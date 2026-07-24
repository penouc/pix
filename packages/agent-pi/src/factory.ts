import type { AgentRuntime } from '@pi-desktop/agent-domain';

import { FakeAgentRuntime } from './fake-runtime.js';

export interface AgentRuntimeFactoryOptions {
  /** Use FakeAgentRuntime when true or when PI_DESKTOP_FAKE_RUNTIME=1. */
  forceFake?: boolean;
}

/**
 * Create the desktop AgentRuntime.
 *
 * Real Pi SDK adapter will be wired here after M1 tech validation.
 * Default remains FakeAgentRuntime so UI/E2E work offline without model cost.
 */
export function createAgentRuntime(options: AgentRuntimeFactoryOptions = {}): AgentRuntime {
  const useFake =
    options.forceFake !== false &&
    (options.forceFake === true ||
      process.env['PI_DESKTOP_FAKE_RUNTIME'] !== '0');

  // Pi SDK integration lands once package name + version are locked (plan §7.1).
  // Factory is the single switch point — PiAgentRuntime will replace the false branch.
  if (useFake) {
    return new FakeAgentRuntime();
  }

  // Real adapter not yet implemented; fall back to fake with a clear warning.
  console.warn(
    '[agent-pi] PiAgentRuntime is not implemented yet; using FakeAgentRuntime. Set forceFake/PI_DESKTOP_FAKE_RUNTIME.',
  );
  return new FakeAgentRuntime();
}
