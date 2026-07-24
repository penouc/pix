import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface AppShellProps {
  sidebar: ReactNode;
  main: ReactNode;
  right: ReactNode;
  className?: string;
}

/** Three-column workbench skeleton (plan §18). */
export function AppShell({ sidebar, main, right, className }: AppShellProps) {
  return (
    <div className={cn('flex h-full min-h-0 bg-background text-foreground', className)}>
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface">
        {sidebar}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">{main}</main>
      <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-surface">
        {right}
      </aside>
    </div>
  );
}
