import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import type { OnboardingState, PatchOnboardingInput, Settings } from '@pi-desktop/protocol';

import { invoke } from '@/lib/ipc';
import { useOfferedModels } from '@/features/models/use-offered-models';
import { useWorkspaceStore } from '@/stores/workspace-store';

export {
  ONBOARDING_STARTER_PROMPT,
  shouldShowOnboardingChecklist,
} from '../../../shared/onboarding-state';

const ONBOARDING_QUERY_KEY = ['settings.getOnboarding'] as const;

/**
 * User-level first-run state. Prefer this over reading localStorage — secrets and
 * prefs stay in Main (docs/onboarding.md).
 */
export function useOnboarding() {
  const queryClient = useQueryClient();
  const project = useWorkspaceStore((s) => s.project);
  const { models, isLoading: modelsLoading } = useOfferedModels();
  const hasAuth = models.length > 0;

  const onboarding = useQuery({
    queryKey: ONBOARDING_QUERY_KEY,
    queryFn: () => invoke<OnboardingState>({ method: 'settings.getOnboarding' }),
  });

  const patch = useMutation({
    mutationFn: (input: PatchOnboardingInput) =>
      invoke<OnboardingState>({ method: 'settings.patchOnboarding', params: input }),
    onSuccess: (next) => {
      queryClient.setQueryData(ONBOARDING_QUERY_KEY, next);
      queryClient.setQueryData<Settings>(['settings.get'], (prev) =>
        prev ? { ...prev, onboarding: next } : prev,
      );
    },
  });

  const state = onboarding.data;

  const mutatePatch = patch.mutate;

  // Keep step flags in sync with live evidence (auth may come from env/OAuth).
  useEffect(() => {
    if (!state || state.completed || state.skipped) return;
    const patchBody: PatchOnboardingInput = {};
    if (project && !project.isPlayground && !state.hasOpenedProject) {
      patchBody.hasOpenedProject = true;
    }
    if (hasAuth && !state.hasConfiguredAuth) {
      patchBody.hasConfiguredAuth = true;
    }
    if (Object.keys(patchBody).length === 0) return;
    mutatePatch(patchBody);
  }, [state, project, hasAuth, mutatePatch]);

  const steps = useMemo(() => {
    const opened = Boolean(state?.hasOpenedProject || (project && !project.isPlayground));
    const auth = Boolean(state?.hasConfiguredAuth || hasAuth);
    const firstRun = Boolean(state?.hasFirstRun);
    return {
      openProject: opened,
      addModel: auth,
      firstMessage: firstRun,
    };
  }, [state, project, hasAuth]);

  return {
    state,
    steps,
    loading: onboarding.isLoading || modelsLoading,
    hasAuth,
    showChecklist: Boolean(state && !state.completed && !state.skipped),
    skip: () => patch.mutate({ skipped: true, completed: true }),
    markOpenedProject: () => patch.mutate({ hasOpenedProject: true }),
    markConfiguredAuth: () => patch.mutate({ hasConfiguredAuth: true }),
    markFirstRun: () => patch.mutate({ hasFirstRun: true }),
    patch: (input: PatchOnboardingInput) => patch.mutate(input),
  };
}
