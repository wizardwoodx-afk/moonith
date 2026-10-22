/**
 * VH 6.0 — Mission & Organization types.
 *
 * V6 adds a layer ON TOP of V5. Nothing here replaces the V5 graph: the graph remains the
 * authoritative execution structure, and the organization is a projection of it (§30).
 *
 *   V5:  node -> workflow -> execution
 *   V6:  mission -> organization -> plan -> graph -> execution -> verification
 */

import type { NodeInstance, WorkflowGraph } from "../domain/types";
import type { HarnessId } from "../domain/harness";

/* ------------------------------------------------------------------ §1 Mission */

export type MissionStatus =
  | "DRAFT"
  | "PLANNING"
  | "READY"
  | "RUNNING"
  | "PAUSED"
  | "BLOCKED"
  | "REPAIRING"
  | "VERIFYING"
  | "COMPLETED"
  | "FAILED";

/** Ordered lifecycle; every transition is validated against this. */
export const MISSION_TRANSITIONS: Record<MissionStatus, MissionStatus[]> = {
  DRAFT: ["PLANNING", "FAILED"],
  PLANNING: ["READY", "BLOCKED", "FAILED"],
  READY: ["RUNNING", "DRAFT", "FAILED"],
  RUNNING: ["PAUSED", "BLOCKED", "REPAIRING", "VERIFYING", "COMPLETED", "FAILED"],
  PAUSED: ["RUNNING", "BLOCKED", "FAILED"],
  BLOCKED: ["REPAIRING", "RUNNING", "PAUSED", "FAILED"],
  REPAIRING: ["RUNNING", "BLOCKED", "VERIFYING", "FAILED"],
  VERIFYING: ["COMPLETED", "REPAIRING", "BLOCKED", "FAILED"],
  COMPLETED: [],
  FAILED: ["DRAFT"],
};

export function canTransition(from: MissionStatus, to: MissionStatus): boolean {
  return MISSION_TRANSITIONS[from].includes(to);
}

/* ------------------------------------------------------------------ §10 Risk */

export type RiskClass = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export const RISK_ORDER: RiskClass[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export function riskAtLeast(a: RiskClass, b: RiskClass): boolean {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b);
}

/* ------------------------------------------------------------------ §11 Autonomy */

export type AutonomyMode = "AUTONOMOUS" | "SUPERVISED" | "HUMAN_ONLY";

export type ApprovalDecision = "PENDING" | "APPROVED" | "REJECTED" | "TIMED_OUT";

export interface ApprovalRequest {
  id: string;
  missionId: string;
  /** Who asked. */
  requestedBy: string;
  /** Which agent role, if any. */
  agentId: string | null;
  action: string;
  risk: RiskClass;
  /** WHAT IS ABOUT TO HAPPEN */
  summary: string;
  /** WHY IT IS REQUIRED */
  justification: string;
  /** WHAT WILL CHANGE */
  changes: string[];
  evidence: string[];
  expectedOutcome: string;
  /** Set when the action would be irreversible. */
  reversible: boolean;
  status: ApprovalDecision;
  decidedBy: string | null;
  reason: string | null;
  createdAt: string;
  decidedAt: string | null;
}

/* ------------------------------------------------------------------ §1 Mission */

export interface MissionBudget {
  maxCostUsd: number;
  maxTokens: number;
  maxWallClockMs: number;
  maxConcurrentAgents: number;
  maxRetriesPerTask: number;
  maxBrowserSessions: number;
  maxGraphMutations: number;
}

export const DEFAULT_BUDGET: MissionBudget = {
  maxCostUsd: 10,
  maxTokens: 2_000_000,
  maxWallClockMs: 60 * 60 * 1000,
  maxConcurrentAgents: 4,
  maxRetriesPerTask: 3,
  maxBrowserSessions: 2,
  maxGraphMutations: 8,
};

export interface MissionPolicy {
  autonomy: AutonomyMode;
  /** Actions at or above this risk class always require a human, regardless of autonomy. */
  approvalThreshold: RiskClass;
  /** Allow the runtime to mutate the graph without a human, when policy permits. */
  allowGraphMutation: boolean;
  /** Allow the runtime to change the roster without a human. */
  allowReorganization: boolean;
  /** Allow the runtime to switch harness without a human. */
  allowHarnessSwitch: boolean;
  /** Spend one extra model call to measure a candidate before accepting it. */
  measureCandidates: boolean;
}

export const DEFAULT_POLICY: MissionPolicy = {
  autonomy: "SUPERVISED",
  approvalThreshold: "HIGH",
  allowGraphMutation: true,
  allowReorganization: true,
  allowHarnessSwitch: true,
  measureCandidates: true,
};

