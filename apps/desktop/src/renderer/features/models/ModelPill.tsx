import { ChevronDown } from 'lucide-react';
import { useEffect } from 'react';

import { modelKey } from '@/features/models/model-key';
import { useOfferedModels } from '@/features/models/use-offered-models';
import { invoke } from '@/lib/ipc';
import { useWorkspaceStore } from '@/stores/workspace-store';

/**
 * The composer's model pill, beside the send button — the model is a property of
 * the message you are about to send. The dot reads the provider's auth state.
 */
export function ModelPill() {
  const session = useWorkspaceStore((s) => s.session);
  const selectedModel = useWorkspaceStore((s) => s.selectedModel);
  const setSelectedModel = useWorkspaceStore((s) => s.setSelectedModel);

  const { models: usable, isLoading } = useOfferedModels();

  useEffect(() => {
    if (!usable.length || selectedModel) return;
    setSelectedModel(modelKey(usable[0]!));
  }, [usable, selectedModel, setSelectedModel]);

  const active = usable.find((m) => modelKey(m) === selectedModel);
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
    : isLoading
      ? 'loading models…'
      : usable.length
        ? 'choose a model'
        : 'no provider configured';

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
        disabled={!usable.length}
        value={selectedModel}
        onChange={(event) => change(event.target.value)}
      >
        {!usable.length ? (
          <option value="">Add a provider key in Settings</option>
        ) : (
          usable.map((model) => {
            const value = modelKey(model);
            return (
              <option key={value} value={value}>
                {model.displayName}
              </option>
            );
          })
        )}
      </select>
    </div>
  );
}
