import { describe, expect, it } from 'vitest';

import {
  AnchorEditError,
  applyAnchoredEdits,
  buildLineHashes,
  sha256Hex,
  shortHash,
} from './hashline-edit.js';

const CONTENT = [
  'const sum = (a, b) => a + b;',
  '',
  'export function greet(name) {',
  '  return `Hello, ${name}!`;',
  '}',
  '',
  'export const PI = 3.14159;',
].join('\n');

describe('buildLineHashes', () => {
  it('hashes each line and the whole file', () => {
    const { entries, fileHash } = buildLineHashes(CONTENT);
    expect(entries).toHaveLength(7);
    expect(entries[0]).toMatchObject({ line: 1, text: 'const sum = (a, b) => a + b;' });
    expect(entries[0]!.hash).toBe(sha256Hex('const sum = (a, b) => a + b;'));
    expect(shortHash(entries[0]!.hash)).toHaveLength(12);
    expect(fileHash).toBe(sha256Hex(CONTENT.replace(/\r\n/g, '\n')));
  });

  it('does not count a trailing newline as an extra line', () => {
    const { entries } = buildLineHashes('a\nb\n');
    expect(entries.map((e) => e.line)).toEqual([1, 2]);
  });
});

describe('applyAnchoredEdits — oldText mode', () => {
  it('replaces a unique exact block', () => {
    const { content, applied } = applyAnchoredEdits(CONTENT, [
      {
        oldText: 'export const PI = 3.14159;',
        newText: 'export const PI = Math.PI;',
      },
    ]);
    expect(content).toContain('export const PI = Math.PI;');
    expect(content).not.toContain('3.14159');
    expect(applied).toEqual([{ index: 0, mode: 'oldText', line: 7 }]);
  });

  it('rejects a stale whole-file oldHash without writing anything', () => {
    expect(() =>
      applyAnchoredEdits(CONTENT, [
        {
          oldText: 'export const PI = 3.14159;',
          newText: 'export const PI = Math.PI;',
          oldHash: 'deadbeef',
        },
      ]),
    ).toThrow(AnchorEditError);
  });

  it('accepts a fresh whole-file oldHash', () => {
    const fileHash = sha256Hex(CONTENT.replace(/\r\n/g, '\n'));
    const { content } = applyAnchoredEdits(CONTENT, [
      {
        oldText: 'export const PI = 3.14159;',
        newText: 'export const PI = Math.PI;',
        oldHash: fileHash,
      },
    ]);
    expect(content).toContain('export const PI = Math.PI;');
  });

  it('rejects missing text', () => {
    expect(() =>
      applyAnchoredEdits(CONTENT, [{ oldText: 'nope nope nope', newText: 'x' }]),
    ).toThrow(/Could not find/i);
  });

  it('rejects ambiguous text', () => {
    const dup = 'line\nline\n';
    expect(() =>
      applyAnchoredEdits(dup, [{ oldText: 'line', newText: 'changed' }]),
    ).toThrow(/multiple occurrences/i);
  });

  it('rejects an edit with both anchors or neither', () => {
    expect(() =>
      applyAnchoredEdits(CONTENT, [
        { oldText: 'a', lineHash: 'b', newText: 'x' },
      ]),
    ).toThrow(/exactly one anchor/i);
    expect(() => applyAnchoredEdits(CONTENT, [{ newText: 'x' }])).toThrow(/no anchor/i);
  });
});

describe('applyAnchoredEdits — lineHash mode', () => {
  it('replaces the line whose hash matches', () => {
    const { entries } = buildLineHashes(CONTENT);
    const target = entries.find((e) => e.text.includes('PI'))!;
    const { content, applied } = applyAnchoredEdits(CONTENT, [
      { lineHash: target.hash, newText: 'export const PI = Math.PI;' },
    ]);
    expect(content).toContain('export const PI = Math.PI;');
    expect(content).not.toContain('3.14159');
    expect(applied[0]).toMatchObject({ mode: 'lineHash', line: 7 });
  });

  it('rejects a lineHash that no longer matches', () => {
    expect(() =>
      applyAnchoredEdits(CONTENT, [{ lineHash: 'deadbeef', newText: 'x' }]),
    ).toThrow(/No line matches/i);
  });

  it('rejects a lineHash matching identical lines', () => {
    const dup = 'same\nother\nsame\n';
    const { entries } = buildLineHashes(dup);
    const same = entries.find((e) => e.text === 'same')!;
    expect(() => applyAnchoredEdits(dup, [{ lineHash: same.hash, newText: 'x' }])).toThrow(
      /identical lines/i,
    );
  });
});

describe('applyAnchoredEdits — atomicity and fidelity', () => {
  it('validates every edit before writing any (all-or-nothing)', () => {
    // First edit is fine, second is missing — nothing may change.
    expect(() =>
      applyAnchoredEdits(CONTENT, [
        { oldText: 'export const PI = 3.14159;', newText: 'X' },
        { oldText: 'does not exist', newText: 'Y' },
      ]),
    ).toThrow(/Could not find/i);
  });

  it('rejects overlapping edits', () => {
    expect(() =>
      applyAnchoredEdits('const a = 1;\nconst b = 2;', [
        { oldText: 'const a = 1;', newText: 'x' },
        { oldText: 'a = 1;\nconst', newText: 'y' },
      ]),
    ).toThrow(/overlap/i);
  });

  it('applies multiple disjoint edits matched against the original', () => {
    const { content } = applyAnchoredEdits(CONTENT, [
      { oldText: 'const sum = (a, b) => a + b;', newText: 'const sum = (a, b) => a * b;' },
      { oldText: 'export const PI = 3.14159;', newText: 'export const PI = Math.PI;' },
    ]);
    expect(content).toContain('a * b');
    expect(content).toContain('Math.PI');
  });

  it('preserves CRLF line endings and a trailing newline', () => {
    const crlf = 'line1\r\nline2\r\nline3\r\n';
    const { content } = applyAnchoredEdits(crlf, [
      { oldText: 'line2', newText: 'changed' },
    ]);
    expect(content).toBe('line1\r\nchanged\r\nline3\r\n');
  });

  it('preserves a file without a trailing newline', () => {
    const noNewline = 'a\nb';
    const { content } = applyAnchoredEdits(noNewline, [{ oldText: 'b', newText: 'c' }]);
    expect(content).toBe('a\nc');
  });
});
