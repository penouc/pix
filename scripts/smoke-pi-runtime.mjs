#!/usr/bin/env node
/**
 * Headless AgentRuntime smoke (plan M1 / §7.2).
 *
 * Default: FakeAgentRuntime (no cost, CI-safe).
 * Real Pi: PI_DESKTOP_FAKE_RUNTIME=0 node scripts/smoke-pi-runtime.mjs
 * Optional real prompt: SMOKE_PROMPT=1 (requires API key env).
 */
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Load built package (must run after pnpm -r build packages)
const agentPiPath = path.join(root, 'packages/agent-pi/dist/index.js');

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`OK: ${msg}`);
}

const useFake =
  process.env.PI_DESKTOP_FAKE_RUNTIME !== '0' &&
  process.env.PI_DESKTOP_FAKE_RUNTIME !== 'false';
const wantPrompt = process.env.SMOKE_PROMPT === '1';

const { createAgentRuntime, PI_SDK_PACKAGES } = await import(agentPiPath);

ok(`Pi lock ${PI_SDK_PACKAGES.codingAgent}@${PI_SDK_PACKAGES.version}`);
ok(`mode=${useFake ? 'fake' : 'pi'}`);

const dir = await mkdtemp(path.join(tmpdir(), 'pi-desktop-smoke-'));
const agentDir = path.join(dir, 'agent');
try {
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await writeFile(path.join(dir, 'README.md'), '# smoke\n', 'utf8');

  const runtime = createAgentRuntime({
    forceFake: useFake,
    agentDir,
    allowModelNetwork: false,
  });

  const events = [];
  runtime.subscribe((e) => events.push(e));

  const session = await runtime.createSession({
    projectId: 'smoke',
    projectPath: dir,
    title: 'Smoke session',
  });
  ok(`createSession ${session.id.slice(0, 8)}…`);

  const models = await runtime.listModels();
  ok(`listModels count=${models.length}`);

  if (typeof runtime.getAuthStatus === 'function') {
    const auth = await runtime.getAuthStatus();
    const ready = auth.filter((a) => a.hasAuth).map((a) => a.providerId);
    ok(`auth=${ready.length ? ready.join(',') : 'none'}`);
  }

  if (wantPrompt) {
    if (useFake) {
      const ref = await runtime.sendMessage(session.id, { text: 'hello smoke' });
      ok(`sendMessage runId=${ref.runId.slice(0, 8)}…`);
      // wait for completion
      const start = Date.now();
      while (Date.now() - start < 5000) {
        if (events.some((e) => e.type === 'run.completed' || e.type === 'run.failed')) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const types = events.map((e) => e.type);
      if (!types.includes('run.started') && !types.includes('message.delta')) {
        fail(`expected stream events, got ${types.join(',')}`);
      }
      ok(`events: ${[...new Set(types)].join(', ')}`);
    } else {
      const ref = await runtime.sendMessage(session.id, {
        text: 'Reply with exactly: pong',
      });
      ok(`pi sendMessage runId=${ref.runId.slice(0, 8)}…`);
      const start = Date.now();
      while (Date.now() - start < 60_000) {
        if (events.some((e) => e.type === 'run.completed' || e.type === 'run.failed')) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const failed = events.find((e) => e.type === 'run.failed');
      if (failed) {
        console.warn(`WARN: run.failed ${failed.error?.message ?? ''}`);
      } else if (!events.some((e) => e.type === 'run.completed')) {
        fail('timed out waiting for run.completed');
      } else {
        ok('pi run.completed');
      }
    }
  }

  await runtime.dispose();
  ok('dispose');
  ok('smoke-pi-runtime passed');
} finally {
  await rm(dir, { recursive: true, force: true });
}
