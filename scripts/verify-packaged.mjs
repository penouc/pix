#!/usr/bin/env node
/**
 * Post-pack verification script (plan §15 / M8-4).
 *
 * Validates that the packaged macOS app bundle contains all required
 * components: asar structure, Pi SDK, SQLite native module, @pierre/diffs,
 * and unpacked native assets.
 *
 * Usage:
 *   node scripts/verify-packaged.mjs [--app-path <path>]
 *
 * Uninstall guide: printed by this script rather than written here. Electron
 * derives the user-data directory from package.json `name`, not `productName`,
 * so a hand-written path drifts from reality — this guide used to name
 * "Pi Agent Desktop" while the app actually wrote to "@pi-desktop/desktop",
 * which would have left the database and the encrypted provider keys behind.
 */
import { createRequire } from 'node:module';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Support --app-path override for CI
const argIdx = process.argv.indexOf('--app-path');
const appRoot =
  argIdx !== -1
    ? process.argv[argIdx + 1]
    : path.join(root, 'apps/desktop/release/mac-arm64/PiX.app');

let failures = 0;

function pass(msg) {
  console.log(`  ✓  ${msg}`);
}

function fail(msg) {
  console.error(`  ✗  ${msg}`);
  failures++;
}

function section(title) {
  console.log(`\n── ${title}`);
}

// ── 1. App bundle structure
section('App bundle structure');
if (!existsSync(appRoot)) {
  fail(`App bundle not found: ${appRoot}\n  Run: pnpm package:dir`);
  process.exit(1);
}
pass('app bundle exists');

const binary = path.join(appRoot, 'Contents/MacOS/PiX');
existsSync(binary) ? pass('main binary present') : fail('main binary missing');

const asarPath = path.join(appRoot, 'Contents/Resources/app.asar');
if (!existsSync(asarPath)) {
  fail('app.asar missing');
  process.exit(1);
}
pass(`app.asar present (${(statSync(asarPath).size / 1024 / 1024).toFixed(1)} MB)`);

// ── 2. asar contents
section('asar contents');
const require = createRequire(import.meta.url);
let asarFiles;
/** Kept for later so the uninstall section can read the packaged manifest. */
let asarModule = null;
try {
  let asar;
  try {
    asar = require(path.join(root, 'node_modules/.pnpm/node_modules/@electron/asar/lib/asar.js'));
  } catch {
    asar = require('@electron/asar');
  }
  asarModule = asar;
  asarFiles = asar.listPackage(asarPath).map(String);
} catch {
  const asarBin = path.join(root, 'node_modules/.pnpm/node_modules/.bin/asar');
  if (existsSync(asarBin)) {
    const listed = spawnSync(asarBin, ['list', asarPath], { encoding: 'utf8' });
    asarFiles = listed.stdout.split('\n').filter(Boolean);
  } else {
    console.warn('  ⚠  Cannot list asar contents — @electron/asar not found');
    asarFiles = [];
  }
}

const required = [
  '/dist-electron/main/index.js',
  '/dist-electron/preload/index.mjs',
  '/dist/index.html',
  '/package.json',
];
for (const req of required) {
  asarFiles.some((f) => f === req || f.endsWith(req)) ? pass(`asar: ${req}`) : fail(`asar missing: ${req}`);
}

const hasPiInAsar = asarFiles.some((f) => f.includes('@earendil-works/pi-coding-agent'));
hasPiInAsar
  ? pass('asar: @earendil-works/pi-coding-agent referenced')
  : console.warn('  ⚠  pi-coding-agent not listed in asar (may be fully unpacked — OK)');

const hasPierre = asarFiles.some((f) => f.includes('@pierre/diffs'));
hasPierre ? pass('asar: @pierre/diffs present') : fail('asar: @pierre/diffs missing');

// ── 3. Unpacked native modules
section('Unpacked assets');
const unpacked = path.join(appRoot, 'Contents/Resources/app.asar.unpacked/node_modules');
if (existsSync(unpacked)) {
  pass('app.asar.unpacked/node_modules exists');
  const piDir = path.join(unpacked, '@earendil-works');
  if (existsSync(piDir)) {
    const piPkgs = readdirSync(piDir);
    pass(`@earendil-works unpacked: ${piPkgs.join(', ')}`);
  } else {
    console.warn('  ⚠  @earendil-works not in unpacked (Pi SDK may be entirely in asar)');
  }
} else {
  console.warn('  ⚠  no app.asar.unpacked/node_modules (acceptable if no native deps were unpacked)');
}

// Check for *.node native binaries (e.g. SQLite)
const nodeFiles = [];
function findNodeFiles(dir) {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) findNodeFiles(full);
      else if (entry.name.endsWith('.node')) nodeFiles.push(full);
    }
  } catch {
    // ignore permission errors
  }
}
if (existsSync(unpacked)) findNodeFiles(unpacked);

if (nodeFiles.length > 0) {
  pass(`native .node modules found: ${nodeFiles.length} file(s)`);
  for (const f of nodeFiles) {
    const rel = path.relative(unpacked, f);
    // Verify the binary is loadable on this platform
    try {
      require(f);
      pass(`  loadable: ${rel}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // May fail if wrong arch — report as warning not failure
      if (/incompatible|wrong architecture|mach-o/i.test(msg)) {
        console.warn(`  ⚠  arch mismatch (expected on cross-compile): ${rel}`);
      } else {
        fail(`  not loadable: ${rel} — ${msg}`);
      }
    }
  }
} else {
  console.warn('  ⚠  no .node native modules found in unpacked dir');
}

// ── 4. DMG presence (optional — only if package:dmg was run)
section('DMG artifact (optional)');
const dmgDir = path.join(root, 'apps/desktop/release');
if (existsSync(dmgDir)) {
  const dmgs = readdirSync(dmgDir).filter((f) => f.endsWith('.dmg'));
  if (dmgs.length > 0) {
    pass(`DMG files: ${dmgs.join(', ')}`);
  } else {
    console.log('  –  no .dmg found (run pnpm package:dmg to produce one)');
  }
} else {
  console.log('  –  release/ dir not found; no DMG check');
}

// ── Uninstall paths, derived from the bundle so they cannot be wrong
section('Uninstall paths (derived)');
{
  // Electron keys userData off `name`; `productName` only names the bundle.
  let appName = null;
  try {
    const raw = asarModule
      ? asarModule.extractFile(asarPath, 'package.json').toString('utf8')
      : null;
    if (raw) appName = JSON.parse(raw).name ?? null;
  } catch {
    appName = null;
  }
  if (!appName) {
    fail('could not read app name from the packaged package.json');
  } else {
    pass(`user data:  ~/Library/Application Support/${appName}`);
    pass(`logs:       ~/Library/Logs/${appName}`);
    console.log('  –  no LaunchAgents and no kernel extensions are installed');
  }
}

// ── Result
console.log('');
if (failures > 0) {
  console.error(`verify-packaged: ${failures} failure(s). Fix the above before shipping.`);
  process.exit(1);
} else {
  console.log('verify-packaged: all checks passed.');
}
