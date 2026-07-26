import { describe, expect, it, vi } from 'vitest';

import type {
  AgentRuntime,
  ProviderLoginNotice,
  ProviderLoginQuestion,
} from '@pi-desktop/agent-domain';

import { ProviderLoginService } from './provider-login-service.js';

type LoginArgs = {
  providerId: string;
  type: 'oauth' | 'apiKey';
  notify: (notice: ProviderLoginNotice) => void;
  ask: (question: ProviderLoginQuestion) => Promise<string>;
  signal?: AbortSignal;
};

/** A runtime whose login flow the test drives step by step. */
function harness() {
  const opened: string[] = [];
  let captured: LoginArgs | undefined;
  let settle: { resolve: () => void; reject: (error: Error) => void } | undefined;

  const runtime = {
    loginProvider: (args: LoginArgs) => {
      captured = args;
      return new Promise<void>((resolve, reject) => {
        settle = { resolve, reject };
      });
    },
  } as unknown as AgentRuntime;

  const service = new ProviderLoginService({
    runtime: () => runtime,
    openExternal: (url) => opened.push(url),
  });

  return {
    service,
    opened,
    args: () => captured!,
    finish: () => settle!.resolve(),
    fail: (message: string) => settle!.reject(new Error(message)),
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ProviderLoginService', () => {
  it('shows a device code and opens the verification page', async () => {
    const h = harness();
    const { loginId } = h.service.start({ providerId: 'xai', type: 'oauth' });

    expect(h.service.status(loginId)).toMatchObject({ phase: 'starting', providerId: 'xai' });

    h.args().notify({
      kind: 'device_code',
      userCode: 'ABCD-1234',
      verificationUri: 'https://auth.x.ai/device',
      expiresInSeconds: 600,
    });

    expect(h.service.status(loginId)).toMatchObject({
      phase: 'device_code',
      userCode: 'ABCD-1234',
      verificationUri: 'https://auth.x.ai/device',
    });
    expect(h.opened).toEqual(['https://auth.x.ai/device']);
    expect(h.service.status(loginId)?.expiresAt).toBeGreaterThan(Date.now());
  });

  it('refuses to hand a non-https login url to the OS', () => {
    const h = harness();
    h.service.start({ providerId: 'xai', type: 'oauth' });

    // Pi validates this too; this is the boundary that calls openExternal, so it
    // is the one that must not be talked into launching another app.
    h.args().notify({ kind: 'auth_url', url: 'file:///etc/passwd' });
    h.args().notify({ kind: 'auth_url', url: 'zoommtg://join' });

    expect(h.opened).toEqual([]);
  });

  it('keeps the code visible while progress arrives', () => {
    const h = harness();
    const { loginId } = h.service.start({ providerId: 'xai', type: 'oauth' });
    h.args().notify({
      kind: 'device_code',
      userCode: 'WXYZ-9999',
      verificationUri: 'https://auth.x.ai/device',
    });

    // Polling emits progress; it must not replace the code the user is typing.
    h.args().notify({ kind: 'progress', message: 'Waiting for approval…' });

    expect(h.service.status(loginId)).toMatchObject({
      phase: 'device_code',
      userCode: 'WXYZ-9999',
      message: 'Waiting for approval…',
    });
  });

  it('parks a question and resolves it with the submitted answer', async () => {
    const h = harness();
    const { loginId } = h.service.start({ providerId: 'openrouter', type: 'oauth' });

    const answered = h.args().ask({ message: 'Paste the code', kind: 'manual_code' });
    await tick();
    expect(h.service.status(loginId)).toMatchObject({
      phase: 'question',
      message: 'Paste the code',
      questionKind: 'manual_code',
    });

    expect(h.service.submit(loginId, 'pasted-code')).toBe(true);
    await expect(answered).resolves.toBe('pasted-code');
    expect(h.service.status(loginId)).toMatchObject({ phase: 'working' });
    // A second submit has nothing to answer.
    expect(h.service.submit(loginId, 'again')).toBe(false);
  });

  it('reports success once the flow resolves', async () => {
    const h = harness();
    const { loginId } = h.service.start({ providerId: 'xai', type: 'oauth' });
    h.finish();
    await tick();

    expect(h.service.status(loginId)).toMatchObject({ phase: 'done' });
  });

  it('reports a failure with its reason', async () => {
    const h = harness();
    const { loginId } = h.service.start({ providerId: 'xai', type: 'oauth' });
    h.fail('device code expired');
    await tick();

    expect(h.service.status(loginId)).toMatchObject({
      phase: 'failed',
      message: 'device code expired',
    });
  });

  it('cancelling aborts the flow and is not reported as a failure', async () => {
    const h = harness();
    const { loginId } = h.service.start({ providerId: 'xai', type: 'oauth' });
    const signal = h.args().signal!;

    expect(h.service.cancel(loginId)).toBe(true);
    expect(signal.aborted).toBe(true);

    // Pi rejects with its own cancellation error once aborted.
    h.fail('Login cancelled');
    await tick();
    expect(h.service.status(loginId)).toMatchObject({ phase: 'cancelled' });
  });

  it('cancelling releases a parked question instead of leaving it hanging', async () => {
    const h = harness();
    const { loginId } = h.service.start({ providerId: 'openrouter', type: 'oauth' });
    const answered = h.args().ask({ message: 'Paste the code', kind: 'manual_code' });
    await tick();

    h.service.cancel(loginId);

    await expect(answered).rejects.toThrow(/cancelled/i);
  });

  it('refuses to start when the runtime cannot log in', () => {
    const service = new ProviderLoginService({
      runtime: () => ({}) as unknown as AgentRuntime,
      openExternal: vi.fn(),
    });

    expect(() => service.start({ providerId: 'xai', type: 'oauth' })).toThrow(/cannot perform/i);
  });

  it('forgets a login so its state is no longer served', async () => {
    const h = harness();
    const { loginId } = h.service.start({ providerId: 'xai', type: 'oauth' });
    h.finish();
    await tick();

    h.service.forget(loginId);
    expect(h.service.status(loginId)).toBeUndefined();
  });
});
