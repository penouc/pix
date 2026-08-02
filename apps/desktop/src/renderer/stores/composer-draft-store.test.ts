import { beforeEach, describe, expect, it } from 'vitest';

import { composerDraftScope, useComposerDraftStore } from './composer-draft-store';

describe('composer draft store', () => {
  beforeEach(() => useComposerDraftStore.setState({ drafts: {} }));

  it('keeps drafts independently for each task', () => {
    const store = useComposerDraftStore.getState();
    store.setDraft('session:one', 'first draft');
    store.setDraft('session:two', 'second draft');

    expect(useComposerDraftStore.getState().drafts).toEqual({
      'session:one': 'first draft',
      'session:two': 'second draft',
    });
  });

  it('removes a draft only when it is explicitly cleared', () => {
    useComposerDraftStore.getState().setDraft('session:one', 'keep me');
    useComposerDraftStore.getState().setDraft('session:one', '');

    expect(useComposerDraftStore.getState().drafts['session:one']).toBeUndefined();
  });

  it('uses separate scopes for sessions and new tasks', () => {
    expect(composerDraftScope('s1', 'p1')).toBe('session:s1');
    expect(composerDraftScope(undefined, 'p1')).toBe('new:p1');
    expect(composerDraftScope()).toBe('new:unscoped');
  });
});
