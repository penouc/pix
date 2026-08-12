import { describe, expect, it } from 'vitest';

import {
  TITLEBAR_HEIGHT_PX,
  WINDOWS_TITLEBAR_OVERLAY_DARK,
  WINDOWS_TITLEBAR_OVERLAY_LIGHT,
  windowChromeOptions,
  windowsTitleBarOverlay,
} from './window-chrome.js';

describe('windowChromeOptions', () => {
  it('keeps macOS hiddenInset traffic lights', () => {
    expect(windowChromeOptions('darwin')).toEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 9 },
    });
  });

  it('uses a single overlay title bar on Windows (no stacked native frame)', () => {
    expect(windowChromeOptions('win32')).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: WINDOWS_TITLEBAR_OVERLAY_LIGHT.color,
        symbolColor: WINDOWS_TITLEBAR_OVERLAY_LIGHT.symbolColor,
        height: TITLEBAR_HEIGHT_PX,
      },
    });
  });

  it('picks dark overlay tokens when requested', () => {
    expect(windowChromeOptions('win32', { dark: true })).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: WINDOWS_TITLEBAR_OVERLAY_DARK.color,
        symbolColor: WINDOWS_TITLEBAR_OVERLAY_DARK.symbolColor,
        height: TITLEBAR_HEIGHT_PX,
      },
    });
  });

  it('leaves Linux on the default native frame', () => {
    expect(windowChromeOptions('linux')).toEqual({});
  });
});

describe('windowsTitleBarOverlay', () => {
  it('returns light and dark surface pairs', () => {
    expect(windowsTitleBarOverlay(false)).toEqual(WINDOWS_TITLEBAR_OVERLAY_LIGHT);
    expect(windowsTitleBarOverlay(true)).toEqual(WINDOWS_TITLEBAR_OVERLAY_DARK);
  });
});
