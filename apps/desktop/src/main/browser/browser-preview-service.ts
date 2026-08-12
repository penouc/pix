import { WebContentsView, shell, type BrowserWindow } from 'electron';

import type {
  BrowserBounds,
  BrowserSelection,
  BrowserState,
  InputImage,
} from '@pi-desktop/protocol';

import { isHttpUrl, isLoopbackUrl, normalizeBrowserUrl } from './origin.js';

/** Injected into the guest page for a one-shot element pick. */
const PICKER_SCRIPT = `(() => {
  if (window.__pixPickerCancel) {
    try { window.__pixPickerCancel('superseded'); } catch (_) {}
  }
  return new Promise((resolve, reject) => {
    const highlight = document.createElement('div');
    highlight.setAttribute('data-pix-picker', '1');
    Object.assign(highlight.style, {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: '2147483646',
      border: '2px solid #2563eb',
      background: 'rgba(37, 99, 235, 0.12)',
      borderRadius: '2px',
      display: 'none',
    });
    document.documentElement.appendChild(highlight);

    let current = null;

    function cssEscape(value) {
      if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
      return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
    }

    function buildSelector(el) {
      if (!(el instanceof Element)) return 'html';
      if (el.id) return '#' + cssEscape(el.id);
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && parts.length < 6) {
        let part = node.tagName.toLowerCase();
        if (node.id) {
          parts.unshift('#' + cssEscape(node.id));
          break;
        }
        const parent = node.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
          if (siblings.length > 1) {
            part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
          }
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(' > ') || el.tagName.toLowerCase();
    }

    function moveHighlight(el) {
      if (!(el instanceof Element)) {
        highlight.style.display = 'none';
        return;
      }
      const rect = el.getBoundingClientRect();
      Object.assign(highlight.style, {
        display: 'block',
        left: rect.left + 'px',
        top: rect.top + 'px',
        width: Math.max(0, rect.width) + 'px',
        height: Math.max(0, rect.height) + 'px',
      });
    }

    function cleanup() {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey, true);
      highlight.remove();
      delete window.__pixPickerCancel;
    }

    function onMove(event) {
      const el = document.elementFromPoint(event.clientX, event.clientY);
      if (!el || el === highlight) return;
      current = el;
      moveHighlight(el);
    }

    function onClick(event) {
      event.preventDefault();
      event.stopPropagation();
      const el = current || document.elementFromPoint(event.clientX, event.clientY);
      if (!(el instanceof Element)) {
        cleanup();
        reject(new Error('No element under the cursor'));
        return;
      }
      const rect = el.getBoundingClientRect();
      const html = (el.outerHTML || '').slice(0, 4000);
      const text = (el.innerText || el.textContent || '').trim().slice(0, 4000);
      cleanup();
      resolve({
        selector: buildSelector(el),
        tagName: el.tagName,
        text,
        htmlSnippet: html,
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
      });
    }

    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanup();
        reject(new Error('cancelled'));
      }
    }

    window.__pixPickerCancel = (reason) => {
      cleanup();
      reject(new Error(reason || 'cancelled'));
    };

    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey, true);
  });
})()`;

type PickerDomResult = {
  selector: string;
  tagName: string;
  text: string;
  htmlSnippet: string;
  rect?: BrowserBounds;
};

/**
 * Dock preview host: a single WebContentsView painted over the Browser tab content.
 * See ADR-0005 — loopback picker only; no agent drive in P1.
 */
