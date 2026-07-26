import { FileCode2, FolderTree, Globe, SquareTerminal } from 'lucide-react';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';

import { BrowserPanel } from '@/features/browser/BrowserPanel';
import { ReviewPanel } from '@/features/chat/ReviewPanel';
import { FileTree } from '@/features/files/FileTree';
import { TerminalView } from '@/features/terminal/TerminalView';
import { cn } from '@/lib/utils';
import { useUiPrefsStore, DOCK_MIN_WIDTH, DOCK_MAX_WIDTH, type DockTab } from '@/stores/ui-prefs-store';

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
  onContinue,
  onInsertPath,
}: {
  onOpenFullDiff: () => void;
  onContinue: () => void;
  onInsertPath: (path: string) => void;
}) {
  const tab = useUiPrefsStore((s) => s.dockTab);
  const setPref = useUiPrefsStore((s) => s.set);
  const width = useUiPrefsStore((s) => s.dockWidth);
  /** Once the terminal has been opened it is never torn down — see above. */
  const terminalTouched = useRef(false);
  if (tab === 'terminal') terminalTouched.current = true;

  return (
    <>
      <DockResizer width={width} onWidth={(value) => setPref('dockWidth', value)} />
      <aside
        className="flex min-h-0 flex-none flex-col border-l border-border bg-surface"
        style={{ width }}
      >
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
          {tab === 'changes' ? (
            <ReviewPanel onOpenFullDiff={onOpenFullDiff} onContinue={onContinue} />
          ) : null}
          {tab === 'browser' ? <BrowserPanel /> : null}
          {terminalTouched.current ? (
            <div className={cn('flex min-h-0 flex-1', tab === 'terminal' ? 'flex' : 'hidden')}>
              <TerminalView />
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}

/**
 * Drag handle on the dock's inner edge. Width is committed to the store on every
 * move so the layout follows the pointer, and the store only writes to storage,
 * which is cheap.
 */
function DockResizer({ width, onWidth }: { width: number; onWidth: (value: number) => void }) {
  const dragging = useRef(false);

  const onMove = useCallback(
    (event: PointerEvent) => {
      if (!dragging.current) return;
      // The dock is anchored right, so width grows as the pointer moves left.
      const next = window.innerWidth - event.clientX;
      onWidth(Math.round(Math.min(DOCK_MAX_WIDTH, Math.max(DOCK_MIN_WIDTH, next))));
    },
    [onWidth],
  );

  useEffect(() => {
    function stop() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      // Re-enable text selection, disabled for the duration of the drag.
      document.body.style.userSelect = '';
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      stop();
    };
  }, [onMove]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      tabIndex={0}
      title="Drag to resize"
      className="w-1 flex-none cursor-col-resize bg-transparent hover:bg-accent/40 focus-visible:bg-accent/40"
      onPointerDown={(event) => {
        event.preventDefault();
        dragging.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }}
      // Keyboard resizing, so the panel is not mouse-only.
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const delta = event.key === 'ArrowLeft' ? 24 : -24;
        onWidth(Math.min(DOCK_MAX_WIDTH, Math.max(DOCK_MIN_WIDTH, width + delta)));
      }}
    />
  );
}