/** §33 — mission-level security boundary. Agents inherit only what is granted here. */
export interface SecurityBoundary {
  filesystemRead: boolean;
  filesystemWrite: boolean;
  shell: boolean;
  network: boolean;
  browser: boolean;
  mcp: boolean;
  credentials: boolean;
  repositories: string[];
  deploymentTargets: string[];
  /** Absolute path prefixes the mission may touch. Empty = the app workspace only. */
  allowedPaths: string[];
  deniedPaths: string[];
}

export const DEFAULT_BOUNDARY: SecurityBoundary = {
  filesystemRead: true,
  filesystemWrite: true,
  shell: true,
  network: true,
  browser: false,
  mcp: true,
  credentials: false,
  repositories: [],
  deploymentTargets: [],
  allowedPaths: [],
  deniedPaths: [],
};

export interface Mission {
  missionId: string;
  name: string;
  objective: string;
  description: string;
  constraints: string[];
  successCriteria: string[];
  deadline: string | null;
  budget: MissionBudget;
  riskPolicy: MissionPolicy;
  boundary: SecurityBoundary;
  allowedHarnesses: HarnessId[];
  allowedTools: string[];
  allowedMcpServers: string[];
  allowedAgents: string[];
  preferredFramework: string | null;
  workspace: string;
  templateId: string | null;
  priority: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
  status: MissionStatus;
  /** The workflow this mission drives. The graph stays the execution authority (§30). */
  workflowId: string | null;
  graphVersion: number;
  checkpointId: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

/* ------------------------------------------------------------------ §2 Plan */

export type PlanStepKind = "research" | "architecture" | "implementation" | "test" | "security" | "review" | "approval" | "synthesis" | "release";

export interface PlanStep {
  id: string;
  kind: PlanStepKind;
  title: string;
  agentDefId: string;
  purpose: string;
  /** Hard requirements used by the arbitrator (§6). */
  requiredCapabilities: string[];
  languages: string[];
  /** Preferred harness; null means "let the arbitrator decide". */
  preferredHarness: HarnessId | null;
  /** Steps that must complete first. */
  dependsOn: string[];
  estimatedCostUsd: number;
  estimatedMs: number;
  risk: RiskClass;
  requiresApproval: boolean;
  /** Why this step is in the plan — shown in the inspectable plan UI. */
  rationale: string;
}

export interface MissionPlan {
  planId: string;
  missionId: string;
  version: number;
  frameworkId: string;
  steps: PlanStep[];
  verificationStrategy: string[];
  approvalCheckpoints: string[];
  estimatedCostUsd: number;
  estimatedMs: number;
  requiresBrowser: boolean;
  workspaceRequirements: string[];
  warnings: string[];
  createdAt: string;
}

/* ------------------------------------------------------------------ §3 Organization */

export type AgentState = "IDLE" | "ACTIVE" | "PAUSED" | "FAILED" | "DONE" | "REPLACED" | "REMOVED";

export type TaskState = "PENDING" | "ASSIGNED" | "RUNNING" | "BLOCKED" | "DONE" | "FAILED" | "CANCELLED";

export type TaskClass = "PARALLEL_SAFE" | "SEQUENTIAL" | "DEPENDENCY_BOUND" | "EXCLUSIVE" | "APPROVAL_GATED";

export interface OrgTask {
  taskId: string;
  missionId: string;
  title: string;
  description: string;
  agentId: string | null;
  state: TaskState;
  cls: TaskClass;
  dependsOn: string[];
  blockedBy: string | null;
  attempts: number;
  maxAttempts: number;
  risk: RiskClass;
  planStepId: string | null;
  nodeId: string | null;
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  parentTaskId: string | null;
  createdAt: string;
  updatedAt: string;
  error: string | null;
}

export interface OrgAgent {
  agentId: string;
  missionId: string;
  definitionId: string;
  title: string;
  /** §9 — the contract this agent is bound by for this mission. */
  contract: AgentContract;
  harness: HarnessId | null;
  state: AgentState;
  nodeId: string | null;
  spawnedAt: string;
  replacedBy: string | null;
  /** How this agent came to exist. Governance (§32). */
  spawnedBy: "planner" | "supervisor" | "repair" | "human";
  spawnReason: string;
  taskIds: string[];
  stats: {
    tasksDone: number;
    tasksFailed: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    medianMs: number;
  };
}

/* ------------------------------------------------------------------ §9 Contracts */

export interface AgentContract {
  identity: string;
  purpose: string;
  capabilities: string[];
  inputs: string[];
  outputs: string[];
  permissions: GrantedPermissions;
  budgetUsd: number;
  timeoutMs: number;
  successCriteria: string[];
  failurePolicy: "RETRY" | "REASSIGN" | "SWITCH_HARNESS" | "ESCALATE";
  escalationPolicy: "SUPERVISOR" | "HUMAN";
}

export interface GrantedPermissions {
  filesystemRead: boolean;
  filesystemWrite: boolean;
  shell: boolean;
  network: boolean;
  browser: boolean;
  mcp: boolean;
  credentials: boolean;
  memoryWrite: boolean;
  skillWrite: boolean;
  /** May this agent ask for a graph mutation? (Never may it apply one.) */
  proposeGraphMutation: boolean;
}

/* ------------------------------------------------------------------ §4 Graph mutation */

export type MutationAuthority = "SUPERVISOR" | "HUMAN" | "POLICY" | "REPAIR";

export interface GraphMutation {
  mutationId: string;
  missionId: string;
  fromGraphVersion: number;
  toGraphVersion: number;
  reason: string;
  /** The observed evidence that triggered it. */
  evidence: string[];
  requestedBy: string;
  authority: MutationAuthority;
  policyCheck: { passed: boolean; failures: string[] };
  evaluation: { passed: boolean; detail: string } | null;
  regression: { passed: boolean; detail: string } | null;
  rollbackTargetVersion: number;
  graphSnapshotBefore: WorkflowGraph;
  appliedAt: string;
  applied: boolean;
}

/* ------------------------------------------------------------------ §12 Artifacts */

export type ArtifactApprovalState = "NONE" | "PENDING" | "APPROVED" | "REJECTED";

export interface ArtifactProvenance {
  missionId: string;
  taskId: string | null;
  agentId: string | null;
  agentTitle: string;
  harness: HarnessId | null;
  model: string | null;
  toolsUsed: string[];
  mcpServersUsed: string[];
  costUsd: number;
  latencyMs: number;
  startedAt: string;
  finishedAt: string;
}

export interface Artifact {
  artifactId: string;
  missionId: string;
  version: number;
  /** Version 1 of a logical artifact shares this with all its successors. */
  lineageRoot: string;
  name: string;
  content: string;
  contentType: "text" | "markdown" | "json" | "code" | "diff" | "report" | "binary-ref";
  createdBy: string;
  modifiedBy: string;
  parentArtifactIds: string[];
  inputs: string[];
  provenance: ArtifactProvenance;
  evaluation: ArtifactEvaluation | null;
  approvalState: ArtifactApprovalState;
  approvalId: string | null;
  /** Version to restore if this one is rolled back. */
  rollbackTargetVersion: number | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ §18 Evaluation */

export type EvidenceSource = "AGENT_SELF_REPORT" | "TEST_RUN" | "STATIC_CHECK" | "SECURITY_CHECK" | "INDEPENDENT_REVIEW" | "REGRESSION_SUITE" | "HUMAN";

export interface EvaluationCheck {
  id: string;
  name: string;
  source: EvidenceSource;
  passed: boolean;
  /** 0..1. Null when the check could not be measured. */
  score: number | null;
  detail: string;
  /** False when the check was skipped or unavailable — never silently counted as a pass. */
  measured: boolean;
  evidence: string[];
}

export interface ArtifactEvaluation {
  evaluationId: string;
  artifactId: string;
  checks: EvaluationCheck[];
  passed: boolean;
  /** True only when every required check was actually measured. */
  fullyMeasured: boolean;
  /** Names of checks that were required but not measured. */
  unmeasured: string[];
  decidedAt: string;
}

/* ------------------------------------------------------------------ §19 Mission score */

export interface MissionScore {
  goalCompletion: number;
  quality: number;
  tests: number;
  security: number;
  costEfficiency: number;
  latencyEfficiency: number;
  humanInterventions: number;
  regressionCount: number;
  /** Dimensions that could not be measured — surfaced, never averaged away. */
  unmeasured: string[];
}

/* ------------------------------------------------------------------ §15/§16 Failure + repair */

export type FailureKind =
  | "REPEATED_FAILURE"
  | "TIMEOUT_LOOP"
  | "TOOL_FAILURE_LOOP"
  | "DUPLICATE_WORK"
  | "CONTRADICTORY_OUTPUT"
  | "AGENT_STARVATION"
  | "DEPENDENCY_DEADLOCK"
  | "BUDGET_EXHAUSTION"
  | "PERMISSION_DENIAL"
  | "INVALID_ARTIFACT_STATE"
  | "REGRESSION"
  | "MISSING_CAPABILITY"
  | "STALL";

export interface FailureSignal {
  id: string;
  missionId: string;
  kind: FailureKind;
  severity: "INFO" | "WARN" | "ERROR" | "CRITICAL";
  subject: string;
  detail: string;
  evidence: string[];
  detectedAt: string;
  resolvedBy: string | null;
}

export type RepairStrategy =
  | "RETRY"
  | "ENRICH_CONTEXT"
  | "SWITCH_HARNESS"
  | "SPAWN_SPECIALIST"
  | "SPLIT_TASK"
  | "REDUCE_SCOPE"
  | "ROLLBACK_CHECKPOINT"
  | "REORGANIZE"
  | "ESCALATE_HUMAN";

export interface RepairAttempt {
  attemptId: string;
  missionId: string;
  taskId: string;
  failureId: string;
  strategy: RepairStrategy;
  order: number;
  /** Why this strategy was selected over the others. */
  rationale: string;
  /** What actually changed. */
  changes: string[];
  expectedImprovement: string;
  result: "PENDING" | "SUCCESS" | "FAILURE";
  detail: string;
  costUsd: number;
  startedAt: string;
  finishedAt: string | null;
}

/* ------------------------------------------------------------------ §26 Checkpoints */

export interface Checkpoint {
  checkpointId: string;
  missionId: string;
  label: string;
  reason: string;
  graphVersion: number;
  graphSnapshot: WorkflowGraph;
  taskStates: Record<string, TaskState>;
  artifactVersions: Record<string, number>;
  roster: Array<{ agentId: string; definitionId: string; state: AgentState }>;
  pendingApprovalIds: string[];
  spentUsd: number;
  createdAt: string;
}

/* ------------------------------------------------------------------ §14 Flight recorder */

export type FlightEventKind =
  | "MISSION_CREATED"
  | "MISSION_PLANNED"
  | "MISSION_STATUS"
  | "MISSION_CHECKPOINTED"
  | "MISSION_ROLLED_BACK"
  | "MISSION_COMPLETED"
  | "MISSION_FAILED"
  | "AGENT_SPAWNED"
  | "AGENT_ASSIGNED"
  | "AGENT_REPLACED"
  | "AGENT_PAUSED"
  | "AGENT_RESUMED"
  | "AGENT_FAILED"
  | "AGENT_RECOVERED"
  | "TASK_DELEGATED"
  | "TASK_REASSIGNED"
  | "TASK_SPLIT"
  | "TASK_MERGED"
  | "TASK_COMPLETED"
  | "HARNESS_SELECTED"
  | "HARNESS_SWITCHED"
  | "GRAPH_MUTATED"
  | "ARTIFACT_CREATED"
  | "ARTIFACT_VERSIONED"
  | "EVALUATION_STARTED"
  | "EVALUATION_PASSED"
  | "EVALUATION_FAILED"
  | "NEGOTIATION_OPENED"
  | "NEGOTIATION_POSITION"
  | "NEGOTIATION_RESOLVED"
  | "REPAIR_STARTED"
  | "REPAIR_COMPLETED"
  | "RECOMMENDATION_EXECUTED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_GRANTED"
  | "APPROVAL_REJECTED"
  | "FAILURE_DETECTED"
  | "RESOURCE_LIMIT"
  | "POLICY_DENIED";

export interface FlightEvent {
  seq: number;
  missionId: string;
  ts: string;
  kind: FlightEventKind;
  /** §32 governance — who acted and under what authority. */
  actor: string;
  authority: string;
  policy: string;
  reason: string;
  evidence: string[];
  subjectId: string | null;
  data: Record<string, unknown>;
}

/* ------------------------------------------------------------------ §8 Negotiation */

export type NegotiationPositionKind = "PROPOSE" | "ACCEPT" | "REJECT" | "CHALLENGE" | "CLARIFY" | "ALTERNATIVE";

export interface NegotiationPosition {
  positionId: string;
  threadId: string;
  agentId: string;
  agentTitle: string;
  kind: NegotiationPositionKind;
  statement: string;
  evidence: string[];
  /** Set on ALTERNATIVE. */
  proposal: string | null;
  at: string;
}

export type NegotiationResolution = "AGREED" | "SUPERVISOR_DECIDED" | "ESCALATED_HUMAN" | "UNRESOLVED";

export interface NegotiationThread {
  threadId: string;
  missionId: string;
  taskId: string | null;
  topic: string;
  positions: NegotiationPosition[];
  resolution: NegotiationResolution | null;
  decidedBy: string | null;
  decisionRationale: string | null;
  openedAt: string;
  closedAt: string | null;
}

/* ------------------------------------------------------------------ §6/§7 Arbitration */

export interface HarnessCapabilityProfile {
  id: HarnessId;
  languages: string[];
  strengths: string[];
  canEditFiles: boolean;
  canRunTests: boolean;
  /** Null = not installed on this machine. */
  installed: boolean | null;
  notes: string;
}

export interface HarnessRunRecord {
  id: string;
  missionId: string;
  harness: HarnessId;
  taskId: string;
  taskKind: PlanStepKind;
  languages: string[];
  repository: string;
  success: boolean;
  /** True only when an independent check confirmed the outcome. */
  independentlyVerified: boolean;
  latencyMs: number;
  costUsd: number;
  failureKind: FailureKind | null;
  at: string;
}

export interface HarnessStats {
  harness: HarnessId;
  runs: number;
  successRate: number;
  verifiedSuccessRate: number;
  medianLatencyMs: number;
  totalCostUsd: number;
  byTaskKind: Record<string, { runs: number; successRate: number; medianLatencyMs: number }>;
  byLanguage: Record<string, { runs: number; successRate: number }>;
}

export interface ArbitrationDecision {
  /** AgentRuntimeId — may be "local-test", the labelled simulation. */
  chosen: string;
  scores: Array<{ harness: string; score: number; components: Record<string, number> }>;
  rationale: string[];
  rejected: Array<{ harness: string; reason: string }>;
  usedHistoricalEvidence: boolean;
  /** True when the winner is the labelled test double. Callers must not treat its output as verified. */
  simulated: boolean;
}

/* ------------------------------------------------------------------ §22 Reputation */

export interface ReputationRecord {
  subjectKind: "agent" | "team" | "framework" | "harness";
  subjectId: string;
  dimension: string;
  wins: number;
  losses: number;
  totalMs: number;
  runs: number;
  updatedAt: string;
}

export interface ReputationView {
  subjectId: string;
  subjectKind: ReputationRecord["subjectKind"];
  runs: number;
  successRate: number;
  medianMs: number;
  byDimension: Array<{ dimension: string; runs: number; successRate: number; label: string }>;
  /** How much the router should trust this: evidence volume, not certainty. */
  confidence: number;
}

/* ------------------------------------------------------------------ §20/§21 Memory */

export type MemoryScope = "MISSION" | "TEAM" | "AGENT" | "ARTIFACT" | "DECISION" | "FAILURE";

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  scopeKey: string;
  missionId: string;
  kind: "what_worked" | "what_failed" | "agent_success" | "harness_success" | "tool_failure" | "rejected_architecture" | "repair_strategy" | "approval_required" | "decision";
  content: string;
  evidence: string[];
  importance: number;
  tags: string[];
  createdAt: string;
}

/* ------------------------------------------------------------------ §23 Resources */

export interface ResourceUsage {
  costUsd: number;
  tokens: number;
  peakConcurrentAgents: number;
  browserSessions: number;
  graphMutations: number;
  retries: number;
  wallClockMs: number;
}

export type ResourceLimitKind = keyof MissionBudget;

export interface ResourceViolation {
  limit: ResourceLimitKind;
  value: number;
  ceiling: number;
  at: string;
}

/* ------------------------------------------------------------------ §5 Supervisor */

export type SupervisorRecommendationKind =
  | "REPLACE_AGENT"
  | "SWITCH_HARNESS"
  | "SPAWN_SPECIALIST"
  | "SPLIT_TASK"
  | "REORGANIZE"
  | "ESCALATE_HUMAN"
  | "RETRY"
  | "PAUSE_MISSION"
  | "ROLLBACK_CHECKPOINT";

export interface SupervisorRecommendation {
  id: string;
  missionId: string;
  kind: SupervisorRecommendationKind;
  subjectId: string | null;
  reason: string;
  evidence: string[];
  /** Executed only when policy permits; otherwise it waits for a human. */
  autoExecutable: boolean;
  executed: boolean;
  createdAt: string;
}

/* ------------------------------------------------------------------ §36 Mission run result */

export interface MissionRunResult {
  missionId: string;
  status: MissionStatus;
  score: MissionScore;
  finalArtifactIds: string[];
  failures: FailureSignal[];
  repairs: RepairAttempt[];
  mutations: GraphMutation[];
  approvals: ApprovalRequest[];
  spentUsd: number;
  durationMs: number;
}

/** Convenience: a node the organization instantiated for a mission. */
export interface OrgNode {
  nodeId: string;
  node: NodeInstance;
  agentId: string;
  planStepId: string | null;
}
