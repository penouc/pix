#!/usr/bin/env node
/**
 * Smoke-check packaged macOS app contents (plan §7.2 / M1).
 * Does not require GUI interaction.
 *
 * Usage: node scripts/smoke-packaged.mjs
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = path.join(
  root,
  'apps/desktop/release/mac-arm64/Pi Agent Desktop.app',
);
const asarPath = path.join(appRoot, 'Contents/Resources/app.asar');
const binary = path.join(appRoot, 'Contents/MacOS/Pi Agent Desktop');

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`OK: ${msg}`);
}

if (!existsSync(appRoot)) {
  fail(`Packaged app not found at ${appRoot}. Run: pnpm package:dir`);
}
ok(`app bundle exists`);

if (!existsSync(binary)) fail(`binary missing: ${binary}`);
ok(`main binary exists`);

if (!existsSync(asarPath)) fail(`app.asar missing`);
ok(`app.asar exists (${statSync(asarPath).size} bytes)`);

// Locate @electron/asar from pnpm store
const require = createRequire(import.meta.url);
let asar;
try {
  asar = require(path.join(
    root,
    'node_modules/.pnpm/node_modules/@electron/asar/lib/asar.js',
  ));
} catch {
  try {
    asar = require('@electron/asar');
  } catch {
    // fall back to asar CLI listing
    const asarBin = path.join(root, 'node_modules/.pnpm/node_modules/.bin/asar');
    if (!existsSync(asarBin)) fail('cannot load @electron/asar');
    const listed = spawnSync(asarBin, ['list', asarPath], { encoding: 'utf8' });
    if (listed.status !== 0) fail(`asar list failed: ${listed.stderr}`);
    const files = listed.stdout.split('\n');
    checkList(files);
    process.exit(0);
  }
}

const files = asar.listPackage(asarPath).map(String);
checkList(files);

// Pi unpack path
const unpacked = path.join(appRoot, 'Contents/Resources/app.asar.unpacked/node_modules/@earendil-works');
if (existsSync(unpacked)) {
  ok(`Pi packages unpacked: ${readdirSync(unpacked).join(', ')}`);
} else {
  console.warn('WARN: @earendil-works not found under app.asar.unpacked (may live only in asar)');
}

ok('packaged smoke passed');

function checkList(files) {
  const required = [
    '/dist-electron/main/index.js',
    '/dist-electron/preload/index.mjs',
    '/dist/index.html',
    '/package.json',
  ];
  for (const req of required) {
    if (!files.some((f) => f === req || f.endsWith(req))) {
      fail(`asar missing ${req}`);
    }
    ok(`asar has ${req}`);
  }
  const hasPi = files.some((f) => f.includes('@earendil-works/pi-coding-agent'));
  if (!hasPi) {
    // may be only in unpacked
    console.warn('WARN: pi-coding-agent not listed inside asar (check unpacked)');
  } else {
    ok('asar references pi-coding-agent');
  }
}
