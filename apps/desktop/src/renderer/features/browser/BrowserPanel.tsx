import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  MousePointer2,
  RotateCw,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { formatBrowserSelectionForComposer } from '@/features/browser/selection-format';
import { invoke, IpcError } from '@/lib/ipc';
import { useUiPrefsStore } from '@/stores/ui-prefs-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { BrowserSelection, BrowserState, InputImage } from '@pi-desktop/protocol';

/** Ports a dev server is most likely to be on, offered as one-click starts. */
const COMMON_PORTS = [3000, 5173, 8080, 4321, 1420];

const STORAGE_PREFIX = 'pi-desktop.browser-url.';

type ComposerInsert = {
  text?: string;
  images?: InputImage[];
  token: number;
};

const EMPTY_STATE: BrowserState = {
  url: '',
  title: '',
  canGoBack: false,
  canGoForward: false,
  picking: false,
};

/**
 * Dock preview chrome for the Main-owned WebContentsView (ADR-0005).
 *
 * The page itself is not an iframe — Main paints a WebContentsView into the
 * content hole below this toolbar. That is what makes element selection and
 * screenshots possible. Agent-driven browsing is still out of scope (P2 / C8).
 */
export function BrowserPanel({
  onInsertComposer,
}: {
  onInsertComposer: (insert: ComposerInsert) => void;
}) {
  const project = useWorkspaceStore((s) => s.project);
  const setPref = useUiPrefsStore((s) => s.set);
  const storageKey = `${STORAGE_PREFIX}${project?.id ?? 'none'}`;

  const [draft, setDraft] = useState('');
  /** True only after this panel intentionally shows a page (avoids leftover guest URLs). */
  const [pageOpen, setPageOpen] = useState(false);
  const [state, setState] = useState<BrowserState>(EMPTY_STATE);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  function closePanel() {
    setPref('dockTab', 'changes');
  }

  const applyState = useCallback((next: BrowserState, open: boolean) => {
    setState(next);
    setPageOpen(open);
    if (open && next.url) setDraft(next.url);
  }, []);

  const syncBounds = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    void invoke<BrowserState>({
      method: 'browser.setBounds',
      params: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
    })
      .then((next) => applyState(next, true))
      .catch((err) => console.error('[browser] setBounds failed', err));
  }, [applyState]);

  // Attach + restore on mount / project change. Hiding (not destroying) on unmount
  // keeps guest history across Dock tab switches; the window close path detaches.
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      setError(null);
      let saved = '';
      try {
        saved = localStorage.getItem(storageKey) ?? '';
      } catch {
        saved = '';
      }
      setDraft(saved);

      try {
        await invoke<BrowserState>({ method: 'browser.attach' });
        if (cancelled) return;

        if (!saved) {
          await invoke({ method: 'browser.setVisible', params: { visible: false } });
          if (!cancelled) applyState(EMPTY_STATE, false);
          return;
        }

        const current = await invoke<BrowserState>({ method: 'browser.getState' });
        if (cancelled) return;
        const next =
          current.url === saved
            ? await invoke<BrowserState>({ method: 'browser.setVisible', params: { visible: true } })
            : await invoke<BrowserState>({ method: 'browser.navigate', params: { url: saved } });
        if (cancelled) return;
        applyState(next, true);
        requestAnimationFrame(() => {
          if (!cancelled) syncBounds();
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          applyState(EMPTY_STATE, false);
        }
      }
    }

    void boot();
    return () => {
      cancelled = true;
      void invoke({ method: 'browser.setVisible', params: { visible: false } }).catch(() => {
        /* shutting down */
      });
    };
  }, [storageKey, applyState, syncBounds]);

  useEffect(() => {
    if (!pageOpen) return;
    syncBounds();
    const el = contentRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => syncBounds());
    observer.observe(el);
    window.addEventListener('resize', syncBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncBounds);
    };
  }, [pageOpen, syncBounds]);

  async function go(next: string) {
    setError(null);
    try {
      const nextState = await invoke<BrowserState>({
        method: 'browser.navigate',
        params: { url: next },
      });
      applyState(nextState, true);
      try {
        localStorage.setItem(storageKey, nextState.url || next);
      } catch {
        /* storage unavailable */
      }
      requestAnimationFrame(() => syncBounds());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function startPick() {
    setError(null);
    setPicking(true);
    try {
      const selection = await invoke<BrowserSelection>({ method: 'browser.startPicker' });
      onInsertComposer({
        text: formatBrowserSelectionForComposer(selection),
        ...(selection.screenshot ? { images: [selection.screenshot] } : {}),
        token: Date.now(),
      });
      const next = await invoke<BrowserState>({ method: 'browser.getState' });
      applyState(next, true);
    } catch (err) {
      if (err instanceof IpcError && err.code === 'BROWSER_PICKER_CANCELLED') {
        /* user hit Escape */
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setPicking(false);
    }
  }

  async function cancelPick() {
    try {
      const next = await invoke<BrowserState>({ method: 'browser.cancelPicker' });
      applyState(next, pageOpen);
    } finally {
      setPicking(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-1 border-b border-border px-2 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          title="Back"
          disabled={!pageOpen || !state.canGoBack}
          onClick={() => {
            void invoke<BrowserState>({ method: 'browser.goBack' })
              .then((next) => applyState(next, true))
              .catch(console.error);
          }}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          title="Forward"
          disabled={!pageOpen || !state.canGoForward}
          onClick={() => {
            void invoke<BrowserState>({ method: 'browser.goForward' })
              .then((next) => applyState(next, true))
              .catch(console.error);
          }}
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          title="Reload"
          disabled={!pageOpen}
          onClick={() => {
            void invoke<BrowserState>({ method: 'browser.reload' })
              .then((next) => applyState(next, true))
              .catch(console.error);
          }}
        >
          <RotateCw className="h-3.5 w-3.5" />
        </Button>
        <input
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1 font-mono text-[11.5px] outline-none focus:border-accent/50"
          placeholder="localhost:5173"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void go(draft);
          }}
        />
        {picking ? (
          <Button
            variant="secondary"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => void cancelPick()}
          >
            Cancel
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px]"
            title="Select an element to send into the composer"
            disabled={!pageOpen}
            onClick={() => void startPick()}
          >
            <MousePointer2 className="h-3 w-3" />
            Select
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          title="Open in your browser"
          disabled={!pageOpen || !state.url}
          onClick={() => {
            void invoke({ method: 'system.openExternal', params: { url: state.url } }).catch(
              console.error,
            );
          }}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          title="Close browser"
          onClick={closePanel}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {error ? (
        <p className="m-0 flex-none border-b border-border bg-background px-3 py-1.5 text-[11.5px] text-danger">
          {error}
        </p>
      ) : null}

      {picking ? (
        <p className="m-0 flex-none border-b border-border px-3 py-1.5 text-[11.5px] text-muted">
          Click an element in the preview. Esc cancels. Selection is limited to localhost.
        </p>
      ) : null}

      <div ref={contentRef} className="relative min-h-0 w-full flex-1 bg-white">
        {!pageOpen ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-surface px-5 text-center">
            <p className="m-0 text-[12.5px] leading-relaxed text-muted">
              Point this at your dev server to see it next to the thread. Use Select to send an
              element into the composer, then ask the agent to change the source.
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {COMMON_PORTS.map((port) => (
                <Button
                  key={port}
                  variant="secondary"
                  size="sm"
                  onClick={() => void go(`http://localhost:${port}`)}
                >
                  :{port}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
