/**
 * §3 OrganizationRuntime + §9 agent contracts + §23 resource limits + §24 parallelism.
 *
 * The organization is the live collection of agents working one mission. It can change while
 * the mission runs: spawn, replace, pause, resume, delegate, reassign, split, merge,
 * restructure, escalate.
 *
 * Two invariants hold everywhere in this file:
 *
 *   1. No mutation happens without a flight-recorder entry carrying actor, authority,
 *      policy, reason and evidence (§32).
 *   2. An agent's permissions are the intersection of what the mission boundary grants and
 *      what its role requires. Permissions are never widened by the agent itself (§33).
 */

import { uid } from "../app/id";
import { DEFINITIONS_BY_ID } from "../domain/nodeLibrary";
import type { HarnessId } from "../domain/harness";
import type {
  AgentContract,
  GrantedPermissions,
  Mission,
  OrgAgent,
  OrgTask,
  PlanStep,
  RiskClass,
  SecurityBoundary,
  TaskClass,
  TaskState,
} from "./types";
import type { FlightRecorder } from "./flightRecorder";
import { classifyRisk } from "./riskPolicy";

export interface SpawnInput {
  definitionId: string;
  title?: string;
  purpose?: string;
  harness?: HarnessId | null;
  nodeId?: string | null;
  planStepId?: string | null;
  spawnedBy?: OrgAgent["spawnedBy"];
  spawnReason: string;
  /** Requested permissions; intersected with the mission boundary. */
  requested?: Partial<GrantedPermissions>;
  budgetUsd?: number;
  timeoutMs?: number;
}

export interface TaskInput {
  title: string;
  description: string;
  planStepId?: string | null;
  dependsOn?: string[];
  cls?: TaskClass;
  maxAttempts?: number;
  risk?: RiskClass;
  nodeId?: string | null;
  inputArtifactIds?: string[];
  parentTaskId?: string | null;
}

/** What each node category needs to do its job, before the boundary is applied. */
const ROLE_REQUIREMENTS: Record<string, Partial<GrantedPermissions>> = {
  "agent.coder": { filesystemRead: true, filesystemWrite: true, shell: true, memoryWrite: true },
  "agent.tester": { filesystemRead: true, shell: true, memoryWrite: true },
  "agent.security": { filesystemRead: true, shell: false, network: true, memoryWrite: true },
  "agent.reviewer": { filesystemRead: true, memoryWrite: true },
  "agent.researcher": { filesystemRead: true, network: true, browser: true, memoryWrite: true },
  "agent.architect": { filesystemRead: true, memoryWrite: true, skillWrite: true },
  "agent.planner": { filesystemRead: true, memoryWrite: true, proposeGraphMutation: true },
  "agent.browser": { network: true, browser: true },
  "agent.debugger": { filesystemRead: true, shell: true },
  "agent.docs": { filesystemRead: true, filesystemWrite: true, memoryWrite: true },
  "agent.supervisor": { filesystemRead: true, memoryWrite: true, proposeGraphMutation: true },
};

const DEFAULT_REQUIREMENTS: Partial<GrantedPermissions> = { filesystemRead: true, memoryWrite: true };

/**
 * §33 Intersection. An agent inherits only what the mission grants AND its role needs.
 * Credentials are never granted by a role: only the mission boundary can grant them.
 */
export function grantPermissions(boundary: SecurityBoundary, definitionId: string, requested?: Partial<GrantedPermissions>): { granted: GrantedPermissions; denied: string[] } {
  const role = ROLE_REQUIREMENTS[definitionId] ?? DEFAULT_REQUIREMENTS;
  const want: Partial<GrantedPermissions> = { ...role, ...(requested ?? {}) };
  const denied: string[] = [];
  const map: Array<[keyof GrantedPermissions, keyof SecurityBoundary | null]> = [
    ["filesystemRead", "filesystemRead"],
    ["filesystemWrite", "filesystemWrite"],
    ["shell", "shell"],
    ["network", "network"],
    ["browser", "browser"],
    ["mcp", "mcp"],
    ["credentials", "credentials"],
    ["memoryWrite", null],
    ["skillWrite", null],
    ["proposeGraphMutation", null],
  ];
  const granted = {} as GrantedPermissions;
  for (const [perm, bound] of map) {
    const wanted = Boolean(want[perm]);
    const allowed = bound ? Boolean(boundary[bound]) : true;
    granted[perm] = wanted && allowed;
    if (wanted && !allowed) denied.push(`${perm} (mission boundary denies ${bound})`);
  }
  return { granted, denied };
}

