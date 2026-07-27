/**
 * Rasterises `apps/desktop/build/icon-source.png` (or falls back to icon.svg)
 * that electron-builder picks up from `buildResources`.
 *
 * Runs under Electron so the renderer is the same Chromium the app ships with.
 * ImageMagick's built-in SVG renderer ignores gradients and clip paths (it
 * yields a black square), and adding a standalone rasteriser would mean a
 * network download and a new dependency for a build-time step.
 *
 * Two vector renders at 1024 (full art, and the small-size art with the soil
 * mound dropped as the design does), then `sips` for the downscales. One window
 * is reused: creating and destroying offscreen windows in a loop fails with
 * ERR_FAILED on the second load.
 *
 *   pnpm icon:generate
 */
import { app, BrowserWindow } from 'electron';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(here, '..');
const buildDir = path.join(rootDir, 'apps', 'desktop', 'build');
const prepareScript = path.join(here, 'prepare-mascot-icon.py');
const source = path.join(buildDir, 'icon.svg');
const pngSource = path.join(buildDir, 'icon-source.png');
const iconsetDir = path.join(buildDir, 'icon.iconset');

const RENDER_AT = 1024;

/** iconset name → pixel size, per Apple's naming. */
const ICONSET = {
  'icon_16x16.png': 16,
  'icon_16x16@2x.png': 32,
  'icon_32x32.png': 32,
  'icon_32x32@2x.png': 64,
  'icon_128x128.png': 128,
  'icon_128x128@2x.png': 256,
  'icon_256x256.png': 256,
  'icon_256x256@2x.png': 512,
  'icon_512x512.png': 512,
  'icon_512x512@2x.png': 1024,
};

/** Below this the soil mound reads as mud, so the design drops it. */
const SIMPLIFY_BELOW = 128;

function generateIconsetFromMaster(masterPath) {
  for (const [name, size] of Object.entries(ICONSET)) {
    const out = path.join(iconsetDir, name);
    if (size === RENDER_AT) {
      fs.copyFileSync(masterPath, out);
    } else {
      execFileSync(
        'sips',
        ['-s', 'format', 'png', '-z', String(size), String(size), masterPath, '--out', out],
        { stdio: 'ignore' },
      );
    }
  }

  fs.copyFileSync(masterPath, path.join(buildDir, 'icon.png'));

  execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', path.join(buildDir, 'icon.icns')], {
    stdio: 'inherit',
  });

  fs.rmSync(iconsetDir, { recursive: true, force: true });
}

function preparePngSource(tmpDir) {
  const prepared = path.join(tmpDir, 'prepared.png');
  const result = spawnSync(
    'python3',
    [prepareScript, pngSource, prepared, '--size', String(RENDER_AT)],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`prepare-mascot-icon.py failed: ${detail || 'unknown error'}`);
  }
  process.stdout.write(`  flattened checkerboard corners in icon-source.png\n`);
  return prepared;
}

function syncUiIcons(masterPath) {
  const mascot = path.join(rootDir, 'apps', 'desktop', 'src', 'renderer', 'assets', 'pix-mascot.png');
  const favicon = path.join(rootDir, 'apps', 'desktop', 'public', 'favicon.png');
  fs.copyFileSync(masterPath, mascot);
  execFileSync(
    'sips',
    ['-s', 'format', 'png', '-z', '32', '32', masterPath, '--out', favicon],
    { stdio: 'ignore' },
  );
  process.stdout.write(`  synced pix-mascot.png and public/favicon.png\n`);
}

async function generateFromPng() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pix-icon-'));
  fs.rmSync(iconsetDir, { recursive: true, force: true });
  fs.mkdirSync(iconsetDir, { recursive: true });

  const prepared = preparePngSource(tmp);
  const master = path.join(tmp, `master-${RENDER_AT}.png`);
  execFileSync(
    'sips',
    [
      '-s',
      'format',
      'png',
      '-z',
      String(RENDER_AT),
      String(RENDER_AT),
      prepared,
      '--out',
      master,
    ],
    { stdio: 'ignore' },
  );
  process.stdout.write(`  rasterised icon-source.png → ${RENDER_AT}×${RENDER_AT}\n`);

  generateIconsetFromMaster(master);
  syncUiIcons(master);
  fs.rmSync(tmp, { recursive: true, force: true });

  const icns = fs.statSync(path.join(buildDir, 'icon.icns'));
  process.stdout.write(`  wrote icon.icns (${Math.round(icns.size / 1024)} KB) and icon.png\n`);
}

function pageFor(simplified) {
  let svg = fs.readFileSync(source, 'utf8');
  if (simplified) svg = svg.replace(/<ellipse id="mound"[^>]*\/>/, '');
  return `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;background:transparent;overflow:hidden}
  svg{display:block;width:${RENDER_AT}px;height:${RENDER_AT}px}
</style>
${svg}`;
}

async function main() {
  if (fs.existsSync(pngSource)) {
    await generateFromPng();
    return;
  }

  if (!fs.existsSync(source)) throw new Error(`missing ${source} or ${pngSource}`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loam-icon-'));
  fs.rmSync(iconsetDir, { recursive: true, force: true });
  fs.mkdirSync(iconsetDir, { recursive: true });

  const win = new BrowserWindow({
    width: RENDER_AT,
    height: RENDER_AT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    useContentSize: true,
    webPreferences: { offscreen: true },
  });

  const masters = {};
  for (const variant of ['full', 'simple']) {
    const page = path.join(tmp, `${variant}.html`);
    fs.writeFileSync(page, pageFor(variant === 'simple'), 'utf8');
    await win.loadFile(page);
    // A single frame is not always enough for gradient rasterisation to settle.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const image = await win.webContents.capturePage();
    const buffer = image.toPNG();
    if (buffer.length === 0) throw new Error(`capture produced no data for ${variant}`);

    // On a Retina display capturePage returns 2× the logical size, which would
    // make icon_512x512@2x.png 2048px and violate the icns spec. Normalise the
    // master to exactly RENDER_AT so every derived size is exact.
    const raw = path.join(tmp, `${variant}-raw.png`);
    fs.writeFileSync(raw, buffer);
    masters[variant] = path.join(tmp, `${variant}-${RENDER_AT}.png`);
    execFileSync(
      'sips',
      ['-z', String(RENDER_AT), String(RENDER_AT), raw, '--out', masters[variant]],
      { stdio: 'ignore' },
    );
    const { width, height } = image.getSize();
    process.stdout.write(
      `  rendered ${variant} at ${width}×${height} → ${RENDER_AT}×${RENDER_AT}\n`,
    );
  }
  win.destroy();

  generateIconsetFromMaster(masters.full);
  fs.rmSync(tmp, { recursive: true, force: true });

  const icns = fs.statSync(path.join(buildDir, 'icon.icns'));
  process.stdout.write(`  wrote icon.icns (${Math.round(icns.size / 1024)} KB) and icon.png\n`);
}

app.disableHardwareAcceleration();
app
  .whenReady()
  .then(main)
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
