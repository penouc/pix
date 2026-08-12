/**
 * Per-platform BrowserWindow chrome.
 *
 * macOS keeps `hiddenInset` + traffic-light inset (plan / ADR-0004 history).
 * Windows uses a single custom title bar via `titleBarStyle: 'hidden'` and
 * Window Controls Overlay so the OS caption buttons sit in our chrome instead
 * of stacking a native title bar above the app bar.
 *
 * Overlay colours match renderer `--color-surface` / `--color-foreground`.
 * Height matches the TitleBar (`h-9` = 36px).
 */
export const TITLEBAR_HEIGHT_PX = 36;

/** Light-theme surface tokens — same as globals.css / TitleBar `bg-surface`. */
export const WINDOWS_TITLEBAR_OVERLAY_LIGHT = {
  color: '#f3f6f3',
  symbolColor: '#17181a',
  height: TITLEBAR_HEIGHT_PX,
} as const;

/** Dark-theme surface tokens — globals.css `[data-theme='dark']`. */
export const WINDOWS_TITLEBAR_OVERLAY_DARK = {
  color: '#212523',
  symbolColor: '#f2f4f2',
  height: TITLEBAR_HEIGHT_PX,
} as const;

export type TitleBarOverlayColors = {
  color: string;
  symbolColor: string;
  height: number;
};

export type WindowChromeOptions =
  | {
      titleBarStyle: 'hiddenInset';
      trafficLightPosition: { x: number; y: number };
    }
  | {
      titleBarStyle: 'hidden';
      titleBarOverlay: TitleBarOverlayColors;
    }
  | Record<string, never>;

export function windowsTitleBarOverlay(dark: boolean): TitleBarOverlayColors {
  return dark
    ? { ...WINDOWS_TITLEBAR_OVERLAY_DARK }
    : { ...WINDOWS_TITLEBAR_OVERLAY_LIGHT };
}

/**
 * BrowserWindow constructor fragment for the main window chrome.
 * Pure / platform-injected so unit tests do not need Electron.
 */
export function windowChromeOptions(
  platform: NodeJS.Platform = process.platform,
  options: { dark?: boolean } = {},
): WindowChromeOptions {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 9 },
    };
  }
  if (platform === 'win32') {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: windowsTitleBarOverlay(options.dark === true),
    };
  }
  return {};
}
