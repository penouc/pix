import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { ProviderLoginState } from '@pi-desktop/protocol';

import { Button } from '@/components/ui/button';
import { invoke, IpcError } from '@/lib/ipc';

/** Fast enough to feel responsive, slow enough not to hammer Main. */
const POLL_MS = 700;

/**
 * A provider subscription login, driven by Pi.
 *
 * For xAI (and any other device-code provider) the shape is: Pi asks the provider
 * for a code, we open the verification page in the real browser, and Pi polls
 * until the user has approved it there. The code is shown here as well as opened,
 * because a login that only worked if the browser handoff succeeded would be
 * impossible to recover from.
 *
 * Closing the dialog cancels the flow rather than leaving it running invisibly.
 */
export function ProviderLoginDialog({
  loginId,
  providerName,
  onClose,
}: {
  loginId: string;
  providerName: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ProviderLoginState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [copied, setCopied] = useState(false);
  /** Kept in a ref so the poll loop is not restarted by every state change. */
  const finished = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (cancelled || finished.current) return;
      try {
        const next = await invoke<ProviderLoginState>({
          method: 'provider.loginStatus',
          params: { loginId },
        });
        if (cancelled) return;
        setState(next);
        if (next.phase === 'done' || next.phase === 'failed' || next.phase === 'cancelled') {
          finished.current = true;
          if (next.phase === 'done') {
            // The provider now has a credential, so the model lists change.
            await queryClient.invalidateQueries({ queryKey: ['agent.models'] });
            await queryClient.invalidateQueries({ queryKey: ['provider.listAvailable'] });
            await queryClient.invalidateQueries({ queryKey: ['provider.settings'] });
          }
          return;
        }
      } catch (err) {
        if (cancelled) return;
        // A login Main has forgotten cannot be recovered by polling harder.
        finished.current = true;
        setError(err instanceof IpcError ? err.message : String(err));
        return;
      }
      setTimeout(() => void poll(), POLL_MS);
    }

    void poll();
    return () => {
      cancelled = true;
    };
  }, [loginId, queryClient]);

  function close() {
    // Cancel unless it already finished — otherwise the flow keeps polling the
    // provider for a code nobody is going to enter.
    if (!finished.current) {
      void invoke({ method: 'provider.loginCancel', params: { loginId } }).catch(console.error);
    }
    onClose();
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (err) {
      console.error('[login] copy failed', err);
    }
  }

  const phase = state?.phase ?? 'starting';

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-[rgba(23,24,26,.42)]"
      role="presentation"
      onClick={close}
    >
      <div
        className="w-[440px] overflow-hidden rounded-[24px] bg-background shadow-[var(--shadow-lg)]"
        style={{ animation: 'pi-in .16s ease-out' }}
        role="dialog"
        aria-modal="true"
        aria-label={`Sign in to ${providerName}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h4 className="m-0">Sign in to {providerName}</h4>
            <p className="mt-0.5 mb-0 text-[12px] text-muted">
              {phase === 'done'
                ? 'Signed in.'
                : phase === 'failed' || error
                  ? 'Sign-in did not complete.'
                  : phase === 'cancelled'
                    ? 'Cancelled.'
                    : 'Approve this in your browser, then come back.'}
            </p>
          </div>
          <Button variant="secondary" size="icon" className="h-7 w-7" onClick={close} title="Close">
            <X className="h-[14px] w-[14px]" />
          </Button>
        </div>

        <div className="px-5 py-4">
          {error ? <Problem>{error}</Problem> : null}

          {phase === 'starting' ? <Waiting>Asking {providerName} for a code…</Waiting> : null}

          {phase === 'device_code' && state?.userCode ? (
            <>
              <p className="mt-0 mb-2 text-[12.5px] leading-relaxed text-muted">
                Enter this code on the page that just opened:
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-xl bg-surface px-3.5 py-2.5 text-center font-mono text-[20px] tracking-[0.18em] select-all">
                  {state.userCode}
                </code>
                <Button
                  variant="secondary"
                  size="icon"
                  className="h-9 w-9"
                  title="Copy code"
                  onClick={() => void copyCode(state.userCode!)}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              {state.verificationUri ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() =>
                    void invoke({
                      method: 'system.openExternal',
                      params: { url: state.verificationUri! },
                    }).catch(console.error)
                  }
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open the page again
                </Button>
              ) : null}
              <Waiting>{state.message ?? 'Waiting for you to approve it…'}</Waiting>
            </>
          ) : null}

          {phase === 'auth_url' ? (
            <>
              <p className="mt-0 mb-2 text-[12.5px] leading-relaxed text-muted">
                {state?.message ?? 'Authorise in the browser window that just opened.'}
              </p>
              <Waiting>Waiting for authorisation…</Waiting>
            </>
          ) : null}

          {phase === 'question' && state ? (
            <>
              <p className="mt-0 mb-2 text-[12.5px] leading-relaxed">{state.message}</p>
              {state.questionKind === 'select' ? (
                <div className="flex flex-col gap-1.5">
                  {(state.options ?? []).map((option) => (
                    <Button
                      key={option.id}
                      variant="secondary"
                      onClick={() => void submit(loginId, option.id, setAnswer, setError)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2 font-mono text-[13px] outline-none focus:border-accent/50"
                    type={state.questionKind === 'password' ? 'password' : 'text'}
                    placeholder={state.placeholder ?? ''}
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || !answer.trim()) return;
                      event.preventDefault();
                      void submit(loginId, answer.trim(), setAnswer, setError);
                    }}
                  />
                  <Button
                    disabled={!answer.trim()}
                    onClick={() => void submit(loginId, answer.trim(), setAnswer, setError)}
                  >
                    Continue
                  </Button>
                </div>
              )}
            </>
          ) : null}

          {phase === 'working' ? <Waiting>{state?.message ?? 'Working…'}</Waiting> : null}

          {phase === 'done' ? (
            <p className="m-0 text-[12.5px] leading-relaxed">
              {providerName} is connected. Its models are available in the picker now.
            </p>
          ) : null}

          {phase === 'failed' && state?.message ? <Problem>{state.message}</Problem> : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-surface px-5 py-3">
          <Button variant={phase === 'done' ? 'primary' : 'secondary'} onClick={close}>
            {phase === 'done' ? 'Done' : 'Cancel'}
          </Button>
        </div>
      </div>
    </div>
  );
}

async function submit(
  loginId: string,
  value: string,
  setAnswer: (value: string) => void,
  setError: (value: string) => void,
) {
  try {
    await invoke({ method: 'provider.loginSubmit', params: { loginId, value } });
    setAnswer('');
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
  }
}

function Waiting({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 flex items-center gap-2 text-[12px] text-muted">
      <span
        className="h-1.5 w-1.5 rounded-full bg-accent"
        style={{ animation: 'pi-pulse 1.4s ease-in-out infinite' }}
      />
      {children}
    </div>
  );
}

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 rounded-xl border border-accent/30 bg-accent-100 px-3 py-2 text-[12.5px] leading-relaxed text-accent-900">
      {children}
    </p>
  );
}
