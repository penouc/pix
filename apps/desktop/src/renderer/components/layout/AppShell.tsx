import type { ReactNode } from 'react';

import { TitleBar } from '@/components/layout/TitleBar';
import { cn } from '@/lib/utils';

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
 * Chrome bar over a 210px sidebar, the working column, and the optional 336px
 * review panel — the widths the design lays out.
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
  return (
    <div
      className={cn(
        'relative flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground',
        className,
      )}
    >
      <TitleBar right={titleBarRight} />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[210px] flex-none select-none flex-col border-r border-border bg-surface">
          {sidebar}
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">{main}</main>
        {right && showRight ? (
          <aside className="flex min-h-0 w-[336px] flex-none flex-col border-l border-border bg-surface">
            {right}
          </aside>
        ) : null}
      </div>
      {overlay}
    </div>
  );
}
