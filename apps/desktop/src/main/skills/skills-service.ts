import { app } from 'electron';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { SkillInfo } from '@pi-desktop/protocol';

interface DisabledState {
  /** Skill ids the user switched off, keyed globally and per project. */
  global: string[];
  byProject: Record<string, string[]>;
}

const EMPTY: DisabledState = { global: [], byProject: {} };

const SKILL_EXAMPLES = {
  'code-review': `---
name: code-review
description: Reviews the current code changes for correctness, security, regressions, and missing tests. Use before keeping or committing a change.
---

# Code Review

Review the current working-tree changes. Focus on correctness, security, regressions, and missing tests.

1. Inspect the diff and the surrounding implementation.
2. Run focused checks when useful, but do not modify files unless the user asks.
3. Report findings in severity order with file and line references.
4. If there are no findings, say so and mention any remaining test gaps.
`,
  'test-failure-triage': `---
name: test-failure-triage
description: Diagnoses a failing test with a reproduce-first workflow and proposes the smallest safe fix. Use when tests are failing or flaky.
---

# Test Failure Triage

Diagnose the reported test failure before changing code.

1. Reproduce the narrowest failing test.
2. Separate product defects, test defects, environment issues, and flakes.
3. Explain the root cause with evidence.
4. Propose the smallest safe fix and the verification command.
5. Only edit files after the user confirms, unless they explicitly asked for a fix.
`,
} as const;

export type SkillExampleId = keyof typeof SKILL_EXAMPLES;

/**
 * Mirrors Pi's global and trusted-project discovery. `SKILL.md` marks a skill
 * directory; direct `.md` children are accepted only in the Pi-specific
 * `agentDir/skills` and `.pi/skills` roots.
 *
 * Picker visibility is Desktop state (Pi itself still discovers the files),
 * stored in the Main-private config dir. Nothing here is exposed to the
 * Renderer beyond the SkillInfo projection.
 */
export class SkillsService {
  private readonly statePath: string;
  private readonly agentDir: string;
  private state: DisabledState | null = null;

  constructor(
    userDataPath = app.getPath('userData'),
    private readonly homeDir = os.homedir(),
  ) {
    this.statePath = path.join(userDataPath, 'skills-state.json');
    // Keep discovery aligned with PiAgentRuntime's custom agentDir in Main.
    this.agentDir = path.join(userDataPath, 'pi-agent');
  }

