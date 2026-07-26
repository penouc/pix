import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { ModelInfo } from '@pi-desktop/protocol';

import { modelKey } from '@/features/models/model-key';
import { invoke } from '@/lib/ipc';

/**
 * The models a picker should offer, plus which of them are pinned.
 *
 * One filter only: **runnable**. Pi's catalogue is ~1100 models, nearly all
 * without a credential; `hasAuth` covers a key saved in Settings, an environment
 * variable, and another tool's auth store, so it hides nothing that works.
 *
 * Favourites *order* the list, they do not shorten it. That distinction matters:
 * this used to double as a filter, which meant starring one model hid the other
 * eighty-eight. The length problem is solved by the picker's shape instead —
 * search, and drilling in by provider — so every runnable model stays reachable.
 */
export function useOfferedModels(): {
  models: ModelInfo[];
  favorites: Set<string>;
  toggleFavorite: (key: string) => void;
  isLoading: boolean;
} {
  const queryClient = useQueryClient();

  const all = useQuery({
    queryKey: ['agent.models'],
    queryFn: () => invoke<ModelInfo[]>({ method: 'agent.listModels' }),
  });
  const favorite = useQuery({
    queryKey: ['settings.getFavoriteModels'],
    queryFn: () => invoke<{ keys: string[] }>({ method: 'settings.getFavoriteModels' }),
  });

  const save = useMutation({
    mutationFn: (keys: string[]) =>
      invoke<{ keys: string[] }>({ method: 'settings.setFavoriteModels', params: { keys } }),
    onSuccess: (next) => queryClient.setQueryData(['settings.getFavoriteModels'], next),
  });

  const models = useMemo(
    () => (all.data ?? []).filter((model) => model.hasAuth === true),
    [all.data],
  );

  const favorites = useMemo(() => new Set(favorite.data?.keys ?? []), [favorite.data?.keys]);

  function toggleFavorite(key: string) {
    const next = new Set(favorites);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    save.mutate([...next]);
  }

  return {
    models,
    favorites,
    toggleFavorite,
    isLoading: all.isLoading || favorite.isLoading,
  };
}

/** Group models by provider, providers ordered by name. */
export function groupByProvider(models: ModelInfo[]): Array<[string, ModelInfo[]]> {
  const groups = new Map<string, ModelInfo[]>();
  for (const model of models) {
    const bucket = groups.get(model.providerId) ?? [];
    bucket.push(model);
    groups.set(model.providerId, bucket);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** Case-insensitive match across provider, id and display name. */
export function matchesModel(model: ModelInfo, needle: string): boolean {
  if (!needle) return true;
  return `${model.providerId} ${model.modelId} ${model.displayName}`.toLowerCase().includes(needle);
}

export { modelKey };
