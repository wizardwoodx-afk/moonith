/**
 * §23 Resource manager + §25 pause/resume + §26 checkpoints.
 *
 * The resource manager is the only place that decides whether a mission may keep spending.
 * It is consulted before every task dispatch, and a ceiling is a hard stop — the mission
 * goes BLOCKED and a human decides, rather than the runtime quietly overspending.
 */

import { uid } from "../app/id";
import type {
  AgentState,
  ApprovalRequest,
  Artifact,
  Checkpoint,
  FlightEvent,
  MissionBudget,
  NegotiationThread,
  OrgAgent,
  OrgTask,
  ResourceLimitKind,
  ResourceUsage,
  ResourceViolation,
  SupervisorRecommendation,
  TaskState,
} from "./types";
import type { WorkflowGraph } from "../domain/types";
import type { FlightRecorder } from "./flightRecorder";

export const EMPTY_USAGE: ResourceUsage = {
  costUsd: 0,
  tokens: 0,
  peakConcurrentAgents: 0,
  browserSessions: 0,
  graphMutations: 0,
  retries: 0,
  wallClockMs: 0,
};

export class ResourceManager {
  usage: ResourceUsage = { ...EMPTY_USAGE };
  private violations: ResourceViolation[] = [];

  constructor(private budget: MissionBudget, private startedAt: number = Date.now()) {}

  spend(delta: Partial<ResourceUsage>): void {
    for (const [k, v] of Object.entries(delta)) {
      const key = k as keyof ResourceUsage;
      this.usage[key] = (this.usage[key] as number) + (v as number);
    }
    this.usage.wallClockMs = Date.now() - this.startedAt;
  }

  /** Called before dispatching work. Returns the first ceiling already breached, or null. */
  maySpend(estimatedCostUsd: number, liveAgents: number): ResourceViolation | null {
    const projected = { ...this.usage, costUsd: this.usage.costUsd + estimatedCostUsd };
    const checks: Array<[ResourceLimitKind, number, number]> = [
      ["maxCostUsd", projected.costUsd, this.budget.maxCostUsd],
      ["maxTokens", projected.tokens, this.budget.maxTokens],
      ["maxWallClockMs", Date.now() - this.startedAt, this.budget.maxWallClockMs],
      ["maxConcurrentAgents", liveAgents, this.budget.maxConcurrentAgents],
      ["maxGraphMutations", this.usage.graphMutations, this.budget.maxGraphMutations],
      ["maxBrowserSessions", this.usage.browserSessions, this.budget.maxBrowserSessions],
    ];
    for (const [limit, value, ceiling] of checks) {
      if (ceiling > 0 && value > ceiling) {
        const v: ResourceViolation = { limit, value, ceiling, at: new Date().toISOString() };
        this.violations.push(v);
        return v;
      }
    }
    return null;
  }

  /** Ratios for the mission header, so a ceiling is visible before it is hit. */
  ratios(): Array<{ limit: ResourceLimitKind; value: number; ceiling: number; ratio: number }> {
    const rows: Array<[ResourceLimitKind, number, number]> = [
      ["maxCostUsd", this.usage.costUsd, this.budget.maxCostUsd],
      ["maxTokens", this.usage.tokens, this.budget.maxTokens],
      ["maxWallClockMs", Date.now() - this.startedAt, this.budget.maxWallClockMs],
      ["maxConcurrentAgents", this.usage.peakConcurrentAgents, this.budget.maxConcurrentAgents],
      ["maxGraphMutations", this.usage.graphMutations, this.budget.maxGraphMutations],
      ["maxRetriesPerTask", this.usage.retries, this.budget.maxRetriesPerTask * 10],
    ];
    return rows.map(([limit, value, ceiling]) => ({
      limit,
      value,
      ceiling,
      ratio: ceiling > 0 ? value / ceiling : 0,
    }));
  }

  violationsList(): ResourceViolation[] {
    return [...this.violations];
  }

  remainingCostUsd(): number {
    return Math.max(0, this.budget.maxCostUsd - this.usage.costUsd);
  }

  hydrate(usage: ResourceUsage, startedAt: number): void {
    this.usage = { ...usage };
    this.startedAt = startedAt;
  }

  export(): ResourceUsage {
    return { ...this.usage, wallClockMs: Date.now() - this.startedAt };
  }
}

/* ------------------------------------------------------------------ §26 checkpoints */

export interface CheckpointInput {
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
}

export class CheckpointStore {
  private checkpoints: Checkpoint[] = [];

