import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  Sparkles,
  Star,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { ModelInfo, Settings } from '@pi-desktop/protocol';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { AUTO_MODEL_KEY, modelKey } from '@/features/models/model-key';
import {
  groupByProvider,
  matchesModel,
  useOfferedModels,
} from '@/features/models/use-offered-models';
import { invoke } from '@/lib/ipc';
import { listOptionClass, useListKeyboard } from '@/lib/use-list-keyboard';
import { useAnchorAbove, useDismiss } from '@/lib/use-dismiss';
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
export function ModelPicker({ onAddProvider }: { onAddProvider?: () => void } = {}) {
  const session = useWorkspaceStore((s) => s.session);
  const selectedModel = useWorkspaceStore((s) => s.selectedModel);
  const setSelectedModel = useWorkspaceStore((s) => s.setSelectedModel);
  const { models, favorites, toggleFavorite, isLoading } = useOfferedModels();
  const queryClient = useQueryClient();
  const saved = useQuery({
    queryKey: ['settings.get'],
    queryFn: () => invoke<Settings>({ method: 'settings.get' }),
  });
  const noAuth = !isLoading && models.length === 0;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  /** Which provider is drilled into; null is the top level. */
  const [provider, setProvider] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const active = models.find((model) => modelKey(model) === selectedModel);
  const autoActive = selectedModel === AUTO_MODEL_KEY;

  // Last-used model (settings default) → favourite → first runnable model.
  useEffect(() => {
    if (!models.length || selectedModel || saved.isLoading) return;
    if (saved.data?.defaultModel?.kind === 'auto') {
      setSelectedModel(AUTO_MODEL_KEY);
      return;
    }
    const savedKey =
      saved.data?.defaultModel && saved.data.defaultModel.kind === 'model'
        ? `${saved.data.defaultModel.providerId}/${saved.data.defaultModel.modelId}`
        : '';
    const fromSaved = savedKey ? models.find((model) => modelKey(model) === savedKey) : undefined;
    const preferred =
      fromSaved ?? models.find((model) => favorites.has(modelKey(model))) ?? models[0]!;
    setSelectedModel(modelKey(preferred));
  }, [
    models,
    favorites,
    selectedModel,
    saved.data?.defaultModel,
    saved.isLoading,
    setSelectedModel,
  ]);

  const menuRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, [rootRef, menuRef], close);
  // Right-aligned: the picker sits at the right end of the composer footer.
  const anchor = useAnchorAbove(open, rootRef, 'right');

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
  const drilled = useMemo(
    () => (provider ? models.filter((model) => model.providerId === provider) : []),
    [models, provider],
  );

  type NavItem =
    { kind: 'auto' } | { kind: 'model'; model: ModelInfo } | { kind: 'provider'; id: string };

  const navItems = useMemo((): NavItem[] => {
    if (needle) return searchHits.map((model) => ({ kind: 'model' as const, model }));
    if (provider) return drilled.map((model) => ({ kind: 'model' as const, model }));
    const items: NavItem[] = [{ kind: 'auto' }];
    for (const model of favorited) items.push({ kind: 'model', model });
    for (const [id] of providers) items.push({ kind: 'provider', id });
    return items;
  }, [needle, searchHits, provider, drilled, favorited, providers]);

  function choose(model: ModelInfo) {
    const key = modelKey(model);
    setSelectedModel(key);
    setOpen(false);
    setQuery('');
    setProvider(null);
    const ref = { providerId: model.providerId, modelId: model.modelId };
    // Remember globally so the next launch and new tasks reopen on this model.
    void invoke({
      method: 'settings.setDefaultModel',
      params: { model: { kind: 'model', ...ref } },
    })
      .then(() => void queryClient.invalidateQueries({ queryKey: ['settings.get'] }))
      .catch(console.error);
    if (!session) return;
    void invoke({
      method: 'agent.setModel',
      params: { sessionId: session.id, model: { kind: 'model', ...ref } },
    }).catch(console.error);
    void queryClient.invalidateQueries({ queryKey: ['agent.getThinkingLevel', session.id] });
  }

  /** Auto (#21): the runtime picks per role and falls back on rate limits. */
  function chooseAuto() {
    setSelectedModel(AUTO_MODEL_KEY);
    setOpen(false);
    setQuery('');
    setProvider(null);
    void invoke({ method: 'settings.setDefaultModel', params: { model: { kind: 'auto' } } })
      .then(() => void queryClient.invalidateQueries({ queryKey: ['settings.get'] }))
      .catch(console.error);
    if (!session) return;
    void invoke({
      method: 'agent.setModel',
      params: { sessionId: session.id, model: { kind: 'auto' } },
    }).catch(console.error);
    void queryClient.invalidateQueries({ queryKey: ['agent.getThinkingLevel', session.id] });
  }

  const {
    cursor,
    setCursor,
    onKeyDown: onListKeyDown,
  } = useListKeyboard({
    open,
    count: navItems.length,
    resetKey: `${needle}|${provider ?? ''}|${navItems.length}`,
    onSelect: (index) => {
      const item = navItems[index];
      if (!item) return;
      if (item.kind === 'auto') chooseAuto();
      else if (item.kind === 'model') choose(item.model);
      else setProvider(item.id);
    },
    onClose: close,
  });

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, cursor]);

  const label = autoActive
    ? 'Auto'
    : active
      ? shortModelLabel(active)
      : isLoading
        ? 'loading…'
        : models.length
          ? 'model'
          : 'Add a provider…';

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        aria-haspopup={noAuth ? undefined : 'listbox'}
        aria-expanded={noAuth ? undefined : open}
        disabled={isLoading}
        onClick={() => {
          if (noAuth) {
            onAddProvider?.();
            return;
          }
          setOpen((value) => !value);
        }}
        title={
          noAuth
            ? 'Add a provider under Settings to run the agent'
            : autoActive
              ? 'Auto — picks per task & mode'
              : active
                ? `${active.displayName} · ${active.providerId}/${active.modelId}`
                : 'Choose a model'
        }
        className={cn(
          'flex h-[26px] max-w-[160px] cursor-pointer items-center gap-1.5 rounded-full border-0 pr-2 pl-2.5 text-[12px]',
          noAuth
            ? 'bg-accent/15 font-bold text-accent-800 hover:bg-accent/25'
            : 'bg-foreground/[0.06] hover:bg-foreground/[0.1]',
        )}
      >
        <span
          className="h-1.5 w-1.5 flex-none rounded-full"
          style={{
            background:
              active || autoActive
                ? 'var(--color-accent-2)'
                : noAuth
                  ? 'var(--color-accent)'
                  : 'var(--color-neutral-400)',
          }}
        />
        <span className="min-w-0 truncate">{label}</span>
        {noAuth ? null : <ChevronDown className="h-3 w-3 flex-none text-muted" />}
      </button>

      {open && anchor
        ? createPortal(
            // Portalled and anchored above: the composer card clips its overflow, and
            // it sits at the bottom of the window, so neither an in-flow menu nor a
            // downward one would be fully visible.
            <div
              ref={menuRef}
              style={anchor}
              className="z-50 flex w-[320px] max-h-[380px] flex-col overflow-hidden rounded-[16px] border border-border bg-background shadow-[var(--shadow-lg)]"
            >
              <div className="flex flex-none items-center gap-2 border-b border-border px-3 py-2">
                {provider ? (
                  <button
                    type="button"
                    onClick={() => {
                      setProvider(null);
                      setQuery('');
                    }}
                    title="All providers"
                    className="flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted hover:bg-foreground/[0.08] hover:text-foreground"
                  >
                    <ChevronLeft className="h-4 w-4" />
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
                  onKeyDown={(event) => {
                    if (event.key === 'Backspace' && !query && provider) {
                      setProvider(null);
                      return;
                    }
                    onListKeyDown(event);
                  }}
                />
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto py-1">
                {needle ? (
                  searchHits.length ? (
                    <>
                      <GroupLabel>
                        {searchHits.length} match{searchHits.length === 1 ? '' : 'es'}
                      </GroupLabel>
                      {searchHits.map((model, index) => (
                        <Row
                          key={modelKey(model)}
                          model={model}
                          showProvider
                          active={index === cursor}
                          selected={modelKey(model) === selectedModel}
                          starred={favorites.has(modelKey(model))}
                          onChoose={() => choose(model)}
                          onStar={() => toggleFavorite(modelKey(model))}
                          onHover={() => setCursor(index)}
                        />
                      ))}
                    </>
                  ) : (
                    <Empty>No model matches “{query}”.</Empty>
                  )
                ) : provider ? (
                  <>
                    <GroupLabel>{provider}</GroupLabel>
                    {drilled.map((model, index) => (
                      <Row
                        key={modelKey(model)}
                        model={model}
                        active={index === cursor}
                        selected={modelKey(model) === selectedModel}
                        starred={favorites.has(modelKey(model))}
                        onChoose={() => choose(model)}
                        onStar={() => toggleFavorite(modelKey(model))}
                        onHover={() => setCursor(index)}
                      />
                    ))}
                  </>
                ) : (
                  <>
                    {/* Auto (#21) is a first-class choice, pinned above favourites. */}
                    <button
                      type="button"
                      data-active={cursor === 0 ? 'true' : undefined}
                      onMouseEnter={() => setCursor(0)}
                      onClick={chooseAuto}
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-[7px] text-left',
                        listOptionClass(cursor === 0, autoActive),
                      )}
                    >
                      <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-accent/15">
                        <Sparkles className="h-3 w-3 text-accent-700" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px]">Auto</span>
                        <span className="block truncate text-[10.5px] text-muted">
                          Picks per task &amp; mode — cheap for chores, strong for Plan, falls back
                          on rate limits
                        </span>
                      </span>
                      {autoActive ? <Check className="h-3.5 w-3.5 flex-none text-accent" /> : null}
                    </button>
                    {favorited.length ? (
                      <>
                        <GroupLabel>Favourites</GroupLabel>
                        {favorited.map((model, index) => {
                          const navIndex = 1 + index;
                          return (
                            <Row
                              key={modelKey(model)}
                              model={model}
                              showProvider
                              active={navIndex === cursor}
                              selected={modelKey(model) === selectedModel}
                              starred
                              onChoose={() => choose(model)}
                              onStar={() => toggleFavorite(modelKey(model))}
                              onHover={() => setCursor(navIndex)}
                            />
                          );
                        })}
                      </>
                    ) : null}
                    <GroupLabel>Providers</GroupLabel>
                    {providers.map(([id, group], index) => {
                      const navIndex = 1 + favorited.length + index;
                      return (
                        <button
                          key={id}
                          type="button"
                          data-active={navIndex === cursor ? 'true' : undefined}
                          onMouseEnter={() => setCursor(navIndex)}
                          onClick={() => setProvider(id)}
                          className={cn(
                            'flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-[7px] text-left',
                            listOptionClass(navIndex === cursor),
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate text-[12.5px]">{id}</span>
                          <span className="flex-none text-[11px] text-muted">{group.length}</span>
                          <ChevronRight className="h-3.5 w-3.5 flex-none text-muted" />
                        </button>
                      );
                    })}
                    {!providers.length ? (
                      <Empty>
                        {isLoading ? (
                          'Loading models…'
                        ) : (
                          <span className="flex flex-col items-center gap-2">
                            <span>Add a provider under Settings to run the agent.</span>
                            {onAddProvider ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setOpen(false);
                                  onAddProvider();
                                }}
                                className="cursor-pointer border-0 bg-transparent p-0 text-[12px] font-bold text-accent-800 underline-offset-2 hover:underline"
                              >
                                Open Providers
                              </button>
                            ) : null}
                          </span>
                        )}
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
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function Row({
  model,
  selected,
  starred,
  active,
  showProvider,
  onChoose,
  onStar,
  onHover,
}: {
  model: ModelInfo;
  selected: boolean;
  starred: boolean;
  active?: boolean;
  showProvider?: boolean;
  onChoose: () => void;
  onStar: () => void;
  onHover?: () => void;
}) {
  return (
    <div
      data-active={active ? 'true' : undefined}
      onMouseEnter={onHover}
      className={cn(
        'flex items-center gap-1.5 px-3 py-[6px]',
        listOptionClass(Boolean(active), selected),
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
            model.supportsImages ? 'vision' : null,
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
        aria-label={starred ? `Unpin ${model.displayName}` : `Pin ${model.displayName}`}
        className="flex-none cursor-pointer rounded-md border-0 bg-transparent p-1 hover:bg-foreground/[0.08]"
      >
        <Star className={cn('h-3.5 w-3.5', starred ? 'fill-accent text-accent' : 'text-muted')} />
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

/** Footer trigger label: prefer a short readable name over the full marketing string. */
function shortModelLabel(model: ModelInfo): string {
  const name = model.displayName.trim();
  // Dated ids like "claude-opus-4-20250514" → drop the trailing YYYYMMDD.
  const undated = name.replace(/[-_]?\d{8}$/, '');
  const candidate = undated.length >= 4 ? undated : name;
  if (candidate.length <= 22) return candidate;
  return `${candidate.slice(0, 20)}…`;
}
