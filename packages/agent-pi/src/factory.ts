import type { AgentRuntime } from '@pi-desktop/agent-domain';

import { FakeAgentRuntime } from './fake-runtime.js';
import { PiAgentRuntime, type PiAgentRuntimeOptions } from './pi-runtime.js';

export interface AgentRuntimeFactoryOptions extends PiAgentRuntimeOptions {
  /**
   * Force FakeAgentRuntime.
   * Default: real Pi when available unless PI_DESKTOP_FAKE_RUNTIME=1.
   */
  forceFake?: boolean;
}

/**
 * Single switch point for desktop AgentRuntime (plan §7.1).
 *
 * - `PI_DESKTOP_FAKE_RUNTIME=1` → FakeAgentRuntime
 * - `forceFake: true` → FakeAgentRuntime
 * - otherwise → PiAgentRuntime (locked SDK 0.83.0)
 */
export function createAgentRuntime(options: AgentRuntimeFactoryOptions = {}): AgentRuntime {
  const envFake =
    process.env['PI_DESKTOP_FAKE_RUNTIME'] === '1' ||
    process.env['PI_DESKTOP_FAKE_RUNTIME'] === 'true';

  if (options.forceFake === true || envFake) {
    return new FakeAgentRuntime();
  }

  return new PiAgentRuntime({
    agentDir: options.agentDir,
    allowModelNetwork: options.allowModelNetwork,
  });
}
