import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useState } from 'react';

import type { ProviderCatalogEntry } from '@pi-desktop/protocol';

import { Button } from '@/components/ui/button';
import { invoke } from '@/lib/ipc';
import { ProviderLoginDialog } from '@/features/settings/ProviderLoginDialog';

/**
 * Sign in with a subscription instead of an API key.
 *
 * This is its own section because the first version put the sign-in button
 * inside the "other providers" dropdown flow — visible only after selecting the
 * right provider from a list of thirty-seven, which meant a feature that existed
 * and could not be found.
 *
 * The list is whichever providers Pi's registry says support OAuth, so it grows
 * with the SDK rather than with a list maintained here.
 */
export function SubscriptionsSection() {
  const queryClient = useQueryClient();
  const [login, setLogin] = useState<{ loginId: string; providerName: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const catalog = useQuery({
    queryKey: ['provider.listAvailable'],
    queryFn: () => invoke<ProviderCatalogEntry[]>({ method: 'provider.listAvailable' }),
  });

  const signOut = useMutation({
    mutationFn: (providerId: string) =>
      invoke({ method: 'provider.logout', params: { providerId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['provider.listAvailable'] });
      await queryClient.invalidateQueries({ queryKey: ['agent.models'] });
      await queryClient.invalidateQueries({ queryKey: ['provider.settings'] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  const subscriptions = (catalog.data ?? []).filter((entry) => entry.oauthLabel);

  async function signIn(entry: ProviderCatalogEntry) {
    setBusy(entry.id);
    setError(null);
    try {
      const started = await invoke<{ loginId: string }>({
        method: 'provider.login',
        params: { providerId: entry.id, type: 'oauth' },
      });
      setLogin({ loginId: started.loginId, providerName: entry.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (!subscriptions.length) {
    return (
      <p className="text-xs text-muted">
        {catalog.isLoading
          ? 'Loading providers…'
          : 'No provider in the catalogue offers a subscription login.'}
      </p>
    );
  }

  return (
    <>
      {error ? (
        <p className="mb-2 rounded-xl border border-accent/30 bg-accent-100 px-3 py-2 text-xs leading-relaxed text-accent-900">
          {error}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border">
        {subscriptions.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                {entry.oauthLabel}
                {entry.oauthConnected ? (
                  <span className="inline-flex items-center gap-0.5 rounded-md bg-accent-2-100 px-1.5 py-0.5 text-[10px] font-semibold text-accent-2-900">
                    <Check className="h-2.5 w-2.5" />
                    connected
                  </span>
                ) : null}
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-muted">
                {entry.id}
                {entry.modelCount ? ` · ${entry.modelCount} models` : ''}
                {/* Says why a provider already works without a subscription, so
                    "connected" is never implied by an ambient API key. */}
                {!entry.oauthConnected && entry.hasAuth ? ' · using an API key' : ''}
              </div>
            </div>
            {entry.oauthConnected ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={signOut.isPending}
                onClick={() => signOut.mutate(entry.id)}
              >
                Sign out
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy === entry.id}
                onClick={() => void signIn(entry)}
              >
                {entry.oauthLoginLabel ?? 'Sign in'}
              </Button>
            )}
          </div>
        ))}
      </div>

      <p className="mt-2.5 text-[11.5px] leading-relaxed text-muted">
        Signing in opens your browser. The token is stored by the Pi SDK in its own credential
        store — this app never sees it.
      </p>

      {login ? (
        <ProviderLoginDialog
          loginId={login.loginId}
          providerName={login.providerName}
          onClose={() => setLogin(null)}
        />
      ) : null}
    </>
  );
}
