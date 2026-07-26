import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useEffect } from 'react';

import type { ModelInfo } from '@pi-desktop/protocol';

import { modelKey } from '@/features/models/model-key';
import { invoke } from '@/lib/ipc';
import { useWorkspaceStore } from '@/stores/workspace-store';

/**
 * The title-bar model pill. The design puts model selection in the chrome bar
 * rather than the composer, with a dot that reads the provider's auth state.
 */
export function ModelPill() {
  const session = useWorkspaceStore((s) => s.session);
  const selectedModel = useWorkspaceStore((s) => s.selectedModel);
  const setSelectedModel = useWorkspaceStore((s) => s.setSelectedModel);

  const models = useQuery({
    queryKey: ['agent.models'],
    queryFn: () => invoke<ModelInfo[]>({ method: 'agent.listModels' }),
  });

  useEffect(() => {
    if (!models.data?.length || selectedModel) return;
    const preferred = models.data.find((m) => m.hasAuth) ?? models.data[0];
    if (preferred) setSelectedModel(modelKey(preferred));
  }, [models.data, selectedModel, setSelectedModel]);

  const active = models.data?.find((m) => modelKey(m) === selectedModel);
  const authed = active?.hasAuth === true;

  function change(value: string) {
    setSelectedModel(value);
    if (!session || !value.includes('/')) return;
    const [providerId, ...rest] = value.split('/');
    const modelId = rest.join('/');
    if (!providerId || !modelId) return;
    void invoke({
      method: 'agent.setModel',
      params: { sessionId: session.id, model: { providerId, modelId } },
    }).catch(console.error);
  }

  const label = active
    ? `${active.providerId} / ${active.modelId}`
    : models.isLoading
      ? 'loading models…'
      : 'no model configured';

  return (
    <div className="relative inline-flex">
      <span className="pointer-events-none flex h-[26px] items-center gap-1.5 rounded-full bg-foreground/[0.06] pr-7 pl-3 text-[12px]">
        <span
          className="h-1.5 w-1.5 flex-none rounded-full"
          style={{ background: authed ? 'var(--color-accent-2)' : 'var(--color-neutral-400)' }}
          title={authed ? 'provider credentials ready' : 'no credentials for this provider'}
        />
        <span className="max-w-[240px] truncate">{label}</span>
      </span>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 h-3 w-3 -translate-y-1/2 text-muted" />
      <select
        aria-label="Active model"
        className="absolute inset-0 cursor-pointer appearance-none rounded-full bg-transparent text-transparent opacity-0"
        disabled={!models.data?.length}
        value={selectedModel}
        onChange={(event) => change(event.target.value)}
      >
        {!models.data?.length ? (
          <option value="">No models</option>
        ) : (
          models.data.slice(0, 200).map((model) => {
            const value = modelKey(model);
            return (
              <option key={value} value={value}>
                {model.displayName}
                {model.hasAuth ? '' : ' (no credentials)'}
              </option>
            );
          })
        )}
      </select>
    </div>
  );
}
