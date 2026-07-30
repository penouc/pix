import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PermissionPipeline } from './permission-pipeline.js';

const workspace = path.resolve('/tmp/pi-ws');
const ctx = {
  projectId: 'p1',
  sessionId: 's1',
  runId: 'r1',
  workspaceRoot: workspace,
  projectTrusted: true,
};

describe('PermissionPipeline', () => {
  it('audits and resolves approval decisions', async () => {
    const pipeline = new PermissionPipeline({ defaultMode: 'ask' });
    const result = pipeline.evaluate({
      toolCallId: 'tc1',
      toolName: 'bash',
      args: { command: 'rm -rf ./build' },
      ctx,
    });
    expect(result.action).toBe('require-approval');
    expect(pipeline.audit.list()).toHaveLength(1);

    if (result.action !== 'require-approval') throw new Error('expected approval');

    const { requestId, decision } = pipeline.requestApproval(
      ctx,
      result.tool,
      result.request,
      result.assessment,
    );

    const resolved = pipeline.resolve(requestId, 'deny');
    expect(resolved).toBe(true);
    await expect(decision).resolves.toBe('deny');
    expect(pipeline.audit.list().some((e) => e.outcome === 'denied')).toBe(true);
  });
});
