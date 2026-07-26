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

/**
 * Discovers skills the way Pi does — `SKILL.md` marks a skill directory,
 * otherwise direct `.md` children are skills — over the global agent dir and
 * the open project's `.pi/skills`.
 *
 * Enabled/disabled is Desktop state (Pi has no notion of it), stored in the
 * Main-private config dir. Nothing here is exposed to the Renderer beyond the
 * SkillInfo projection.
 */
export class SkillsService {
  private readonly statePath: string;
  private state: DisabledState | null = null;

  constructor(userDataPath = app.getPath('userData')) {
    this.statePath = path.join(userDataPath, 'skills-state.json');
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

    const globalDir = path.join(os.homedir(), '.pi', 'skills');
    const found: SkillInfo[] = [];
    found.push(...(await this.scan(globalDir, 'global')));
    if (options.projectPath) {
      found.push(...(await this.scan(path.join(options.projectPath, '.pi', 'skills'), 'project')));
    }

    // A project skill of the same command shadows the global one.
    const byCommand = new Map<string, SkillInfo>();
    for (const skill of found) {
      const existing = byCommand.get(skill.command);
      if (!existing || skill.scope === 'project') byCommand.set(skill.command, skill);
    }

    return [...byCommand.values()]
      .map((skill) => ({ ...skill, enabled: !disabledForProject.has(skill.id) }))
      .sort((a, b) => a.command.localeCompare(b.command));
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

  /** Commands the composer may expand — used to validate `$name` before sending. */
  async enabledCommands(options: {
    projectPath?: string;
    projectId?: string;
  }): Promise<SkillInfo[]> {
    return (await this.list(options)).filter((skill) => skill.enabled);
  }

  private async scan(dir: string, scope: 'global' | 'project'): Promise<SkillInfo[]> {
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
          skills.push(...(await this.scan(full, scope)));
        }
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
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
    const command = `$${name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()}`;
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
