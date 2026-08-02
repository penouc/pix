import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { SkillInfo } from '@pi-desktop/protocol';

import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { invoke } from '@/lib/ipc';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/stores/workspace-store';

type ScopeFilter = 'all' | 'project' | 'global';
type SkillExampleId = 'code-review' | 'test-failure-triage';

const SKILL_EXAMPLES: Array<{
  id: SkillExampleId;
  name: string;
  command: string;
  description: string;
}> = [
  {
    id: 'code-review',
    name: 'Code review',
    command: '/skill:code-review',
    description:
      'Review the current diff for correctness, security, regressions and missing tests.',
  },
  {
    id: 'test-failure-triage',
    name: 'Test failure triage',
    command: '/skill:test-failure-triage',
    description:
      'Reproduce a failing test, identify its root cause and propose the smallest safe fix.',
  },
];

/** Pi skills discovered from its real global and trusted-project locations. */
export function SkillsView({ onRunSkill }: { onRunSkill: (skill: SkillInfo) => void }) {
  const project = useWorkspaceStore((s) => s.project);
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<ScopeFilter>('all');

  const skills = useQuery({
    queryKey: ['skills.list', project?.id],
    queryFn: () =>
      invoke<SkillInfo[]>({ method: 'skills.list', params: { projectId: project?.id } }),
  });

  const setEnabled = useMutation({
    mutationFn: (input: { skillId: string; enabled: boolean }) =>
      invoke<SkillInfo[]>({
        method: 'skills.setEnabled',
        params: { ...input, projectId: project?.id },
      }),
    onSuccess: (next) => queryClient.setQueryData(['skills.list', project?.id], next),
  });

  const installExample = useMutation({
    mutationFn: (id: SkillExampleId) =>
      invoke<SkillInfo[]>({
        method: 'skills.installExample',
        params: { id, projectId: project?.id },
      }),
    onSuccess: (next) => queryClient.setQueryData(['skills.list', project?.id], next),
  });

  const list = useMemo(() => skills.data ?? [], [skills.data]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return list.filter((skill) => {
      if (scope !== 'all' && skill.scope !== scope) return false;
      return (
        !needle ||
        `${skill.name} ${skill.command} ${skill.description}`.toLowerCase().includes(needle)
      );
    });
  }, [list, query, scope]);
  const projectCount = list.filter((skill) => skill.scope === 'project').length;

  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[920px] px-8 pt-8 pb-9">
        <div className="mb-1.5 flex items-end gap-3.5">
          <div className="flex-1">
            <div className="text-[11px] font-bold tracking-[0.14em] text-foreground/45 uppercase">
              Skills
            </div>
            <h2 className="mt-2 mb-1.5">Reusable expertise, on demand</h2>
          </div>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => void skills.refetch()}
            disabled={skills.isFetching}
          >
            {skills.isFetching ? 'Scanning…' : 'Rescan'}
          </Button>
        </div>
        <p className="mb-5 max-w-[620px] text-[13.5px] leading-relaxed text-muted">
          Type <span className="font-mono text-accent-800">$</span> in the composer to pick a skill.
          PiX sends the standard <span className="font-mono">/skill:name</span> command, so
          arguments after it are passed through to the skill.
        </p>

        <div className="mb-4 flex flex-wrap items-center gap-2.5">
          <label className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              className="input w-full bg-background pr-3 pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search skills"
              aria-label="Search skills"
            />
          </label>
          <Segmented
            aria-label="Skill scope"
            options={[
              { value: 'all', label: `All ${list.length}` },
              { value: 'project', label: `Project ${projectCount}` },
              { value: 'global', label: `Global ${list.length - projectCount}` },
            ]}
            value={scope}
            onChange={setScope}
          />
        </div>

        {skills.isError || installExample.isError ? (
          <div className="mb-4 rounded-[16px] bg-danger/10 px-4 py-3 text-[12.5px] text-danger">
            {skills.isError
              ? `Could not scan skills: ${skills.error.message}`
              : `Could not add example: ${installExample.error?.message}`}
          </div>
        ) : null}

        {!project?.trusted && project ? (
          <div className="mb-4 rounded-[16px] bg-neutral-200 px-4 py-3 text-[12px] leading-relaxed text-neutral-800">
            Project skills stay hidden until you trust this workspace. Global skills are still
            available.
          </div>
        ) : null}

        {!list.length && !skills.isLoading ? (
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-[13px] font-bold">Start with a working example</div>
              <div className="mt-1 text-[12px] text-muted">
                Add either skill to PiX, then edit its SKILL.md whenever you want.
              </div>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3">
              {SKILL_EXAMPLES.map((example) => (
                <div
                  key={example.id}
                  className="flex min-h-[168px] flex-col gap-2.5 rounded-[22px] border border-border bg-background p-4 shadow-[var(--shadow-sm)]"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="rounded-full bg-accent-100 px-2.5 py-[3px] font-mono text-[12px] text-accent-800">
                      {example.command}
                    </span>
                    <span className="text-[13.5px] font-bold">{example.name}</span>
                  </div>
                  <div className="flex-1 text-[12.5px] leading-relaxed text-muted">
                    {example.description}
                  </div>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      disabled={installExample.isPending}
                      onClick={() => installExample.mutate(example.id)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add skill
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[11.5px] leading-relaxed text-muted">
              Or add your own under PiX agent data <span className="font-mono">skills/</span>,{' '}
              <span className="font-mono">~/.agents/skills</span>,{' '}
              <span className="font-mono">.pi/skills</span> or{' '}
              <span className="font-mono">.agents/skills</span>.
            </div>
          </div>
        ) : filtered.length === 0 && !skills.isLoading ? (
          <div className="rounded-[20px] border border-dashed border-foreground/20 px-5 py-7 text-center text-[12.5px] text-muted">
            No skills match this search and scope.
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3">
            {filtered.map((skill) => (
              <div
                key={skill.id}
                className={cn(
                  'flex min-h-[168px] flex-col gap-2.5 rounded-[22px] border border-border bg-background p-4 shadow-[var(--shadow-sm)] transition-opacity',
                  !skill.enabled && 'opacity-60',
                )}
              >
                <div className="flex items-center gap-2.5">
                  <span className="rounded-full bg-accent-100 px-2.5 py-[3px] font-mono text-[12px] text-accent-800">
                    {skill.command}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold">
                    {skill.name}
                  </span>
                  <Switch
                    label={`Show ${skill.name} in skill picker`}
                    checked={skill.enabled}
                    disabled={setEnabled.isPending}
                    onChange={(next) => setEnabled.mutate({ skillId: skill.id, enabled: next })}
                  />
                </div>
                <div className="line-clamp-3 flex-1 text-[12.5px] leading-relaxed text-muted">
                  {skill.description || 'No description in the skill file.'}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-[2px] text-[10.5px]',
                      skill.scope === 'project'
                        ? 'bg-accent-2-100 text-accent-2-800'
                        : 'bg-neutral-200 text-neutral-800',
                    )}
                  >
                    {skill.scope}
                  </span>
                  <span className="flex-1" />
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Show this skill in Finder"
                    onClick={() =>
                      void invoke({ method: 'skills.reveal', params: { path: skill.filePath } })
                    }
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    Reveal
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!skill.enabled}
                    onClick={() => onRunSkill(skill)}
                  >
                    Use
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
