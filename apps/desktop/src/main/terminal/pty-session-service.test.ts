import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Factory must not close over outer imports — vi.mock is hoisted above them.
vi.mock('node-pty', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require('node:events');
  class FakePty extends EventEmitter {
    pid = 4242;
    cols = 80;
    rows = 24;
    process = 'bash';
    write = vi.fn();
    resize = vi.fn((cols: number, rows: number) => {
      this.cols = cols;
      this.rows = rows;
    });
    kill = vi.fn(() => {
      this.emit('exit', { exitCode: 0, signal: undefined });
    });
    onData(listener: (data: string | Buffer) => void) {
      this.on('data', listener);
      return { dispose: () => this.off('data', listener) };
    }
    onExit(listener: (e: { exitCode: number; signal?: number }) => void) {
      this.on('exit', listener);
      return { dispose: () => this.off('exit', listener) };
    }
  }
  return {
    spawn: vi.fn(() => new FakePty()),
  };
});

import * as pty from 'node-pty';

import { PtySessionError, PtySessionService, resolveInteractiveShell } from './pty-session-service.js';

describe('PtySessionService', () => {
  let root: string;
  let service: PtySessionService;
  let events: Array<{ type: string; ptySessionId?: string }>;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'pi-pty-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'README.md'), '# hi\n');
    events = [];
    service = new PtySessionService({
      emit: (event) => {
        events.push(event);
      },
    });
    vi.mocked(pty.spawn).mockClear();
  });

  afterEach(async () => {
    service.closeAll();
    await rm(root, { recursive: true, force: true });
  });

  it('opens a session in the workspace root and audits lifecycle', () => {
    const opened = service.open({
      projectId: 'p1',
      workspaceRoot: root,
      projectTrusted: true,
      cols: 100,
      rows: 40,
    });

    expect(opened.sessionId).toBeTruthy();
    expect(opened.relative).toBe('.');
    expect(opened.cols).toBe(100);
    expect(opened.rows).toBe(40);
    expect(service.size).toBe(1);
    expect(pty.spawn).toHaveBeenCalledOnce();
    const spawnArgs = vi.mocked(pty.spawn).mock.calls[0]!;
    expect(spawnArgs[2]).toMatchObject({
      cwd: root,
      cols: 100,
      rows: 40,
      name: 'xterm-256color',
    });
  });

  it('refuses untrusted projects and cwd escapes', () => {
    expect(() =>
      service.open({
        projectId: 'p1',
        workspaceRoot: root,
        projectTrusted: false,
        cols: 80,
        rows: 24,
      }),
    ).toThrow(PtySessionError);

    expect(() =>
      service.open({
        projectId: 'p1',
        workspaceRoot: root,
        projectTrusted: true,
        cwd: path.join(root, '..'),
        cols: 80,
        rows: 24,
      }),
    ).toThrow(/outside the project root/i);
  });

  it('writes, resizes, forwards data, and kills on close', () => {
    const opened = service.open({
      projectId: 'p1',
      workspaceRoot: root,
      projectTrusted: true,
      cols: 80,
      rows: 24,
    });
    const fake = vi.mocked(pty.spawn).mock.results[0]!.value as {
      write: ReturnType<typeof vi.fn>;
      resize: ReturnType<typeof vi.fn>;
      kill: ReturnType<typeof vi.fn>;
      emit: (event: string, ...args: unknown[]) => boolean;
    };

    service.write(opened.sessionId, { data: '\u0003' });
    expect(fake.write).toHaveBeenCalled();

    expect(service.resize(opened.sessionId, 120, 30)).toEqual({
      ok: true,
      cols: 120,
      rows: 30,
    });
    expect(fake.resize).toHaveBeenCalledWith(120, 30);

    fake.emit('data', Buffer.from('\x1b[32mhi\x1b[0m', 'utf8'));
    expect(events.some((event) => event.type === 'terminal.data')).toBe(true);

    service.close(opened.sessionId);
    expect(fake.kill).toHaveBeenCalled();
    expect(service.size).toBe(0);
  });

  it('emits terminal.exit when the PTY process ends', () => {
    const opened = service.open({
      projectId: 'p1',
      workspaceRoot: root,
      projectTrusted: true,
      cols: 80,
      rows: 24,
    });
    const fake = vi.mocked(pty.spawn).mock.results[0]!.value as {
      emit: (event: string, ...args: unknown[]) => boolean;
    };
    fake.emit('exit', { exitCode: 1, signal: undefined });

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'terminal.exit',
          ptySessionId: opened.sessionId,
          exitCode: 1,
        }),
      ]),
    );
    expect(service.size).toBe(0);
  });
});

describe('resolveInteractiveShell', () => {
  it('returns a usable shell descriptor on this platform', () => {
    if (process.platform === 'win32') {
      try {
        const shell = resolveInteractiveShell();
        expect(shell.args).toEqual(['-l', '-i']);
        expect(shell.file.toLowerCase()).toContain('bash');
      } catch (error) {
        expect(error).toBeInstanceOf(PtySessionError);
        expect((error as PtySessionError).code).toBe('BASH_NOT_FOUND');
      }
      return;
    }
    const shell = resolveInteractiveShell();
    expect(shell.args).toContain('-l');
    expect(shell.file.length).toBeGreaterThan(0);
  });
});
