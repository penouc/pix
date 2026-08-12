import { Check, FolderOpen, KeyRound, MessageSquare } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { ONBOARDING_STARTER_PROMPT } from './use-onboarding';

export interface OnboardingChecklistProps {
  steps: {
    openProject: boolean;
    addModel: boolean;
    firstMessage: boolean;
  };
  onOpenFolder: () => void;
  onOpenPlayground: () => void;
  onOpenProviders: () => void;
  onUseStarter: () => void;
  onSkip: () => void;
}

/**
 * Cold-start checklist on the blank Run surface (docs/onboarding.md).
 * Not a wizard — lives in the real empty state and can be skipped forever.
 */
export function OnboardingChecklist({
  steps,
  onOpenFolder,
  onOpenPlayground,
  onOpenProviders,
  onUseStarter,
  onSkip,
}: OnboardingChecklistProps) {
  const readyForStarter = steps.openProject && steps.addModel && !steps.firstMessage;

  return (
    <div className="flex flex-col items-stretch gap-5 px-5 py-14">
      <div className="text-center">
        <h2 className="text-sm font-bold">Get started</h2>
        <p className="mx-auto mt-1.5 max-w-[340px] text-[12.5px] leading-relaxed text-muted">
          Open a folder, add a model, then send a message — that&apos;s the whole first run.
        </p>
      </div>

      <ol className="mx-auto flex w-full max-w-[420px] flex-col gap-2.5">
        <Step
          done={steps.openProject}
          index={1}
          icon={<FolderOpen className="h-3.5 w-3.5" />}
          title="Open a project folder"
          body={
            steps.openProject ? (
              <span className="text-[12px] text-muted">Folder ready.</span>
            ) : (
              <div className="flex flex-col items-start gap-2">
                <Button size="sm" onClick={onOpenFolder}>
                  <FolderOpen className="h-3.5 w-3.5" />
                  Open folder…
                </Button>
                <button
                  type="button"
                  onClick={onOpenPlayground}
                  className="cursor-pointer border-0 bg-transparent p-0 text-left text-[11.5px] text-muted underline-offset-2 hover:text-foreground hover:underline"
                >
                  Or try the scratch playground
                </button>
              </div>
            )
          }
        />
        <Step
          done={steps.addModel}
          index={2}
          icon={<KeyRound className="h-3.5 w-3.5" />}
          title="Add a model (API key or sign-in)"
          body={
            steps.addModel ? (
              <span className="text-[12px] text-muted">Provider ready.</span>
            ) : (
              <Button size="sm" onClick={onOpenProviders}>
                <KeyRound className="h-3.5 w-3.5" />
                Open Providers…
              </Button>
            )
          }
        />
        <Step
          done={steps.firstMessage}
          index={3}
          icon={<MessageSquare className="h-3.5 w-3.5" />}
          title="Send your first message"
          body={
            steps.firstMessage ? (
              <span className="text-[12px] text-muted">You&apos;re in.</span>
            ) : readyForStarter ? (
              <div className="flex flex-col items-start gap-2">
                <p className="text-[12px] leading-relaxed text-muted">
                  Starter (editable in the composer):
                </p>
                <p className="rounded-xl bg-foreground/[0.04] px-3 py-2 text-left text-[12px] leading-relaxed text-foreground/80">
                  {ONBOARDING_STARTER_PROMPT}
                </p>
                <Button size="sm" onClick={onUseStarter}>
                  Use starter prompt
                </Button>
              </div>
            ) : (
              <span className="text-[12px] text-muted">
                Finish the steps above, then type below — or use the starter when it appears.
              </span>
            )
          }
        />
      </ol>

      <div className="text-center">
        <button
          type="button"
          onClick={onSkip}
          className="cursor-pointer border-0 bg-transparent text-[12px] text-muted underline-offset-2 hover:text-foreground hover:underline"
        >
          Skip for now — I&apos;ll explore on my own
        </button>
      </div>
    </div>
  );
}

function Step({
  done,
  index,
  icon,
  title,
  body,
}: {
  done: boolean;
  index: number;
  icon: ReactNode;
  title: string;
  body: ReactNode;
}) {
  return (
    <li
      className={cn(
        'flex gap-3 rounded-2xl px-3.5 py-3',
        done ? 'bg-foreground/[0.03]' : 'bg-surface shadow-[var(--shadow-sm)]',
      )}
    >
      <span
        className={cn(
          'mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full text-[11px] font-bold',
          done ? 'bg-foreground/10 text-foreground' : 'bg-foreground/[0.06] text-muted',
        )}
        aria-hidden
      >
        {done ? <Check className="h-3.5 w-3.5" /> : index}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-bold">
          <span className="text-muted">{icon}</span>
          {title}
        </div>
        {body}
      </div>
    </li>
  );
}
