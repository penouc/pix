import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  isBroadProjectPath,
  normalizeProjectPath,
  resolveProjectIdentities,
} from './types.js';

describe('resolveProjectIdentities', () => {
  it('rolls nested paths into the shortest non-broad ancestor', () => {
    const stockk = normalizeProjectPath('/Users/pen/dev/stockk');
    const stockkFront = normalizeProjectPath('/Users/pen/dev/stockk/frontend');
    const stockkFonts = normalizeProjectPath('/Users/pen/dev/stockk/Resources/Fonts');
    const mai = normalizeProjectPath('/Users/pen/dev/mai-project');
    const maiFront = normalizeProjectPath('/Users/pen/dev/mai-project/mai-frontend');
    const home = normalizeProjectPath('/Users/pen');
    const pix = normalizeProjectPath('/Users/pen/dev/pix');

    const map = resolveProjectIdentities([
      stockk,
      stockkFront,
      stockkFonts,
      mai,
      maiFront,
      home,
      pix,
    ]);
    expect(map.get(stockkFront)).toBe(stockk);
    expect(map.get(stockkFonts)).toBe(stockk);
    expect(map.get(maiFront)).toBe(mai);
    expect(map.get(pix)).toBe(pix);
    // Broad home path must not absorb siblings.
    expect(map.get(home)).toBe(home);
  });

  it('marks shallow paths as too broad to be merge parents', () => {
    expect(isBroadProjectPath('/')).toBe(true);
    expect(isBroadProjectPath(path.resolve('/Users/pen'))).toBe(true);
    expect(isBroadProjectPath(path.resolve('/Users/pen/dev/pix'))).toBe(false);
  });
});
