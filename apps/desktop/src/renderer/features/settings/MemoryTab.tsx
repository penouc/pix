import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { SavedMemory } from '@pi-desktop/protocol';

import { Button } from '@/components/ui/button';
import { invoke } from '@/lib/ipc';
import { cn } from '@/lib/utils';

/**
 * ChatGPT-style saved memories: durable facts about the user across projects.
 * Injected into new (non-temporary) sessions; editable here or via the agent.
 */
export function MemoryTab() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const memories = useQuery({
    queryKey: ['memory.list'],
    queryFn: () => invoke<SavedMemory[]>({ method: 'memory.list' }),
  });

  const add = useMutation({
    mutationFn: (content: string) =>
      invoke<SavedMemory>({ method: 'memory.add', params: { content, source: 'user' } }),
    onSuccess: async () => {
      setDraft('');
      await queryClient.invalidateQueries({ queryKey: ['memory.list'] });
    },
  });

  const update = useMutation({
    mutationFn: (input: { id: string; content: string }) =>
      invoke<SavedMemory>({ method: 'memory.update', params: input }),
    onSuccess: async () => {
      setEditingId(null);
      setEditText('');
      await queryClient.invalidateQueries({ queryKey: ['memory.list'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => invoke({ method: 'memory.delete', params: { id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['memory.list'] });
    },
  });

  const clearAll = useMutation({
    mutationFn: () => invoke<{ deleted: number }>({ method: 'memory.clear' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['memory.list'] });
    },
  });

  const list = memories.data ?? [];
  const busy = add.isPending || update.isPending || remove.isPending || clearAll.isPending;

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-border bg-foreground/[0.02] p-3.5">
        <label className="mb-2 block text-[12px] font-medium text-foreground/70">
          Add a saved memory
        </label>
        <textarea
          rows={2}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="e.g. I prefer TypeScript strict mode and concise diffs"
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] outline-none placeholder:text-muted focus:border-foreground/30"
          disabled={busy}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="m-0 text-[11.5px] text-muted">
            Applied to new tasks. Temporary chats never read or write these.
          </p>
          <Button
            size="sm"
            disabled={busy || !draft.trim()}
            onClick={() => add.mutate(draft.trim())}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Save
          </Button>
        </div>
        {add.isError ? (
          <p className="mt-2 m-0 text-[12px] text-danger">
            {add.error instanceof Error ? add.error.message : String(add.error)}
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] text-muted">
          {memories.isLoading
            ? 'Loading…'
            : `${list.length} memor${list.length === 1 ? 'y' : 'ies'}`}
        </div>
        {list.length ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Delete all saved memories?')) clearAll.mutate();
            }}
            className="text-[12px] text-muted hover:text-danger disabled:opacity-40"
          >
            Clear all
          </button>
        ) : null}
      </div>

      {memories.isError ? (
        <p className="m-0 text-[12px] text-danger">
          {memories.error instanceof Error ? memories.error.message : String(memories.error)}
        </p>
      ) : null}

      {!memories.isLoading && !list.length ? (
        <p className="m-0 rounded-xl border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted">
          No saved memories yet. Add one above, or ask the agent to remember something.
        </p>
      ) : null}

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {list.map((item) => {
          const editing = editingId === item.id;
          return (
            <li
              key={item.id}
              className={cn(
                'rounded-xl border border-border px-3.5 py-3',
                editing && 'border-foreground/25',
              )}
            >
              {editing ? (
                <>
                  <textarea
                    rows={2}
                    value={editText}
                    onChange={(event) => setEditText(event.target.value)}
                    className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-foreground/30"
                    disabled={busy}
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setEditingId(null);
                        setEditText('');
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy || !editText.trim()}
                      onClick={() =>
                        update.mutate({ id: item.id, content: editText.trim() })
                      }
                    >
                      Update
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-[13px] leading-snug text-foreground">{item.content}</p>
                    <p className="mt-1.5 m-0 text-[11px] text-muted">
                      {item.source === 'agent' ? 'From agent' : 'From you'} ·{' '}
                      {relativeTime(item.updatedAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    title="Edit"
                    disabled={busy}
                    onClick={() => {
                      setEditingId(item.id);
                      setEditText(item.content);
                    }}
                    className="flex h-7 shrink-0 items-center rounded-full px-2 text-[11.5px] text-muted hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-40"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    title="Delete"
                    disabled={busy}
                    onClick={() => remove.mutate(item.id)}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted hover:bg-foreground/[0.06] hover:text-danger disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function relativeTime(ts: number): string {
  const delta = Date.now() - ts;
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
