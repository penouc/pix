import { randomUUID } from 'node:crypto';

import type { AgentRuntime, ProviderLoginNotice } from '@pi-desktop/agent-domain';
import type { ProviderLoginState } from '@pi-desktop/protocol';

/**
 * Only these can be handed to the OS.
 *
 * The check belongs here, in the code that decides to open something, not only in
 * whatever callback is injected: a verification URI arrives in a network response
 * from the provider, and the component that acts on it is the one that has to
 * refuse a `file://` or an app-registered scheme. Pi validates it too — two
 * independent checks on the same untrusted value is the point.
 */
function isOpenableLoginUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/** A login older than this is abandoned; xAI device codes expire well inside it. */
const MAX_LOGIN_LIFETIME_MS = 20 * 60 * 1000;

interface Pending {
  state: ProviderLoginState;
  controller: AbortController;
  startedAt: number;
  /** Set while a flow is waiting on an answer from the user. */
  answer?: { resolve: (value: string) => void; reject: (error: Error) => void };
}

/**
 * Drives provider logins (subscription/OAuth) from Main.
 *
 * The flow is inherently multi-step and paced by a human in a browser, so it is
 * modelled as a small state machine the Renderer polls rather than a new event
 * channel. That is a deliberate trade: a device-code login takes minutes and the
 * only transitions are "here is your code" → "waiting" → "done", so sub-second
 * latency buys nothing, and polling cannot lose a transition the way a dropped
 * event can.
 *
 * No token ever reaches this class. Pi's `Models.login` persists the credential
 * in its own CredentialStore; this only shepherds the interaction.
 */
export class ProviderLoginService {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly deps: {
      runtime: () => AgentRuntime;
      /** Opens the verification URL in the user's real browser. */
      openExternal: (url: string) => void;
    },
  ) {}

  /** Begin a login and return its id; the flow continues in the background. */
  start(input: { providerId: string; type: 'oauth' | 'apiKey' }): { loginId: string } {
    this.sweep();
    const runtime = this.deps.runtime();
    if (!runtime.loginProvider) {
      throw new Error('This runtime cannot perform provider logins.');
    }

    const loginId = randomUUID();
    const controller = new AbortController();
    const entry: Pending = {
      state: { loginId, providerId: input.providerId, phase: 'starting' },
      controller,
      startedAt: Date.now(),
    };
    this.pending.set(loginId, entry);

    void runtime
      .loginProvider({
        providerId: input.providerId,
        type: input.type,
        signal: controller.signal,
        notify: (notice) => this.onNotice(loginId, notice),
        ask: (question) =>
          new Promise<string>((resolve, reject) => {
            const current = this.pending.get(loginId);
            if (!current) {
              reject(new Error('Login is no longer active.'));
              return;
            }
            current.answer = { resolve, reject };
            current.state = {
              loginId,
              providerId: input.providerId,
              phase: 'question',
              message: question.message,
              questionKind: question.kind,
              ...(question.placeholder ? { placeholder: question.placeholder } : {}),
              ...(question.options ? { options: question.options } : {}),
            };
          }),
      })
      .then(() => {
        this.setState(loginId, { loginId, providerId: input.providerId, phase: 'done' });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.setState(loginId, {
          loginId,
          providerId: input.providerId,
          // A cancel is not a failure worth showing as one.
          phase: controller.signal.aborted ? 'cancelled' : 'failed',
          message,
        });
      });

    return { loginId };
  }

  /** Current state, or undefined once it has been collected or expired. */
  status(loginId: string): ProviderLoginState | undefined {
    this.sweep();
    return this.pending.get(loginId)?.state;
  }

  /** Answer a question the flow is waiting on. */
  submit(loginId: string, value: string): boolean {
    const entry = this.pending.get(loginId);
    if (!entry?.answer) return false;
    const { resolve } = entry.answer;
    delete entry.answer;
    entry.state = { loginId, providerId: entry.state.providerId, phase: 'working' };
    resolve(value);
    return true;
  }

  cancel(loginId: string): boolean {
    const entry = this.pending.get(loginId);
    if (!entry) return false;
    entry.controller.abort();
    // Reject a parked question too, or the flow would sit waiting forever.
    entry.answer?.reject(new Error('Login cancelled'));
    delete entry.answer;
    return true;
  }

  /** Drop a finished login the Renderer has already seen. */
  forget(loginId: string): void {
    this.pending.delete(loginId);
  }

  private onNotice(loginId: string, notice: ProviderLoginNotice): void {
    const entry = this.pending.get(loginId);
    if (!entry) return;
    const providerId = entry.state.providerId;

    switch (notice.kind) {
      case 'device_code': {
        this.setState(loginId, {
          loginId,
          providerId,
          phase: 'device_code',
          userCode: notice.userCode,
          verificationUri: notice.verificationUri,
          ...(notice.expiresInSeconds
            ? { expiresAt: Date.now() + notice.expiresInSeconds * 1000 }
            : {}),
        });
        this.open(notice.verificationUri);
        return;
      }
      case 'auth_url': {
        this.setState(loginId, {
          loginId,
          providerId,
          phase: 'auth_url',
          verificationUri: notice.url,
          ...(notice.instructions ? { message: notice.instructions } : {}),
        });
        this.open(notice.url);
        return;
      }
      case 'info':
      case 'progress': {
        // Keep a device code on screen — progress arrives while polling for it.
        if (entry.state.phase === 'device_code' || entry.state.phase === 'auth_url') {
          entry.state = { ...entry.state, message: notice.message };
          return;
        }
        this.setState(loginId, {
          loginId,
          providerId,
          phase: 'working',
          message: notice.message,
        });
        return;
      }
    }
  }

  private open(url: string): void {
    if (!isOpenableLoginUrl(url)) {
      console.warn('[provider-login] refused to open a non-http(s) verification url');
      return;
    }
    this.deps.openExternal(url);
  }

  private setState(loginId: string, state: ProviderLoginState): void {
    const entry = this.pending.get(loginId);
    if (!entry) return;
    entry.state = state;
  }

  /** Abandon logins that outlived any plausible browser round-trip. */
  private sweep(): void {
    const cutoff = Date.now() - MAX_LOGIN_LIFETIME_MS;
    for (const [loginId, entry] of this.pending) {
      if (entry.startedAt > cutoff) continue;
      entry.controller.abort();
      entry.answer?.reject(new Error('Login expired'));
      this.pending.delete(loginId);
    }
  }
}
