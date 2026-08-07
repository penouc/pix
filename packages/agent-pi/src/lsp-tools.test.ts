import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resetLanguageServiceCache } from './ts-language-service.js';
import { findReferences, getFileDiagnostics, renameSymbol } from './ts-language-service.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  resetLanguageServiceCache();
});

function makeProject(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pi-lsp-'));
  tempDirs.push(root);
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(root, name);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  return root;
}
const PROJECT = {
  'src/math.ts': `export function add(a: number, b: number): number {
  return a + b;
}

export const VERSION = '1.0.0';
`,
  'src/main.ts': `import { add, VERSION } from './math';

export function total(x: number): number {
  return add(x, VERSION.length);
}
`,
};

describe('lsp diagnostics', () => {
  it('reports type errors in a file', () => {
    const root = makeProject({
      ...PROJECT,
      'src/broken.ts': `export function broken(): string {
  const count: number = 'not a number';
  return count;
}
`,
    });
    const diagnostics = getFileDiagnostics(root, path.join(root, 'src/broken.ts'));
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.code === 2322 || d.code === 2375)).toBe(true);
    expect(diagnostics[0]!.file).toBe('src/broken.ts');
    expect(diagnostics[0]!.line).toBeGreaterThan(0);
  });

  it('reports no diagnostics for a clean file', () => {
    const root = makeProject(PROJECT);
    const diagnostics = getFileDiagnostics(root, path.join(root, 'src/math.ts'));
    expect(diagnostics).toEqual([]);
  });

  it('resolves relative paths against the root', () => {
    const root = makeProject({
      'src/broken.ts': `export const x: number = 'nope';\n`,
    });
    const diagnostics = getFileDiagnostics(root, 'src/broken.ts');
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});

describe('lsp references', () => {
  it('finds every usage of a symbol across files', () => {
    const root = makeProject(PROJECT);
    const { references, matched } = findReferences(
      root,
      path.join(root, 'src/math.ts'),
      'add',
    );
    expect(matched).toBe(true);
    // declaration in math.ts + usage in main.ts
    const files = references.map((r) => r.file).sort();
    expect(files).toContain('src/math.ts');
    expect(files).toContain('src/main.ts');
    expect(references.filter((r) => r.file === 'src/main.ts').length).toBeGreaterThan(0);
  });

  it('returns matched=false when the symbol is not in the anchor file', () => {
    const root = makeProject(PROJECT);
    const { matched } = findReferences(root, path.join(root, 'src/math.ts'), 'total');
    expect(matched).toBe(false);
  });
});

describe('lsp rename', () => {
  it('renames a symbol across files and rewrites imports', () => {
    const root = makeProject(PROJECT);
    const result = renameSymbol(root, path.join(root, 'src/main.ts'), 'add', 'sum');

    expect(result.newName).toBe('sum');
    expect(result.changedFiles.sort()).toEqual(['src/main.ts', 'src/math.ts']);

    const math = readFileSync(path.join(root, 'src/math.ts'), 'utf8');
    const main = readFileSync(path.join(root, 'src/main.ts'), 'utf8');
    expect(math).toContain('export function sum(');
    expect(math).not.toContain('export function add(');
    expect(main).toContain("import { sum, VERSION } from './math';");
    expect(main).toContain('return sum(x, VERSION.length);');
    expect(main).not.toContain('add(');
  });

  it('throws when the symbol is not found in the anchor file', () => {
    const root = makeProject(PROJECT);
    expect(() => renameSymbol(root, path.join(root, 'src/math.ts'), 'zzz', 'x')).toThrow(
      /Could not find symbol/,
    );
  });
});
