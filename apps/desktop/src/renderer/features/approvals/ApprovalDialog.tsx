import { Lock } from 'lucide-react';
import { useEffect, useRef } from 'react';

import type { ApprovalDecision } from '@pi-desktop/protocol';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ApprovalRequest } from '@/stores/agent-stream-store';

/**
 * The design's approval modal. The thread already carries an inline approval
 * card, so this is used when a decision is pending while the user is looking at
 * another screen — an approval must never be somewhere you cannot see it.
 *
 * Dismissing only closes the modal: the run stays paused and the inline card
 * keeps the decision available. Nothing here decides on the user's behalf.
 */
export function ApprovalDialog({
  approval,
  onDecide,
  onDismiss,
}: {
  approval: ApprovalRequest;
  onDecide: (decision: ApprovalDecision) => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div
      className="dialog-backdrop z-50"
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onDismiss();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Approval required"
        className="dialog elev-lg outline-none"
        style={{ animation: 'pi-in .18s ease-out' }}
      >
        <div className="flex items-start gap-3">
          <span className="grid h-[38px] w-[38px] flex-none place-items-center rounded-full bg-accent-200">
            <Lock className="h-[19px] w-[19px] text-accent-800" />
          </span>
          <div className="min-w-0">
            <div className="dialog-title">
              {approval.command ? 'Run this command?' : `Allow ${approval.toolName}?`}
            </div>
            <div className="dialog-body mt-1 flex items-center gap-2">
              <span className="font-mono">{approval.toolName}</span>
              <Badge tone="outline" className="text-[10.5px]">
                risk: {approval.riskLevel}
              </Badge>
            </div>
          </div>
        </div>

        {approval.command ? (
          <pre className="output-pre rounded-[18px] px-4 py-3 text-[12.5px]">
            {approval.command}
          </pre>
        ) : (
          <div className="text-[13px] leading-normal">{approval.summary}</div>
        )}

        {approval.affectedPaths.length ? (
          <div className="font-mono text-[11.5px] break-all text-muted">
            {approval.affectedPaths.slice(0, 5).join('\n')}
            {approval.affectedPaths.length > 5
              ? `\n+${approval.affectedPaths.length - 5} more`
              : ''}
          </div>
        ) : null}

        {approval.reasons.length ? (
          <div className="flex flex-col gap-[7px] text-[12.5px]">
            {approval.reasons.map((reason) => (
              <div key={reason} className="flex items-start gap-2.5">
                <span className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-accent-2" />
                <span className="leading-normal">{reason}</span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-[var(--space-2)] flex flex-col gap-[var(--space-2)]">
          <Button className="btn-block h-[38px]" onClick={() => onDecide('allow-once')}>
            Allow once
          </Button>
          <div className="flex items-center gap-[var(--space-2)]">
            {approval.rememberable ? (
              <>
                <span className="flex-none text-xs text-muted">Remember for</span>
                <Button
                  variant="secondary"
                  className="h-8 flex-1"
                  onClick={() => onDecide('allow-session')}
                >
                  this session
                </Button>
                <Button
                  variant="secondary"
                  className="h-8 flex-1"
                  onClick={() => onDecide('allow-project')}
                >
                  this project
                </Button>
              </>
            ) : (
              <span className="flex-1 text-xs text-muted">
                This risk level can&apos;t be remembered.
              </span>
            )}
            <Button
              variant="ghost"
              className="h-8 flex-none text-accent-800"
              onClick={() => onDecide('deny')}
            >
              Deny
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
