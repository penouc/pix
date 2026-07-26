/**
 * Electron E2E happy-path test (plan §13.1 / M8-3).
 *
 * Prerequisites: `pnpm build` must be run before this test.
 * Uses PI_DESKTOP_FAKE_RUNTIME=1 to avoid real provider calls.
 *
 * Covers: app launch → project open → trust → session create → message → abort.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureProject = path.join(
  root,
  'fixtures/test-repositories/react-button-label',
);
const mainEntry = path.join(root, 'apps/desktop/dist-electron/main/index.js');

let app: Awaited<ReturnType<typeof electron.launch>>;

test.beforeAll(async () => {
  app = await electron.launch({
    args: [mainEntry],
    env: {
      ...process.env,
      PI_DESKTOP_FAKE_RUNTIME: '1',
      NODE_ENV: 'test',
      // Prevent opening DevTools in test mode
      VITE_DEV_SERVER_URL: '',
    },
    timeout: 15_000,
  });
});

test.afterAll(async () => {
  await app?.close();
});

test('app launches and shows main window', async () => {
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  const title = await window.title();
  expect(title).toContain('Pi');
});

test('IPC app.getInfo returns runtime info', async () => {
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  const result = await window.evaluate(() => {
    if (typeof window.piDesktop === 'undefined') return null;
    return window.piDesktop.invoke({ method: 'app.getInfo' });
  });

  expect(result).not.toBeNull();
  expect(result?.ok).toBe(true);
  const info = result?.data as {
    name: string;
    version: string;
    platform: string;
    electron: string;
    piSdk: string;
    runtimeMode: string;
  };
  expect(info.name).toBe('Pi Agent Desktop');
  expect(info.version).toMatch(/\S/);
  expect(info.platform).toBe(process.platform);
  expect(info.electron).toMatch(/\S/);
  expect(info.piSdk).toMatch(/@/);
  expect(info.runtimeMode).toBe('fake');
});

test('open project via IPC and verify response', async () => {
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  // Use the IPC bridge to open the fixture project
  const result = await window.evaluate(
    async ([projectPath]) => {
      return window.piDesktop.invoke({ method: 'project.open', params: { path: projectPath } });
    },
    [fixtureProject] as [string],
  );

  expect(result.ok).toBe(true);
  const project = result.data as { id: string; path: string; name: string; trusted: boolean };
  expect(project.path).toBe(fixtureProject);
  expect(project.name).toBe('react-button-label');
});

test('create session with fake runtime and send a message', async () => {
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  // Open and trust the project
  const openResult = await window.evaluate(
    async ([p]) => window.piDesktop.invoke({ method: 'project.open', params: { path: p } }),
    [fixtureProject] as [string],
  );
  expect(openResult.ok).toBe(true);
  const project = openResult.data as { id: string };

  const trustResult = await window.evaluate(
    async ([projectId]) =>
      window.piDesktop.invoke({
        method: 'project.setTrust',
        params: { projectId, trusted: true },
      }),
    [project.id] as [string],
  );
  expect(trustResult.ok).toBe(true);

  // Create a session
  const sessionResult = await window.evaluate(
    async ([projectId]) =>
      window.piDesktop.invoke({
        method: 'session.create',
        params: { projectId, title: 'E2E Test Session' },
      }),
    [project.id] as [string],
  );
  expect(sessionResult.ok).toBe(true);
  const session = sessionResult.data as { id: string };
  expect(typeof session.id).toBe('string');

  // Send a message (fake runtime will stream events)
  const sendResult = await window.evaluate(
    async ([sessionId]) =>
      window.piDesktop.invoke({
        method: 'agent.sendMessage',
        params: { sessionId, text: 'Hello fake agent' },
      }),
    [session.id] as [string],
  );
  expect(sendResult.ok).toBe(true);
  const runRef = sendResult.data as { runId: string; sessionId: string };
  expect(typeof runRef.runId).toBe('string');

  // Wait briefly then abort
  await window.waitForTimeout(500);
  const abortResult = await window.evaluate(
    async ([runId]) =>
      window.piDesktop.invoke({ method: 'agent.abort', params: { runId } }),
    [runRef.runId] as [string],
  );
  expect(abortResult.ok).toBe(true);
});
