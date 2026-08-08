/**
 * Renderer-side OS detection.
 *
 * The authoritative platform string comes from `app.getInfo().platform` in
 * Main, but two Settings surfaces describe credential storage before any IPC
 * round-trip is worth waiting for, so a UA sniff is good enough here: Electron
 * ships a real UA that reliably contains the OS name.
 */
export function detectOs(): 'mac' | 'windows' | 'linux' | 'other' {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
  if (/Linux/i.test(ua)) return 'linux';
  return 'other';
}

/** What Electron `safeStorage` actually encrypts with, per platform. */
export function credentialStorageLabel(): string {
  switch (detectOs()) {
    case 'mac':
      return 'macOS Keychain';
    case 'windows':
      return 'Windows DPAPI';
    default:
      return 'OS-level encryption';
  }
}
