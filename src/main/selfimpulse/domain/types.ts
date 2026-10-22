export const GRAPH_SCHEMA_VERSION = 2;

export type PortDirection = "input" | "output";

export type DataType =
  | "any"
  | "Text"
  | "Markdown"
  | "JSON"
  | "Object"
  | "Array"
  | "Image"
  | "File"
  | "URL"
  | "BrowserSession"
  | "AgentResult"
  | "Evaluation"
  | "Boolean"
  | "Number"
  | "Stream"
  | "Event"
  | "WorkflowContext"
  | "RepositoryContext"
  | "Error";

export interface SchemaField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface PortDefinition {
  id: string;
  label: string;
  direction: PortDirection;
  dataType: DataType;
  required: boolean;
  multiple: boolean;
  description?: string;
}

export type NodeCategory = "agent" | "control" | "capability" | "note";

export type NodeStatus =
  | "idle"
  | "queued"
  | "running"
  | "waiting"
  | "streaming"
  | "evaluating"
  | "learning"
  | "evolving"
  | "succeeded"
  | "failed"
  | "blocked"
  | "paused";

export interface RolePrompt {
  sections: {
    identity: string;
    mission: string;
    operatingPrinciples: string;
    procedures: string;
    toolStrategy: string;
    verificationStrategy: string;
    collaborationRules: string;
    learningRules: string;
    invariants: string;
  };
  version: number;
}

export type EvolutionMode = "OFF" | "SUGGEST" | "AUTONOMOUS";
export type FeedbackLoop = "ON" | "OFF";

export interface ReflectionConfig {
  enabled: boolean;
  maxAttempts: number;
  passThreshold: number;
}

export interface PermissionSet {
  filesystemRead: boolean;
  filesystemWrite: boolean;
  terminalExecute: boolean;
  networkAccess: boolean;
  browserControl: boolean;
  mcpUse: boolean;
  providerExecute: boolean;
  workflowModify: boolean;
  memoryWrite: boolean;
  skillWrite: boolean;
  evolutionPropose: boolean;
  evolutionAccept: boolean;
  secretResolve: boolean;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
}

export interface NodeContract {
  inputSchema?: SchemaField[];
  outputSchema?: SchemaField[];
  requiredCapabilities: string[];
  sideEffects: string[];
  successCriteria: string;
  failureCriteria: string;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
}

export type ProviderKind = "openai" | "anthropic" | "google" | "ollama" | "openrouter" | "builtin-agent";

export interface ProviderConfig {
  kind: ProviderKind;
  model?: string;
  secretRef?: string;
}

export interface NodeInstance {
  id: string;
  definitionId: string;
  title: string;
  x: number;
  y: number;
  purpose: string;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  config: Record<string, unknown>;
  rolePrompt: RolePrompt;
  feedbackLoop: FeedbackLoop;
  evolutionMode: EvolutionMode;
  reflection: ReflectionConfig;
  permissions: PermissionSet;
  contract: NodeContract;
  providers: ProviderConfig[];
  allowedMcpServers: string[];
  memoryEnabled: boolean;
  groupId?: string;
  color?: string;
  collapsed?: boolean;
  templateKey?: string;
}

export interface Connection {
  id: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
  dataType: DataType;
  status: "idle" | "active" | "streaming" | "completed" | "error";
}

