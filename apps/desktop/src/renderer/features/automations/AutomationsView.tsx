import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Clock, Plus } from 'lucide-react';
import { useState } from 'react';

import type {
  Automation,
  AutomationApprovalMode,
  AutomationDraft,
  AutomationRunRef,
} from '@pi-desktop/protocol';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { invoke } from '@/lib/ipc';
import { formatRelative } from '@/lib/status';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/stores/workspace-store';

const MODE_LABEL: Record<AutomationApprovalMode, string> = {
  ask: 'Ask before changes',
  'auto-reads': 'Auto-approve reads',
  'read-only': 'Read-only',
  unattended: 'Unattended',
};

/** Modes that cannot finish without a person present. */
const STALLS_UNATTENDED: AutomationApprovalMode[] = ['ask', 'auto-reads'];

/** Triggers that fire with nobody necessarily watching. */
const UNSUPERVISED_TRIGGERS = ['interval', 'daily', 'event'];

export function AutomationsView({ onOpenSession }: { onOpenSession: (sessionId: string) => void }) {
  const project = useWorkspaceStore((s) => s.project);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AutomationDraft | null>(null);

  const automations = useQuery({
    queryKey: ['automation.list'],
    queryFn: () => invoke<Automation[]>({ method: 'automation.list' }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['automation.list'] });

  const save = useMutation({
    mutationFn: (draft: AutomationDraft) =>
      invoke<Automation>({ method: 'automation.save', params: draft }),
    onSuccess: () => {
      setEditing(null);
      void invalidate();
    },
  });

  const setEnabled = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) =>
      invoke<Automation>({ method: 'automation.setEnabled', params: input }),
    onSuccess: () => void invalidate(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => invoke({ method: 'automation.delete', params: { id } }),
    onSuccess: () => void invalidate(),
  });

  const runNow = useMutation({
    mutationFn: (id: string) =>
      invoke<AutomationRunRef>({ method: 'automation.runNow', params: { id } }),
    onSuccess: (ref) => {
      void invalidate();
      onOpenSession(ref.sessionId);
    },
  });

  const list = automations.data ?? [];

  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[760px] px-8 pt-8 pb-9">
        <div className="mb-1.5 flex items-end gap-3.5">
          <div className="flex-1">
            <div className="text-[11px] font-bold tracking-[0.14em] text-foreground/45 uppercase">
              Automations
            </div>
            <h2 className="mt-2 mb-1.5">Work that starts without you</h2>
          </div>
          <Button
            size="lg"
            disabled={!project}
            title={project ? undefined : 'Open a project first'}
            onClick={() =>
              setEditing({
                name: '',
                projectId: project!.id,
                prompt: '',
                trigger: { kind: 'daily', atMinute: 2 * 60 },
                approvalMode: 'read-only',
                enabled: false,
              })
            }
          >
            <Plus className="h-3.5 w-3.5" />
            New automation
          </Button>
        </div>
        <p className="mb-5 max-w-[520px] text-[13.5px] leading-relaxed text-muted">
          Each automation opens a normal task you can review, keep or revert — snapshots and Revert
          all work exactly as they do for a task you started yourself.
        </p>

        {editing ? (
          <AutomationEditor
            draft={editing}
            saving={save.isPending}
            onCancel={() => setEditing(null)}
            onSave={(draft) => save.mutate(draft)}
          />
        ) : null}

        {!list.length && !editing ? (
          <div className="rounded-[22px] border border-dashed border-foreground/20 px-5 py-8 text-center">
            <div className="mb-1 text-[13px] font-bold">No automations yet</div>
            <div className="mx-auto max-w-[440px] text-[12.5px] leading-relaxed text-muted">
              An automation is a saved prompt plus a trigger. Nothing runs until you enable one.
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-2.5">
          {list.map((automation) => {
            const stalls =
              UNSUPERVISED_TRIGGERS.includes(automation.trigger.kind) &&
              STALLS_UNATTENDED.includes(automation.approvalMode);
            return (
              <div
                key={automation.id}
                className="flex flex-col gap-2.5 rounded-[22px] border border-border bg-background p-4 shadow-[var(--shadow-sm)]"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 text-[14.5px] leading-snug font-bold">
                      {automation.name}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="neutral" className="gap-1.5 text-[10.5px]">
                        <Clock className="h-2.5 w-2.5" />
                        {describeTrigger(automation)}
                      </Badge>
                      <Badge tone="neutral" className="text-[10.5px]">
                        {automation.projectName ?? automation.projectId.slice(0, 8)}
                      </Badge>
                      <span
                        className={cn(
                          'rounded-full px-2.5 py-[2px] text-[10.5px]',
                          automation.approvalMode === 'read-only'
                            ? 'bg-accent-2-100 text-accent-2-800'
                            : 'bg-accent-100 text-accent-800',
                        )}
                      >
                        {MODE_LABEL[automation.approvalMode]}
                      </span>
                    </div>
                  </div>
                  <Switch
                    label={`Enable ${automation.name}`}
                    checked={automation.enabled}
                    disabled={setEnabled.isPending}
                    onChange={(next) => setEnabled.mutate({ id: automation.id, enabled: next })}
                  />
                </div>

                {automation.note ? (
                  <div className="text-[12.5px] leading-relaxed text-muted">{automation.note}</div>
                ) : null}

                {automation.approvalMode === 'unattended' ? (
                  <div className="flex items-start gap-2 rounded-[14px] bg-accent-100 px-3 py-2 text-[11.5px] leading-relaxed text-accent-900">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                    <span>
                      Writes and commands inside the project are approved automatically. Protected
                      paths, anything outside the project root, and{' '}
                      <span className="font-mono">git push</span> are still refused.
                    </span>
                  </div>
                ) : null}

                {stalls ? (
                  <div className="flex items-start gap-2 rounded-[14px] bg-neutral-200 px-3 py-2 text-[11.5px] leading-relaxed text-neutral-800">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                    <span>
                      This mode waits for a person, so a scheduled run will pause until you answer.
                    </span>
                  </div>
                ) : null}

                <div className="flex items-center gap-2.5 border-t border-border pt-2.5">
                  <span className="flex-1 font-mono text-[11.5px] text-muted">
                    {automation.lastRunAt
                      ? `Last run ${formatRelative(automation.lastRunAt)}${automation.lastRunSummary ? ` · ${automation.lastRunSummary}` : ''}`
                      : 'Never run'}
                    {automation.nextRunAt
                      ? ` · next ${new Date(automation.nextRunAt).toLocaleTimeString()}`
                      : ''}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={runNow.isPending}
                    onClick={() => runNow.mutate(automation.id)}
                  >
                    Run now
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setEditing({
                        id: automation.id,
                        name: automation.name,
                        projectId: automation.projectId,
                        prompt: automation.prompt,
                        trigger: automation.trigger,
                        approvalMode: automation.approvalMode,
                        note: automation.note,
                        enabled: automation.enabled,
                      })
                    }
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(automation.id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AutomationEditor({
  draft,
  saving,
  onSave,
  onCancel,
}: {
  draft: AutomationDraft;
  saving: boolean;
  onSave: (draft: AutomationDraft) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(draft);
  const triggerKind = value.trigger.kind;

  return (
    <div className="mb-4 flex flex-col gap-3.5 rounded-[24px] border border-border bg-surface p-5">
      <div className="text-[13.5px] font-bold">
        {draft.id ? 'Edit automation' : 'New automation'}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-muted">Name</span>
        <input
          className="input bg-background"
          value={value.name}
          onChange={(event) => setValue({ ...value, name: event.target.value })}
          placeholder="Nightly: fix failing unit tests"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-muted">Prompt sent to the agent</span>
        <textarea
          className="input min-h-[72px] resize-y rounded-[18px] bg-background py-2"
          value={value.prompt}
          onChange={(event) => setValue({ ...value, prompt: event.target.value })}
          placeholder="Run the unit tests and fix any failing suite."
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted">Trigger</span>
        <Segmented
          aria-label="Trigger"
          options={[
            { value: 'manual', label: 'Manual only' },
            { value: 'interval', label: 'Every N minutes' },
            { value: 'daily', label: 'Daily' },
            { value: 'event', label: 'After a run' },
          ]}
          value={triggerKind}
          onChange={(kind) =>
            setValue({
              ...value,
              trigger:
                kind === 'manual'
                  ? { kind: 'manual' }
                  : kind === 'interval'
                    ? { kind: 'interval', everyMinutes: 60 }
                    : kind === 'event'
                      ? { kind: 'event', on: 'run-completed' }
                      : { kind: 'daily', atMinute: 2 * 60 },
            })
          }
        />
        {value.trigger.kind === 'interval' ? (
          <input
            type="number"
            min={5}
            className="input mt-1 w-40 bg-background"
            value={value.trigger.everyMinutes}
            onChange={(event) =>
              setValue({
                ...value,
                trigger: { kind: 'interval', everyMinutes: Number(event.target.value) || 60 },
              })
            }
          />
        ) : null}
        {value.trigger.kind === 'event' ? (
          <div className="mt-1 rounded-[14px] bg-neutral-200 px-3 py-2 text-[11.5px] leading-relaxed text-neutral-800">
            Fires after a run <em>you</em> start finishes. Runs an automation starts are excluded,
            so two of these can never trigger each other in a loop.
          </div>
        ) : null}
        {value.trigger.kind === 'daily' ? (
          <input
            type="time"
            className="input mt-1 w-40 bg-background"
            value={minutesToTime(value.trigger.atMinute)}
            onChange={(event) =>
              setValue({
                ...value,
                trigger: { kind: 'daily', atMinute: timeToMinutes(event.target.value) },
              })
            }
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted">Approval mode</span>
        <Segmented
          aria-label="Approval mode"
          options={[
            { value: 'read-only', label: 'Read-only' },
            { value: 'ask', label: 'Ask' },
            { value: 'auto-reads', label: 'Auto reads' },
            { value: 'unattended', label: 'Unattended' },
          ]}
          value={value.approvalMode}
          onChange={(mode) => setValue({ ...value, approvalMode: mode })}
        />
        {value.approvalMode === 'unattended' ? (
          <div className="mt-1 rounded-[14px] bg-accent-100 px-3 py-2 text-[11.5px] leading-relaxed text-accent-900">
            Unattended approves writes and commands inside the project with nobody watching. The
            policy floor still holds: protected paths, paths outside the root and{' '}
            <span className="font-mono">git push</span> stay refused, and every automatic decision
            is written to the audit log.
          </div>
        ) : null}
      </div>

      <label className="flex items-center gap-2.5">
        <Switch
          label="Enabled"
          checked={value.enabled}
          onChange={(next) => setValue({ ...value, enabled: next })}
        />
        <span className="text-[12.5px]">Enabled</span>
      </label>

      <div className="flex items-center gap-2">
        <Button
          disabled={saving || !value.name.trim() || !value.prompt.trim()}
          onClick={() => onSave(value)}
        >
          {draft.id ? 'Save changes' : 'Create automation'}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function describeTrigger(automation: Automation): string {
  if (automation.trigger.kind === 'manual') return 'Manual only';
  if (automation.trigger.kind === 'event') return 'After a run finishes';
  if (automation.trigger.kind === 'interval') {
    return `Every ${automation.trigger.everyMinutes} min`;
  }
  return `Daily · ${minutesToTime(automation.trigger.atMinute)}`;
}

function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}