export class BrowserPreviewService {
  private view: WebContentsView | null = null;
  private picking = false;
  private attached = false;

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  attach(): BrowserState {
    const win = this.requireWindow();
    if (!this.view) {
      this.view = new WebContentsView({
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          // Ephemeral partition: preview cookies do not share the app session.
          partition: 'persist:pi-desktop-preview',
        },
      });
      this.view.setBackgroundColor('#ffffff');
      const { webContents } = this.view;
      webContents.setWindowOpenHandler(({ url }) => {
        if (isHttpUrl(url)) void shell.openExternal(url);
        return { action: 'deny' };
      });
      webContents.on('will-navigate', (event, url) => {
        if (!isHttpUrl(url)) event.preventDefault();
      });
    }
    if (!this.attached) {
      win.contentView.addChildView(this.view);
      this.attached = true;
    }
    this.view.setVisible(true);
    return this.getState();
  }

  detach(): void {
    void this.cancelPicker();
    if (!this.view) return;
    const win = this.getWindow();
    if (win && this.attached) {
      try {
        win.contentView.removeChildView(this.view);
      } catch {
        /* already removed */
      }
    }
    this.attached = false;
    try {
      this.view.webContents.close();
    } catch {
      /* destroyed */
    }
    this.view = null;
  }

  setVisible(visible: boolean): BrowserState {
    if (!this.view) {
      if (visible) return this.attach();
      return this.emptyState();
    }
    if (!visible) void this.cancelPicker();
    this.view.setVisible(visible);
    return this.getState();
  }

  setBounds(bounds: BrowserBounds): BrowserState {
    this.attach();
    const safe = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    };
    this.view!.setBounds(safe);
    // Zero-size means the Dock hole is gone — hide so we do not steal clicks.
    this.view!.setVisible(safe.width > 0 && safe.height > 0);
    return this.getState();
  }

  async navigate(rawUrl: string): Promise<BrowserState> {
    const url = normalizeBrowserUrl(rawUrl);
    if (!url || !isHttpUrl(url)) {
      throw new BrowserPreviewError('UNSUPPORTED_SCHEME', 'Only http and https URLs can load.');
    }
    this.attach();
    void this.cancelPicker();
    await this.view!.webContents.loadURL(url);
    return this.getState();
  }

  reload(): BrowserState {
    if (!this.view) throw new BrowserPreviewError('BROWSER_NOT_ATTACHED', 'Open the Browser tab first.');
    void this.cancelPicker();
    this.view.webContents.reload();
    return this.getState();
  }

  goBack(): BrowserState {
    if (!this.view) throw new BrowserPreviewError('BROWSER_NOT_ATTACHED', 'Open the Browser tab first.');
    if (this.view.webContents.navigationHistory.canGoBack()) {
      this.view.webContents.navigationHistory.goBack();
    }
    return this.getState();
  }

  goForward(): BrowserState {
    if (!this.view) throw new BrowserPreviewError('BROWSER_NOT_ATTACHED', 'Open the Browser tab first.');
    if (this.view.webContents.navigationHistory.canGoForward()) {
      this.view.webContents.navigationHistory.goForward();
    }
    return this.getState();
  }

  getState(): BrowserState {
    if (!this.view) return this.emptyState();
    const { webContents } = this.view;
    return {
      url: webContents.getURL(),
      title: webContents.getTitle(),
      canGoBack: webContents.navigationHistory.canGoBack(),
      canGoForward: webContents.navigationHistory.canGoForward(),
      picking: this.picking,
    };
  }

  async startPicker(): Promise<BrowserSelection> {
    this.attach();
    const { webContents } = this.view!;
    const url = webContents.getURL();
    if (!url || !isHttpUrl(url)) {
      throw new BrowserPreviewError('BROWSER_NO_PAGE', 'Load a page before selecting.');
    }
    if (!isLoopbackUrl(url)) {
      throw new BrowserPreviewError(
        'BROWSER_ORIGIN_DENIED',
        'Selecting page content is limited to localhost for now. Open the site in your system browser, or use a local preview URL.',
      );
    }
    if (this.picking) {
      await this.cancelPicker();
    }
    this.picking = true;
    try {
      const dom = (await webContents.executeJavaScript(PICKER_SCRIPT, true)) as PickerDomResult;
      let screenshot: InputImage | undefined;
      if (dom.rect && dom.rect.width > 0 && dom.rect.height > 0) {
        try {
          const image = await webContents.capturePage({
            x: Math.max(0, Math.floor(dom.rect.x)),
            y: Math.max(0, Math.floor(dom.rect.y)),
            width: Math.max(1, Math.ceil(dom.rect.width)),
            height: Math.max(1, Math.ceil(dom.rect.height)),
          });
          const png = image.toPNG();
          if (png.byteLength > 0 && png.byteLength <= 10 * 1024 * 1024) {
            screenshot = {
              data: png.toString('base64'),
              mimeType: 'image/png',
              name: 'browser-selection.png',
              size: png.byteLength,
            };
          }
        } catch (error) {
          console.warn('[browser] selection screenshot failed', error);
        }
      }
      return {
        url,
        title: webContents.getTitle() || undefined,
        selector: dom.selector,
        tagName: dom.tagName,
        text: dom.text ?? '',
        htmlSnippet: dom.htmlSnippet ?? '',
        ...(dom.rect ? { rect: dom.rect } : {}),
        ...(screenshot ? { screenshot } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'cancelled' || message === 'superseded') {
        throw new BrowserPreviewError('BROWSER_PICKER_CANCELLED', 'Selection cancelled.');
      }
      throw new BrowserPreviewError('BROWSER_PICKER_FAILED', message || 'Selection failed.');
    } finally {
      this.picking = false;
    }
  }

  async cancelPicker(): Promise<BrowserState> {
    if (!this.view || !this.picking) {
      this.picking = false;
      return this.getState();
    }
    try {
      await this.view.webContents.executeJavaScript(
        `(() => { if (window.__pixPickerCancel) window.__pixPickerCancel('cancelled'); })()`,
        true,
      );
    } catch {
      /* page may have navigated */
    }
    this.picking = false;
    return this.getState();
  }

  private requireWindow(): BrowserWindow {
    const win = this.getWindow();
    if (!win) throw new BrowserPreviewError('NO_WINDOW', 'Main window is not available.');
    return win;
  }

  private emptyState(): BrowserState {
    return { url: '', title: '', canGoBack: false, canGoForward: false, picking: false };
  }
}

export class BrowserPreviewError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BrowserPreviewError';
  }
}
