/**
 * Pure first-run onboarding transitions (docs/onboarding.md).
 *
 * Kept free of Electron / FS so state machines can be unit-tested without
 * mocking safeStorage. Persistence lives in ProviderSettingsStore.
 */

export interface OnboardingState {
  completed: boolean;
  skipped: boolean;
  hasOpenedProject: boolean;
  hasConfiguredAuth: boolean;
  hasFirstRun: boolean;
}

export const DEFAULT_ONBOARDING_STATE: OnboardingState = {
  completed: false,
  skipped: false,
  hasOpenedProject: false,
  hasConfiguredAuth: false,
  hasFirstRun: false,
};

/** Editable starter prompt offered once project + auth exist. */
export const ONBOARDING_STARTER_PROMPT =
  'Summarize what this repo does and list the top risks before changing code.';

export interface OnboardingEvidence {
  /** At least one non-playground project has been opened. */
  hasRealProject: boolean;
  /** Any provider credential is usable (saved key, OAuth, or ambient env). */
  hasAuth: boolean;
  /** At least one session exists — the user has started a run before. */
  hasSession: boolean;
}

export function normalizeOnboarding(partial?: Partial<OnboardingState> | null): OnboardingState {
  return { ...DEFAULT_ONBOARDING_STATE, ...(partial ?? {}) };
}

/**
 * Apply a partial patch. Skip marks completed; finishing all three steps does too.
 */
export function mergeOnboarding(
  current: OnboardingState,
  patch: Partial<OnboardingState>,
): OnboardingState {
  const next = normalizeOnboarding({ ...current, ...patch });
  if (next.skipped) {
    next.completed = true;
  }
  if (next.hasOpenedProject && next.hasConfiguredAuth && next.hasFirstRun) {
    next.completed = true;
  }
  return next;
}

/**
 * One-shot upgrade migration. When preferences have never recorded onboarding,
 * experienced users (project / auth / session) are marked completed so the
 * checklist does not interrupt an existing install.
 */
export function migrateOnboardingFromEvidence(
  stored: Partial<OnboardingState> | undefined,
  evidence: OnboardingEvidence,
): { state: OnboardingState; shouldPersist: boolean } {
  if (stored !== undefined) {
    return { state: normalizeOnboarding(stored), shouldPersist: false };
  }
  const experienced = evidence.hasRealProject || evidence.hasAuth || evidence.hasSession;
  if (experienced) {
    return {
      state: {
        completed: true,
        skipped: false,
        hasOpenedProject: evidence.hasRealProject || evidence.hasSession,
        hasConfiguredAuth: evidence.hasAuth,
        hasFirstRun: evidence.hasSession,
      },
      shouldPersist: true,
    };
  }
  return { state: { ...DEFAULT_ONBOARDING_STATE }, shouldPersist: true };
}

/** Checklist stays on the blank Run surface until completed or skipped. */
export function shouldShowOnboardingChecklist(state: OnboardingState): boolean {
  return !state.completed && !state.skipped;
}
