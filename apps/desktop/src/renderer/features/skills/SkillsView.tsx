import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { SkillInfo } from '@pi-desktop/protocol';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { invoke } from '@/lib/ipc';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/stores/workspace-store';

/**
 * Skills are prompt files on disk — `~/.pi/skills` plus the project's
 * `.pi/skills`, discovered the way Pi discovers them. Enabling is Desktop
 * state; the files themselves are the source of truth and travel with the repo.
 */
export function SkillsView({ onRunSkill }: { onRunSkill: (skill: SkillInfo) => void }) {
  const project = useWorkspaceStore((s) => s.project);
  const queryClient = useQueryClient();

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

  const list = skills.data ?? [];

  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[860px] px-8 pt-8 pb-9">
        <div className="mb-1.5 flex items-end gap-3.5">
          <div className="flex-1">
            <div className="text-[11px] font-bold tracking-[0.14em] text-foreground/45 uppercase">
              Skills
            </div>
            <h2 className="mt-2 mb-1.5">Prompts you can call with $</h2>
          </div>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => void skills.refetch()}
            disabled={skills.isFetching}
          >
            Rescan
          </Button>
        </div>
        <p className="mb-5 max-w-[540px] text-[13.5px] leading-relaxed text-muted">
          Type <span className="font-mono text-accent-800">$</span> in the composer to run one.
          Project skills are read from the repo, so they travel with the codebase and stay in
          review.
        </p>

        {!list.length ? (
          <div className="rounded-[22px] border border-dashed border-foreground/20 px-5 py-8 text-center">
            <div className="mb-1 text-[13px] font-bold">No skills found</div>
            <div className="mx-auto max-w-[420px] text-[12.5px] leading-relaxed text-muted">
              Add a markdown file to <span className="font-mono">~/.pi/skills</span>, or a{' '}
              <span className="font-mono">.pi/skills</span> folder in this project. A directory with
              a <span className="font-mono">SKILL.md</span> counts as one skill.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {list.map((skill) => (
              <div
                key={skill.id}
                className="flex flex-col gap-2.5 rounded-[22px] border border-border bg-background p-4 shadow-[var(--shadow-sm)]"
              >
                <div className="flex items-center gap-2.5">
                  <span className="rounded-full bg-accent-100 px-2.5 py-[3px] font-mono text-[13px] text-accent-800">
                    {skill.command}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold">
                    {skill.name}
                  </span>
                  <Switch
                    label={`Enable ${skill.name}`}
                    checked={skill.enabled}
                    disabled={setEnabled.isPending}
                    onChange={(next) => setEnabled.mutate({ skillId: skill.id, enabled: next })}
                  />
                </div>
                <div className="flex-1 text-[12.5px] leading-relaxed text-muted">
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
                    {skill.scope === 'project' ? 'project' : 'global'}
                  </span>
                  <span className="flex-1" />
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!skill.enabled}
                    onClick={() => onRunSkill(skill)}
                  >
                    Use
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void invoke({ method: 'skills.reveal', params: { path: skill.filePath } })
                    }
                  >
                    Reveal
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
