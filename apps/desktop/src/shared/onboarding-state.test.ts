import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ONBOARDING_STATE,
  mergeOnboarding,
  migrateOnboardingFromEvidence,
  shouldShowOnboardingChecklist,
} from './onboarding-state.js';

describe('mergeOnboarding', () => {
  it('marks completed when the user skips', () => {
    const next = mergeOnboarding(DEFAULT_ONBOARDING_STATE, { skipped: true });
    expect(next.skipped).toBe(true);
    expect(next.completed).toBe(true);
    expect(shouldShowOnboardingChecklist(next)).toBe(false);
  });

  it('marks completed when all three steps are done', () => {
    const next = mergeOnboarding(DEFAULT_ONBOARDING_STATE, {
      hasOpenedProject: true,
      hasConfiguredAuth: true,
      hasFirstRun: true,
    });
    expect(next.completed).toBe(true);
    expect(shouldShowOnboardingChecklist(next)).toBe(false);
  });

  it('keeps the checklist up while steps are incomplete', () => {
    const mid = mergeOnboarding(DEFAULT_ONBOARDING_STATE, {
      hasOpenedProject: true,
      hasConfiguredAuth: true,
    });
    expect(mid.completed).toBe(false);
    expect(shouldShowOnboardingChecklist(mid)).toBe(true);
  });

  it('does not reopen the checklist for a completed user on further patches', () => {
    const done = mergeOnboarding(DEFAULT_ONBOARDING_STATE, {
      hasOpenedProject: true,
      hasConfiguredAuth: true,
      hasFirstRun: true,
    });
    const again = mergeOnboarding(done, { hasOpenedProject: true });
    expect(again.completed).toBe(true);
    expect(shouldShowOnboardingChecklist(again)).toBe(false);
  });
});

describe('migrateOnboardingFromEvidence', () => {
  it('persists defaults for a clean first install', () => {
    const result = migrateOnboardingFromEvidence(undefined, {
      hasRealProject: false,
      hasAuth: false,
      hasSession: false,
    });
    expect(result.shouldPersist).toBe(true);
    expect(result.state).toEqual(DEFAULT_ONBOARDING_STATE);
    expect(shouldShowOnboardingChecklist(result.state)).toBe(true);
  });

  it('marks experienced upgrades completed so the checklist does not interrupt', () => {
    const result = migrateOnboardingFromEvidence(undefined, {
      hasRealProject: true,
      hasAuth: true,
      hasSession: false,
    });
    expect(result.shouldPersist).toBe(true);
    expect(result.state.completed).toBe(true);
    expect(result.state.hasOpenedProject).toBe(true);
    expect(result.state.hasConfiguredAuth).toBe(true);
    expect(shouldShowOnboardingChecklist(result.state)).toBe(false);
  });

  it('treats an existing session alone as experienced', () => {
    const result = migrateOnboardingFromEvidence(undefined, {
      hasRealProject: false,
      hasAuth: false,
      hasSession: true,
    });
    expect(result.state.completed).toBe(true);
    expect(result.state.hasFirstRun).toBe(true);
    expect(shouldShowOnboardingChecklist(result.state)).toBe(false);
  });

  it('does not re-migrate once onboarding has been written', () => {
    const stored = mergeOnboarding(DEFAULT_ONBOARDING_STATE, { skipped: true });
    const result = migrateOnboardingFromEvidence(stored, {
      hasRealProject: true,
      hasAuth: true,
      hasSession: true,
    });
    expect(result.shouldPersist).toBe(false);
    expect(result.state.skipped).toBe(true);
    expect(result.state.completed).toBe(true);
  });
});