/** §9 Build the contract an agent is bound by for this mission. */
export function buildContract(mission: Mission, definitionId: string, purpose: string, requested?: Partial<GrantedPermissions>, budgetUsd?: number, timeoutMs?: number): AgentContract {
  const def = DEFINITIONS_BY_ID.get(definitionId);
  const { granted } = grantPermissions(mission.boundary, definitionId, requested);
  const isControl = definitionId.startsWith("control.");
  return {
    identity: def?.rolePrompt?.sections.identity ?? `VH ${def?.title ?? definitionId}`,
    purpose: purpose || def?.defaultPurpose || "Accomplish the assigned task.",
    capabilities: capabilitiesFor(definitionId),
    inputs: def?.inputs.map((p) => `${p.id}:${p.dataType}`) ?? [],
    outputs: def?.outputs.map((p) => `${p.id}:${p.dataType}`) ?? [],
    permissions: granted,
    budgetUsd: budgetUsd ?? Math.max(0.01, mission.budget.maxCostUsd / 8),
    timeoutMs: timeoutMs ?? def?.contractTimeoutMs ?? 300_000,
    successCriteria: def?.rolePrompt?.sections.verificationStrategy
      ? [def.rolePrompt.sections.verificationStrategy]
      : ["The deliverable is usable without the author present."],
    failurePolicy: isControl ? "ESCALATE" : definitionId === "agent.coder" ? "SWITCH_HARNESS" : "RETRY",
    escalationPolicy: mission.riskPolicy.autonomy === "AUTONOMOUS" ? "SUPERVISOR" : "HUMAN",
  };
}

export function capabilitiesFor(definitionId: string): string[] {
  const table: Record<string, string[]> = {
    "agent.coder": ["coding", "refactor", "implementation"],
    "agent.tester": ["testing", "verification"],
    "agent.security": ["security-review", "threat-modelling"],
    "agent.reviewer": ["review"],
    "agent.researcher": ["research", "synthesis"],
    "agent.architect": ["architecture", "design"],
    "agent.planner": ["planning", "decomposition"],
    "agent.synthesizer": ["synthesis"],
    "agent.critic": ["critique"],
    "agent.judge": ["adjudication"],
    "agent.docs": ["documentation"],
    "agent.qa": ["quality-assurance"],
    "agent.debugger": ["debugging", "root-cause"],
    "agent.browser": ["browser-automation"],
    "agent.supervisor": ["coordination"],
    "agent.router": ["routing"],
    "agent.reflection": ["reflection"],
    "agent.evolution": ["evolution"],
    "agent.local": ["local-inference"],
    "agent.crew": ["coding", "testing", "review"],
  };
  return table[definitionId] ?? ["general"];
}

/** §24 Classify a task's parallelism from its dependencies and risk. */
export function classifyTask(step: PlanStep | null, dependsOn: string[], risk: RiskClass): TaskClass {
  if (risk === "CRITICAL" || step?.requiresApproval) return "APPROVAL_GATED";
  if (step?.kind === "implementation") return "EXCLUSIVE"; // two agents editing one tree conflict
  if (dependsOn.length) return "DEPENDENCY_BOUND";
  if (step?.kind === "research") return "PARALLEL_SAFE";
  return "SEQUENTIAL";
}

export class OrganizationRuntime {
  readonly missionId: string;
  private agentMap = new Map<string, OrgAgent>();
  private taskMap = new Map<string, OrgTask>();
  private taskUpdatedAt = new Map<string, number>();
  private recorder: FlightRecorder;
  private boundary: SecurityBoundary;
  private mission: Mission;

