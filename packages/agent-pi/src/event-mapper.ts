import type { DesktopAgentEvent, RiskLevel } from '@pi-desktop/protocol';

/** Minimal Pi session event shapes we care about (avoid importing Pi types into protocol). */
export type PiSessionEventLike = {
  type: string;
  [key: string]: unknown;
};

export interface MapContext {
  projectId: string;
  sessionId: string;
  runId: string;
  nextSequence: () => number;
  /** Stable message id for the current streaming assistant message. */
  ensureMessageId: () => string;
  clearMessageId: () => void;
}

/**
 * Map a Pi AgentSession event into zero or more DesktopAgentEvents.
 * Unknown event types are ignored (adapter isolation, plan §7.1).
 */
export function mapPiSessionEvent(
  event: PiSessionEventLike,
  ctx: MapContext,
): DesktopAgentEvent[] {
  const base = () => ({
    projectId: ctx.projectId,
    sessionId: ctx.sessionId,
    runId: ctx.runId,
    sequence: ctx.nextSequence(),
    timestamp: Date.now(),
  });

  switch (event.type) {
    case 'agent_start':
      // Desktop may already emit run.started when accepting the prompt.
      // Returning another run.started is harmless if sequence advances, but UI
      // treats a second run.started as a new run — skip to avoid flicker.
      return [];

    case 'message_update': {
      const assistantEvent = event['assistantMessageEvent'] as
        | { type?: string; delta?: string }
        | undefined;
      if (assistantEvent?.type === 'text_delta' && typeof assistantEvent.delta === 'string') {
        return [
          {
            type: 'message.delta',
            ...base(),
            messageId: ctx.ensureMessageId(),
            role: 'assistant',
            delta: assistantEvent.delta,
          },
        ];
      }
      return [];
    }

    case 'message_end': {
      const message = event['message'] as
        | { role?: string; content?: unknown; id?: string }
        | undefined;
      if (!message || message.role !== 'assistant') {
        return [];
      }
      const content = extractTextContent(message.content);
      const messageId = ctx.ensureMessageId();
      ctx.clearMessageId();
      return [
        {
          type: 'message.completed',
          ...base(),
          messageId,
          role: 'assistant',
          content,
        },
      ];
    }

    case 'tool_execution_start': {
      const toolCallId = String(event['toolCallId'] ?? '');
      const toolName = String(event['toolName'] ?? 'unknown');
      const args = event['args'];
      return [
        {
          type: 'tool.requested',
          ...base(),
          toolCallId,
          toolName,
          inputSummary: summarizeArgs(toolName, args),
          riskLevel: riskForTool(toolName),
        },
      ];
    }

    case 'tool_execution_update': {
      const toolCallId = String(event['toolCallId'] ?? '');
      const partial = event['partialResult'];
      const chunk =
        typeof partial === 'string'
          ? partial
          : partial != null
            ? safeJson(partial)
            : '';
      if (!chunk) return [];
      return [
        {
          type: 'tool.progress',
          ...base(),
          toolCallId,
          chunk: chunk.slice(0, 4000),
        },
      ];
    }

    case 'tool_execution_end': {
      const toolCallId = String(event['toolCallId'] ?? '');
      const toolName = String(event['toolName'] ?? 'unknown');
      const isError = Boolean(event['isError']);
      const result = event['result'];
      return [
        {
          type: 'tool.completed',
          ...base(),
          toolCallId,
          toolName,
          ok: !isError,
          outputSummary: summarizeResult(result),
        },
      ];
    }

    case 'agent_end':
      return [
        {
          type: 'run.completed',
          ...base(),
          summary: 'Pi agent run completed',
        },
      ];

    default:
      return [];
  }
}

export function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : safeJson(content);
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block);
      continue;
    }
    if (block && typeof block === 'object') {
      const rec = block as Record<string, unknown>;
      if (rec['type'] === 'text' && typeof rec['text'] === 'string') {
        parts.push(rec['text']);
      }
    }
  }
  return parts.join('');
}

function summarizeArgs(toolName: string, args: unknown): string {
  if (args == null) return toolName;
  if (typeof args === 'string') return `${toolName}: ${args.slice(0, 200)}`;
  if (typeof args === 'object') {
    const rec = args as Record<string, unknown>;
    const pathLike = rec['path'] ?? rec['file_path'] ?? rec['filePath'] ?? rec['command'];
    if (typeof pathLike === 'string') {
      return `${toolName}: ${pathLike}`;
    }
  }
  return `${toolName}: ${safeJson(args).slice(0, 200)}`;
}

function summarizeResult(result: unknown): string {
  if (result == null) return '';
  if (typeof result === 'string') return result.slice(0, 500);
  if (typeof result === 'object') {
    const rec = result as Record<string, unknown>;
    if (typeof rec['output'] === 'string') return rec['output'].slice(0, 500);
    if (typeof rec['content'] === 'string') return rec['content'].slice(0, 500);
  }
  return safeJson(result).slice(0, 500);
}

function riskForTool(toolName: string): RiskLevel {
  const name = toolName.toLowerCase();
  if (name === 'bash' || name === 'shell') return 'sensitive';
  if (name === 'write' || name === 'edit') return 'workspace-write';
  if (name === 'read' || name === 'grep' || name === 'find' || name === 'ls') return 'safe';
  return 'sensitive';
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
