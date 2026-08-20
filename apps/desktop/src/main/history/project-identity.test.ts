import { describe, expect, it } from 'vitest';

import {
  isBroadProjectPath,
  resolveProjectIdentities,
} from './types.js';

describe('resolveProjectIdentities', () => {
  it('rolls nested paths into the shortest non-broad ancestor', () => {
    const map = resolveProjectIdentities([
      '/Users/pen/dev/stockk',
      '/Users/pen/dev/stockk/frontend',
      '/Users/pen/dev/stockk/Resources/Fonts',
      '/Users/pen/dev/mai-project',
      '/Users/pen/dev/mai-project/mai-frontend',
      '/Users/pen',
      '/Users/pen/dev/pix',
    ]);
    expect(map.get('/Users/pen/dev/stockk/frontend')).toBe('/Users/pen/dev/stockk');
    expect(map.get('/Users/pen/dev/stockk/Resources/Fonts')).toBe('/Users/pen/dev/stockk');
    expect(map.get('/Users/pen/dev/mai-project/mai-frontend')).toBe('/Users/pen/dev/mai-project');
    expect(map.get('/Users/pen/dev/pix')).toBe('/Users/pen/dev/pix');
    // Broad home path must not absorb siblings.
    expect(map.get('/Users/pen')).toBe('/Users/pen');
  });

  it('marks shallow paths as too broad to be merge parents', () => {
    expect(isBroadProjectPath('/')).toBe(true);
    expect(isBroadProjectPath('/Users/pen')).toBe(true);
    expect(isBroadProjectPath('/Users/pen/dev/pix')).toBe(false);
  });
});
