/**
 * Deterministic M0 fixture integrity check. It verifies local fixture metadata
 * and executes each fixture's passing baseline suite; it does not invoke an LLM.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturesRoot = path.join(root, 'fixtures', 'test-repositories');
const requiredFixtures = [
  'react-button-label',
  'ts-type-error',
  'query-loading-error',
  'form-validation',
  'failing-test',
  'small-refactor',
];

const fixtureDirectories = new Set(
  readdirSync(fixturesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name),
);
const failures = [];

for (const fixtureName of requiredFixtures) {
  const fixturePath = path.join(fixturesRoot, fixtureName);
  if (!fixtureDirectories.has(fixtureName)) {
    failures.push(`${fixtureName}: directory is missing`);
    continue;
  }

  const requiredFiles = ['package.json', 'task.json', 'setup-git.sh'];
  for (const relativePath of requiredFiles) {
    if (!existsSync(path.join(fixturePath, relativePath))) {
      failures.push(`${fixtureName}: missing ${relativePath}`);
    }
  }
  if (failures.some((failure) => failure.startsWith(`${fixtureName}:`))) continue;

  let task;
  let manifest;
  try {
    task = JSON.parse(readFileSync(path.join(fixturePath, 'task.json'), 'utf8'));
    manifest = JSON.parse(readFileSync(path.join(fixturePath, 'package.json'), 'utf8'));
  } catch (error) {
    failures.push(`${fixtureName}: invalid JSON (${error.message})`);
    continue;
  }

  for (const field of ['id', 'prompt', 'baselineCommand', 'acceptanceCommand', 'resetCommand']) {
    if (typeof task[field] !== 'string' || task[field].trim() === '') {
      failures.push(`${fixtureName}: task.json requires non-empty ${field}`);
    }
  }
  if (task.id !== fixtureName) failures.push(`${fixtureName}: task id must match directory`);
  if (
    typeof manifest.scripts?.test !== 'string' ||
    !manifest.scripts.test.includes('node --test')
  ) {
    failures.push(`${fixtureName}: baseline test script must use node:test`);
  }
  if (
    typeof manifest.scripts?.['test:acceptance'] !== 'string' ||
    !manifest.scripts['test:acceptance'].includes('node --test')
  ) {
    failures.push(`${fixtureName}: acceptance test script must use node:test`);
  }
  if (
    !readdirSync(path.join(fixturePath, 'test')).some((file) =>
      /^acceptance.*\.test\.js$/.test(file),
    )
  ) {
    failures.push(`${fixtureName}: acceptance test file is missing`);
  }
  if (failures.some((failure) => failure.startsWith(`${fixtureName}:`))) continue;

  const result = spawnSync('npm', ['test'], {
    cwd: fixturePath,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    failures.push(`${fixtureName}: baseline failed\n${result.stdout}${result.stderr}`);
  } else {
    console.log(`PASS ${fixtureName}: baseline`);
  }
}

if (failures.length > 0) {
  console.error(`Fixture integrity failed:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`Verified ${requiredFixtures.length} deterministic fixtures.`);
}
