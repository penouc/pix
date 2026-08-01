import { FileCode2, FolderTree, Globe, SquareTerminal } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { PanelResizer } from '@/components/layout/PanelResizer';
import { BrowserPanel } from '@/features/browser/BrowserPanel';
import { ReviewPanel } from '@/features/chat/ReviewPanel';
import { FileTree } from '@/features/files/FileTree';
import { TerminalView } from '@/features/terminal/TerminalView';
import { cn } from '@/lib/utils';
import {
  useUiPrefsStore,
  DOCK_MIN_WIDTH,
  DOCK_MAX_WIDTH,
  type DockTab,
} from '@/stores/ui-prefs-store';

const MIN_THREAD_WIDTH = 440;
const RESIZER_WIDTH = 8;

const TABS: Array<{ id: DockTab; label: string; icon: ReactNode }> = [
  { id: 'files', label: 'Files', icon: <FolderTree className="h-3.5 w-3.5" /> },
  { id: 'changes', label: 'Changes', icon: <FileCode2 className="h-3.5 w-3.5" /> },
  { id: 'terminal', label: 'Terminal', icon: <SquareTerminal className="h-3.5 w-3.5" /> },
  { id: 'browser', label: 'Browser', icon: <Globe className="h-3.5 w-3.5" /> },
];

/**
 * The right-hand dock: files, changes, terminal and a preview pane, beside the
 * thread rather than instead of it.
 *
 * Only the active tab is mounted, with one exception. The terminal keeps its
 * scrollback and its per-tab working directories in component state, so
 * unmounting it would throw away a session you are in the middle of — it stays
 * mounted once opened and is hidden with CSS. The others are cheap to rebuild
 * and re-query on the way back in.
 */
export function RightDock({
  onOpenFullDiff,
  onInsertPath,
}: {
  onOpenFullDiff: (path?: string) => void;
  onInsertPath: (path: string) => void;
}) {
  const tab = useUiPrefsStore((s) => s.dockTab);
  const setPref = useUiPrefsStore((s) => s.set);
  const width = useUiPrefsStore((s) => s.dockWidth);
  const sidebarWidth = useUiPrefsStore((s) => s.sidebarWidth);
  const sidebarCollapsed = useUiPrefsStore((s) => s.sidebarCollapsed);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  /** Once the terminal has been opened it is never torn down — see above. */
  const terminalTouched = useRef(false);
  if (tab === 'terminal') terminalTouched.current = true;

  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', updateViewportWidth);
    return () => window.removeEventListener('resize', updateViewportWidth);
  }, []);

  // Never let the dock cover or collapse the conversation. The preferred width
  // is retained in the store, while the rendered width adapts to this window.
  const occupiedSidebarWidth = sidebarCollapsed ? 0 : sidebarWidth + RESIZER_WIDTH;
  const availableDockWidth =
    viewportWidth - occupiedSidebarWidth - MIN_THREAD_WIDTH - RESIZER_WIDTH;
  const maxWidth = Math.max(
    DOCK_MIN_WIDTH,
    Math.min(DOCK_MAX_WIDTH, Math.floor(availableDockWidth)),
  );
  const renderedWidth = Math.min(width, maxWidth);

  return (
    <section
      aria-label="Workbench dock"
      className="relative z-0 flex min-h-0 flex-none isolate overflow-hidden bg-surface"
      style={{ width: renderedWidth + RESIZER_WIDTH, backgroundColor: 'var(--color-surface)' }}
    >
      <PanelResizer
        side="right"
        value={renderedWidth}
        min={DOCK_MIN_WIDTH}
        max={maxWidth}
        onChange={(next) => setPref('dockWidth', next)}
      />
      <aside className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-border bg-surface">
        <div
          role="tablist"
          aria-label="Workbench panels"
          className="flex flex-none items-center gap-0.5 border-b border-border px-1.5 py-1.5"
        >
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={entry.id === tab}
              onClick={() => setPref('dockTab', entry.id)}
              className={cn(
                'flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[10px] border-0 px-2 py-1.5 text-[11.5px] transition-colors',
                entry.id === tab
                  ? 'bg-background font-bold text-foreground shadow-[var(--shadow-sm)]'
                  : 'bg-transparent text-foreground/55 hover:bg-foreground/[0.06]',
              )}
            >
              {entry.icon}
              <span className="truncate">{entry.label}</span>
            </button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {tab === 'files' ? <FileTree onInsertPath={onInsertPath} /> : null}
          {tab === 'changes' ? <ReviewPanel onOpenFullDiff={onOpenFullDiff} /> : null}
          {tab === 'browser' ? <BrowserPanel /> : null}
          {terminalTouched.current ? (
            <div className={cn('flex min-h-0 flex-1', tab === 'terminal' ? 'flex' : 'hidden')}>
              <TerminalView />
            </div>
          ) : null}
        </div>
      </aside>
    </section>
  );
}
