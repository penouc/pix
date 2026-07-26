import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, MessageSquare, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { ProviderCatalogEntry, ProviderSetting, Settings } from '@pi-desktop/protocol';

import { Button } from '@/components/ui/button';
import { useOfferedModels } from '@/features/models/use-offered-models';
import { FavoriteModelsSection } from '@/features/models/FavoriteModelsSection';
import { SubscriptionsSection } from '@/features/settings/SubscriptionsSection';
import { invoke } from '@/lib/ipc';

interface SettingsPanelProps {
  onClose?: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const queryClient = useQueryClient();
  const [providerId, setProviderId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeType, setNoticeType] = useState<'ok' | 'err'>('ok');

  // ChatGPT subscription state
  const [chatgptKey, setChatgptKey] = useState('');
  const [chatgptNotice, setChatgptNotice] = useState<string | null>(null);

  const providers = useQuery({
    queryKey: ['provider.settings'],
    queryFn: () => invoke<ProviderSetting[]>({ method: 'provider.list' }),
  });
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => invoke<Settings>({ method: 'settings.get' }),
  });
  const { models: offered } = useOfferedModels();
  /*
   * Providers come from Pi's registry, not a list maintained here. The hand-written
   * one had sixteen ids against the thirty-seven Pi knows, so twenty-one were
   * unreachable, and it could not know which providers accept a subscription
   * login because only the registry says so.
   */
  const catalog = useQuery({
    queryKey: ['provider.listAvailable'],
    queryFn: () => invoke<ProviderCatalogEntry[]>({ method: 'provider.listAvailable' }),
  });
  const available = catalog.data ?? [];


  const chosen = available.find((entry) => entry.id === providerId);

  useEffect(() => {
    if (model || !settings.data?.defaultModel) return;
    setModel(`${settings.data.defaultModel.providerId}/${settings.data.defaultModel.modelId}`);
  }, [model, settings.data?.defaultModel]);

  const configured = new Set(
    providers.data?.filter((e) => e.configured).map((e) => e.providerId),
  );

  async function saveKey() {
    if (!providerId || !apiKey.trim()) return;
    setNotice(null);
    try {
      await invoke({ method: 'provider.saveApiKey', params: { providerId, apiKey: apiKey.trim() } });
      setApiKey('');
      setNoticeType('ok');
      setNotice(`${providerId} configured.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['provider.settings'] }),
        queryClient.invalidateQueries({ queryKey: ['agent.models'] }),
      ]);
    } catch (error) {
      setNoticeType('err');
      setNotice(error instanceof Error ? error.message : 'Unable to save key.');
    }
  }

  async function removeKey(id: string) {
    setNotice(null);
    try {
      await invoke({ method: 'provider.remove', params: { providerId: id } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['provider.settings'] }),
        queryClient.invalidateQueries({ queryKey: ['agent.models'] }),
      ]);
    } catch (error) {
      setNoticeType('err');
      setNotice(error instanceof Error ? error.message : 'Unable to remove key.');
    }
  }

  async function saveChatGptKey() {
    if (!chatgptKey.trim()) return;
    setChatgptNotice(null);
    try {
      await invoke({
        method: 'provider.saveApiKey',
        params: { providerId: 'openai', apiKey: chatgptKey.trim() },
      });
      setChatgptKey('');
      setChatgptNotice('ChatGPT / OpenAI connected.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['provider.settings'] }),
        queryClient.invalidateQueries({ queryKey: ['agent.models'] }),
      ]);
    } catch (error) {
      setChatgptNotice(error instanceof Error ? error.message : 'Unable to save key.');
    }
  }

  async function saveDefaultModel(value: string) {
    setModel(value);
    const [pid, ...modelParts] = value.split('/');
    const mid = modelParts.join('/');
    await invoke({
      method: 'settings.setDefaultModel',
      params: { model: pid && mid ? { providerId: pid, modelId: mid } : undefined },
    });
    await queryClient.invalidateQueries({ queryKey: ['settings'] });
  }

  const chatgptConfigured = configured.has('openai');

  return (
    // `relative` so the login dialog's overlay covers this panel rather than
    // escaping to the window and sitting over the sidebar.
    <div className="relative h-full overflow-auto">
      <div className="mx-auto max-w-2xl px-8 py-7 space-y-8">
        {/* Header */}
        <header className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-muted uppercase">
              Preferences
            </p>
            <h1 className="mt-2 text-xl font-semibold text-foreground">Providers & models</h1>
            <p className="mt-1.5 max-w-md text-sm leading-6 text-muted">
              API keys are encrypted with macOS Keychain and never shown again.
            </p>
          </div>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="mt-1 flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted hover:bg-surface-raised hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </header>

        {/* ── Subscriptions ── */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Subscriptions</h2>
            <p className="mt-1 text-xs text-muted">
              Sign in with a plan you already pay for, instead of an API key.
            </p>
          </div>
          <SubscriptionsSection />
        </section>

        {/* ── OpenAI API key ── */}
        <section className="rounded-2xl border border-border bg-surface p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-foreground/5 border border-border">
              <MessageSquare className="h-4.5 w-4.5 text-foreground" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                ChatGPT
                {chatgptConfigured ? (
                  <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
                    Connected
                  </span>
                ) : null}
              </h2>
              <p className="text-xs text-muted mt-0.5">
                Add an OpenAI API key. To use a ChatGPT Plus/Pro subscription instead, sign in
                under Subscriptions above.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs text-muted">
              Use an API key from{' '}
              <button
                type="button"
                className="inline-flex items-center gap-0.5 text-foreground underline underline-offset-2"
                onClick={() =>
                  window.open?.('https://platform.openai.com/api-keys', '_blank')
                }
              >
                platform.openai.com
                <ExternalLink className="h-3 w-3" />
              </button>
              . This works with any OpenAI plan.
            </p>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm outline-none focus:border-border-strong"
                type="password"
                autoComplete="off"
                placeholder="sk-…"
                value={chatgptKey}
                onChange={(e) => setChatgptKey(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void saveChatGptKey(); }}
              />
              <Button disabled={!chatgptKey.trim()} onClick={() => void saveChatGptKey()}>
                Connect
              </Button>
            </div>
            {chatgptNotice ? (
              <p className="text-xs text-muted">{chatgptNotice}</p>
            ) : null}
          </div>

          {chatgptConfigured ? (
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <span className="text-xs text-muted">OpenAI / ChatGPT is connected.</span>
              <Button variant="ghost" size="sm" onClick={() => void removeKey('openai')}>
                Disconnect
              </Button>
            </div>
          ) : null}
        </section>

        {/* ── Other providers ── */}
        <section className="space-y-4 border-y border-border py-6">
          <div>
            <h2 className="text-sm font-semibold">Other providers</h2>
            <p className="mt-1 text-xs text-muted">
              {available.length
                ? `Add an API key for any of the ${available.length} providers Pi supports.`
                : 'Add an API key for any supported provider.'}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)_auto]">
            <select
              className="rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm outline-none focus:border-border-strong"
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
            >
              <option value="">Choose a provider…</option>
              {available.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                  {entry.hasAuth ? ' ✓' : ''}
                  {entry.modelCount ? ` · ${entry.modelCount}` : ''}
                </option>
              ))}
            </select>
            <input
              className="rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm outline-none focus:border-border-strong"
              type="password"
              autoComplete="off"
              placeholder={chosen?.apiKeyLabel ?? 'API key'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void saveKey(); }}
            />
            <Button disabled={!apiKey.trim() || !providerId} onClick={() => void saveKey()}>
              Save
            </Button>
          </div>

          {notice ? (
            <p className={`text-xs ${noticeType === 'err' ? 'text-danger' : 'text-muted'}`}>
              {notice}
            </p>
          ) : null}
        </section>

        {/* ── Configured providers ── */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Configured providers</h2>
            <p className="mt-1 text-xs text-muted">Remove a stored key to disconnect.</p>
          </div>
          {configured.size === 0 ? (
            <p className="text-sm text-muted">No API keys saved.</p>
          ) : (
            <div className="space-y-1">
              {[...configured].map((id) => (
                <div
                  key={id}
                  className="flex items-center justify-between rounded-xl border border-border bg-surface px-3 py-2.5"
                >
                  <span className="text-sm text-foreground">
                    {available.find((entry) => entry.id === id)?.name ?? id}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => void removeKey(id)}>
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Which models the picker offers ── */}
        <section className="space-y-3 border-t border-border pt-6">
          <div>
            <h2 className="text-sm font-semibold">Favourite models</h2>
            <p className="mt-1 text-xs text-muted">
              Pinned to the top of the composer&apos;s picker. You can also star them there.
            </p>
          </div>
          <FavoriteModelsSection />
        </section>

        {/* ── Default model ── */}
        <section className="space-y-3 border-t border-border pt-6">
          <div>
            <h2 className="text-sm font-semibold">Default model</h2>
            <p className="mt-1 text-xs text-muted">Used when creating a new session.</p>
          </div>
          <select
            className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm outline-none focus:border-border-strong"
            value={model}
            onChange={(e) => void saveDefaultModel(e.target.value)}
          >
            <option value="">Choose automatically</option>
            {/* The same offered list the composer uses, not the whole catalogue. */}
            {offered.map((entry) => {
              const value = `${entry.providerId}/${entry.modelId}`;
              return (
                <option key={value} value={value}>
                  {entry.displayName} ({entry.providerId})
                </option>
              );
            })}
          </select>
        </section>
      </div>

    </div>
  );
}
