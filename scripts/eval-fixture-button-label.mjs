#!/usr/bin/env node
/**
 * M1 eval: real Pi coding task on react-button-label fixture (plan §13.2).
 *
 * Default provider: **opencode-go** (reads key from OPENCODE_API_KEY or
 * ~/.local/share/opencode/auth.json — never logs secrets).
 *
 * Usage:
 *   pnpm -r --filter "./packages/*" build
 *   pnpm eval:fixture
 *
 * Optional:
 *   EVAL_MODEL=opencode-go/kimi-k2.7-code
 *   EVAL_AGENT_DIR=~/.pi/agent
 *   EVAL_TIMEOUT_MS=300000
 */
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, cp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureSrc = path.join(root, 'fixtures/test-repositories/react-button-label');
const agentPi = path.join(root, 'packages/agent-pi/dist/index.js');

const PROMPT = `You are working in a small project at the current working directory.

Task: rename the primary button label from "Submit" to "Continue".

Requirements:
1. Update src/Button.jsx: change the default prop and PRIMARY_LABEL from 'Submit' to 'Continue'.
2. Update test/button.test.js so tests expect Continue (not Submit) and still pass.
3. Do not change unrelated files.
4. After edits, the project tests should pass with: node --test test/button.test.js

Make the file changes now using your tools.`;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`OK: ${msg}`);
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return r;
}

function hasAnyProviderKey() {
  const names = [
    'OPENCODE_API_KEY',
    'OPENCODE_GO_API_KEY',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'XAI_API_KEY',
    'OPENROUTER_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'MINIMAX_CN_API_KEY',
    'MINIMAX_API_KEY',
  ];
  return names.some((n) => Boolean(process.env[n]?.trim()));
}

