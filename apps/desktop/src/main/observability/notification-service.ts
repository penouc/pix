import { app, BrowserWindow, Notification } from 'electron';

import type { DesktopAgentEvent } from '@pi-desktop/protocol';

import type { UiFlags } from '../providers/provider-settings-store.js';

/**
 * Desktop notifications for the events worth interrupting someone over — the
 * design's Notifications tab ("long runs should be able to page you").
 *
 * Driven off the same agent event stream the window sees, so it needs no extra
 * plumbing in the run path. Nothing here reads prompts or file contents: a
 * notification body only ever carries the session title and a status word,
 * because notifications are surfaced by the OS and can persist in a tray.
 */
export class NotificationService {
  private runningRuns = new Set<string>();
  /** Session titles, so a finished-run notification can name the task. */
  private readonly titles = new Map<string, string>();

  constructor(private readonly readFlags: () => UiFlags) {}

  setSessionTitle(sessionId: string, title: string): void {
    this.titles.set(sessionId, title);
  }

  observe(event: DesktopAgentEvent): void {
    const flags = this.readFlags();

    switch (event.type) {
      case 'run.started':
        this.runningRuns.add(event.runId);
        this.updateBadge(flags);
        break;

      case 'approval.requested':
        if (flags.notifyApprovalRequired) {
          this.show(flags, {
            title: 'Approval required',
            body: `${event.toolName} is waiting on your decision in ${this.describe(event.sessionId)}.`,
            urgent: true,
          });
        }
        break;

      case 'run.completed':
      case 'run.failed':
      case 'run.cancelled': {
        this.runningRuns.delete(event.runId);
        this.updateBadge(flags);
        if (!flags.notifyRunFinished) break;
        const outcome =
          event.type === 'run.completed'
            ? 'finished'
            : event.type === 'run.failed'
              ? 'failed'
              : 'was cancelled';
        this.show(flags, {
          title: `Task ${outcome}`,
          body: this.describe(event.sessionId),
        });
        break;
      }

      default:
        break;
    }
  }

  /** Called by the automation scheduler when it opens a task on its own. */
  automationOpenedTask(automationName: string): void {
    const flags = this.readFlags();
    if (!flags.notifyAutomationOpenedTask) return;
    this.show(flags, {
      title: 'Automation opened a task',
      body: automationName,
    });
  }

  dispose(): void {
    this.runningRuns.clear();
    if (process.platform === 'darwin') app.dock?.setBadge('');
  }

  private describe(sessionId: string): string {
    return this.titles.get(sessionId) ?? 'a task';
  }

  private show(flags: UiFlags, options: { title: string; body: string; urgent?: boolean }): void {
    if (!Notification.isSupported()) return;
    // "Only notify when the window is in the background" — an approval you can
    // already see on screen should not also buzz.
    if (flags.notifyOnlyWhenBackground && this.windowHasFocus()) return;

    const notification = new Notification({
      title: options.title,
      body: options.body,
      silent: !flags.notifyPlaySound,
      urgency: options.urgent ? 'critical' : 'normal',
    });
    notification.on('click', () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.focus();
    });
    notification.show();
  }

  private windowHasFocus(): boolean {
    return BrowserWindow.getAllWindows().some((win) => win.isFocused());
  }

  private updateBadge(flags: UiFlags): void {
    if (process.platform !== 'darwin' || !app.dock) return;
    if (!flags.notifyBadgeDock) {
      app.dock.setBadge('');
      return;
    }
    app.dock.setBadge(this.runningRuns.size > 0 ? String(this.runningRuns.size) : '');
  }
}
