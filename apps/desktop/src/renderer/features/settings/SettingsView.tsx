import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import type {
  AppInfo,
  ApprovalMode,
  AuditSummary,
  RememberedRule,
  SetUiSettingInput,
  Settings,
  UiFlags,
} from '@pi-desktop/protocol';

import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { SettingsPanel } from '@/features/settings/SettingsPanel';
import { UsageTab } from '@/features/settings/UsageTab';
import { invoke } from '@/lib/ipc';
import { cn } from '@/lib/utils';
import { useUiPrefsStore } from '@/stores/ui-prefs-store';

type TabId =
  | 'providers'
  | 'permissions'
  | 'projects'
  | 'checkpoints'
  | 'appearance'
  | 'notifications'
  | 'usage'
  | 'about';

const TABS: Array<{ id: TabId; name: string; title: string; desc: string }> = [
  {
    id: 'providers',
    name: 'Providers & models',
    title: 'Providers & models',
    desc: 'API keys are encrypted with the macOS Keychain and never shown again.',
  },
  {
    id: 'permissions',
    name: 'Permissions',
    title: 'Permissions & security',
    desc: 'What the agent may do on its own, and what always stops for you.',
  },
  {
    id: 'projects',
    name: 'Projects & trust',
    title: 'Projects & trust',
    desc: 'Which folders the agent may open, and what it is allowed to see.',
  },
  {
    id: 'checkpoints',
    name: 'Checkpoints',
    title: 'Checkpoints & history',
    desc: 'How much of a run can be undone, and for how long.',
  },
  {
    id: 'appearance',
    name: 'Appearance',
    title: 'Appearance',
    desc: 'How the workbench looks while a run is streaming.',
  },
  {
    id: 'usage',
    name: 'Usage',
    title: 'Usage & cost',
    desc: 'What the agent has actually run, and what it cost.',
  },
  {
    id: 'notifications',
    name: 'Notifications',
    title: 'Notifications',
    desc: 'Long runs should be able to page you.',
  },
  {
    id: 'about',
    name: 'About',
    title: 'About & diagnostics',
    desc: 'Build information and logs.',
  },
];

/**
 * The design's tab rail. Only rows that actually take effect are rendered —
 * the design also sketches Agent runtime and Notifications tabs, but nothing
 * behind them exists yet, and a switch that changes nothing is worse than an
 * absent one.
 */
export function SettingsView({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<TabId>('providers');
  const active = TABS.find((entry) => entry.id === tab)!;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex w-[186px] flex-none flex-col gap-0.5 border-r border-border px-2.5 py-4">
        <div className="px-2.5 pt-0.5 pb-2 text-[10px] font-bold tracking-[0.14em] text-foreground/42 uppercase">
          Preferences
        </div>
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={cn(
              'w-full cursor-pointer rounded-xl px-3 py-[7px] text-left text-[12.5px] transition-colors',
              entry.id === tab
                ? 'bg-surface font-bold text-foreground'
                : 'text-foreground/60 hover:bg-foreground/[0.06]',
            )}
          >
            {entry.name}
          </button>
        ))}
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {tab === 'providers' ? (
          <SettingsPanel onClose={onClose} />
        ) : (
          <div
            className={cn(
              'mx-auto px-8 pt-8 pb-11',
              tab === 'usage' ? 'max-w-[860px]' : 'max-w-[660px]',
            )}
          >
            <div className="mb-6 flex items-start justify-between gap-3.5">
              <div>
                <h2 className="mb-1.5">{active.title}</h2>
                <p className="m-0 max-w-[440px] text-[13px] leading-relaxed text-muted">
                  {active.desc}
                </p>
              </div>
              <Button variant="secondary" size="icon" className="h-8 w-8" onClick={onClose}>
                <X className="h-[15px] w-[15px]" />
              </Button>
            </div>

            {tab === 'appearance' ? <AppearanceTab /> : null}
            {tab === 'notifications' ? <NotificationsTab /> : null}
            {tab === 'usage' ? <UsageTab /> : null}
            {tab === 'permissions' ? <PermissionsTab /> : null}
            {tab === 'projects' ? <ProjectsTab /> : null}
            {tab === 'checkpoints' ? <CheckpointsTab /> : null}
            {tab === 'about' ? <AboutTab /> : null}
          </div>
        )}
      </div>
    </div>
  );
}

