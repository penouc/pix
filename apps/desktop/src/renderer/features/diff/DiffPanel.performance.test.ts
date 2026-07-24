import { performance } from 'node:perf_hooks';

import { parsePatchFiles } from '@pierre/diffs';
import { describe, expect, it } from 'vitest';

function createLargePatch(files = 25, changedLines = 400): string {
  const chunks: string[] = [];
  for (let file = 0; file < files; file += 1) {
    const path = `src/generated-${file}.ts`;
    const removed = Array.from({ length: changedLines }, (_, line) => `-const value${line} = 0;`);
    const added = Array.from({ length: changedLines }, (_, line) => `+const value${line} = 1;`);
    chunks.push(
      [
        `diff --git a/${path} b/${path}`,
        'index 1111111..2222222 100644',
        `--- a/${path}`,
        `+++ b/${path}`,
        `@@ -1,${changedLines} +1,${changedLines} @@`,
        ...removed,
        ...added,
        '',
      ].join('\n'),
    );
  }
  return chunks.join('\n');
}

describe('DiffPanel performance baseline', () => {
  it('parses a 10,000-line, 25-file working-tree patch within one second', () => {
    const startedAt = performance.now();
    const patches = parsePatchFiles(createLargePatch());
    const elapsed = performance.now() - startedAt;
    const files = patches.flatMap((patch) => patch.files);

    expect(files).toHaveLength(25);
    expect(elapsed).toBeLessThan(1_000);
  });
});
