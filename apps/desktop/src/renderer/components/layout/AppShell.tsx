import type { ReactNode } from 'react';

import { TitleBar } from '@/components/layout/TitleBar';
import { PanelResizer } from '@/components/layout/PanelResizer';
import { cn } from '@/lib/utils';
import {
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  useUiPrefsStore,
} from '@/stores/ui-prefs-store';

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
  const setPref = useUiPrefsStore((s) => s.set);

  return (
    <div
      className={cn(
        'relative flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground',
        className,
      )}
    >
      <TitleBar right={titleBarRight} />
      <div className="flex min-h-0 flex-1">
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
        <main className="flex min-w-0 flex-1 flex-col">{main}</main>
        {right && showRight ? right : null}
      </div>
      {overlay}
    </div>
  );
}