  /**
   * Take a checkpoint. The graph is deep-copied: a checkpoint that aliases live state is not
   * a checkpoint, it is a promise that will be broken by the next mutation.
   */
  take(input: CheckpointInput, recorder: FlightRecorder): Checkpoint {
    const cp: Checkpoint = {
      checkpointId: uid("cp"),
      missionId: input.missionId,
      label: input.label,
      reason: input.reason,
      graphVersion: input.graphVersion,
      graphSnapshot: structuredClone(input.graphSnapshot),
      taskStates: { ...input.taskStates },
      artifactVersions: { ...input.artifactVersions },
      roster: input.roster.map((r) => ({ ...r })),
      pendingApprovalIds: [...input.pendingApprovalIds],
      spentUsd: input.spentUsd,
      createdAt: new Date().toISOString(),
    };
    this.checkpoints.push(cp);
    recorder.record({
      kind: "MISSION_CHECKPOINTED",
      actor: "runtime",
      authority: "policy:checkpoint.automatic",
      policy: "checkpoint.after-transition",
      reason: input.reason,
      subjectId: cp.checkpointId,
      data: {
        label: cp.label,
        graphVersion: cp.graphVersion,
        nodes: cp.graphSnapshot.nodes.length,
        tasksDone: Object.values(cp.taskStates).filter((s) => s === "DONE").length,
        spentUsd: cp.spentUsd,
      },
    });
    return cp;
  }

  latest(missionId: string): Checkpoint | null {
    const list = this.forMission(missionId);
    return list.length ? list[list.length - 1] : null;
  }

  get(checkpointId: string): Checkpoint | null {
    return this.checkpoints.find((c) => c.checkpointId === checkpointId) ?? null;
  }

  forMission(missionId: string): Checkpoint[] {
    return this.checkpoints.filter((c) => c.missionId === missionId);
  }

  /**
   * §26 Rollback. Returns the checkpoint to restore and records the rollback. Restoring is
   * the caller's job: this store never mutates live mission state behind its back.
   */
  rollbackTo(checkpointId: string, recorder: FlightRecorder, actor: string, reason: string): Checkpoint | null {
    const cp = this.get(checkpointId);
    if (!cp) return null;
    recorder.record({
      kind: "MISSION_ROLLED_BACK",
      actor,
      authority: actor === "human" ? "human" : "supervisor",
      policy: "checkpoint.rollback",
      reason,
      subjectId: cp.checkpointId,
      data: {
        label: cp.label,
        graphVersion: cp.graphVersion,
        discardedCheckpoints: this.forMission(cp.missionId).filter((c) => c.createdAt > cp.createdAt).length,
      },
    });
    // Checkpoints taken after the target are no longer valid restore points.
    this.checkpoints = this.checkpoints.filter((c) => c.createdAt <= cp.createdAt);
    return cp;
  }

  hydrate(checkpoints: Checkpoint[]): void {
    this.checkpoints = [...checkpoints];
  }

  export(): Checkpoint[] {
    return [...this.checkpoints];
  }
}

/* ------------------------------------------------------------------ §25 pause/resume */

export interface PersistedMissionState {
  version: 6;
  savedAt: string;
  missionId: string;
  /** Everything needed to resume without repeating completed work. */
  agents: OrgAgent[];
  tasks: OrgTask[];
  taskUpdatedAt: Record<string, number>;
  artifacts: Artifact[];
  checkpoints: Checkpoint[];
  approvals: ApprovalRequest[];
  negotiations: NegotiationThread[];
  recommendations: SupervisorRecommendation[];
  flightEvents: FlightEvent[];
  usage: ResourceUsage;
  startedAt: number;
  graphVersion: number;
  graph: WorkflowGraph | null;
  completedNodeIds: string[];
  pendingTaskIds: string[];
}

/**
 * Validate a restored state before trusting it. A resume that cannot be validated must fail
 * loudly — resuming into a half-restored mission duplicates work, which §25 forbids.
 */
export function validateRestoredState(state: Partial<PersistedMissionState> | null): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!state) return { ok: false, errors: ["no saved state"] };
  if (state.version !== 6) errors.push(`unsupported state version ${String(state.version)} (expected 6)`);
  if (!state.missionId) errors.push("missing missionId");
  if (!Array.isArray(state.tasks)) errors.push("missing task states");
  if (!Array.isArray(state.agents)) errors.push("missing agent states");
  if (!Array.isArray(state.flightEvents)) errors.push("missing flight recorder trace");
  if (!state.usage) errors.push("missing resource usage");
  return { ok: errors.length === 0, errors };
}
