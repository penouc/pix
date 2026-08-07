import { Check, Circle, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

import type { TodoItem, TodoStatus } from '@pi-desktop/protocol';

import { cn } from '@/lib/utils';
import { useAgentStreamStore } from '@/stores/agent-stream-store';

const STATUS_ICON: Record<TodoStatus, ReactNode> = {
  pending: <Circle className="h-3.5 w-3.5 text-foreground/40" strokeWidth={1.5} />,
  in_progress: <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" strokeWidth={2} />,
  completed: <Check className="h-3.5 w-3.5 text-foreground/40" strokeWidth={2.5} />,
};

/**
 * #11 — the agent's step checklist, rendered read-only in the workbench dock.
 *
 * The list mirrors exactly what the model sees (each `todo` tool call returns
 * the same items to the LLM), so the sidebar is a window into the agent's plan,
 * not a separate store the agent has to keep in sync.
 */
export function TodoPanel() {
  const todos = useAgentStreamStore((s) => s.todos);

  if (todos.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <Circle className="h-5 w-5 text-foreground/25" strokeWidth={1.5} />
        <p className="text-xs leading-relaxed text-foreground/50">
          No todo checklist yet.
          <br />
          Ask the agent to plan a multi-step task and it will track its steps here.
        </p>
      </div>
    );
  }

  const done = todos.filter((item) => item.status === 'completed').length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-none items-center justify-between border-b border-border px-4 py-2.5">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-foreground/60">
          Todo checklist
        </h3>
        <span className="rounded-full bg-foreground/[0.07] px-2 py-0.5 text-[10.5px] font-semibold text-foreground/60">
          {done}/{todos.length}
        </span>
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {todos.map((item: TodoItem) => (
          <li
            key={item.id}
            className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-foreground/[0.04]"
          >
            <span className="mt-0.5 flex-none">{STATUS_ICON[item.status]}</span>
            <span
              className={cn(
                'min-w-0 flex-1 text-[12.5px] leading-snug',
                item.status === 'completed'
                  ? 'text-foreground/40 line-through'
                  : 'text-foreground/85',
              )}
            >
              {item.text}
            </span>
          </li>
        ))}
      </ol>
      <p className="flex-none border-t border-border px-4 py-2 text-[10.5px] text-foreground/40">
        Updated by the agent as it works.
      </p>
    </div>
  );
}