  constructor(mission: Mission, recorder: FlightRecorder) {
    this.mission = mission;
    this.missionId = mission.missionId;
    this.recorder = recorder;
    this.boundary = mission.boundary;
  }

  /* ------------------------------------------------------------------ agents */

  spawn(input: SpawnInput): OrgAgent {
    const def = DEFINITIONS_BY_ID.get(input.definitionId);
    if (!def) throw new Error(`cannot spawn: no node definition "${input.definitionId}"`);
    const live = this.agentsInState("ACTIVE", "IDLE").length;
    if (live >= this.mission.budget.maxConcurrentAgents) {
      // Not a silent failure: the caller decides whether to queue or escalate.
      throw new Error(
        `concurrency limit: ${live} agents live, budget allows ${this.mission.budget.maxConcurrentAgents}. Pause or replace one first.`,
      );
    }
    const { granted, denied } = grantPermissions(this.boundary, input.definitionId, input.requested);
    const contract = buildContract(this.mission, input.definitionId, input.purpose ?? "", input.requested, input.budgetUsd, input.timeoutMs);
    contract.permissions = granted;
    const agent: OrgAgent = {
      agentId: uid("agt"),
      missionId: this.missionId,
      definitionId: input.definitionId,
      title: input.title ?? def.title,
      contract,
      harness: input.harness ?? null,
      state: "IDLE",
      nodeId: input.nodeId ?? null,
      spawnedAt: new Date().toISOString(),
      replacedBy: null,
      spawnedBy: input.spawnedBy ?? "planner",
      spawnReason: input.spawnReason,
      taskIds: [],
      stats: { tasksDone: 0, tasksFailed: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, medianMs: 0 },
    };
    this.agentMap.set(agent.agentId, agent);
    this.recorder.record({
      kind: "AGENT_SPAWNED",
      actor: agent.spawnedBy,
      authority: `policy:organization.spawn;autonomy=${this.mission.riskPolicy.autonomy}`,
      policy: this.mission.riskPolicy.allowReorganization ? "organization.dynamic-roster" : "organization.fixed-roster",
      reason: input.spawnReason,
      evidence: denied.map((d) => `denied: ${d}`),
      subjectId: agent.agentId,
      data: {
        definitionId: agent.definitionId,
        title: agent.title,
        harness: agent.harness,
        capabilities: contract.capabilities,
        permissions: Object.entries(granted).filter(([, v]) => v).map(([k]) => k),
        denied,
        budgetUsd: contract.budgetUsd,
        timeoutMs: contract.timeoutMs,
      },
    });
    return agent;
  }

  replace(agentId: string, replacement: SpawnInput, reason: string, evidence: string[], actor: string): OrgAgent {
    const old = this.agentMap.get(agentId);
    if (!old) throw new Error(`unknown agent ${agentId}`);
    const created = this.spawn({ ...replacement, spawnedBy: "supervisor", spawnReason: reason });
    old.state = "REPLACED";
    old.replacedBy = created.agentId;
    // Hand over the replaced agent's unfinished work.
    for (const taskId of old.taskIds) {
      const task = this.taskMap.get(taskId);
      if (task && (task.state === "ASSIGNED" || task.state === "RUNNING" || task.state === "BLOCKED")) {
        this.reassign(taskId, created.agentId, `Inherited from replaced ${old.title}`, actor);
      }
    }
    this.recorder.record({
      kind: "AGENT_REPLACED",
      actor,
      authority: "supervisor",
      policy: "organization.replace",
      reason,
      evidence,
      subjectId: created.agentId,
      data: { replacedAgentId: agentId, replacedTitle: old.title, newTitle: created.title },
    });
    return created;
  }

