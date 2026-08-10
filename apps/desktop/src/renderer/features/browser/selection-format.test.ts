import { describe, expect, it } from 'vitest';

import { formatBrowserSelectionForComposer } from './selection-format';

describe('formatBrowserSelectionForComposer', () => {
  it('includes url, selector, and text for the agent', () => {
    const text = formatBrowserSelectionForComposer({
      url: 'http://localhost:5173/',
      title: 'Demo',
      selector: 'button.primary',
      tagName: 'BUTTON',
      text: 'Save',
      htmlSnippet: '<button class="primary">Save</button>',
    });
    expect(text).toContain('http://localhost:5173/');
    expect(text).toContain('`button.primary`');
    expect(text).toContain('Save');
    expect(text).toContain('```html');
  });
});
