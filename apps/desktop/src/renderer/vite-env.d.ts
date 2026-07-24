/// <reference types="vite/client" />

import type { PiDesktopApi } from '../preload/index';

declare global {
  interface Window {
    piDesktop: PiDesktopApi;
  }
}

export {};