  pause(agentId: string, reason: string, actor: string): void {
    const a = this.require(agentId);
    if (a.state === "PAUSED") return;
    a.state = "PAUSED";
    this.recorder.record({
      kind: "AGENT_PAUSED",
      actor,
      authority: "supervisor",
      policy: "organization.pause",
      reason,
      subjectId: agentId,
    });
  }

  resume(agentId: string, reason: string, actor: string): void {
    const a = this.require(agentId);
    if (a.state !== "PAUSED") return;
    a.state = "IDLE";
    this.recorder.record({
      kind: "AGENT_RESUMED",
      actor,
      authority: "supervisor",
      policy: "organization.resume",
      reason,
      subjectId: agentId,
    });
  }

  remove(agentId: string, reason: string, actor: string): void {
    const a = this.require(agentId);
    a.state = "REMOVED";
    for (const taskId of a.taskIds) {
      const t = this.taskMap.get(taskId);
      if (t && (t.state === "ASSIGNED" || t.state === "RUNNING")) {
        t.agentId = null;
        t.state = "PENDING";
        this.touch(t.taskId);
      }
    }
    this.recorder.record({
      kind: "AGENT_REPLACED",
      actor,
      authority: "supervisor",
      policy: "organization.remove",
      reason,
      subjectId: agentId,
      data: { removed: true },
    });
  }

  setHarness(agentId: string, harness: HarnessId | null, reason: string, actor: string, rationale: string[]): void {
    const a = this.require(agentId);
    const previous = a.harness;
    a.harness = harness;
    this.recorder.record({
      kind: previous ? "HARNESS_SWITCHED" : "HARNESS_SELECTED",
      actor,
      authority: this.mission.riskPolicy.allowHarnessSwitch ? "policy:arbitration" : "human",
      policy: "arbitration.selection",
      reason,
      evidence: rationale,
      subjectId: agentId,
      data: { from: previous, to: harness },
    });
  }

  recordWork(agentId: string, outcome: { success: boolean; tokensIn: number; tokensOut: number; costUsd: number; latencyMs: number }): void {
    const a = this.agentMap.get(agentId);
    if (!a) return;
    const s = a.stats;
    if (outcome.success) s.tasksDone += 1;
    else s.tasksFailed += 1;
    s.tokensIn += outcome.tokensIn;
    s.tokensOut += outcome.tokensOut;
    s.costUsd += outcome.costUsd;
    const total = s.tasksDone + s.tasksFailed;
    s.medianMs = total ? Math.round((s.medianMs * (total - 1) + outcome.latencyMs) / total) : outcome.latencyMs;
  }

  /* ------------------------------------------------------------------ tasks */

  createTask(input: TaskInput): OrgTask {
    const risk = input.risk ?? classifyRisk(`${input.title} ${input.description}`).risk;
    const task: OrgTask = {
      taskId: uid("task"),
      missionId: this.missionId,
      title: input.title,
      description: input.description,
      agentId: null,
      state: "PENDING",
      cls: input.cls ?? classifyTask(null, input.dependsOn ?? [], risk),
      dependsOn: input.dependsOn ?? [],
      blockedBy: null,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? this.mission.budget.maxRetriesPerTask,
      risk,
      planStepId: input.planStepId ?? null,
      nodeId: input.nodeId ?? null,
      inputArtifactIds: input.inputArtifactIds ?? [],
      outputArtifactIds: [],
      parentTaskId: input.parentTaskId ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: null,
    };
    this.taskMap.set(task.taskId, task);
    this.touch(task.taskId);
    return task;
  }

  delegate(taskId: string, agentId: string, reason: string, actor: string): OrgTask {
    const task = this.requireTask(taskId);
    const agent = this.require(agentId);
    if (agent.state === "PAUSED" || agent.state === "REMOVED" || agent.state === "REPLACED") {
      throw new Error(`cannot delegate to ${agent.title}: state is ${agent.state}`);
    }
    if (!this.dependenciesMet(task)) {
      throw new Error(
        `cannot delegate "${task.title}": unmet dependencies ${task.dependsOn.filter((d) => this.taskMap.get(d)?.state !== "DONE").join(", ")}`,
      );
    }
    task.agentId = agentId;
    task.state = "ASSIGNED";
    task.error = null;
    agent.taskIds.push(taskId);
    agent.state = "ACTIVE";
    this.touch(taskId);
    this.recorder.record({
      kind: "TASK_DELEGATED",
      actor,
      authority: "supervisor",
      policy: "organization.delegate",
      reason,
      subjectId: taskId,
      data: { agentId, agentTitle: agent.title, risk: task.risk, cls: task.cls },
    });
    return task;
  }

