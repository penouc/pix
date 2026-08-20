import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { ReactNode } from 'react';

import { TitleBar } from '@/components/layout/TitleBar';
import { PanelResizer } from '@/components/layout/PanelResizer';
import { cn } from '@/lib/utils';
import { SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, useUiPrefsStore } from '@/stores/ui-prefs-store';

interface AppShellProps {
  sidebar: ReactNode;
  main: ReactNode;
  right?: ReactNode;
  showRight?: boolean;
  /** Title-bar right slot — the active model pill. */
  titleBarRight?: ReactNode;
  /** Modal layer, positioned over the whole window. */
  overlay?: ReactNode;
  className?: string;
}

/**
 * Chrome bar over a 210px sidebar, the working column, and the optional
 * right-hand dock. The dock brings its own width and resizer, so this lays out
 * the row and stays out of it.
 *
 * Sidebar collapse lives in the TitleBar (same row as brand / window controls)
 * so Windows does not get an orphaned collapse-only row under a native title bar.
 */
export function AppShell({
  sidebar,
  main,
  right,
  showRight = false,
  titleBarRight,
  overlay,
  className,
}: AppShellProps) {
  const sidebarWidth = useUiPrefsStore((s) => s.sidebarWidth);
  const sidebarCollapsed = useUiPrefsStore((s) => s.sidebarCollapsed);
  const setPref = useUiPrefsStore((s) => s.set);

  return (
    <div
      className={cn(
        'relative flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground',
        className,
      )}
    >
      <TitleBar
        left={
          <button
            type="button"
            title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            aria-pressed={!sidebarCollapsed}
            onClick={() => setPref('sidebarCollapsed', !sidebarCollapsed)}
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-muted transition-colors hover:bg-foreground/[0.08] hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="h-[18px] w-[18px]" />
            ) : (
              <PanelLeftClose className="h-[18px] w-[18px]" />
            )}
          </button>
        }
        right={titleBarRight}
      />
      <div className="flex min-h-0 min-w-0 w-full flex-1 overflow-hidden">
        {!sidebarCollapsed ? (
          <>
            <aside
              className="flex flex-none select-none flex-col bg-surface"
              style={{ width: sidebarWidth }}
            >
              {sidebar}
            </aside>
            <PanelResizer
              side="left"
              value={sidebarWidth}
              min={SIDEBAR_MIN_WIDTH}
              max={SIDEBAR_MAX_WIDTH}
              onChange={(width) => setPref('sidebarWidth', width)}
            />
          </>
        ) : null}
        <main className="relative z-0 flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
          {main}
        </main>
        {right && showRight ? right : null}
      </div>
      {overlay}
    </div>
  );
}
