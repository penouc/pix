import { useQuery } from '@tanstack/react-query';
import { FileText, Search, Sparkles, SquareTerminal, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { SessionSummary, SkillInfo } from '@pi-desktop/protocol';

import { Badge } from '@/components/ui/badge';
import { invoke } from '@/lib/ipc';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/stores/workspace-store';

export interface PaletteCommand {
  id: string;
  title: string;
  hint?: string;
  run: () => void;
}

interface Hit {
  key: string;
  group: string;
  icon: ReactNode;
  title: string;
  hint?: string;
  run: () => void;
}

/**
 * The ⌘K palette. Tasks come from the session list, files from `git ls-files`
 * in Main (so ignored paths never show up), commands from the app itself, and
 * skills from the on-disk skill dirs.
 */
export function SearchPalette({
  onClose,
  commands,
  onOpenSession,
  onOpenFile,
  onRunSkill,
}: {
  onClose: () => void;
  commands: PaletteCommand[];
  onOpenSession: (session: SessionSummary) => void;
  onOpenFile: (path: string) => void;
  onRunSkill: (skill: SkillInfo) => void;
}) {
  const project = useWorkspaceStore((s) => s.project);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const sessions = useQuery({
    queryKey: ['session.list', project?.id],
    enabled: Boolean(project?.id),
    queryFn: () =>
      invoke<SessionSummary[]>({ method: 'session.list', params: { projectId: project!.id } }),
  });

  const skills = useQuery({
    queryKey: ['skills.list', project?.id],
    queryFn: () =>
      invoke<SkillInfo[]>({ method: 'skills.list', params: { projectId: project?.id } }),
  });

  const files = useQuery({
    queryKey: ['project.searchFiles', project?.id, query],
    enabled: Boolean(project?.trusted && query.trim().length > 0),
    queryFn: () =>
      invoke<string[]>({
        method: 'project.searchFiles',
        params: { projectId: project!.id, query, limit: 8 },
      }),
  });

  const hits = useMemo<Hit[]>(() => {
    const needle = query.trim().toLowerCase();
    const match = (text: string) => !needle || text.toLowerCase().includes(needle);
    const out: Hit[] = [];

    for (const session of sessions.data ?? []) {
      if (!match(session.title)) continue;
      out.push({
        key: `task:${session.id}`,
        group: 'Tasks',
        icon: <Sparkles className="h-3.5 w-3.5" />,
        title: session.title,
        hint: `session ${session.id.slice(0, 8)}`,
        run: () => onOpenSession(session),
      });
      if (out.length > 6) break;
    }

    for (const filePath of files.data ?? []) {
      out.push({
        key: `file:${filePath}`,
        group: 'Files',
        icon: <FileText className="h-3.5 w-3.5" />,
        title: filePath,
        run: () => onOpenFile(filePath),
      });
    }

    for (const command of commands) {
      if (!match(command.title)) continue;
      out.push({
        key: `cmd:${command.id}`,
        group: 'Commands',
        icon: <SquareTerminal className="h-3.5 w-3.5" />,
        title: command.title,
        hint: command.hint,
        run: command.run,
      });
    }

    for (const skill of skills.data ?? []) {
      if (!skill.enabled) continue;
      if (!match(`${skill.command} ${skill.name}`)) continue;
      out.push({
        key: `skill:${skill.id}`,
        group: 'Skills',
        icon: <Zap className="h-3.5 w-3.5" />,
        title: `${skill.command} — ${skill.name}`,
        hint: skill.scope,
        run: () => onRunSkill(skill),
      });
    }

    return out;
  }, [
    query,
    sessions.data,
    files.data,
    skills.data,
    commands,
    onOpenSession,
    onOpenFile,
    onRunSkill,
  ]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const grouped = useMemo(() => {
    const map = new Map<string, Hit[]>();
    for (const hit of hits) {
      const bucket = map.get(hit.group) ?? [];
      bucket.push(hit);
      map.set(hit.group, bucket);
    }
    return [...map.entries()];
  }, [hits]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((value) => Math.min(value + 1, Math.max(hits.length - 1, 0)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((value) => Math.max(value - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const hit = hits[cursor];
      if (!hit) return;
      hit.run();
      onClose();
    }
  }

  let flatIndex = -1;

  return (
    <div
      className="absolute inset-0 z-50 flex justify-center bg-[rgba(23,24,26,.42)] pt-[88px]"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="flex max-h-[520px] w-[620px] flex-col overflow-hidden rounded-[26px] bg-background shadow-[var(--shadow-lg)]"
        style={{ animation: 'pi-in .16s ease-out' }}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <Search className="h-[17px] w-[17px] flex-none opacity-45" />
          <input
            autoFocus
            className="flex-1 border-0 bg-transparent p-0 text-[15px] outline-none placeholder:text-muted"
            placeholder="Search tasks, files, commands, skills…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {project ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="text-[11px] text-muted">in</span>
              <Badge tone="neutral" className="text-[10.5px]">
                {project.name}
              </Badge>
            </span>
          ) : null}
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2.5 pt-2 pb-2.5">
          {grouped.map(([group, items]) => (
            <div key={group} className="mb-1.5">
              <div className="px-2.5 pt-2 pb-1 text-[10px] font-bold tracking-[0.14em] text-foreground/40 uppercase">
                {group}
              </div>
              {items.map((hit) => {
                flatIndex += 1;
                const active = flatIndex === cursor;
                return (
                  <div
                    key={hit.key}
                    data-active={active}
                    onMouseEnter={() => setCursor(hits.indexOf(hit))}
                    onClick={() => {
                      hit.run();
                      onClose();
                    }}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-[14px] px-3 py-2.5',
                      active && 'bg-foreground/[0.06]',
                    )}
                  >
                    <span className="grid h-6 w-6 flex-none place-items-center rounded-lg bg-neutral-200 text-neutral-700">
                      {hit.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">{hit.title}</span>
                    {hit.hint ? (
                      <span className="font-mono text-[11px] text-muted">{hit.hint}</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}

          {!hits.length ? (
            <div className="flex flex-col items-center gap-2 px-3.5 py-8 text-center">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-neutral-200 text-neutral-500">
                <Search className="h-4 w-4" />
              </span>
              <div className="text-[13px] font-bold">
                {query ? `No results for “${query}”` : 'Start typing to search'}
              </div>
              <div className="text-xs text-muted">Try a task title, a file path, or a $ skill.</div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-none items-center gap-4 border-t border-border bg-surface px-4.5 py-2.5 text-[11px] text-muted">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span className="flex-1" />
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
