import type { ModelCatalogEntry } from '@pi-desktop/agent-domain';
import type { AutoModelConfig, ModelRef } from '@pi-desktop/protocol';

/** Which tier an Auto run is on. Plan Mode asks for the strong tier. */
export type AutoRole = 'default' | 'plan';

/** Why an Auto run abandoned its current model mid-turn. */
export type AutoSwitchReason = 'rate-limit' | 'timeout' | 'quota' | 'error';

/**
 * Decide whether a failed run is worth retrying on the next model in the
 * chain, and why.
 *
 * Auth / configuration failures are deliberately excluded: switching models
 * cannot fix a missing key, and reporting it as a switch would bury the real
 * problem. Context-overflow is Pi's compaction job, not a model problem.
 */
export function classifyAutoSwitchError(error: unknown): AutoSwitchReason | null {
  const message = error instanceof Error ? error.message : String(error);
  const text = message.toLowerCase();
  if (!text) return null;
  if (/api key|auth|credential|login|no model|not found|invalid request/i.test(text)) {
    return null;
  }
  if (/context.?overflow|context window|too long|max tokens/i.test(text)) return null;
  if (/rate limit|429|too many|overload|exhausted|capacity/i.test(text)) return 'rate-limit';
  if (/quota|402|payment|billing|limit exceeded|insufficient/i.test(text)) return 'quota';
  if (/timeout|timed out|deadline|408|ecpnnect|network/i.test(text)) return 'timeout';
  if (/5\d\d|server error|service unavailable|bad gateway|internal error/i.test(text)) {
    return 'error';
  }
  return null;
}

export function modelRefKey(ref: ModelRef): string {
  return `${ref.providerId}/${ref.modelId}`;
}

export function modelRefFromKey(key: string): ModelRef {
  const slash = key.indexOf('/');
  if (slash <= 0 || slash === key.length - 1) {
    throw new Error(`Invalid model key: ${key}`);
  }
  return { providerId: key.slice(0, slash), modelId: key.slice(slash + 1) };
}

/**
 * Derived candidate order for a role, from the live catalogue.
 *
 * Default role: cheapest runnable first — the “打杂” tier. Plan role:
 * reasoning-capable first, cheapest within a tier. Ties break by name so the
 * order is deterministic.
 */
export function deriveAutoCandidates(
  models: ModelCatalogEntry[],
  role: AutoRole,
): ModelRef[] {
  return models
    .filter((model) => model.hasAuth === true)
    .map((model) => ({
      ref: { providerId: model.providerId, modelId: model.modelId },
      cost: (model.inputCostPerMTok ?? 0) + (model.outputCostPerMTok ?? 0),
      reasoning: model.reasoning === true,
      name: `${model.providerId}/${model.modelId}`,
    }))
    .sort((a, b) => {
      if (role === 'plan' && a.reasoning !== b.reasoning) {
        return a.reasoning ? -1 : 1;
      }
      if (a.cost !== b.cost) return a.cost - b.cost;
      return a.name.localeCompare(b.name);
    })
    .map((entry) => entry.ref);
}

/**
 * Resolves Auto (#21) to a concrete model: role pins → configured fallback
 * chain → derived catalogue order. Runnable-only: models without credentials
 * are skipped at every step, so a stale pin never 429s on auth.
 */
export class AutoModelRouter {
  constructor(
    private readonly config: AutoModelConfig | undefined,
    private readonly models: ModelCatalogEntry[],
  ) {}

  /** The full ordered chain for a role, deduplicated. */
  chain(role: AutoRole): ModelRef[] {
    const config = this.config ?? {};
    const seen = new Set<string>();
    const out: ModelRef[] = [];
    const push = (key: string) => {
      if (seen.has(key)) return;
      let ref: ModelRef;
      try {
        ref = modelRefFromKey(key);
      } catch {
        return;
      }
      if (!this.models.some((model) => modelKeyMatch(model, ref) && model.hasAuth === true)) {
        return;
      }
      seen.add(key);
      out.push(ref);
    };

    const pinKey = role === 'plan' ? config.planKey : config.defaultKey;
    if (pinKey) push(pinKey);
    for (const key of config.fallbackKeys ?? []) push(key);
    for (const ref of deriveAutoCandidates(this.models, role)) {
      push(modelRefKey(ref));
    }
    return out;
  }

  /** First runnable candidate for a role, skipping `avoid` when given. */
  resolve(role: AutoRole, avoid?: ModelRef): ModelRef | null {
    const avoidKey = avoid ? modelRefKey(avoid) : null;
    for (const ref of this.chain(role)) {
      if (avoidKey && modelRefKey(ref) === avoidKey) continue;
      return ref;
    }
    return null;
  }

  /** The candidate strictly after `current` in the role's chain. */
  next(role: AutoRole, current: ModelRef): ModelRef | null {
    const chain = this.chain(role);
    const currentKey = modelRefKey(current);
    const index = chain.findIndex((ref) => modelRefKey(ref) === currentKey);
    if (index < 0) return chain[0] ?? null;
    return chain[index + 1] ?? null;
  }
}

function modelKeyMatch(
  model: Pick<ModelCatalogEntry, 'providerId' | 'modelId'>,
  ref: ModelRef,
): boolean {
  return model.providerId === ref.providerId && model.modelId === ref.modelId;
}
