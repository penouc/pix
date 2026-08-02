import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SkillsService, parseFrontmatter } from './skills-service.js';

const roots: string[] = [];

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pix-skills-'));
  roots.push(root);
  const userData = path.join(root, 'data');
  const home = path.join(root, 'home');
  const project = path.join(root, 'repo', 'packages', 'app');
  await fs.mkdir(path.join(root, 'repo', '.git'), { recursive: true });
  await fs.mkdir(project, { recursive: true });
  return { root, userData, home, project, service: new SkillsService(userData, home) };
}

async function skill(filePath: string, name: string, description = `${name} description`) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `---\nname: ${name}\ndescription: ${description}\n---\n`, 'utf8');
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('SkillsService discovery', () => {
  it('matches Pi global and inherited project locations', async () => {
    const { root, userData, home, project, service } = await fixture();
    await skill(path.join(userData, 'pi-agent', 'skills', 'global.md'), 'global-tool');
    await skill(path.join(home, '.agents', 'skills', 'shared', 'SKILL.md'), 'shared-tool');
    await skill(path.join(project, '.pi', 'skills', 'local.md'), 'local-tool');
    await skill(path.join(root, 'repo', '.agents', 'skills', 'repo-tool', 'SKILL.md'), 'repo-tool');
    // Root markdown is intentionally ignored under .agents/skills.
    await skill(path.join(home, '.agents', 'skills', 'ignored.md'), 'ignored');

    const found = await service.list({ projectPath: project, projectId: 'project-1' });

    expect(found.map((entry) => entry.command)).toEqual([
      '/skill:global-tool',
      '/skill:local-tool',
      '/skill:repo-tool',
      '/skill:shared-tool',
    ]);
    expect(found.find((entry) => entry.name === 'repo-tool')?.scope).toBe('project');
  });

  it('installs a real starter skill without replacing later customizations', async () => {
    const { userData, service } = await fixture();
    await service.installExample('code-review');
    const [installed] = await service.list({});
    expect(installed).toMatchObject({
      name: 'code-review',
      command: '/skill:code-review',
      scope: 'global',
    });

    await fs.writeFile(installed!.filePath, 'customized', 'utf8');
    await service.installExample('code-review');
    expect(
      await fs.readFile(
        path.join(userData, 'pi-agent', 'skills', 'code-review', 'SKILL.md'),
        'utf8',
      ),
    ).toBe('customized');
  });

  it('persists picker visibility per project', async () => {
    const { userData, project, service } = await fixture();
    await skill(path.join(project, '.pi', 'skills', 'review.md'), 'review');
    const [entry] = await service.list({ projectPath: project, projectId: 'one' });
    expect(entry?.enabled).toBe(true);

    await service.setEnabled({ skillId: entry!.id, enabled: false, projectId: 'one' });

    expect((await service.list({ projectPath: project, projectId: 'one' }))[0]?.enabled).toBe(
      false,
    );
    expect((await service.list({ projectPath: project, projectId: 'two' }))[0]?.enabled).toBe(true);
    expect(
      JSON.parse(await fs.readFile(path.join(userData, 'skills-state.json'), 'utf8')),
    ).toMatchObject({
      byProject: { one: [entry!.id] },
    });
  });
});

describe('parseFrontmatter', () => {
  it('uses prose as a description fallback', () => {
    expect(parseFrontmatter('# Title\n\nUseful instructions.', 'fallback')).toEqual({
      name: 'fallback',
      description: 'Useful instructions.',
    });
  });
});
