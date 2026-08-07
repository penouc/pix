import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2 } from 'lucide-react';

import type { AutoModelConfig, ModelInfo } from '@pi-desktop/protocol';

import { Button } from '@/components/ui/button';
import { SearchableSelect } from '@/components/SearchableSelect';
import { modelKey } from '@/features/models/model-key';
import { useOfferedModels } from '@/features/models/use-offered-models';
import { invoke } from '@/lib/ipc';

/**
 * Auto model routing (#21): role pins + ordered fallback chain.
 *
 * - **Default tier** — cheap / fast models for ordinary chores.
 * - **Plan tier** — the stronger (reasoning) model used while Plan Mode is on.
 * - **Fallback chain** — when the active model 429s / times out / runs out of
 *   quota, Auto advances down this list and retries the same turn.
 *
 * Every pick is optional; with nothing configured Auto derives the order from
 * the live catalogue (cheapest runnable first, reasoning-capable first for the
 * plan tier), so the section is a preference, not a prerequisite.
 */
export function AutoModelSection() {
  const queryClient = useQueryClient();
  const { models: offered } = useOfferedModels();

  const config = useQuery({
    queryKey: ['settings.getAutoModel'],
    queryFn: () => invoke<AutoModelConfig>({ method: 'settings.getAutoModel' }),
  });

  const save = useMutation({
    mutationFn: (next: AutoModelConfig) =>
      invoke<AutoModelConfig>({ method: 'settings.setAutoModel', params: { config: next } }),
    onSuccess: (next) => queryClient.setQueryData(['settings.getAutoModel'], next),
  });

  const current = config.data ?? {};
  const fallbacks = current.fallbackKeys ?? [];

  function update(patch: Partial<AutoModelConfig>) {
    save.mutate({ ...current, ...patch });
  }

  function setFallback(index: number, key: string) {
    const next = [...fallbacks];
    next[index] = key;
    update({ fallbackKeys: next.filter(Boolean) });
  }

  function removeFallback(index: number) {
    update({ fallbackKeys: fallbacks.filter((_, i) => i !== index) });
  }

  function moveFallback(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= fallbacks.length) return;
    const next = [...fallbacks];
    [next[index], next[target]] = [next[target]!, next[index]!];
    update({ fallbackKeys: next });
  }

  const modelOptions = offered.map((model) => ({
    value: modelKey(model),
    label: model.displayName,
    sublabel: `${model.providerId} · ${describeModel(model)}`,
  }));

  const roleSelect = (key: string | undefined, onChange: (key: string) => void) => (
    <SearchableSelect
      options={[
        { value: '', label: 'Auto (derived — cheapest runnable)', sublabel: 'recommended' },
        ...modelOptions,
      ]}
      value={key ?? ''}
      onChange={(value) => onChange(value)}
      placeholder="Auto (derived)"
      searchPlaceholder="Search models…"
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 flex-none place-items-center rounded-xl border border-border bg-foreground/5">
          <Sparkles className="h-4 w-4 text-accent-700" />
        </div>
        <div>
          <h2 className="text-sm font-semibold">Auto model routing</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            When the picker is on <span className="font-medium text-foreground">Auto</span>, the
            app picks the model per task and role, and falls back through the chain below on rate
            limits, timeouts, or exhausted quota. This is the model-level Auto — separate from the
            approval-mode “Auto” that auto-approves reads.
          </p>
        </div>
      </div>

      <div className="space-y-2.5">
        <div className="grid items-center gap-2 sm:grid-cols-[160px_minmax(0,1fr)]">
          <span className="text-[12.5px] text-muted">Default tier</span>
          {roleSelect(current.defaultKey, (key) => update({ defaultKey: key || undefined }))}
        </div>
        <div className="grid items-center gap-2 sm:grid-cols-[160px_minmax(0,1fr)]">
          <span className="text-[12.5px] text-muted">Plan tier</span>
          {roleSelect(current.planKey, (key) => update({ planKey: key || undefined }))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[12.5px] text-muted">
            Fallback chain{' '}
            <span className="text-[11px] text-muted/70">(tried in order after a failure)</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => update({ fallbackKeys: [...fallbacks, ''] })}
          >
            <Plus className="h-3 w-3" />
            Add fallback
          </Button>
        </div>

        {fallbacks.length ? (
          <div className="space-y-1.5">
            {fallbacks.map((key, index) => (
              <div key={`${index}-${key || 'empty'}`} className="flex items-center gap-1.5">
                <span className="w-5 flex-none text-center font-mono text-[10.5px] font-bold text-muted">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <SearchableSelect
                    options={modelOptions}
                    value={key}
                    onChange={(value) => setFallback(index, value)}
                    placeholder="Choose a model…"
                    searchPlaceholder="Search models…"
                  />
                </div>
                {index > 0 ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 flex-none"
                    title="Move up"
                    onClick={() => moveFallback(index, -1)}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
                {index < fallbacks.length - 1 ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 flex-none"
                    title="Move down"
                    onClick={() => moveFallback(index, 1)}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 flex-none text-muted hover:text-danger"
                  title="Remove"
                  onClick={() => removeFallback(index)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-foreground/20 px-3 py-2.5 text-[11.5px] leading-relaxed text-muted">
            No explicit chain — Auto derives one from the catalogue: the cheapest runnable model
            first, then the rest by price (reasoning-capable first for the Plan tier). Add a
            fallback to pin the order.
          </p>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-muted">
        Only models with usable credentials are listed. Every run reports which provider and model
        it actually used.
      </p>
    </div>
  );
}

function describeModel(model: ModelInfo): string {
  const parts: string[] = [model.modelId];
  if (model.contextWindow) parts.push(`${formatTokenCount(model.contextWindow)} ctx`);
  if (model.inputCostPerMTok != null && model.outputCostPerMTok != null) {
    parts.push(`$${model.inputCostPerMTok}/$${model.outputCostPerMTok} per Mtok`);
  }
  if (model.reasoning) parts.push('reasoning');
  return parts.join(' · ');
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}