function AppearanceTab() {
  const prefs = useUiPrefsStore();
  return (
    <>
      <Group label="Interface">
        <Row name="Theme" desc="Also switches the diff viewer's syntax theme.">
          <Segmented
            aria-label="Theme"
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'System' },
            ]}
            value={prefs.theme}
            onChange={(value) => prefs.set('theme', value)}
          />
        </Row>
        <Row name="Density" desc="Affects list rows and the composer.">
          <Segmented
            aria-label="Density"
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ]}
            value={prefs.density}
            onChange={(value) => prefs.set('density', value)}
          />
        </Row>
        <Row name="Reduce motion" desc="Stops the pulsing status dots and typing indicator.">
          <Switch
            label="Reduce motion"
            checked={prefs.reduceMotion}
            onChange={(value) => prefs.set('reduceMotion', value)}
          />
        </Row>
      </Group>
      <Group label="Code & diffs">
        <Row name="Default diff view" desc="Used by the review rail and the full diff.">
          <Segmented
            aria-label="Default diff view"
            options={[
              { value: 'unified', label: 'Unified' },
              { value: 'split', label: 'Split' },
            ]}
            value={prefs.diffStyle}
            onChange={(value) => prefs.set('diffStyle', value)}
          />
        </Row>
        <Row name="Collapse unchanged context" desc="Shows three lines around each hunk.">
          <Switch
            label="Collapse unchanged context"
            checked={prefs.collapseContext}
            onChange={(value) => prefs.set('collapseContext', value)}
          />
        </Row>
      </Group>
    </>
  );
}

