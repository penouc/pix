import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { ModelInfo } from '@pi-desktop/protocol';

import { modelKey } from '@/features/models/model-key';
import { invoke } from '@/lib/ipc';

/**
 * The models any picker should offer, in one place so the composer's pill and
 * Settings' default-model select cannot disagree.
 *
 * Two filters, in order:
 *
 * 1. **Runnable.** Pi's catalogue is ~1100 models, nearly all without a
 *    credential. `hasAuth` covers a key saved in Settings, an environment
 *    variable, and another tool's auth store, so this hides nothing that works.
 * 2. **Chosen.** Even runnable is ~90 here, which is still a wall, so Settings
 *    lets you tick the ones you actually use. An empty selection means "offer
 *    everything runnable" — the picker must never be empty because a preference
 *    has not been set.
 */
export function useOfferedModels(): {
  models: ModelInfo[];
  runnableCount: number;
  isLoading: boolean;
} {
  const all = useQuery({
    queryKey: ['agent.models'],
    queryFn: () => invoke<ModelInfo[]>({ method: 'agent.listModels' }),
  });
  const visible = useQuery({
    queryKey: ['settings.getVisibleModels'],
    queryFn: () => invoke<{ keys: string[] }>({ method: 'settings.getVisibleModels' }),
  });

  const runnable = useMemo(
    () => (all.data ?? []).filter((model) => model.hasAuth === true),
    [all.data],
  );

  const models = useMemo(() => {
    const chosen = new Set(visible.data?.keys ?? []);
    if (!chosen.size) return runnable;
    const filtered = runnable.filter((model) => chosen.has(modelKey(model)));
    // A stored selection can go stale — a provider's key removed, a model
    // retired. Falling back beats presenting an empty picker with no explanation.
    return filtered.length ? filtered : runnable;
  }, [runnable, visible.data?.keys]);

  return {
    models,
    runnableCount: runnable.length,
    isLoading: all.isLoading || visible.isLoading,
  };
}