  reassign(taskId: string, agentId: string, reason: string, actor: string): OrgTask {
    const task = this.requireTask(taskId);
    const previous = task.agentId;
    if (previous) {
      const old = this.agentMap.get(previous);
      if (old) old.taskIds = old.taskIds.filter((t) => t !== taskId);
    }
    task.agentId = null;
    task.state = "PENDING";
    this.touch(taskId);
    const delegated = this.delegate(taskId, agentId, reason, actor);
    this.recorder.record({
      kind: "TASK_REASSIGNED",
      actor,
      authority: "supervisor",
      policy: "organization.reassign",
      reason,
      subjectId: taskId,
      data: { from: previous, to: agentId },
    });
    return delegated;
  }

  /** §3 Split a task. Children inherit the parent's dependencies; the parent becomes a join. */
  split(taskId: string, parts: Array<{ title: string; description: string }>, reason: string, actor: string): OrgTask[] {
    const parent = this.requireTask(taskId);
    if (parts.length < 2) throw new Error("split needs at least two parts");
    const children = parts.map((p) =>
      this.createTask({
        title: p.title,
        description: p.description,
        planStepId: parent.planStepId,
        dependsOn: [...parent.dependsOn],
        risk: parent.risk,
        maxAttempts: parent.maxAttempts,
        parentTaskId: parent.taskId,
      }),
    );
    parent.dependsOn = children.map((c) => c.taskId);
    parent.cls = "DEPENDENCY_BOUND";
    parent.title = `${parent.title} (join)`;
    this.touch(parent.taskId);
    this.recorder.record({
      kind: "TASK_SPLIT",
      actor,
      authority: this.mission.riskPolicy.allowReorganization ? "supervisor" : "human",
      policy: "organization.split",
      reason,
      subjectId: taskId,
      data: { children: children.map((c) => c.taskId), parts: parts.map((p) => p.title) },
    });
    return children;
  }

  /** Merge sibling tasks back into one. */
  merge(taskIds: string[], title: string, reason: string, actor: string): OrgTask {
    const tasks = taskIds.map((id) => this.requireTask(id));
    if (tasks.length < 2) throw new Error("merge needs at least two tasks");
    const deps = [...new Set(tasks.flatMap((t) => t.dependsOn))].filter((d) => !taskIds.includes(d));
    const merged = this.createTask({
      title,
      description: tasks.map((t) => `- ${t.title}: ${t.description}`).join("\n"),
      dependsOn: deps,
      risk: tasks.reduce<RiskClass>((max, t) => (rank(t.risk) > rank(max) ? t.risk : max), "LOW"),
    });
    for (const t of tasks) {
      t.state = "CANCELLED";
      this.touch(t.taskId);
    }
    this.recorder.record({
      kind: "TASK_MERGED",
      actor,
      authority: this.mission.riskPolicy.allowReorganization ? "supervisor" : "human",
      policy: "organization.merge",
      reason,
      subjectId: merged.taskId,
      data: { mergedFrom: taskIds },
    });
    return merged;
  }

