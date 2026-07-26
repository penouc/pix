import type { ModelInfo } from '@pi-desktop/protocol';

export function modelKey(model: Pick<ModelInfo, 'providerId' | 'modelId'>): string {
  return `${model.providerId}/${model.modelId}`;
}
