import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type { AppInfo, ModelInfo } from '@pi-desktop/protocol';

import { Badge } from '@/components/ui/badge';
import { invoke } from '@/lib/ipc';
import { useAgentStreamStore } from '@/stores/agent-stream-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

export function StatusPanel() {
  const project = useWorkspaceStore((s) => s.project);
  const session = useWorkspaceStore((s) => s.session);
  const status = useAgentStreamStore((s) => s.status);
  const usage = useAgentStreamStore((s) => s.usage);
  const activeRunId = useAgentStreamStore((s) => s.activeRunId);

  const appInfo = useQuery({
    queryKey: ['app.info'],
    queryFn: () => invoke<AppInfo>({ method: 'app.getInfo' }),
  });

  const models = useQuery({
    queryKey: ['agent.models'],
    queryFn: () => invoke<ModelInfo[]>({ method: 'agent.listModels' }),
  });

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-4">
        <div className="text-sm font-medium">Run & Models</div>
        <div className="mt-0.5 text-xs text-muted">M1 tech-validation panel</div>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4 text-sm">
        <section className="space-y-2">
          <SectionTitle>Runtime</SectionTitle>
          <Row label="Status" value={<Badge>{status}</Badge>} />
          <Row label="Run" value={activeRunId ? `${activeRunId.slice(0, 8)}…` : '—'} />
          <Row label="Input tokens" value={usage?.inputTokens ?? '—'} />
          <Row label="Output tokens" value={usage?.outputTokens ?? '—'} />
          <Row label="Cost" value={usage?.costUsd != null ? `$${usage.costUsd.toFixed(4)}` : '—'} />
        </section>

        <section className="space-y-2">
          <SectionTitle>Context</SectionTitle>
          <Row label="Project" value={project?.name ?? '—'} />
          <Row label="Trusted" value={project ? (project.trusted ? 'yes' : 'no') : '—'} />
          <Row label="Session" value={session?.title ?? '—'} />
        </section>

        <section className="space-y-2">
          <SectionTitle>Models (fake)</SectionTitle>
          {models.isLoading ? <div className="text-xs text-muted">Loading…</div> : null}
          {models.data?.map((model) => (
            <div
              key={`${model.providerId}/${model.modelId}`}
              className="rounded-lg border border-border bg-background px-3 py-2"
            >
              <div className="font-medium">{model.displayName}</div>
              <div className="font-mono text-[11px] text-muted">
                {model.providerId}/{model.modelId}
              </div>
            </div>
          ))}
        </section>

        <section className="space-y-2">
          <SectionTitle>App</SectionTitle>
          <Row label="Name" value={appInfo.data?.name ?? '…'} />
          <Row label="Version" value={appInfo.data?.version ?? '…'} />
          <Row label="Platform" value={appInfo.data?.platform ?? '…'} />
          <Row label="Electron" value={appInfo.data?.electron ?? '…'} />
        </section>

        <section className="rounded-xl border border-border bg-surface-raised p-3 text-xs leading-relaxed text-muted">
          Next milestones: wire real Pi SDK in <code className="text-accent">agent-pi</code>, Project
          trust UI, SQLite sessions, permission pipeline, and @pierre/diffs review.
        </section>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <div className="text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">{children}</div>;
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="text-right text-foreground">{value}</span>
    </div>
  );
}
