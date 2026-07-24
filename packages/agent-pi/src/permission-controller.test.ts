import path from 'node:path';

import { PermissionPipeline } from '@pi-desktop/security';
import { describe, expect, it, vi } from 'vitest';

import { PermissionController } from './permission-controller.js';

const scope = {
  context: {
    projectId: 'project-1',
    sessionId: 'session-1',
    runId: 'run-1',
    workspaceRoot: path.resolve('/tmp/pi-desktop-permission-test'),
    projectTrusted: true,
  },
  nextEventScope: () => ({
    projectId: 'project-1',
    sessionId: 'session-1',
    runId: 'run-1',
    sequence: 1,
    timestamp: 1,
  }),
};

describe('PermissionController', () => {
  it('blocks execution until a destructive tool is approved', async () => {
    const pipeline = new PermissionPipeline();
    const events: unknown[] = [];
    const controller = new PermissionController({
      pipeline,
      getScope: () => scope,
      emit: (event) => events.push(event),
    });

    const authorization = controller.authorize({
      toolCallId: 'tool-1',
      toolName: 'bash',
      input: { command: 'rm -rf ./build' },
    });

    await vi.waitFor(() => expect(events).toHaveLength(1));
    const request = events[0] as { type: string; requestId: string };
    expect(request.type).toBe('approval.requested');
    expect(controller.resolve(request.requestId, 'allow-once')).toBe(true);
    await expect(authorization).resolves.toEqual({});
    expect(events).toHaveLength(2);
  });
});
