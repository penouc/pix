import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PermissionPipeline } from '@pi-desktop/security';
import { afterEach, describe, expect, it } from 'vitest';

interface AttackCase {
  id: string;
  toolName: string;
  args: unknown;
  riskLevel: 'safe' | 'workspace-write' | 'sensitive' | 'destructive' | 'external-side-effect';
  action: 'allow' | 'require-approval';
}

const fixtureRoot = path.resolve(
  import.meta.dirname,
  '../../../fixtures/test-repositories/security-escape',
);
const tempDirs: string[] = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createFixtureWorkspace(): string {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'pi-desktop-security-'));
  tempDirs.push(tempDir);
  const workspace = path.join(tempDir, 'workspace');
  cpSync(path.join(fixtureRoot, 'workspace'), workspace, { recursive: true });

  const outside = path.join(tempDir, 'outside');
  mkdirSync(outside);
  writeFileSync(path.join(outside, 'secret.txt'), 'fixture-outside-secret');
  symlinkSync(outside, path.join(workspace, 'linked-outside'));
  return workspace;
}

function context(workspaceRoot: string, projectTrusted = true) {
  return {
    projectId: 'security-fixture',
    sessionId: 'security-session',
    runId: 'security-run',
    workspaceRoot,
    projectTrusted,
  };
}

describe('security-escape fixture', () => {
  it('requires approval for every declared attack and allows the safe control', () => {
    const attacks = JSON.parse(
      readFileSync(path.join(fixtureRoot, 'attack-cases.json'), 'utf8'),
    ) as AttackCase[];
    const workspace = createFixtureWorkspace();
    const pipeline = new PermissionPipeline();

    for (const attack of attacks) {
      const result = pipeline.evaluate({
        toolCallId: attack.id,
        toolName: attack.toolName,
        args: attack.args,
        ctx: context(workspace),
      });
      expect(result.assessment.level, attack.id).toBe(attack.riskLevel);
      expect(result.action, attack.id).toBe(attack.action);
    }
  });

  it('denies an untrusted project before a tool is executed', () => {
    const pipeline = new PermissionPipeline();
    const result = pipeline.evaluate({
      toolCallId: 'untrusted-read',
      toolName: 'read',
      args: { path: 'safe.txt' },
      ctx: context(createFixtureWorkspace(), false),
    });

    expect(result.action).toBe('deny');
  });

  it('does not remember approvals for external side effects or destructive project access', () => {
    const workspace = createFixtureWorkspace();
    const pipeline = new PermissionPipeline();
    const ctx = context(workspace);

    const external = pipeline.evaluate({
      toolCallId: 'push',
      toolName: 'bash',
      args: { command: 'git push origin main' },
      ctx,
    });
    if (external.action !== 'require-approval') throw new Error('expected approval');
    pipeline.policy.remember(ctx, 'allow-project', external.tool, external.assessment.level);
    expect(
      pipeline.evaluate({
        toolCallId: 'push-again',
        toolName: 'bash',
        args: { command: 'git push origin main' },
        ctx,
      }).action,
    ).toBe('require-approval');

    const destructive = pipeline.evaluate({
      toolCallId: 'clean',
      toolName: 'bash',
      args: { command: 'git clean -fd' },
      ctx,
    });
    if (destructive.action !== 'require-approval') throw new Error('expected approval');
    pipeline.policy.remember(ctx, 'allow-project', destructive.tool, destructive.assessment.level);
    expect(
      pipeline.evaluate({
        toolCallId: 'clean-again',
        toolName: 'bash',
        args: { command: 'git clean -fd' },
        ctx,
      }).action,
    ).toBe('require-approval');
  });
});
