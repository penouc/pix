import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

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
  const model = useAgentStreamStore((s) => s.model);
  const startedAt = useAgentStreamStore((s) => s.startedAt);
  const tools = useAgentStreamStore((s) => s.tools);
  const activeRunId = useAgentStreamStore((s) => s.activeRunId);
  const [selectedModel, setSelectedModel] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!startedAt || !['starting', 'running', 'waiting_for_approval', 'stopping'].includes(status)) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [startedAt, status]);

  const appInfo = useQuery({
    queryKey: ['app.info'],
    queryFn: () => invoke<AppInfo>({ method: 'app.getInfo' }),
  });

  const models = useQuery({
    queryKey: ['agent.models'],
    queryFn: () => invoke<ModelInfo[]>({ method: 'agent.listModels' }),
  });

  useEffect(() => {
    if (!models.data?.length || selectedModel) return;
    const preferred =
      models.data.find((m) => m.hasAuth) ?? models.data[0];
    if (preferred) {
      setSelectedModel(`${preferred.providerId}/${preferred.modelId}`);
    }
  }, [models.data, selectedModel]);

  async function onModelChange(value: string) {
    setSelectedModel(value);
    if (!session || !value.includes('/')) return;
    const [providerId, ...rest] = value.split('/');
    const modelId = rest.join('/');
    if (!providerId || !modelId) return;
    try {
      await invoke({
        method: 'agent.setModel',
        params: {
          sessionId: session.id,
          model: { providerId, modelId },
        },
      });
    } catch (err) {
      console.error(err);
    }
  }

  const authModels = models.data?.filter((m) => m.hasAuth) ?? [];

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
          <Row label="Elapsed" value={startedAt ? formatElapsed(now - startedAt) : '—'} />
          <Row label="Tools" value={tools.length || '—'} />
          <Row label="Input tokens" value={usage?.inputTokens ?? '—'} />
          <Row label="Output tokens" value={usage?.outputTokens ?? '—'} />
          <Row label="Cost" value={usage?.costUsd != null ? `$${usage.costUsd.toFixed(4)}` : '—'} />
        </section>

        <section className="space-y-2">
          <SectionTitle>Context</SectionTitle>
          <Row label="Project" value={project?.name ?? '—'} />
          <Row label="Trusted" value={project ? (project.trusted ? 'yes' : 'no') : '—'} />
          <Row label="Session" value={session?.title ?? '—'} />
          <Row
            label="Context"
            value={usage?.totalTokens != null ? `${usage.totalTokens} tokens reported` : 'Not reported'}
          />
        </section>

        <section className="space-y-2">
          <SectionTitle>Model</SectionTitle>
          <Row label="Active" value={model ? `${model.providerId}/${model.modelId}` : 'Not reported'} />
          <select
            className="w-full rounded-lg border border-border bg-background px-2 py-2 text-xs outline-none focus:border-accent"
            disabled={!session || models.isLoading}
            value={selectedModel}
            onChange={(e) => void onModelChange(e.target.value)}
          >
            {!models.data?.length ? (
              <option value="">No models</option>
            ) : (
              models.data.slice(0, 80).map((model) => {
                const value = `${model.providerId}/${model.modelId}`;
                return (
                  <option key={value} value={value}>
                    {model.hasAuth ? '● ' : '○ '}
                    {model.displayName} ({model.providerId})
                  </option>
                );
              })
            )}
          </select>
          <div className="text-[11px] text-muted">
            ● = provider has auth ({authModels.length} ready)
            {!session ? ' · create a session to apply' : ''}
          </div>
        </section>

        <section className="space-y-2">
          <SectionTitle>App</SectionTitle>
          <Row label="Name" value={appInfo.data?.name ?? '…'} />
          <Row label="Version" value={appInfo.data?.version ?? '…'} />
          <Row label="Platform" value={appInfo.data?.platform ?? '…'} />
          <Row label="Electron" value={appInfo.data?.electron ?? '…'} />
          <Row label="Runtime" value={appInfo.data?.runtimeMode ?? '…'} />
          <Row label="Pi SDK" value={appInfo.data?.piSdk ?? '…'} />
          <Row label="Auth" value={appInfo.data?.authProviders ?? '…'} />
        </section>

        <section className="rounded-xl border border-border bg-surface-raised p-3 text-xs leading-relaxed text-muted">
          默认 <code className="text-accent">PiAgentRuntime</code>。离线 UI：
          <code className="text-accent"> PI_DESKTOP_FAKE_RUNTIME=1</code>。真模型调用请设置
          API Key 环境变量；Auth 行与模型列表 ● 标记表示就绪。
        </section>
      </div>
    </div>
  );
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function SectionTitle({ children }: { children: string }) {
  return (
    <div className="text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="max-w-[60%] truncate text-right text-foreground">{value}</span>
    </div>
  );
}
