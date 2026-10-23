/**
 * ImpulseCore agent — core types.
 *
 * ImpulseCore is the agent core. Its design is ported from an MIT-licensed
 * upstream (see THIRD-PARTY-NOTICES.md) and modelled exactly as upstream: a
 * phase machine driven by an iteration budget, with stop gates that can override
 * a text answer and continue the turn, and a post-turn background review that
 * closes the learning loop.
 */

/** What a phase tells the loop to do next. */
export type PhaseAction = "return" | "break" | "continue" | "next";

export interface PhaseResult<T = unknown> {
  action: PhaseAction;
  result?: T;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  output?: unknown;
  error?: string;
  /** set by tool implementations that changed the workspace (drives the verify gates) */
  mutatedPaths?: string[];
}

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  /** seamoon: synthetic rows injected by the agent itself (nudges, interim answers) */
  synthetic?: boolean;
  name?: string;
}

export interface ModelResponse {
  text: string | null;
  toolCalls: ToolCall[];
  usage?: { prompt?: number; completion?: number; total?: number };
  finishReason?: string;
}

export interface MemoryRecord {
  id: string;
  text: string;
  scope: string;
  tags: string[];
  createdAt: number;
}

export interface SkillBundle {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  platforms: string[];
  tags: string[];
  body: string;
  path?: string;
  pinned?: boolean;
  archived?: boolean;
  createdAt: number;
  updatedAt: number;
  useCount?: number;
  lastUsedAt?: number;
}

/**
 * The collaborators the agent needs. Everything external is injected, which keeps
 * the core pure TypeScript and testable without a model or a filesystem.
 */
export interface ImpulsePorts {
  /** One chat-completion call. */
  callModel(messages: ModelMessage[], options: CallOptions): Promise<ModelResponse>;
  /** The tools the model may call this turn. */
  listTools(): ToolSpec[];
  /** Execute one tool. */
  runTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  /** Durable memory. */
  memory: {
    list(scope?: string): Promise<MemoryRecord[]>;
    add(record: Omit<MemoryRecord, "id" | "createdAt">): Promise<MemoryRecord>;
    remove(id: string): Promise<boolean>;
    search(query: string, limit?: number): Promise<MemoryRecord[]>;
    summarize(records: MemoryRecord[]): Promise<string>;
  };
  /** Skill bundles, in the agentskills.io format. */
  skills: {
    list(): Promise<SkillBundle[]>;
    read(id: string): Promise<SkillBundle | null>;
    write(bundle: SkillBundle): Promise<SkillBundle>;
    remove(id: string): Promise<boolean>;
    setPinned(id: string, pinned: boolean): Promise<void>;
  };
  /** Events out to the UI. */
  emit(event: string, payload: unknown): void;
  now(): number;
}

export interface CallOptions {
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ImpulseConfig {
  /** Parent iteration cap (upstream default: 500). */
  maxIterations: number;
  /** Sub-agent iteration cap (upstream default: 50). */
  delegationMaxIterations: number;
  /** Iterations without a skill use before the skill nudge fires. 0 disables it. */
  skillNudgeInterval: number;
  /** Iterations without a memory write before the memory nudge fires. 0 disables it. */
  memoryNudgeInterval: number;
  /** Verify-on-stop: keep the turn alive until the edited files check out. */
  verifyOnStop: boolean;
  /** The pre-verify hook: a plugin may keep the turn alive one more round after edits. */
  preVerifyContinue: boolean;
  /** Terminal-tool guard for board workers. */
  kanbanTerminalTool: boolean;
  /** Late language-server verdicts on this turn's edits. */
  lateLspVerdicts: boolean;
  /** Run the post-turn background review (memory + skills). */
  backgroundReview: boolean;
  temperature: number;
  maxOutputTokens: number;
  /** Cap on the background review's own iterations. */
  reviewMaxIterations: number;
}

export const DEFAULT_MOONWRIGHT_CONFIG: ImpulseConfig = {
  maxIterations: 500,
  delegationMaxIterations: 50,
  skillNudgeInterval: 10,
  memoryNudgeInterval: 15,
  verifyOnStop: true,
  preVerifyContinue: true,
  kanbanTerminalTool: false,
  lateLspVerdicts: true,
  backgroundReview: true,
  temperature: 0.2,
  maxOutputTokens: 4096,
  reviewMaxIterations: 12,
};

export interface LoopState {
  turnId: string;
  messages: ModelMessage[];
  apiCallCount: number;
  finalResponse: string | null;
  /** The candidate answer a stop gate held back while it nudged the turn onwards. */
  pendingVerificationResponse: string | null;
  pendingVerificationResponsePreviewed: boolean;
  /** Paths the turn mutated — the verify gates look at these. */
  mutatedPaths: string[];
  iterationsSinceSkill: number;
  iterationsSinceMemory: number;
  skillUsedThisTurn: boolean;
  memoryWrittenThisTurn: boolean;
  stopGateNudges: number;
  budgetGraceCall: boolean;
  toolCalls: number;
  usage: { prompt: number; completion: number; total: number };
}

export interface TurnResult {
  finalResponse: string | null;
  messages: ModelMessage[];
  apiCallCount: number;
  usage: { prompt: number; completion: number; total: number };
  toolCalls: number;
  stopReason:
    | "final"
    | "max_iterations"
    | "budget_exhausted"
    | "interrupted"
    | "error"
    | "prelude_break";
  error?: string;
  /** The background review that was spawned for this turn, if any. */
  review?: { memory: boolean; skills: boolean };
}
