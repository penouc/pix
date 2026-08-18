import { describe, expect, it } from 'vitest';

import {
  buildSessionTitleUserPrompt,
  capSessionTitle,
  deriveSessionTitle,
  MAX_SESSION_TITLE_LENGTH,
  sanitizeSessionTitle,
} from './session-title.js';

describe('capSessionTitle', () => {
  it('leaves short titles unchanged', () => {
    expect(capSessionTitle('修复按钮')).toBe('修复按钮');
  });

  it('caps long titles at MAX_SESSION_TITLE_LENGTH code points', () => {
    expect(capSessionTitle('请帮我修复登录按钮的标签文案')).toBe('请帮我修复登录按钮的');
    expect([...capSessionTitle('Fix login button label')]).toHaveLength(MAX_SESSION_TITLE_LENGTH);
  });
});

describe('sanitizeSessionTitle', () => {
  it('keeps a plain short title', () => {
    expect(sanitizeSessionTitle('Fix login')).toBe('Fix login');
  });

  it('strips quotes, labels, trailing punctuation, and caps length', () => {
    expect(sanitizeSessionTitle('"Rename submit."')).toBe('Rename sub');
    expect(sanitizeSessionTitle('Title: Fix the flaky test suite')).toBe('Fix the fl');
  });

  it('rejects empty or explanatory replies', () => {
    expect(sanitizeSessionTitle('   ')).toBeNull();
    expect(sanitizeSessionTitle("Here's a good title for you")).toBeNull();
  });
});

describe('deriveSessionTitle', () => {
  it('uses the first prose line of the prompt and caps length', () => {
    expect(deriveSessionTitle('## Plan\n\nfix the primary button label')).toBe('Fix the pr');
  });

  it('caps long Chinese prompts', () => {
    expect(deriveSessionTitle('请帮我总结一下这个仓库的主要风险点')).toBe('请帮我总结一下这个仓');
  });
});

describe('buildSessionTitleUserPrompt', () => {
  it('includes both sides of the exchange and the length limit', () => {
    const prompt = buildSessionTitleUserPrompt({
      userText: 'rename the button',
      assistantText: 'Updated App.tsx',
    });
    expect(prompt).toContain('rename the button');
    expect(prompt).toContain('Updated App.tsx');
    expect(prompt).toContain(String(MAX_SESSION_TITLE_LENGTH));
  });
});