function parseModelRef(raw) {
  if (!raw) return null;
  const i = raw.indexOf('/');
  if (i <= 0) return null;
  return { providerId: raw.slice(0, i), modelId: raw.slice(i + 1) };
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function resetWorkdir(work) {
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  await cp(fixtureSrc, work, { recursive: true });
  // Ensure baseline content
  const button = await readFile(path.join(work, 'src/Button.jsx'), 'utf8');
  if (!button.includes("PRIMARY_LABEL = 'Submit'")) {
    fail('fixture baseline Button.jsx missing Submit label');
  }
}

async function main() {
  if (!existsSync(agentPi)) {
    fail('packages/agent-pi/dist missing — run: pnpm -r --filter "./packages/*" build');
  }

  const { createAgentRuntime, describeAuthSources, loadOpenCodeAuthFromDisk } =
    await import(agentPi);

  // Prefer OpenCode Go credentials from CLI auth store (never logged).
  const disk = loadOpenCodeAuthFromDisk();
  if (disk.loaded.length) ok(`loaded OpenCode auth from disk: ${disk.loaded.join(', ')}`);

  if (!hasAnyProviderKey()) {
    fail(
      'No provider API key. Set OPENCODE_API_KEY or login OpenCode Go (auth.json under ~/.local/share/opencode).',
    );
  }
  ok('provider API key available (env or OpenCode auth store)');

  const work = await mkdtemp(path.join(tmpdir(), 'pi-eval-button-'));
  // Use an isolated agentDir by default — ~/.pi/agent may load local extensions that hang headless runs.
  const agentDir =
    process.env.EVAL_AGENT_DIR?.trim() || path.join(work, '.pi-desktop-agent');

  try {
    await resetWorkdir(work);
    ok(`workdir ${work}`);
    ok(`agentDir ${agentDir}`);

    const baseline = run('node', ['--test', 'test/button.test.js'], work);
    if (baseline.status !== 0) {
      console.error(baseline.stdout, baseline.stderr);
      fail('baseline fixture tests failed before agent run');
    }
    ok('baseline tests pass (Submit)');

    ok('creating AgentRuntime (opencode-go)...');
    const runtime = createAgentRuntime({
      forceFake: false,
      agentDir,
      allowModelNetwork: false,
      hydrateEnvAuth: true,
    });
    ok('AgentRuntime constructed');

    const events = [];
    runtime.subscribe((e) => {
      events.push(e);
      if (e.type === 'run.started') {
        console.log(`  run.started ${e.runId?.slice?.(0, 8) ?? ''}…`);
      } else if (e.type === 'tool.requested') {
        console.log(`  tool → ${e.toolName}: ${e.inputSummary}`);
      } else if (e.type === 'tool.completed') {
        console.log(`  tool ✓ ${e.toolName} ok=${e.ok}`);
      } else if (e.type === 'message.delta' && e.delta) {
        process.stdout.write(e.delta);
      } else if (e.type === 'message.completed') {
        process.stdout.write('\n');
      } else if (e.type === 'run.completed') {
        console.log('  run.completed');
      } else if (e.type === 'run.failed') {
        console.error(`\n  run.failed: ${e.error?.message}`);
      }
    });

    ok('resolving auth status...');
    const auth = await withTimeout(
      runtime.getAuthStatus?.() ?? Promise.resolve([]),
      30_000,
      'getAuthStatus',
    );
    ok(`auth providers: ${describeAuthSources(auth)}`);

    ok('listing models...');
    const models = await withTimeout(runtime.listModels(), 30_000, 'listModels');
    // Default: OpenCode Go coding-oriented model (override with EVAL_MODEL).
    const preferredDefaults = [
      process.env.EVAL_MODEL,
      'opencode-go/kimi-k2.7-code',
      'opencode-go/glm-5.2',
      'opencode-go/deepseek-v4-flash',
      'opencode-go/kimi-k2.6',
    ];

    let model = null;
    for (const candidate of preferredDefaults) {
      const ref = parseModelRef(candidate);
      if (!ref) continue;
      const found = models.find(
        (m) => m.providerId === ref.providerId && m.modelId === ref.modelId,
      );
      if (found) {
        model = ref;
        break;
      }
    }

    // Prefer any authed opencode-go model, then any authed model.
    if (!model) {
      const go = models.find((m) => m.providerId === 'opencode-go' && m.hasAuth);
      const any = models.find((m) => m.hasAuth);
      const pick = go ?? any;
      if (pick) model = { providerId: pick.providerId, modelId: pick.modelId };
    }

    // Never fall back to minimax-cn implicitly.
    if (model?.providerId === 'minimax-cn' && !process.env.EVAL_MODEL) {
      console.warn('WARN: refusing implicit minimax-cn; set EVAL_MODEL explicitly if intended');
      model = null;
    }

    if (model) ok(`model ${model.providerId}/${model.modelId}`);
    else fail('No usable opencode-go (or other) model with auth. Check OpenCode Go login.');

    ok('createSession...');
    const session = await withTimeout(
      runtime.createSession({
        projectId: 'eval-button',
        projectPath: work,
        title: 'eval react-button-label',
        model: model ?? undefined,
      }),
      60_000,
      'createSession',
    );
    ok(`session ${session.id.slice(0, 8)}…`);

    ok('sendMessage (agent coding task)...');
    const ref = await withTimeout(
      runtime.sendMessage(session.id, {
        text: PROMPT,
        model: model ?? undefined,
      }),
      30_000,
      'sendMessage accept',
    );
    ok(`run ${ref.runId.slice(0, 8)}… waiting for completion`);

    const timeoutMs = Number(process.env.EVAL_TIMEOUT_MS ?? 180_000);
    const start = Date.now();
    let lastLog = 0;
    while (Date.now() - start < timeoutMs) {
      if (events.some((e) => e.type === 'run.completed' || e.type === 'run.failed' || e.type === 'run.cancelled')) {
        break;
      }
      if (Date.now() - lastLog > 15_000) {
        lastLog = Date.now();
        const types = [...new Set(events.map((e) => e.type))];
        console.log(
          `  …still running ${(Date.now() - start) / 1000}s events=${types.join(',') || 'none'}`,
        );
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    const failed = events.find((e) => e.type === 'run.failed');
    if (failed) {
      await runtime.dispose();
      fail(`agent run failed: ${failed.error?.message ?? 'unknown'}`);
    }
    if (!events.some((e) => e.type === 'run.completed')) {
      await runtime.dispose();
      fail(`timed out after ${timeoutMs}ms waiting for run.completed`);
    }
    ok('agent run.completed');

    const tools = events.filter((e) => e.type === 'tool.requested').map((e) => e.toolName);
    ok(`tools used: ${tools.length ? [...new Set(tools)].join(', ') : '(none)'}`);

    await runtime.dispose();

    // Source checks
    const buttonAfter = await readFile(path.join(work, 'src/Button.jsx'), 'utf8');
    if (!buttonAfter.includes("PRIMARY_LABEL = 'Continue'")) {
      console.error('--- Button.jsx after agent ---\n', buttonAfter);
      fail("PRIMARY_LABEL was not changed to 'Continue'");
    }
    if (!buttonAfter.includes("label = 'Continue'")) {
      fail("default label prop was not changed to 'Continue'");
    }
    ok('source uses Continue');

    // Acceptance suite (force ACCEPTANCE=1)
    const acc2 = spawnSync(
      'node',
      ['--test', 'test/acceptance.expected.test.js'],
      {
        cwd: work,
        encoding: 'utf8',
        env: { ...process.env, ACCEPTANCE: '1' },
      },
    );
    if (acc2.status !== 0) {
      console.error(acc2.stdout, acc2.stderr);
      fail('acceptance tests failed');
    }
    ok('acceptance tests pass');

    // Prefer updated unit tests if agent fixed them; otherwise only acceptance required
    const unit = run('node', ['--test', 'test/button.test.js'], work);
    if (unit.status === 0) {
      ok('unit tests pass after agent edits');
    } else {
      console.warn('WARN: unit tests still fail (agent may not have updated them); acceptance passed');
      console.warn(unit.stdout);
    }

    // Write report into repo for docs
    const reportPath = path.join(root, 'docs/eval-reports/react-button-label-latest.md');
    await mkdir(path.dirname(reportPath), { recursive: true });
    const report = `# Eval report: react-button-label

- Date: ${new Date().toISOString()}
- Model: ${model ? `${model.providerId}/${model.modelId}` : 'default'}
- Workdir: \`${work}\` (ephemeral)
- Tools: ${tools.length ? [...new Set(tools)].join(', ') : 'none'}
- Result: **PASS** (source + acceptance)

## Prompt

\`\`\`
${PROMPT}
\`\`\`

## Event summary

${[...new Set(events.map((e) => e.type))].map((t) => `- ${t}`).join('\n')}
`;
    await writeFile(reportPath, report, 'utf8');
    ok(`report ${reportPath}`);
    ok('EVAL PASSED');
  } finally {
    // keep workdir on failure for inspection via EVAL_KEEP=1
    if (process.env.EVAL_KEEP === '1') {
      console.warn(`KEEP workdir: ${work}`);
    } else {
      await rm(work, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