function PermissionsTab() {
  const info = useQuery({
    queryKey: ['app.getInfo'],
    queryFn: () => invoke<AppInfo>({ method: 'app.getInfo' }),
  });
  const policy = info.data?.policy;
  return (
    <>
      <Group label="Approvals">
        <DefaultApprovalModeRow />
        <RememberedDecisionsRow />
      </Group>
      <Group label="What always stops">
        <Row
          stacked
          name="Protected paths"
          desc="Refused before the tool runs, even if you approve. Read from packages/security/src/protected-paths.ts, so this list cannot drift from what is enforced."
        >
          {policy ? (
            <div className="flex flex-wrap gap-1">
              {policy.protectedBasenames.map((name) => (
                <PathChip key={`file:${name}`}>{name}</PathChip>
              ))}
              {policy.protectedDirectories.map((dir) => (
                <PathChip key={`dir:${dir}`}>{dir}/**</PathChip>
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted">—</span>
          )}
        </Row>
        <Row
          name="Paths outside the project root"
          desc="Canonicalised, then rejected if they escape the workspace."
        >
          <Mono>always refused</Mono>
        </Row>
        <Row
          name="git push and other external side effects"
          desc="Never remembered, never automatic."
        >
          <Mono>always asks or refuses</Mono>
        </Row>
      </Group>
      <Group label="How decisions are made">
        <Row name="Process tree" desc="Stop kills the command and everything it spawned.">
          <Mono>enforced</Mono>
        </Row>
        <Row
          name="Terminal command limits"
          desc="A command you run in the Terminal panel is capped and killed with its children."
        >
          <Mono>
            {policy
              ? `${policy.terminalTimeoutSeconds}s · ${Math.round(policy.terminalOutputCapBytes / 1024)} KB`
              : '—'}
          </Mono>
        </Row>
        <AuditRow />
      </Group>
    </>
  );
}

const MODE_DESC: Record<ApprovalMode, string> = {
  ask: 'Every write and every command waits for you.',
  'auto-reads': 'Writes inside the project run freely; commands still wait.',
  'read-only': 'Nothing is written and no command runs — mutations are refused, not queued.',
};

function DefaultApprovalModeRow() {
  const queryClient = useQueryClient();
  const mode = useQuery({
    queryKey: ['agent.getApprovalMode', undefined],
    queryFn: () => invoke<{ mode: ApprovalMode }>({ method: 'agent.getApprovalMode' }),
  });
  const setMode = useMutation({
    mutationFn: (next: ApprovalMode) =>
      invoke({ method: 'agent.setApprovalMode', params: { mode: next } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['agent.getApprovalMode'] }),
  });
  const current = mode.data?.mode ?? 'auto-reads';

  return (
    <Row name="Default approval mode" desc={MODE_DESC[current]}>
      <Segmented
        aria-label="Default approval mode"
        options={[
          { value: 'ask', label: 'Ask' },
          { value: 'auto-reads', label: 'Auto writes' },
          { value: 'read-only', label: 'Read-only' },
        ]}
        value={current}
        onChange={(next) => setMode.mutate(next)}
      />
    </Row>
  );
}

function RememberedDecisionsRow() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const rules = useQuery({
    queryKey: ['permissions.listRemembered'],
    queryFn: () => invoke<RememberedRule[]>({ method: 'permissions.listRemembered' }),
  });
  const clear = useMutation({
    mutationFn: (filter?: { scope?: 'session' | 'project'; scopeId?: string }) =>
      invoke<{ cleared: number }>({ method: 'permissions.clearRemembered', params: filter }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['permissions.listRemembered'] }),
  });

  const list = rules.data ?? [];
  const projects = new Set(list.filter((r) => r.scope === 'project').map((r) => r.scopeId));

  return (
    <>
      <Row
        name="Remembered decisions"
        desc={
          list.length
            ? `${list.length} rule${list.length === 1 ? '' : 's'} across ${projects.size} project${projects.size === 1 ? '' : 's'}. Held in memory for this app run only.`
            : 'Nothing remembered. "Allow session" and "Allow project" rules appear here.'
        }
      >
        <span className="flex flex-none items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setOpen((value) => !value)}>
            {open ? 'Hide' : 'Manage'}
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={!list.length || clear.isPending}
            onClick={() => clear.mutate(undefined)}
          >
            Forget all
          </Button>
        </span>
      </Row>
      {open ? (
        <div className="flex flex-col gap-1 border-b border-border py-2.5">
          {!list.length ? (
            <div className="px-1 text-[12px] text-muted">No remembered rules.</div>
          ) : (
            list.map((rule) => (
              <div
                key={`${rule.scope}:${rule.scopeId}:${rule.key}`}
                className="flex items-center gap-2 rounded-[12px] px-1 py-1 text-[11.5px] hover:bg-foreground/[0.04]"
              >
                <span
                  className={cn(
                    'rounded-full px-2 py-[1px] text-[10px]',
                    rule.scope === 'project'
                      ? 'bg-accent-100 text-accent-800'
                      : 'bg-neutral-200 text-neutral-800',
                  )}
                >
                  {rule.scope}
                </span>
                <span className="font-mono">{rule.toolName}</span>
                <span className="text-muted">{rule.riskLevel}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-muted" title={rule.focus}>
                  {rule.focus}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={clear.isPending}
                  onClick={() => clear.mutate({ scope: rule.scope, scopeId: rule.scopeId })}
                >
                  Forget
                </Button>
              </div>
            ))
          )}
        </div>
      ) : null}
    </>
  );
}

function AuditRow() {
  const audit = useQuery({
    queryKey: ['audit.summary'],
    queryFn: () => invoke<AuditSummary>({ method: 'audit.summary' }),
  });
  const data = audit.data;
  return (
    <Row
      name="Audit log"
      desc={
        data?.exists
          ? `${data.events.toLocaleString()} events recorded locally, ${data.approvals.toLocaleString()} of them approvals.`
          : 'Every decision is appended locally, with secrets redacted. Nothing recorded yet.'
      }
    >
      <Button
        variant="secondary"
        size="sm"
        disabled={!data?.exists}
        onClick={() => void invoke({ method: 'system.revealPath', params: { path: data!.path } })}
      >
        Reveal
      </Button>
    </Row>
  );
}

function ProjectsTab() {
  const queryClient = useQueryClient();
  const { flags } = useUiFlags();
  const pickFolder = useMutation({
    mutationFn: () => invoke<UiFlags>({ method: 'settings.pickProjectsFolder' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['settings.get'] }),
  });
  const clearFolder = useMutation({
    mutationFn: () =>
      invoke<UiFlags>({ method: 'settings.setDefaultProjectsFolder', params: { path: '' } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['settings.get'] }),
  });

  return (
    <Group label="Opening">
      <Row name="Default projects folder" desc="Where the folder picker starts.">
        <span className="flex flex-none items-center gap-2">
          <Mono>{flags?.defaultProjectsFolder || 'system default'}</Mono>
          <Button
            variant="secondary"
            size="sm"
            disabled={pickFolder.isPending}
            onClick={() => pickFolder.mutate()}
          >
            Choose…
          </Button>
          {flags?.defaultProjectsFolder ? (
            <Button variant="ghost" size="sm" onClick={() => clearFolder.mutate()}>
              Clear
            </Button>
          ) : null}
        </span>
      </Row>
      <FlagSwitch
        name="Trust new projects automatically"
        desc="Off keeps the Workspace Trust step on first open. Automations never bypass it."
        flag="trustNewProjects"
      />
    </Group>
  );
}

function CheckpointsTab() {
  const info = useQuery({
    queryKey: ['app.getInfo'],
    queryFn: () => invoke<AppInfo>({ method: 'app.getInfo' }),
  });
  return (
    <>
      <Group label="Checkpoints">
        <Row
          name="Snapshot files before each agent write"
          desc="Required for Revert all to be safe; always on."
        >
          <Mono>always on</Mono>
        </Row>
        <Row
          name="Keep resolved checkpoints for"
          desc="Unresolved checkpoints are kept until you decide — never pruned."
        >
          <Mono>
            {info.data?.policy ? `${info.data.policy.resolvedCheckpointRetentionDays} days` : '—'}
          </Mono>
        </Row>
        <Row
          name="Concurrent edits"
          desc="Revert compares the current hash first and refuses to overwrite your own changes."
        >
          <Mono>conflict-checked</Mono>
        </Row>
      </Group>
      <Group label="History">
        <Row name="Database" desc="SQLite, on this machine only.">
          <Mono>{info.data?.paths?.database ?? '—'}</Mono>
        </Row>
        <Row name="Logs" desc="Rotated NDJSON with secrets redacted.">
          <Mono>{info.data?.paths?.logs ?? '—'}</Mono>
        </Row>
      </Group>
    </>
  );
}

function AboutTab() {
  const info = useQuery({
    queryKey: ['app.getInfo'],
    queryFn: () => invoke<AppInfo>({ method: 'app.getInfo' }),
  });
  const exported = useMutation({
    mutationFn: () => invoke<{ logPath?: string }>({ method: 'diagnostics.export' }),
  });

  return (
    <>
      <Group label="Build">
        <Row name="Version" desc="">
          <Mono>{info.data?.version ?? '—'}</Mono>
        </Row>
        <Row name="Electron" desc="">
          <Mono>{info.data?.electron ?? '—'}</Mono>
        </Row>
        <Row name="Pi SDK" desc="">
          <Mono>{info.data?.piSdk ?? '—'}</Mono>
        </Row>
        <Row name="Platform" desc="">
          <Mono>{info.data?.platform ?? '—'}</Mono>
        </Row>
        <Row name="Runtime mode" desc="`fake` renders the UI with no provider calls.">
          <Mono>{info.data?.runtimeMode ?? '—'}</Mono>
        </Row>
        <Row name="Authenticated providers" desc="Read from the local credential stores.">
          <Mono>{info.data?.authProviders || 'none'}</Mono>
        </Row>
      </Group>
      <Group label="Diagnostics">
        <Row name="Log files" desc="Rotated NDJSON, secrets redacted before anything is written.">
          <Button
            variant="secondary"
            size="sm"
            disabled={!info.data?.paths?.logs}
            onClick={() =>
              void invoke({
                method: 'system.revealPath',
                params: { path: info.data!.paths!.logs },
              })
            }
          >
            Reveal
          </Button>
        </Row>
        <Row name="Export diagnostics" desc="Redacted NDJSON logs plus recent run metrics.">
          <Button
            variant="secondary"
            size="sm"
            disabled={exported.isPending}
            onClick={() => exported.mutate()}
          >
            {exported.data?.logPath ? 'Exported' : 'Export'}
          </Button>
        </Row>
      </Group>
      {exported.data?.logPath ? (
        <div className="font-mono text-[11.5px] break-all text-muted">{exported.data.logPath}</div>
      ) : null}
    </>
  );
}

/** One place to read and write the Main-owned behaviour flags. */
function useUiFlags() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['settings.get'],
    queryFn: () => invoke<Settings>({ method: 'settings.get' }),
  });
  const setFlag = useMutation({
    mutationFn: (input: SetUiSettingInput) =>
      invoke({ method: 'settings.setUiFlag', params: input }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['settings.get'] }),
  });
  return { flags: settings.data?.uiFlags, loading: settings.isLoading, setFlag };
}

function FlagSwitch({
  name,
  desc,
  flag,
}: {
  name: string;
  desc: string;
  flag: SetUiSettingInput['key'];
}) {
  const { flags, loading, setFlag } = useUiFlags();
  const value = flags?.[flag];
  return (
    <Row name={name} desc={desc}>
      <Switch
        label={name}
        checked={typeof value === 'boolean' ? value : false}
        disabled={loading || setFlag.isPending}
        onChange={(next) => setFlag.mutate({ key: flag, value: next })}
      />
    </Row>
  );
}

function NotificationsTab() {
  return (
    <>
      <Group label="When to notify">
        <FlagSwitch
          name="Approval required"
          desc="The run is paused until you answer — this one is marked urgent."
          flag="notifyApprovalRequired"
        />
        <FlagSwitch
          name="Run finished"
          desc="Fires for success, failure and cancellation."
          flag="notifyRunFinished"
        />
        <FlagSwitch
          name="Automation opened a task"
          desc="An automation started work on its own."
          flag="notifyAutomationOpenedTask"
        />
      </Group>
      <Group label="How">
        <FlagSwitch name="Play a sound" desc="" flag="notifyPlaySound" />
        <FlagSwitch
          name="Badge the dock icon with running tasks"
          desc="macOS only."
          flag="notifyBadgeDock"
        />
        <FlagSwitch
          name="Only notify when the window is in the background"
          desc="An approval already on screen shouldn't also buzz."
          flag="notifyOnlyWhenBackground"
        />
      </Group>
      <p className="text-[12px] leading-relaxed text-muted">
        Notification bodies carry only the task title and a status word — never prompt text, file
        contents or commands, because the OS may keep them in a tray.
      </p>
    </>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-6">
      <div className="mb-1 text-[10px] font-bold tracking-[0.14em] text-foreground/42 uppercase">
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({
  name,
  desc,
  stacked,
  children,
}: {
  name: string;
  desc: string;
  /** Put the value below the label — for values too long for a right-hand pill. */
  stacked?: boolean;
  children: ReactNode;
}) {
  if (stacked) {
    return (
      <div className="border-b border-border py-3.5">
        <div className="text-[13px] leading-snug font-bold">{name}</div>
        {desc ? <div className="mt-0.5 text-xs leading-normal text-muted">{desc}</div> : null}
        <div className="mt-2">{children}</div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-[18px] border-b border-border py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] leading-snug font-bold">{name}</div>
        {desc ? <div className="mt-0.5 text-xs leading-normal text-muted">{desc}</div> : null}
      </div>
      {children}
    </div>
  );
}

/** One path pattern. A wrapped set of these reads far better than a long pill. */
function PathChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-neutral-200 px-1.5 py-0.5 font-mono text-[11px] text-neutral-800">
      {children}
    </span>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return (
    <span className="flex-none rounded-[10px] bg-neutral-200 px-2.5 py-1 font-mono text-[11.5px] text-neutral-800">
      {children}
    </span>
  );
}
