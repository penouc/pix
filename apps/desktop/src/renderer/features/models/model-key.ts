import type { ModelInfo } from '@pi-desktop/protocol';

export function modelKey(model: Pick<ModelInfo, 'providerId' | 'modelId'>): string {
  return `${model.providerId}/${model.modelId}`;
}

/**
 * The workspace-store sentinel for Auto model routing (#21).
 *
 * Deliberately a string that can never be a real `providerId/modelId` key, so
 * every consumer that splits on '/' treats it as “not a concrete model”.
 */
export const AUTO_MODEL_KEY = '__auto__';
