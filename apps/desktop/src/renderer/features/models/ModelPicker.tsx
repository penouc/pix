import { ChevronDown, ChevronLeft, ChevronRight, Search, Star } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { ModelInfo } from '@pi-desktop/protocol';

import { modelKey } from '@/features/models/model-key';
import {
  groupByProvider,
  matchesModel,
  useOfferedModels,
} from '@/features/models/use-offered-models';
import { invoke } from '@/lib/ipc';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/stores/workspace-store';

/**
 * The composer's model picker.
 *
 * A flat `<select>` of every runnable model was ninety-odd options with no way to
 * narrow them, which is a list rather than a choice. Three things fix that, in
 * the order they help:
 *
 * 1. **Search** — one field over provider, id and display name. Typing skips the
 *    hierarchy entirely and shows matches across all providers, because when you
 *    know the name you should not have to remember who serves it.
 * 2. **Two levels** — providers first, then that provider's models. Nine
 *    providers is a choice; ninety models is not.
 * 3. **Favourites** — starred models sit at the top, so the handful you actually
 *    use is one click away. They pin, they do not filter: everything stays
 *    reachable underneath.
 */
export function ModelPicker() {
  const session = useWorkspaceStore((s) => s.session);
  const selectedModel = useWorkspaceStore((s) => s.selectedModel);
  const setSelectedModel = useWorkspaceStore((s) => s.setSelectedModel);
  const { models, favorites, toggleFavorite, isLoading } = useOfferedModels();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  /** Which provider is drilled into; null is the top level. */
  const [provider, setProvider] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const active = models.find((model) => modelKey(model) === selectedModel);

  // Default to something usable, preferring a favourite.
  useEffect(() => {
    if (!models.length || selectedModel) return;
    const preferred = models.find((model) => favorites.has(modelKey(model))) ?? models[0]!;
    setSelectedModel(modelKey(preferred));
  }, [models, favorites, selectedModel, setSelectedModel]);

  // Close on an outside click or Escape, like every other menu in the app.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const needle = query.trim().toLowerCase();
  const searchHits = useMemo(
    () => (needle ? models.filter((model) => matchesModel(model, needle)).slice(0, 40) : []),
    [models, needle],
  );
  const favorited = useMemo(
    () => models.filter((model) => favorites.has(modelKey(model))),
    [models, favorites],
  );
  const providers = useMemo(() => groupByProvider(models), [models]);
  const drilled = provider ? models.filter((model) => model.providerId === provider) : [];

  function choose(model: ModelInfo) {
    const key = modelKey(model);
    setSelectedModel(key);
    setOpen(false);
    setQuery('');
    setProvider(null);
    if (!session) return;
    void invoke({
      method: 'agent.setModel',
      params: {
        sessionId: session.id,
        model: { providerId: model.providerId, modelId: model.modelId },
      },
    }).catch(console.error);
  }

  const label = active
    ? active.displayName
    : isLoading
      ? 'loading models…'
      : models.length
        ? 'choose a model'
        : 'no provider configured';

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={!models.length && !isLoading}
        onClick={() => setOpen((value) => !value)}
        title={active ? `${active.providerId} / ${active.modelId}` : 'Choose a model'}
        className="flex h-[26px] max-w-[220px] cursor-pointer items-center gap-1.5 rounded-full border-0 bg-foreground/[0.06] pr-2 pl-2.5 text-[12px] hover:bg-foreground/[0.1]"
      >
        <span
          className="h-1.5 w-1.5 flex-none rounded-full"
          style={{ background: active ? 'var(--color-accent-2)' : 'var(--color-neutral-400)' }}
        />
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown className="h-3 w-3 flex-none text-muted" />
      </button>

      {open ? (
        // Anchored above: the composer sits at the bottom of the window, so a
        // menu opening downwards would be clipped.
        <div className="absolute bottom-[calc(100%+6px)] right-0 z-50 flex max-h-[380px] w-[320px] flex-col overflow-hidden rounded-[16px] border border-border bg-background shadow-[var(--shadow-lg)]">
          <div className="flex flex-none items-center gap-2 border-b border-border px-3 py-2">
            {provider && !needle ? (
              <button
                type="button"
                onClick={() => setProvider(null)}
                title="All providers"
                className="flex cursor-pointer items-center gap-0.5 border-0 bg-transparent p-0 text-[11px] text-muted hover:text-foreground"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
            ) : (
              <Search className="h-3.5 w-3.5 flex-none opacity-45" />
            )}
            <input
              autoFocus
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[12.5px] outline-none placeholder:text-muted"
              placeholder={provider && !needle ? `Search ${provider}…` : 'Search all models…'}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {needle ? (
              searchHits.length ? (
                <>
                  <GroupLabel>{searchHits.length} match{searchHits.length === 1 ? '' : 'es'}</GroupLabel>
                  {searchHits.map((model) => (
                    <Row
                      key={modelKey(model)}
                      model={model}
                      showProvider
                      selected={modelKey(model) === selectedModel}
                      starred={favorites.has(modelKey(model))}
                      onChoose={() => choose(model)}
                      onStar={() => toggleFavorite(modelKey(model))}
                    />
                  ))}
                </>
              ) : (
                <Empty>No model matches “{query}”.</Empty>
              )
            ) : provider ? (
              <>
                <GroupLabel>{provider}</GroupLabel>
                {drilled.map((model) => (
                  <Row
                    key={modelKey(model)}
                    model={model}
                    selected={modelKey(model) === selectedModel}
                    starred={favorites.has(modelKey(model))}
                    onChoose={() => choose(model)}
                    onStar={() => toggleFavorite(modelKey(model))}
                  />
                ))}
              </>
            ) : (
              <>
                {favorited.length ? (
                  <>
                    <GroupLabel>Favourites</GroupLabel>
                    {favorited.map((model) => (
                      <Row
                        key={modelKey(model)}
                        model={model}
                        showProvider
                        selected={modelKey(model) === selectedModel}
                        starred
                        onChoose={() => choose(model)}
                        onStar={() => toggleFavorite(modelKey(model))}
                      />
                    ))}
                  </>
                ) : null}
                <GroupLabel>Providers</GroupLabel>
                {providers.map(([id, group]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setProvider(id)}
                    className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-[7px] text-left hover:bg-foreground/[0.06]"
                  >
                    <span className="min-w-0 flex-1 truncate text-[12.5px]">{id}</span>
                    <span className="flex-none text-[11px] text-muted">{group.length}</span>
                    <ChevronRight className="h-3.5 w-3.5 flex-none text-muted" />
                  </button>
                ))}
                {!providers.length ? (
                  <Empty>
                    {isLoading ? 'Loading models…' : 'Add a provider key or sign in under Settings.'}
                  </Empty>
                ) : null}
              </>
            )}
          </div>

          {favorited.length === 0 && !needle ? (
            <p className="m-0 flex-none border-t border-border px-3 py-2 text-[11px] leading-snug text-muted">
              Star a model to pin it here.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Row({
  model,
  selected,
  starred,
  showProvider,
  onChoose,
  onStar,
}: {
  model: ModelInfo;
  selected: boolean;
  starred: boolean;
  showProvider?: boolean;
  onChoose: () => void;
  onStar: () => void;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 px-3 py-[6px]',
        selected ? 'bg-accent-soft' : 'hover:bg-foreground/[0.06]',
      )}
    >
      <button
        type="button"
        onClick={onChoose}
        className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left"
      >
        <span className="block truncate text-[12.5px]">{model.displayName}</span>
        {/* The id is always shown: it is the identity, and two models can share
            a display name (an alias and its dated release, for instance). */}
        <span className="block truncate font-mono text-[10.5px] text-muted">
          {[
            showProvider ? model.providerId : null,
            model.modelId,
            model.contextWindow ? `${formatTokens(model.contextWindow)} ctx` : null,
            model.inputCostPerMTok != null && model.outputCostPerMTok != null
              ? `$${model.inputCostPerMTok}/$${model.outputCostPerMTok}`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </button>
      <button
        type="button"
        // Stops the row's choose handler firing — starring is not selecting.
        onClick={(event) => {
          event.stopPropagation();
          onStar();
        }}
        title={starred ? 'Unpin' : 'Pin to the top'}
        className="flex-none cursor-pointer rounded-md border-0 bg-transparent p-1 hover:bg-foreground/[0.08]"
      >
        <Star
          className={cn('h-3.5 w-3.5', starred ? 'fill-accent text-accent' : 'text-muted')}
        />
      </button>
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-2 pb-1 text-[10px] font-bold tracking-[0.14em] text-foreground/40 uppercase">
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-3.5 py-5 text-center text-[12px] text-muted">{children}</div>;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}
