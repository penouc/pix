import { MessageCircleQuestion } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { PendingAsk } from '@/stores/agent-stream-store';

/**
 * #12 — a structured question from the agent, shown as a modal.
 *
 * The agent's `ask` tool blocks the run until this is answered. Options are
 * rendered as buttons; when the agent allows free text (or offers no options),
 * a text field is available. Answering sends `agent.answerAsk`, which resolves
 * the blocked tool call with the chosen answer and the run continues.
 */
export function AskDialog({
  ask,
  onSubmit,
  onDismiss,
}: {
  ask: PendingAsk;
  onSubmit: (answer: string) => void;
  onDismiss: () => void;
}) {
  const [freeText, setFreeText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const hasOptions = (ask.options?.length ?? 0) > 0;
  const allowFreeText = ask.allowFreeText ?? true;

  useEffect(() => {
    // Focus the text field when there is one (free-text or no options).
    if (!hasOptions || allowFreeText) inputRef.current?.focus();
  }, [hasOptions, allowFreeText]);

  function submitFreeText() {
    const value = freeText.trim();
    if (!value) return;
    onSubmit(value);
  }

  return (
    <div
      className="dialog-backdrop z-50"
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onDismiss();
        if (event.key === 'Enter' && hasOptions && !allowFreeText) onDismiss();
      }}
    >
      <div
        ref={inputRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Question from the agent"
        className="dialog elev-lg outline-none"
        style={{ animation: 'pi-in .18s ease-out' }}
      >
        <div className="flex items-start gap-3">
          <span className="grid h-[38px] w-[38px] flex-none place-items-center rounded-full bg-accent-200">
            <MessageCircleQuestion className="h-[19px] w-[19px] text-accent-800" />
          </span>
          <div className="min-w-0">
            <div className="dialog-title">The agent needs your input</div>
          </div>
        </div>

        <div className="dialog-body mt-2 whitespace-pre-wrap text-[13.5px] leading-normal">
          {ask.question}
        </div>

        {hasOptions ? (
          <div className="flex flex-col gap-2">
            {ask.options!.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onSubmit(option.label)}
                className="group flex cursor-pointer items-center gap-2.5 rounded-[14px] border border-border bg-surface px-3.5 py-2.5 text-left text-[13px] font-medium transition-colors hover:border-accent hover:bg-accent-50 hover:text-accent-900"
              >
                <span className="h-2 w-2 flex-none rounded-full bg-foreground/25 transition-colors group-hover:bg-accent" />
                {option.label}
              </button>
            ))}
          </div>
        ) : null}

        {allowFreeText ? (
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={freeText}
              onChange={(event) => setFreeText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitFreeText();
              }}
              placeholder={hasOptions ? 'Or type your own answer…' : 'Type your answer…'}
              className="input flex-1"
            />
            <button
              type="button"
              disabled={!freeText.trim()}
              onClick={submitFreeText}
              className="btn btn-accent flex-none"
            >
              Send
            </button>
          </div>
        ) : null}

        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onDismiss}>
            Abort ask
          </button>
        </div>
      </div>
    </div>
  );
}
