import type { AgentError } from '@pi-desktop/protocol';

export class DomainError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(error: AgentError) {
    super(error.message);
    this.name = 'DomainError';
    this.code = error.code;
    this.retryable = error.retryable;
    this.details = error.details;
  }

  toAgentError(): AgentError {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      details: this.details,
    };
  }
}

export function agentError(
  code: string,
  message: string,
  options?: { retryable?: boolean; details?: unknown },
): AgentError {
  return {
    code,
    message,
    retryable: options?.retryable ?? false,
    details: options?.details,
  };
}
