import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { ModelInfo } from '@pi-desktop/protocol';

import { Button } from '@/components/ui/button';
import { modelKey } from '@/features/models/model-key';
import { invoke } from '@/lib/ipc';
import { cn } from '@/lib/utils';

/**
 * Choose which models the composer's picker offers.
 *
 * This is here because credentials alone do not narrow the list usefully. Pi
 * knows on the order of a thousand models; a credential — a key saved here, an
 * environment variable, or another tool's auth store — makes roughly ninety of
 * them runnable, and there is nothing further to filter on. Ninety options in a
 * dropdown is not a choice, it is a wall.
 *
 * Nothing selected means "offer everything runnable", so the picker is never
 * empty just because this screen has not been visited.
 */
export function VisibleModelsSection() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');

  const models = useQuery({
    queryKey: ['agent.models'],
    queryFn: () => invoke<ModelInfo[]>({ method: 'agent.listModels' }),
  });
  const visible = useQuery({
    queryKey: ['settings.getVisibleModels'],
    queryFn: () => invoke<{ keys: string[] }>({ method: 'settings.getVisibleModels' }),
  });

  const save = useMutation({
    mutationFn: (keys: string[]) =>
      invoke<{ keys: string[] }>({ method: 'settings.setVisibleModels', params: { keys } }),
    onSuccess: (next) => {
      queryClient.setQueryData(['settings.getVisibleModels'], next);
      // The composer's picker reads the same two queries.
      void queryClient.invalidateQueries({ queryKey: ['agent.models'] });
    },
  });

  const runnable = useMemo(
    () => (models.data ?? []).filter((model) => model.hasAuth === true),
    [models.data],
  );

  /** Grouped by provider, because that is how you think about which to keep. */
  const byProvider = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const groups = new Map<string, ModelInfo[]>();
    for (const model of runnable) {
      if (needle && !`${model.providerId} ${model.modelId} ${model.displayName}`.toLowerCase().includes(needle)) {
        continue;
      }
      const bucket = groups.get(model.providerId) ?? [];
      bucket.push(model);
      groups.set(model.providerId, bucket);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [runnable, filter]);

  const selected = new Set(visible.data?.keys ?? []);
  const showingAll = selected.size === 0;

  function toggle(key: string) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    save.mutate([...next]);
  }

  function toggleProvider(providerId: string, models: ModelInfo[]) {
    const keys = models.map(modelKey);
    const allOn = keys.every((key) => selected.has(key));
    const next = new Set(selected);
    for (const key of keys) {
      if (allOn) next.delete(key);
      else next.add(key);
    }
    save.mutate([...next]);
  }

  return (
    <>
      <div className="mb-2.5 flex items-center gap-2">
        <input
          className="min-w-0 flex-1 rounded-xl border border-border bg-background px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent/50"
          placeholder="Filter models…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <span className="flex-none text-[11px] text-muted">
          {showingAll
            ? `all ${runnable.length} offered`
            : `${selected.size} of ${runnable.length} offered`}
        </span>
        {!showingAll ? (
          <Button variant="ghost" size="sm" onClick={() => save.mutate([])}>
            Reset
          </Button>
        ) : null}
      </div>

      {!runnable.length ? (
        <div className="rounded-[18px] border border-dashed border-foreground/20 px-4 py-6 text-center text-[12.5px] text-muted">
          {models.isLoading
            ? 'Loading models…'
            : 'No model has usable credentials yet. Add a provider key above.'}
        </div>
      ) : (
        <div className="max-h-[420px] overflow-y-auto rounded-[18px] border border-border">
          {byProvider.map(([providerId, group]) => {
            const allOn = group.every((model) => selected.has(modelKey(model)));
            return (
              <div key={providerId} className="border-b border-border last:border-b-0">
                <div className="flex items-center gap-2 bg-surface px-3 py-1.5">
                  <span className="flex-1 font-mono text-[11px] font-bold">{providerId}</span>
                  <span className="text-[10.5px] text-muted">{group.length}</span>
                  <Button variant="ghost" size="sm" onClick={() => toggleProvider(providerId, group)}>
                    {allOn ? 'None' : 'All'}
                  </Button>
                </div>
                {group.map((model) => {
                  const key = modelKey(model);
                  const on = selected.has(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggle(key)}
                      className="flex w-full cursor-pointer items-center gap-2.5 border-0 bg-transparent px-3 py-1.5 text-left hover:bg-foreground/[0.04]"
                    >
                      <span
                        className={cn(
                          'grid h-4 w-4 flex-none place-items-center rounded-[5px] border',
                          on ? 'border-accent bg-accent text-white' : 'border-foreground/25',
                        )}
                      >
                        {on ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px]">
                        {model.displayName}
                      </span>
                      <span className="flex-none font-mono text-[10.5px] text-muted">
                        {model.modelId}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-2.5 text-[11.5px] leading-relaxed text-muted">
        Only models with usable credentials are listed — a key saved here, an environment variable,
        or another tool&apos;s auth store. With nothing ticked the picker offers all of them.
      </p>
    </>
  );
}
