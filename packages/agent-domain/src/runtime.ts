import type {
  ApprovalDecision,
  DesktopAgentEvent,
  ModelRef,
  RunRef,
} from '@pi-desktop/protocol';

export interface CreateSessionOptions {
  projectId: string;
  projectPath: string;
  title?: string;
  model?: ModelRef;
}

export interface AgentSession {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface AgentInput {
  text: string;
  model?: ModelRef;
}

export type AgentEventListener = (event: DesktopAgentEvent) => void;

/**
 * Desktop-owned AgentRuntime boundary (plan §7).
 * Pi SDK types must never leak past implementers of this interface.
 */
export interface AgentRuntime {
  createSession(options: CreateSessionOptions): Promise<AgentSession>;
  resumeSession(sessionId: string): Promise<AgentSession>;
  sendMessage(sessionId: string, input: AgentInput): Promise<RunRef>;
  steer(runId: string, input: AgentInput): Promise<void>;
  followUp(sessionId: string, input: AgentInput): Promise<void>;
  abort(runId: string): Promise<void>;
  setModel(sessionId: string, model: ModelRef): Promise<void>;
  approve(requestId: string, decision: ApprovalDecision): Promise<void>;
  listModels(): Promise<Array<{ providerId: string; modelId: string; displayName: string }>>;
  subscribe(listener: AgentEventListener): () => void;
  dispose(): Promise<void>;
}