  private async loadState(): Promise<DisabledState> {
    if (this.state) return this.state;
    try {
      const raw = await fs.readFile(this.statePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<DisabledState>;
      this.state = {
        global: Array.isArray(parsed.global) ? parsed.global : [],
        byProject: parsed.byProject && typeof parsed.byProject === 'object' ? parsed.byProject : {},
      };
    } catch {
      this.state = { ...EMPTY, byProject: {} };
    }
    return this.state;
  }

  private async saveState(): Promise<void> {
    if (!this.state) return;
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    await fs.writeFile(this.statePath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  async list(options: { projectPath?: string; projectId?: string }): Promise<SkillInfo[]> {
    const state = await this.loadState();
    const disabledForProject = new Set([
      ...state.global,
      ...(options.projectId ? (state.byProject[options.projectId] ?? []) : []),
    ]);

    const found: SkillInfo[] = [];
    // These are the locations loaded by DefaultResourceLoader. The old
    // ~/.pi/skills path was never loaded by the runtime, so advertising it in
    // the UI produced commands that could not execute.
    found.push(...(await this.scan(path.join(this.agentDir, 'skills'), 'global', true)));
    found.push(...(await this.scan(path.join(this.homeDir, '.agents', 'skills'), 'global', false)));
    if (options.projectPath) {
      found.push(
        ...(await this.scan(path.join(options.projectPath, '.pi', 'skills'), 'project', true)),
      );
      for (const dir of await this.agentSkillDirs(options.projectPath)) {
        found.push(...(await this.scan(dir, 'project', false)));
      }
    }

    // A project skill of the same command shadows the global one.
    const byCommand = new Map<string, SkillInfo>();
    for (const skill of found) {
      const existing = byCommand.get(skill.command);
      if (!existing || (existing.scope === 'global' && skill.scope === 'project')) {
        byCommand.set(skill.command, skill);
      }
    }

    return [...byCommand.values()]
      .map((skill) => ({ ...skill, enabled: !disabledForProject.has(skill.id) }))
      .sort((a, b) => a.command.localeCompare(b.command));
  }

  /** Install one of PiX's fixed starter skills into the runtime's global agent dir. */
  async installExample(id: SkillExampleId): Promise<void> {
    const content = SKILL_EXAMPLES[id];
    const dir = path.join(this.agentDir, 'skills', id);
    const filePath = path.join(dir, 'SKILL.md');
    await fs.mkdir(dir, { recursive: true });
    try {
      // Never replace a skill the user has already customized.
      await fs.writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }

  async setEnabled(input: {
    skillId: string;
    enabled: boolean;
    projectId?: string;
  }): Promise<void> {
    const state = await this.loadState();
    const bucket = input.projectId ? (state.byProject[input.projectId] ??= []) : state.global;
    const index = bucket.indexOf(input.skillId);
    if (input.enabled && index !== -1) bucket.splice(index, 1);
    if (!input.enabled && index === -1) bucket.push(input.skillId);
    await this.saveState();
  }

  /** Skills visible in the composer's `$` picker. */
  async enabledCommands(options: {
    projectPath?: string;
    projectId?: string;
  }): Promise<SkillInfo[]> {
    return (await this.list(options)).filter((skill) => skill.enabled);
  }

  /**
   * `.agents/skills` is inherited from cwd through the Git root, matching Pi.
   * Opening a nested workspace therefore still sees repository-level skills.
   */
  private async agentSkillDirs(projectPath: string): Promise<string[]> {
    const dirs: string[] = [];
    let current = path.resolve(projectPath);
    while (true) {
      dirs.push(path.join(current, '.agents', 'skills'));
      if (await exists(path.join(current, '.git'))) break;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return dirs;
  }

  private async scan(
    dir: string,
    scope: 'global' | 'project',
    includeRootMarkdown: boolean,
  ): Promise<SkillInfo[]> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const skills: SkillInfo[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const skillFile = path.join(full, 'SKILL.md');
        try {
          await fs.access(skillFile);
          const parsed = await this.read(skillFile, entry.name, scope);
          if (parsed) skills.push(parsed);
          continue;
        } catch {
          // Not a skill root — Pi recurses one more level looking for SKILL.md.
          skills.push(...(await this.scan(full, scope, false)));
        }
        continue;
      }
      if (!includeRootMarkdown || !entry.isFile() || !entry.name.endsWith('.md')) continue;
      const parsed = await this.read(full, entry.name.replace(/\.md$/, ''), scope);
      if (parsed) skills.push(parsed);
    }
    return skills;
  }

  private async read(
    filePath: string,
    fallbackName: string,
    scope: 'global' | 'project',
  ): Promise<SkillInfo | null> {
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch {
      return null;
    }
    const { name, description } = parseFrontmatter(content, fallbackName);
    const command = `/skill:${name.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}`;
    return {
      id: createHash('sha256').update(filePath).digest('hex').slice(0, 16),
      name,
      command,
      description,
      scope,
      filePath,
      enabled: true,
    };
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Minimal YAML-ish frontmatter read — only `name` and `description` matter here. */
export function parseFrontmatter(
  content: string,
  fallbackName: string,
): { name: string; description: string } {
  let name = fallbackName;
  let description = '';

  if (content.startsWith('---')) {
    const end = content.indexOf('\n---', 3);
    if (end !== -1) {
      for (const line of content.slice(3, end).split('\n')) {
        const match = /^\s*(name|description)\s*:\s*(.*)$/.exec(line);
        if (!match) continue;
        const value = match[2]!.trim().replace(/^['"]|['"]$/g, '');
        if (match[1] === 'name' && value) name = value;
        if (match[1] === 'description' && value) description = value;
      }
    }
  }

  if (!description) {
    // Fall back to the first non-heading prose line.
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('---')) continue;
      description = trimmed;
      break;
    }
  }

  return { name, description: description.slice(0, 400) };
}