export interface GraphViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface GraphGroup {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface GraphNote {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: string;
}

export interface WorkflowGraph {
  schemaVersion: number;
  id: string;
  name: string;
  nodes: NodeInstance[];
  connections: Connection[];
  viewport: GraphViewport;
  groups?: GraphGroup[];
  notes?: GraphNote[];
}

export type ExecutionStatus = "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "PAUSED";

export interface ExecutionStats {
  nodesRun: number;
  nodesFailed: number;
  retries: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  costUsd: number;
  evaluationScores: number[];
}

export interface ExecutionEventRecord {
  seq?: number;
  ts: string;
  kind: string;
  level: "INFO" | "DEBUG" | "WARN" | "ERROR" | "AUDIT" | "SECURITY" | "EVOLUTION";
  nodeId?: string | null;
  executionId?: string;
  data: Record<string, unknown>;
}

export interface MemoryRecord {
  id: string;
  nodeKey: string;
  kind: "working" | "persistent" | "episodic" | "procedural" | "failure";
  content: string;
  tags: string[];
  importance: number;
  createdAt: string;
  relevance?: number;
}

export interface SkillRecord {
  id: string;
  nodeKey: string;
  name: string;
  description: string;
  procedure: string;
  preconditions: string;
  toolStrategy: string;
  verificationStrategy: string;
  knownFailureModes: string;
  version: number;
  score: number | null;
  origin: "seed" | "learned" | "evolution" | "user";
  active: boolean;
  createdAt: string;
  updatedAt: string;
  applications?: number;
  lastUsedAt?: string | null;
}

export interface FeedbackRecord {
  id: string;
  executionId: string;
  nodeKey: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface EvaluationCase {
  id: string;
  name: string;
  input: string;
  expectedContains?: string[];
  expectedNotContains?: string[];
  minScore: number;
}

export interface EvolutionCandidateRecord {
  id: string;
  nodeKey: string;
  parentVersion: number;
  candidateVersion: number;
  trigger: string;
  evidence: string[];
  changes: { rolePrompt?: Partial<RolePrompt["sections"]>; skill?: Partial<SkillRecord> };
  baselineScore: number | null;
  candidateScore: number | null;
  holdoutPassed: boolean | null;
  regressionPassed: boolean | null;
  status: "PROPOSED" | "DECIDED" | "ROLLED_BACK";
  decision: "PENDING" | "ACCEPTED" | "REJECTED";
  createdAt: string;
  decidedAt: string | null;
}

export interface McpServerEntry {
  id: string;
  name: string;
  transport: "stdio" | "streamable-http";
  config: {
    transport: string;
    command?: string | null;
    args?: string[] | null;
    url?: string | null;
    headerKeys?: string[] | null;
    enabled?: boolean;
    pinned?: boolean;
    /**
     * Whether the sandboxed server may reach the network. DEFAULT TRUE (MCP servers are network
     * clients by nature); `false` runs it with no network at all. It is part of what a human
     * approves at the native dialog, so changing it asks again.
     */
    network?: boolean;
  };
  state: "AVAILABLE" | "INSTALLED" | "ENABLED" | "AUTHORIZED" | "ERROR";
  /**
   * COMPUTED NATIVELY on every list: true only if a human approved exactly this program at a
   * native dialog and it has not changed since. Never taken from what the page stored.
   */
  approved?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CliProviderEntry {
  id: string;
  name: string;
  executable: string | null;
  installed: boolean;
  version: string | null;
  auth_state: string;
  capabilities: string[];
  invocation: string;
}


export interface WorkflowRecord {
  id: string;
  name: string;
  description: string;
  graph: WorkflowGraph;
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
  tags?: string[];
}

export interface ExecutionRecord {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: ExecutionStatus;
  startedAt: string;
  endedAt: string | null;
  error: string | null;
  stats: ExecutionStats;
}

export interface ApprovalRecord {
  id: string;
  executionId: string;
  nodeKey: string;
  summary: string;
  payload: Record<string, unknown>;
  status: "OPEN" | "APPROVED" | "REJECTED";
  createdAt: string;
  /**
   * C-2 (security review, archive 4): approver-authority binding.
   * `requestedBy`/`authority` are bound at request time; a decision must
   * present a capability minted through the interactive confirm/native
   * dialog (`approval_authorize`), bound to one verdict with a freshness
   * window. `capability` holds the minted token in the web mirror only —
   * it is never included in list output.
   */
  requestedBy?: string;
  authority?: string;
  capability?: string;
  capExpiresAt?: number;
  capDecision?: string;
  decidedBy?: string;
  decidedAt?: string;
}

export interface DlqRecord {
  id: string;
  executionId: string;
  nodeKey: string;
  error: string;
  payload: Record<string, unknown>;
  status: "OPEN" | "RESOLVED";
  suggestedCause: string;
  candidateFix: string;
  createdAt: string;
}

/** v12.0.0 — the product's destinations are exactly the engine and its doors.
 *  Every other page the app ever shipped was consolidated INTO these (see
 *  docs/INFORMATION-ARCHITECTURE.md §12.0): legacy feature pages remain in the
 *  source tree only where probes still exercise them and are not navigable.
 *  15.0.0 (SelfImpulse) adds the sixth door: "teammate" — the named human
 *  face over the same engine. */
export type PageKind =
  | "teammate"
  | "loop"
  | "workflow"
  | "proof"
  | "audit"
  | "settings";
