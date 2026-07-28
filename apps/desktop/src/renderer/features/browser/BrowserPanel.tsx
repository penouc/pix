import { ArrowLeft, ArrowRight, ExternalLink, RotateCw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { invoke } from '@/lib/ipc';
import { useUiPrefsStore } from '@/stores/ui-prefs-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

/** Ports a dev server is most likely to be on, offered as one-click starts. */
const COMMON_PORTS = [3000, 5173, 8080, 4321, 1420];

const STORAGE_PREFIX = 'pi-desktop.browser-url.';

/**
 * A preview pane for whatever you are building.
 *
 * This is a sandboxed `<iframe>`, which is deliberate on two counts. Electron's
 * own documentation recommends against the `<webview>` tag ("we currently
 * recommend to not use the webview tag") and names `iframe` and
 * `WebContentsView` as the alternatives; and VS Code's built-in Simple Browser
 * is itself a sandboxed iframe. So this adds no new Electron privilege — no
 * `webviewTag`, no node access, no popups, no top-level navigation.
 *
 * What that costs, stated plainly rather than hidden: a site that sends
 * `X-Frame-Options: DENY` or a restrictive `frame-ancestors` will refuse to
 * render, and the browser gives the page no way to tell us it refused. Local dev
 * servers do not send those headers, which is the case this pane is for. The
 * "Open in browser" button is the escape hatch for everything else.
 *
 * It is also not agent-drivable: the agent cannot see or click this page. That
 * needs a real browser under CDP and an approval story per origin, and it is a
 * separate project rather than something to imply here.
 */
export function BrowserPanel() {
  const project = useWorkspaceStore((s) => s.project);
  const setPref = useUiPrefsStore((s) => s.set);
  const storageKey = `${STORAGE_PREFIX}${project?.id ?? 'none'}`;

  function closePanel() {
    // Browser is a dock tab, not a window — "close" means leave the tab.
    // URL stays in localStorage so reopening restores where you were.
    setPref('dockTab', 'changes');
  }

  const [url, setUrl] = useState('');
  const [draft, setDraft] = useState('');
  /** Bumped to force a reload; an iframe has no reload() we can reach. */
  const [nonce, setNonce] = useState(0);
  /** Our own history, because a cross-origin iframe's is not readable. */
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState(-1);
  const frameRef = useRef<HTMLIFrameElement>(null);

  // Each project remembers where you were.
  useEffect(() => {
    let saved = '';
    try {
      saved = localStorage.getItem(storageKey) ?? '';
    } catch {
      saved = '';
    }
    setUrl(saved);
    setDraft(saved);
    setHistory(saved ? [saved] : []);
    setCursor(saved ? 0 : -1);
  }, [storageKey]);

  function go(next: string) {
    const normalized = normalizeUrl(next);
    if (!normalized) return;
    setUrl(normalized);
    setDraft(normalized);
    setHistory((all) => [...all.slice(0, cursor + 1), normalized]);
    setCursor((value) => value + 1);
    try {
      localStorage.setItem(storageKey, normalized);
    } catch {
      /* storage unavailable — this session only */
    }
  }

  function step(delta: number) {
    const next = cursor + delta;
    const target = history[next];
    if (!target) return;
    setCursor(next);
    setUrl(target);
    setDraft(target);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-1 border-b border-border px-2 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          title="Back"
          disabled={cursor <= 0}
          onClick={() => step(-1)}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          title="Forward"
          disabled={cursor < 0 || cursor >= history.length - 1}
          onClick={() => step(1)}
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          title="Reload"
          disabled={!url}
          onClick={() => setNonce((value) => value + 1)}
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
            go(draft);
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          title="Open in your browser"
          disabled={!url}
          onClick={() => {
            void invoke({ method: 'system.openExternal', params: { url } }).catch(console.error);
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

      {url ? (
        <iframe
          // Remounts on reload and on navigation, which is what makes both work.
          key={`${url}#${nonce}`}
          ref={frameRef}
          src={url}
          title="Preview"
          className="min-h-0 w-full flex-1 border-0 bg-white"
          // No allow-popups and no allow-top-navigation: the page cannot pull the
          // app window somewhere else. allow-same-origin is needed for ordinary
          // pages to use storage at all.
          sandbox="allow-scripts allow-forms allow-same-origin allow-downloads"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-5 text-center">
          <p className="m-0 text-[12.5px] leading-relaxed text-muted">
            Point this at your dev server to see it next to the thread.
          </p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {COMMON_PORTS.map((port) => (
              <Button
                key={port}
                variant="secondary"
                size="sm"
                onClick={() => go(`http://localhost:${port}`)}
              >
                :{port}
              </Button>
            ))}
          </div>
          <p className="m-0 text-[11px] leading-relaxed text-muted">
            Local pages render here. Sites that refuse to be framed stay blank — use “open in
            browser” for those.
          </p>
        </div>
      )}
    </div>
  );
}

/** Accept `localhost:5173` and bare hosts the way a browser address bar does. */
function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : // Anything local is plain http; assume https for the rest.
      /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(trimmed)
      ? `http://${trimmed}`
      : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