  setState(taskId: string, state: TaskState, detail?: { error?: string; actor?: string; reason?: string }): OrgTask {
    const task = this.requireTask(taskId);
    const previous = task.state;
    task.state = state;
    if (detail?.error !== undefined) task.error = detail.error;
    if (state === "FAILED") task.attempts += 1;
    this.touch(taskId);
    if (state === "DONE") {
      const agent = task.agentId ? this.agentMap.get(task.agentId) : null;
      if (agent) {
        agent.taskIds = agent.taskIds.filter((t) => t !== taskId);
        if (!agent.taskIds.some((t) => ["ASSIGNED", "RUNNING"].includes(this.taskMap.get(t)?.state ?? ""))) agent.state = "IDLE";
      }
      this.recorder.record({
        kind: "TASK_COMPLETED",
        actor: detail?.actor ?? task.agentId ?? "runtime",
        authority: "runtime",
        policy: "task.complete",
        reason: detail?.reason ?? `Task finished after ${task.attempts + 1} attempt(s).`,
        subjectId: taskId,
        data: { previous, outputs: task.outputArtifactIds },
      });
    }
    return task;
  }

  addOutput(taskId: string, artifactId: string): void {
    const task = this.requireTask(taskId);
    if (!task.outputArtifactIds.includes(artifactId)) task.outputArtifactIds.push(artifactId);
  }

  /* ------------------------------------------------------------------ queries */

  agents(): OrgAgent[] {
    return [...this.agentMap.values()];
  }

  agentsInState(...states: OrgAgent["state"][]): OrgAgent[] {
    const set = new Set(states);
    return this.agents().filter((a) => set.has(a.state));
  }

  agent(id: string): OrgAgent | null {
    return this.agentMap.get(id) ?? null;
  }

  byDefinition(definitionId: string): OrgAgent | null {
    return this.agents().find((a) => a.definitionId === definitionId && a.state !== "REPLACED" && a.state !== "REMOVED") ?? null;
  }

  tasks_(): OrgTask[] {
    return [...this.taskMap.values()];
  }

  task(id: string): OrgTask | null {
    return this.taskMap.get(id) ?? null;
  }

  tasksInState(...states: TaskState[]): OrgTask[] {
    const set = new Set(states);
    return this.tasks_().filter((t) => set.has(t.state));
  }

  /** §24 Tasks whose dependencies are all DONE and which are not approval-gated. */
  readyTasks(): OrgTask[] {
    return this.tasksInState("PENDING").filter((t) => this.dependenciesMet(t) && t.cls !== "APPROVAL_GATED");
  }

  /**
   * §24/§11 Tasks the runtime may dispatch right now: dependencies met, still PENDING.
   * Unlike `readyTasks()` this *includes* approval-gated tasks — the gate is the runtime's
   * job to run, and excluding them here made gated tasks permanently undispatchable.
   */
  dispatchableWave(): OrgTask[] {
    return this.tasksInState("PENDING").filter((t) => this.dependenciesMet(t));
  }

  /** §24 Group ready tasks into parallel waves, respecting EXCLUSIVE tasks. */
  nextWave(): OrgTask[] {
    const ready = this.dispatchableWave();
    if (!ready.length) return [];
    const exclusive = ready.filter((t) => t.cls === "EXCLUSIVE");
    if (exclusive.length) return [exclusive[0]];
    const liveAgents = this.agentsInState("ACTIVE", "IDLE").length || 1;
    return ready.slice(0, Math.max(1, this.mission.budget.maxConcurrentAgents - Math.max(0, liveAgents - this.agentsInState("IDLE").length)));
  }

  dependenciesMet(task: OrgTask): boolean {
    return task.dependsOn.every((d) => this.taskMap.get(d)?.state === "DONE" || this.taskMap.get(d)?.state === "CANCELLED");
  }

