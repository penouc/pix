import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import type { ModelInfo, ProviderSetting, Settings } from '@pi-desktop/protocol';

import { Button } from '@/components/ui/button';
import { invoke } from '@/lib/ipc';

const PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'xai',
  'openrouter',
  'opencode',
  'opencode-go',
  'groq',
  'deepseek',
  'mistral',
  'together',
  'fireworks',
  'moonshotai',
  'minimax',
  'minimax-cn',
  'zai',
];

export function SettingsPanel() {
  const queryClient = useQueryClient();
  const [providerId, setProviderId] = useState(PROVIDERS[0]);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const providers = useQuery({
    queryKey: ['provider.settings'],
    queryFn: () => invoke<ProviderSetting[]>({ method: 'provider.list' }),
  });
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => invoke<Settings>({ method: 'settings.get' }),
  });
  const models = useQuery({
    queryKey: ['agent.models'],
    queryFn: () => invoke<ModelInfo[]>({ method: 'agent.listModels' }),
  });

  useEffect(() => {
    if (model || !settings.data?.defaultModel) return;
    setModel(`${settings.data.defaultModel.providerId}/${settings.data.defaultModel.modelId}`);
  }, [model, settings.data?.defaultModel]);

  const configured = new Set(
    providers.data?.filter((entry) => entry.configured).map((entry) => entry.providerId),
  );

  async function saveKey() {
    if (!providerId || !apiKey.trim()) return;
    setNotice(null);
    try {
      await invoke({
        method: 'provider.saveApiKey',
        params: { providerId, apiKey: apiKey.trim() },
      });
      setApiKey('');
      setNotice(`${providerId} is configured.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['provider.settings'] }),
        queryClient.invalidateQueries({ queryKey: ['agent.models'] }),
      ]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to save Provider key.');
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
      setNotice(error instanceof Error ? error.message : 'Unable to remove Provider key.');
    }
  }

  async function saveDefaultModel(value: string) {
    setModel(value);
    const [providerId, ...modelParts] = value.split('/');
    const modelId = modelParts.join('/');
    await invoke({
      method: 'settings.setDefaultModel',
      params: { model: providerId && modelId ? { providerId, modelId } : undefined },
    });
    await queryClient.invalidateQueries({ queryKey: ['settings'] });
  }

  return (
    <div className="h-full overflow-auto px-8 py-7">
      <div className="mx-auto max-w-2xl space-y-8">
        <header>
          <p className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">
            Preferences
          </p>
          <h1 className="mt-2 text-xl font-semibold text-foreground">Providers & models</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
            API keys are encrypted with macOS Keychain before they are saved locally. Saved keys are
            never shown again.
          </p>
        </header>

        <section className="space-y-4 border-y border-border py-5">
          <div>
            <h2 className="text-sm font-medium">Connect a Provider</h2>
            <p className="mt-1 text-xs text-muted">
              Add or replace an API key for a supported Provider.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)_auto]">
            <select
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
            >
              {PROVIDERS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            <input
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
              type="password"
              autoComplete="off"
              placeholder="API key"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <Button disabled={!apiKey.trim()} onClick={() => void saveKey()}>
              Save key
            </Button>
          </div>
          {notice ? <p className="text-xs text-muted">{notice}</p> : null}
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Configured Providers</h2>
            <p className="mt-1 text-xs text-muted">
              Remove a stored key to disconnect it from this app.
            </p>
          </div>
          {configured.size === 0 ? (
            <p className="text-sm text-muted">No API keys saved in Keychain.</p>
          ) : (
            <div className="space-y-2">
              {[...configured].map((id) => (
                <div
                  key={id}
                  className="flex items-center justify-between border-b border-border py-2"
                >
                  <span className="text-sm text-foreground">{id}</span>
                  <Button variant="ghost" size="sm" onClick={() => void removeKey(id)}>
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3 border-t border-border pt-5">
          <div>
            <h2 className="text-sm font-medium">Default model</h2>
            <p className="mt-1 text-xs text-muted">Used when creating a new session.</p>
          </div>
          <select
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            value={model}
            onChange={(event) => void saveDefaultModel(event.target.value)}
          >
            <option value="">Choose automatically</option>
            {(models.data ?? []).map((entry) => {
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
