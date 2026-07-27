import { describe, expect, it } from 'vitest';

import {
  buildSessionTitleUserPrompt,
  deriveSessionTitle,
  sanitizeSessionTitle,
} from './session-title.js';

describe('sanitizeSessionTitle', () => {
  it('keeps a plain short title', () => {
    expect(sanitizeSessionTitle('Fix login button label')).toBe('Fix login button label');
  });

  it('strips quotes, labels, and trailing punctuation', () => {
    expect(sanitizeSessionTitle('"Rename submit button."')).toBe('Rename submit button');
    expect(sanitizeSessionTitle('Title: Fix the flaky test')).toBe('Fix the flaky test');
  });

  it('rejects empty or explanatory replies', () => {
    expect(sanitizeSessionTitle('   ')).toBeNull();
    expect(sanitizeSessionTitle("Here's a good title for you")).toBeNull();
  });
});

describe('deriveSessionTitle', () => {
  it('uses the first prose line of the prompt', () => {
    expect(deriveSessionTitle('## Plan\n\nfix the primary button label')).toBe(
      'Fix the primary button label',
    );
  });
});

describe('buildSessionTitleUserPrompt', () => {
  it('includes both sides of the exchange', () => {
    const prompt = buildSessionTitleUserPrompt({
      userText: 'rename the button',
      assistantText: 'Updated App.tsx',
    });
    expect(prompt).toContain('rename the button');
    expect(prompt).toContain('Updated App.tsx');
  });
});