  /** Wall-clock ms since each task last changed state — feeds the stall/timeout detectors. */
  taskAges(now = Date.now()): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, at] of this.taskUpdatedAt) out[id] = now - at;
    return out;
  }

  isDone(): boolean {
    const tasks = this.tasks_();
    if (!tasks.length) return false;
    return tasks.every((t) => t.state === "DONE" || t.state === "CANCELLED");
  }

  hasUnrecoverable(): boolean {
    return this.tasks_().some((t) => t.state === "FAILED" && t.attempts >= t.maxAttempts);
  }

  /* ------------------------------------------------------------------ persistence (§25) */

  exportState(): { agents: OrgAgent[]; tasks: OrgTask[]; taskUpdatedAt: Record<string, number> } {
    return {
      agents: this.agents(),
      tasks: this.tasks_(),
      taskUpdatedAt: Object.fromEntries(this.taskUpdatedAt),
    };
  }

  hydrate(state: { agents: OrgAgent[]; tasks: OrgTask[]; taskUpdatedAt?: Record<string, number> }): void {
    for (const a of state.agents) this.agentMap.set(a.agentId, a);
    for (const t of state.tasks) this.taskMap.set(t.taskId, t);
    if (state.taskUpdatedAt) for (const [k, v] of Object.entries(state.taskUpdatedAt)) this.taskUpdatedAt.set(k, v);
  }

  updateBoundary(boundary: SecurityBoundary, reason: string, actor: string): string[] {
    const previous = this.boundary;
    this.boundary = boundary;
    this.mission = { ...this.mission, boundary };
    const notes: string[] = [];
    // Existing agents are re-intersected; a widened boundary does not retroactively grant.
    for (const a of this.agents()) {
      const { granted, denied } = grantPermissions(boundary, a.definitionId);
      const lost = (Object.keys(a.contract.permissions) as Array<keyof GrantedPermissions>).filter(
        (k) => a.contract.permissions[k] && !granted[k],
      );
      a.contract.permissions = granted;
      if (lost.length) notes.push(`${a.title} lost ${lost.join(", ")}`);
      if (denied.length) notes.push(`${a.title} denied ${denied.join(", ")}`);
    }
    this.recorder.record({
      kind: "POLICY_DENIED",
      actor,
      authority: "human",
      policy: "security.boundary-update",
      reason,
      evidence: notes,
      data: { previous, next: boundary },
    });
    return notes;
  }

  /* ------------------------------------------------------------------ internals */

  private touch(taskId: string): void {
    this.taskUpdatedAt.set(taskId, Date.now());
    const t = this.taskMap.get(taskId);
    if (t) t.updatedAt = new Date().toISOString();
  }

  private require(agentId: string): OrgAgent {
    const a = this.agentMap.get(agentId);
    if (!a) throw new Error(`unknown agent ${agentId}`);
    return a;
  }

  private requireTask(taskId: string): OrgTask {
    const t = this.taskMap.get(taskId);
    if (!t) throw new Error(`unknown task ${taskId}`);
    return t;
  }
}

function rank(r: RiskClass): number {
  return ["LOW", "MEDIUM", "HIGH", "CRITICAL"].indexOf(r);
}

/** Convenience: build tasks straight from a plan, wiring dependencies by step id. */
export function tasksFromPlan(org: OrganizationRuntime, steps: PlanStep[]): Map<string, OrgTask> {
  const byStep = new Map<string, OrgTask>();
  // Create in dependency order so parent ids exist when children reference them.
  const created = new Set<string>();
  let pending = [...steps];
  let guard = 0;
  while (pending.length && guard++ < 50) {
    const batch = pending.filter((s) => s.dependsOn.every((d) => created.has(d)));
    if (!batch.length) {
      // Unresolvable dependency: create them anyway with the raw ids so the deadlock
      // detector can see it rather than the planner hiding it.
      for (const s of pending) {
        byStep.set(s.id, org.createTask(taskInputFor(s, s.dependsOn)));
        created.add(s.id);
      }
      break;
    }
    for (const s of batch) {
      const deps = s.dependsOn.map((d) => byStep.get(d)?.taskId).filter((x): x is string => Boolean(x));
      byStep.set(s.id, org.createTask(taskInputFor(s, deps)));
      created.add(s.id);
    }
    pending = pending.filter((s) => !created.has(s.id));
  }
  return byStep;
}

function taskInputFor(step: PlanStep, deps: string[]): TaskInput {
  return {
    title: step.title,
    description: step.purpose,
    planStepId: step.id,
    dependsOn: deps,
    cls: classifyTask(step, deps, step.risk),
    risk: step.risk,
  };
}
