/**
 * electron-builder afterPack hook.
 *
 * Electron's default macOS Info.plist ships Camera / Microphone / Bluetooth
 * usage strings. PiX never uses those APIs, but the strings alone make the app
 * show up under Privacy settings and look like it wants invasive access on first
 * install. Strip them from every Info.plist in the bundle before signing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';

/* global console */
import path from 'node:path';

/** Privacy keys Electron templates with and that PiX does not need. */
const PRIVACY_KEYS = [
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSContactsUsageDescription',
  'NSLocationAlwaysUsageDescription',
  'NSLocationWhenInUseUsageDescription',
  'NSCalendarsUsageDescription',
  'NSRemindersUsageDescription',
  'NSMotionUsageDescription',
  'NSPhotoLibraryUsageDescription',
  'NSPhotoLibraryAddUsageDescription',
  'NSAppleEventsUsageDescription',
  'NSSpeechRecognitionUsageDescription',
  'NSAppleMusicUsageDescription',
  'NSDesktopFolderUsageDescription',
  'NSDocumentsFolderUsageDescription',
  'NSDownloadsFolderUsageDescription',
  'NSNetworkVolumesUsageDescription',
  'NSRemovableVolumesUsageDescription',
  'NSFileProviderDomainUsageDescription',
  'NSSystemAdministrationUsageDescription',
];

function walkInfoPlists(root, out = []) {
  if (!existsSync(root)) return out;
  for (const name of readdirSync(root)) {
    const full = path.join(root, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      // Skip deep framework resource noise except nested helper .app bundles.
      if (name === 'Electron Framework.framework' || name.endsWith('.framework')) {
        // Still check the framework's own Info.plist if present.
        const frameworkInfo = path.join(full, 'Resources', 'Info.plist');
        if (existsSync(frameworkInfo)) out.push(frameworkInfo);
        const versionsInfo = path.join(full, 'Versions', 'A', 'Resources', 'Info.plist');
        if (existsSync(versionsInfo)) out.push(versionsInfo);
        continue;
      }
      walkInfoPlists(full, out);
    } else if (name === 'Info.plist') {
      out.push(full);
    }
  }
  return out;
}

function stripPrivacyKeys(plistPath) {
  let removed = 0;
  for (const key of PRIVACY_KEYS) {
    try {
      execFileSync('plutil', ['-remove', key, plistPath], { stdio: 'ignore' });
      removed += 1;
    } catch {
      // Key absent — fine.
    }
  }
  return removed;
}

/** @param {import('electron-builder').AfterPackContext} context */
export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  if (!existsSync(appPath)) {
    console.warn(`[after-pack] app bundle not found at ${appPath}; skipping privacy strip`);
    return;
  }

  const plists = walkInfoPlists(appPath);
  let totalRemoved = 0;
  for (const plistPath of plists) {
    totalRemoved += stripPrivacyKeys(plistPath);
  }

  console.log(
    `[after-pack] stripped ${totalRemoved} unused privacy key(s) from ${plists.length} Info.plist file(s)`,
  );
}
