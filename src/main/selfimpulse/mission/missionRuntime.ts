/**
 * §36 MissionRuntime — the thing that actually runs a mission.
 *
 * Lifecycle: plan → build organization → execute waves → evaluate independently → detect
 * failure → repair → reorganise under policy → verify → checkpoint → score.
 *
 * Every state change is a flight-recorder entry. Every risk-bearing action passes the
 * approval gate. Every artifact is immutable and versioned. Nothing reports success it did
 * not measure: where a check could not be run, the mission says so and does not complete as
 * verified.
 */

import { uid } from "../app/id";
import { createNodeFromDef } from "../graph/factory";
import { DEFINITIONS_BY_ID } from "../domain/nodeLibrary";
import { GRAPH_SCHEMA_VERSION } from "../domain/types";
import type { Connection, NodeInstance, WorkflowGraph } from "../domain/types";
import type { HarnessId } from "../domain/harness";
import {
  DEFAULT_BUDGET,
  DEFAULT_BOUNDARY,
  DEFAULT_POLICY,
  canTransition,
} from "./types";
import type {
  Artifact,
  ArtifactProvenance,
  EvaluationCheck,
  FailureSignal,
  FlightEvent,
  Mission,
  MissionPlan,
  MissionRunResult,
  MissionScore,
  MissionStatus,
  OrgAgent,
  OrgTask,
  PlanStep,
  RepairAttempt,
  RepairStrategy,
  ResourceUsage,
} from "./types";
import { FlightRecorder, recorderFor } from "./flightRecorder";
import { collectAgentsContext, writeAgentsMd, type AgentsMdMissionInput } from "./agentsMd";
import { ArtifactStore } from "./artifactStore";
import { type CliAgentTeam, bindTeamToPlan, applyTeamToSteps, type BindResult } from "./agentTeam";
import { ApprovalGateService } from "./approvals";
import { OrganizationRuntime, tasksFromPlan } from "./organization";
import { OrganizationSupervisor } from "./supervisor";
import { HarnessLedger, selectHarness, selectReplacementHarness } from "./arbitration";
import { getHarness, type AgentRuntimeId } from "./harnessAdapters";
import { portsCompatible } from "../domain/dataTypes";
import { detectAll } from "./failureDetection";
import { evaluateArtifact, scoreMission, testRunCheck, unmeasuredCheck, check as mkCheck } from "./evaluation";
import { CheckpointStore, ResourceManager, validateRestoredState, type PersistedMissionState } from "./checkpoints";
import { proposeMutation, completedTitles } from "./graphMutator";
import { runAllChecks, type CheckResult } from "./checkRunner";
import { OrganizationMemory, ReputationLedger } from "./memory";
import { planMission, parallelWaves, type PlanResult } from "./missionPlanner";
import { NegotiationTable } from "./negotiation";
import { auditBoundary } from "./securityBoundary";
import { durableResume, durableSave, DoneLedger, defaultDurableKV, type DurableKVLike } from "./durable";
import { lastJournalWriteRefusal, persistRunJournal, recordLaneCheckpoint, retryAccounting, resumeRun } from "./runCheckpoints";
import { laneOfLabel, type RetryLane } from "./retryLanes";

/** SecurityBoundary flags → the plain MAY / MAY NOT statements AGENTS.md carries. */
function boundaryStatements(b: Mission["boundary"]): string[] {
  return [
    `MAY${b.filesystemRead ? "" : " NOT"}: read files inside the workspace`,
    `MAY${b.filesystemWrite ? "" : " NOT"}: write files inside the workspace`,
    `MAY${b.shell ? "" : " NOT"}: run shell commands`,
    `MAY${b.network ? "" : " NOT"}: use the network`,
    `MAY${b.browser ? "" : " NOT"}: use a browser`,
    `MAY${b.mcp ? "" : " NOT"}: call MCP tools`,
    `MAY${b.credentials ? "" : " NOT"}: touch stored credentials (never read their values)`,
  ];
}

export interface MissionRuntimeOptions {
  /** Allow the labelled test double. Off by default: a real mission needs a real runtime. */
  allowSimulated?: boolean;
  /** Harnesses detected on this machine. Pass the result of ipc.cliProvidersDetect(). */
  installed?: Record<string, boolean | null>;
  /** Cap on repair attempts per task, overriding the budget. */
  maxRepairAttempts?: number;
  /** Approval wait, ms. */
  approvalTimeoutMs?: number;
  /** Called when the mission needs a human, so the UI can surface it. */
  onApprovalRequired?: (approvalId: string) => void;
  repository?: string;
  team?: CliAgentTeam;
}

export interface RuntimeServices {
  artifacts: ArtifactStore;
  approvals: ApprovalGateService;
  checkpoints: CheckpointStore;
  memory: OrganizationMemory;
  reputation: ReputationLedger;
  ledger: HarnessLedger;
  negotiations: NegotiationTable;
}

/** Shared services so several missions in one app share evidence and memory. */
export function createServices(): RuntimeServices {
  return {
    artifacts: new ArtifactStore(),
    approvals: new ApprovalGateService(),
    checkpoints: new CheckpointStore(),
    memory: new OrganizationMemory(),
    reputation: new ReputationLedger(),
    ledger: new HarnessLedger(),
    negotiations: new NegotiationTable(),
  };
}

/**
 * §DURABLE RUNS — the seat the UI holds.
 *
 * `flushRunJournal()` and `resumeDurableRun()` below are the runtime's own
 * methods, and both docstrings named `src/ui/store.ts` as their caller while no
 * file under `src/ui` had ever mentioned either one. `src/ui` never constructs a
 * runtime, so the seam stayed dead no matter how many times the comment asserted
 * otherwise. This interface is the shape of the promise: the store attaches a
 * live runtime when this host has one (`attachDurableRun`), and until then its
 * seat makes the same two journal calls — `persistRunJournal()` and `resumeRun()`
 * — that these methods make, against the same module-level chain. The seat is
 * pinned to that identity by `probe/durableRuns`, because a seat free to invent
 * its own persistence path is a second journal waiting to disagree with the first.
 */
export interface DurableRunHandle {
  flushRunJournal(): { ok: boolean; refused?: string };
  resumeDurableRun(runId?: string): ReturnType<typeof resumeRun>;
}

/** One run the restored journal still proves out for: its chain verifies and its
 *  newest snapshot re-hashes to the digest the chain committed to. A run missing
 *  from this list is not "no evidence", it is evidence that refused — and the
 *  refusal is what `restoreNote` carries. */
export interface ResumableRun {
  runId: string;
  missionId: string;
  fromStep: number;
  label: string;
  checkpoints: number;
}

export class MissionRuntime implements DurableRunHandle {
  readonly mission: Mission;
  readonly recorder: FlightRecorder;
  readonly org: OrganizationRuntime;
  readonly supervisor: OrganizationSupervisor;
  readonly resources: ResourceManager;
  private services: RuntimeServices;
  private options: Required<Pick<MissionRuntimeOptions, "allowSimulated" | "maxRepairAttempts" | "approvalTimeoutMs">> & MissionRuntimeOptions;
  private plan: MissionPlan | null = null;
  private planResult: PlanResult | null = null;
  private teamBinding: BindResult | null = null;
  private graph: WorkflowGraph;
  private mutations: Array<ReturnType<typeof proposeMutation>["mutation"]> = [];
  private repairs: RepairAttempt[] = [];
  private failures: FailureSignal[] = [];
  /* 16.10.1 — the durable wire (F2): snapshot + once-guard live in ./durable.
   * defaultDurableKV wraps localStorage (getItem/setItem) when the host has it
   * and degrades to an ephemeral Map when it does not — execution never dies
   * because durability is unavailable. */
  private readonly durableKV = defaultDurableKV();
  private readonly doneLedger = new DoneLedger(this.durableKV);
  private taskToStep = new Map<string, PlanStep>();
  private taskToNode = new Map<string, string>();
  private completedNodeIds = new Set<string>();
  private triedHarnesses = new Map<string, AgentRuntimeId[]>();
  private triedStrategies = new Map<string, RepairStrategy[]>();
  private repairCount = new Map<string, number>();
  /** §18 Real verification results for the target repository, measured once per mission. */
  private realChecks: CheckResult[] | null = null;
  /** Monotonic id source for steps a repair adds, so a rollback can never recycle an id. */
  private addedStepSeq = 0;
  private repairInFlight = new Set<string>();
  private repairExhausted = new Set<string>();
  private cancelled = false;
  private paused = false;
  private startedAt = Date.now();
  private finalArtifactIds: string[] = [];
  private simulatedUsed = false;
  /** 19.7.16 — where the run picked up, once the durable chain has answered.
   *  `null` means "nothing was resumed" (a first run) or "the chain refused
   *  and said why" — the refusals are in `resumeRefusals`, never folded
   *  silently into this field. */
  private resumePoint: { fromStep: number; label: string; checkpoints: number; source: "journal" | "memory" } | null = null;
  private resumeRefusalLog: string[] = [];

  constructor(mission: Mission, services: RuntimeServices, options: MissionRuntimeOptions = {}) {
    this.mission = mission;
    this.services = services;
    this.options = {
      allowSimulated: false,
      maxRepairAttempts: mission.budget.maxRetriesPerTask,
      approvalTimeoutMs: 5 * 60 * 1000,
      ...options,
    };
    this.recorder = recorderFor(mission.missionId);
    this.org = new OrganizationRuntime(mission, this.recorder);
    this.supervisor = new OrganizationSupervisor(mission, this.org, this.recorder);
    this.resources = new ResourceManager(mission.budget, Date.now());
    this.graph = emptyGraph(mission);
    this.recorder.record({
      kind: "MISSION_CREATED",
      actor: "user",
      authority: "human",
      policy: "mission.create",
      reason: mission.objective,
      subjectId: mission.missionId,
      data: {
        name: mission.name,
        templateId: mission.templateId,
        autonomy: mission.riskPolicy.autonomy,
        budget: mission.budget,
        boundaryWarnings: auditBoundary(mission.boundary),
      },
    });
  }

  /* ------------------------------------------------------------------ §1 lifecycle */

  private transition(to: MissionStatus, reason: string, actor = "runtime"): void {
    if (this.mission.status === to) return;
    if (!canTransition(this.mission.status, to)) {
      throw new Error(`illegal mission transition ${this.mission.status} -> ${to} (${reason})`);
    }
    const from = this.mission.status;
    this.mission.status = to;
    this.mission.updatedAt = new Date().toISOString();
    this.recorder.record({
      kind: "MISSION_STATUS",
      actor,
      authority: actor === "human" ? "human" : "policy:lifecycle",
      policy: "mission.lifecycle",
      reason,
      subjectId: this.mission.missionId,
      data: { from, to },
    });
  }

  /* ------------------------------------------------------------------ §2 planning */

  /** Plan the mission. Nothing executes. The plan is inspectable before anything runs. */
  prepare(): MissionPlan {
    this.transition("PLANNING", "Planning the organization for this objective.");
    // V11 (W4): portability starts at planning. If the mission has a workspace, seed its
    // AGENTS.md (any existing human edits are preserved — the writer only fills a gap) and
    // collect every AGENTS.md within depth 3 as ground truth the planner must respect.
    let agentsContextSummary = "";
    if (this.options.repository) {
      try {
        const ctx = collectAgentsContext(this.options.repository);
        if (ctx.docs.length > 0) {
          const headings = ctx.docs.flatMap((d) => d.sections.map((s) => `${d.file}#${s.heading ?? d.title}`));
          agentsContextSummary = `${ctx.docs.length} AGENTS.md file(s), ${headings.length} sections: ${headings.slice(0, 6).join(", ")}${headings.length > 6 ? "…" : ""}`;
        } else {
          agentsContextSummary = "no AGENTS.md found in the workspace";
        }
      } catch (e) {
        // Context is a gift, not a contract: an unreadable workspace degrades the note, not the plan.
        agentsContextSummary = `AGENTS.md scan failed: ${(e as Error).message}`;
      }
    }
    this.planResult = planMission(this.mission, { repository: this.options.repository });
    this.plan = this.planResult.plan;
    this.buildGraphFromPlan(this.plan);
    // V11 (W4): the workspace gets its AGENTS.md before the first seat starts, so every
    // agent sees the same contract. Best-effort: a read-only workspace skips the seed.
    let agentsMdSeeded: string | null = null;
    if (this.options.repository) {
      try {
        const input: AgentsMdMissionInput = {
          missionId: this.mission.missionId,
          objective: this.mission.objective,
          doneWhen: this.mission.successCriteria,
          boundaries: boundaryStatements(this.mission.boundary),
          tasks: (this.plan?.steps ?? []).slice(0, 12).map((step) => ({ title: `${step.id} ${step.title}`, kind: step.kind, checks: step.requiredCapabilities.includes("verify") ? ["run the step's own checks"] : [] })),
        };
        agentsMdSeeded = writeAgentsMd(this.options.repository, input);
      } catch {
        agentsMdSeeded = null;
      }
    }
    this.transition("READY", `Plan produced: ${this.plan.steps.length} steps, framework ${this.plan.frameworkId}.${agentsContextSummary ? ` Conventions: ${agentsContextSummary}.` : ""}`);
    this.recorder.record({
      kind: "MISSION_PLANNED",
      actor: "planner",
      authority: "policy:planning",
      policy: "mission.plan-inspectable",
      reason: `Framework ${this.plan.frameworkId} selected; ${this.plan.steps.length} steps proposed.`,
      evidence: this.planResult.signals.evidence,
      subjectId: this.plan.planId,
      data: {
        frameworkId: this.plan.frameworkId,
        steps: this.plan.steps.map((s) => ({ id: s.id, title: s.title, kind: s.kind, risk: s.risk, requiresApproval: s.requiresApproval, rationale: s.rationale })),
        waves: parallelWaves(this.plan.steps).length,
        estimatedCostUsd: this.plan.estimatedCostUsd,
        warnings: this.plan.warnings,
        frameworkScores: this.planResult.frameworkScores.slice(0, 5),
        agentsContext: agentsContextSummary || "no workspace",
        agentsMdSeeded: agentsMdSeeded ?? null,
      },
    });
    if (this.options.team && this.plan) {
      this.teamBinding = bindTeamToPlan(this.options.team, this.plan.steps);
      applyTeamToSteps(this.plan.steps, this.teamBinding);
      this.recorder.record({
        kind: "HARNESS_SELECTED",
        actor: "team",
        authority: `team:${this.options.team.id}`,
        policy: "mission.team-bound",
        reason: `Bound to crew ${this.options.team.name}`,
        subjectId: null,
        data: {
          teamId: this.options.team.id,
          teamName: this.options.team.name,
          bound: this.teamBinding.bound,
          unbound: this.teamBinding.unbound,
          bindings: this.teamBinding.bindings,
        },
      });
    }
    this.checkpoint("after planning", "The plan is fixed; this is the rollback point for any reorganization.");
    return this.plan;
  }

  getTeamBinding(): BindResult | null {
    return this.teamBinding;
  }

  getPlan(): MissionPlan | null {
    return this.plan;
  }

  getGraph(): WorkflowGraph {
    return this.graph;
  }

  /* ------------------------------------------------------------------ §3 organization */

  /** Instantiate the organization from the plan. */
  buildOrganization(): OrgAgent[] {
    if (!this.plan) throw new Error("call prepare() before buildOrganization()");
    const agents: OrgAgent[] = [];
    for (const step of this.plan.steps) {
      if (step.agentDefId.startsWith("control.")) continue; // approval gates are not agents
      if (this.org.byDefinition(step.agentDefId)) continue; // one instance per role is enough
      if (!DEFINITIONS_BY_ID.has(step.agentDefId)) {
        this.recorder.record({
          kind: "POLICY_DENIED",
          actor: "planner",
          authority: "runtime",
          policy: "organization.spawn",
          reason: `No node definition for ${step.agentDefId}; step "${step.title}" has no agent.`,
          subjectId: step.id,
        });
        continue;
      }
      try {
        agents.push(
          this.org.spawn({
            definitionId: step.agentDefId,
            purpose: step.purpose,
            nodeId: this.nodeIdForStep(step.id) ?? null,
            planStepId: step.id,
            spawnedBy: "planner",
            spawnReason: `Plan step "${step.title}" requires this role. ${step.rationale}`,
          }),
        );
      } catch (e) {
        this.recorder.record({
          kind: "POLICY_DENIED",
          actor: "planner",
          authority: "runtime",
          policy: "organization.concurrency",
          reason: e instanceof Error ? e.message : String(e),
          subjectId: step.id,
        });
      }
    }
    tasksFromPlan(this.org, this.plan.steps);
    for (const task of this.org.tasks_()) {
      const step = this.plan.steps.find((s) => s.id === task.planStepId);
      if (step) {
        this.taskToStep.set(task.taskId, step);
        const nodeId = this.nodeIdForStep(step.id);
        if (nodeId) this.taskToNode.set(task.taskId, nodeId);
      }
    }
    return agents;
  }

  /* ------------------------------------------------------------------ §36 execution */

  /** Run to completion (or to a block the runtime cannot resolve). */
  async run(): Promise<MissionRunResult> {
    if (!this.plan) this.prepare();
    if (!this.org.agents().length) this.buildOrganization();
    this.transition("RUNNING", "Organization instantiated; executing the plan.");
    this.mission.startedAt = this.mission.startedAt ?? new Date().toISOString();
    this.startedAt = Date.now();

    // 16.10.1 — resume from the digest-verified durable snapshot when one
    // exists for this mission: the runtime's own restore() refuses tampered
    // or foreign state loudly, and completed work is not repeated.
    try {
      const res = durableResume(this, this.durableKV);
      if (res.ok) this.transition("RUNNING", `Durable resume: ${res.completedNodeIds.length} completed nodes restored (snapshot saved ${res.savedAt}) — finished work is not repeated.`);
      else if (res.refused.startsWith("no durable snapshot")) {
        /* a first run: nothing stored, nothing claimed */
      } else {
        this.noteResumeRefusal("runtime-state", res.refused);
      }
    } catch (e) {
      this.noteResumeRefusal("runtime-state", `durability raised on this host (${e instanceof Error ? e.message : String(e)}) — the mission runs, but nothing durable was restored.`);
    }

    // 19.7.16 — the RUN CHAIN, reloaded from the host's storage. This is the
    // call that makes a crash a resume: `resumeRun` reads the journal the
    // checkpoints wrote, so the chain and its state snapshots survive the
    // process that produced them. It is deliberately BEFORE any new work:
    // the verdict has to be on the record before the run moves on.
    const chain = resumeRun(this.durableRunId(), this.durableKV);
    if (chain.ok) {
      this.resumePoint = { fromStep: chain.fromStep, label: chain.label, checkpoints: chain.checkpoints, source: chain.source };
      this.recorder.record({
        kind: "MISSION_STATUS",
        actor: "runtime",
        authority: "policy:durable-run",
        policy: "mission.resume-run-chain",
        reason: `Run chain ${this.durableRunId()} reloaded from ${chain.source}: resuming at step ${chain.fromStep} ("${chain.label}") across ${chain.checkpoints} checkpoint(s).`,
        evidence: [`source=${chain.source}`, `checkpoints=${chain.checkpoints}`],
        subjectId: this.mission.missionId,
        data: { runId: this.durableRunId(), fromStep: chain.fromStep, label: chain.label, source: chain.source, checkpoints: chain.checkpoints },
      });
    } else if (chain.reason !== "no-journal" && chain.reason !== "unknown-run") {
      // A journal EXISTS and will not load. That is never "start fresh":
      // the refusal is recorded, exposed, and repeated in the mission's own
      // reason so no reader can mistake this run for one that had nothing
      // to lose.
      this.noteResumeRefusal("run-chain", chain.detail);
    }

    let guard = 0;
    while (!this.cancelled && guard++ < 200) {
      while (this.paused && !this.cancelled) await sleep(50);

      this.resources.spend({ wallClockMs: 0 });
      const violation = this.resources.maySpend(0, this.org.agentsInState("ACTIVE").length);
      if (violation) {
        this.recorder.record({
          kind: "RESOURCE_LIMIT",
          actor: "resource-manager",
          authority: "policy:budget",
          policy: `budget.${violation.limit}`,
          reason: `${violation.limit} ceiling reached: ${violation.value} of ${violation.ceiling}.`,
          subjectId: this.mission.missionId,
          data: { ...violation },
        });
        this.transition("BLOCKED", `Budget ceiling ${violation.limit} reached. A human must raise it or stop the mission.`);
        break;
      }

      // §5 supervise: detect, recommend, and execute what policy allows.
      const signals = this.detect();
      const recommendations = this.supervisor.recommend(signals);
      for (const rec of recommendations) {
        if (rec.autoExecutable) await this.executeRecommendation(rec.id);
      }

      if (this.org.isDone()) break;

      // §11 gated tasks are part of the wave: the gate runs inside executeTask. Excluding them
      // here (as V6.0-rc did) left release steps permanently undispatchable.
      const wave = this.org.dispatchableWave();
      if (!wave.length) {
        if (this.org.hasUnrecoverable() && !this.services.approvals.pendingForMission(this.mission.missionId).length) {
          const diagnosis = this.supervisor.diagnoseOrganization(this.failures, this.plan);
          if (diagnosis.reorganize && this.mission.riskPolicy.allowReorganization) {
            await this.reorganize(diagnosis.reason, diagnosis.evidence);
            continue;
          }
          this.transition("BLOCKED", "A task exhausted its repair budget and no further automated strategy applies.");
          break;
        }
        if (this.org.tasksInState("PENDING", "ASSIGNED", "RUNNING").length === 0) break;
        // Nothing dispatchable but work remains: either waiting on approval or deadlocked.
        if (this.services.approvals.pendingForMission(this.mission.missionId).length) {
          this.transition("BLOCKED", "Waiting on a human approval gate.");
          await this.drainApprovals();
          this.transition("RUNNING", "Approval resolved; resuming.");
          continue;
        }
        const deadlock = this.failures.find((f) => f.kind === "DEPENDENCY_DEADLOCK");
        this.transition("BLOCKED", deadlock ? `Dependency deadlock: ${deadlock.detail}` : "No dispatchable task remains.");
        break;
      }

      for (const task of wave) {
        if (this.cancelled) break;
        await this.executeTask(task.taskId);
        this.durableSnapshot(); // 16.10.1 — save after EVERY step, not just verified ones
      }
    }

    return this.finish();
  }

  /** 16.10.1 — the durable envelope: the runtime's OWN persist() state, digest-
   * stamped and stored locally. Best-effort: a non-persistent host degrades
   * honestly instead of killing the mission. */
  private durableSnapshot(): void {
    try { durableSave(this, this.durableKV); } catch { /* degradation, never fabrication */ }
  }

  /** Execute one task end to end: arbitrate, gate, run, evaluate, repair if needed. */
  private async executeTask(taskId: string): Promise<void> {
    const task = this.org.task(taskId);
    if (!task) return;
    if (task.state === "DONE" || task.state === "CANCELLED") return;
    // 16.10.1 — the Done ledger: an action that already ran AND verified in a
    // previous run (crash, restart) never fires twice.
    const doneKey = DoneLedger.actionId(this.mission.missionId, this.taskToNode.get(taskId) ?? taskId, task.title);
    if (this.doneLedger.isDone(doneKey)) {
      this.org.setState(taskId, "DONE", { actor: "done-ledger", reason: "Already executed and verified in a previous run — never twice." });
      return;
    }
    // A task can acquire dependencies after it was scheduled — SPLIT_TASK turns the parent
    // into a join over its children. Do not run it until those are satisfied.
    if (!this.org.dependenciesMet(task)) {
      this.org.setState(taskId, "PENDING", { actor: "runtime", reason: "waiting on dependencies" });
      return;
    }
    const step = this.taskToStep.get(taskId) ?? null;

    // §11 approval gate before risk-bearing work.
    if (step?.requiresApproval || task.risk === "CRITICAL" || task.cls === "APPROVAL_GATED") {
      const approved = await this.requestApproval(task, step);
      if (!approved) {
        /* §RETRY LANES — THE WAIT IS ON THE CHAIN, NOT ON THE LADDER. This is the
         * moment that used to be invisible: the run parks here for however long a
         * person takes, and until this module the only durable record of it was a
         * chain entry indistinguishable from a failed repair. Recorded explicitly,
         * with the approval's own identity in the payload, so "did this run spend
         * retries or did it wait" is a question the journal answers rather than one
         * somebody has to infer from a step number. */
        this.checkpoint(
          `awaiting-human "${task.title}"`,
          "The run is parked on a human approval gate. Waiting is not failing: this step charges no failure retry.",
          "awaiting-human",
        );
        this.org.setState(taskId, "BLOCKED", { error: "Awaiting or denied by human approval.", actor: "approval-gate" });
        return;
      }
    }

    const agent = this.pickAgentFor(task, step);
    if (!agent) {
      this.org.setState(taskId, "BLOCKED", {
        error: `missing capabilities: no roster member can perform "${task.title}"`,
        actor: "runtime",
      });
      return;
    }
    if (step?.requiresApproval || task.risk === "CRITICAL" || task.cls === "APPROVAL_GATED") {
      // §26 The moment a human signs off on a risk-bearing action is exactly the state they
      // would want to get back to if it goes wrong.
      //
      // §RETRY LANES — labelled `continuation` rather than left to the classifier:
      // the label here is `before "<task title>"`, and a task titled
      // "before deploying the approval gate fix" would otherwise be read as a
      // failure by a classifier that cannot see the title's meaning. The runtime
      // knows what this moment is, so it says so. Advancing past an answered gate
      // is progress, not a retry.
      this.checkpoint(
        `before "${task.title}"`,
        "A human approved this risk-bearing action; this is the rollback point for it.",
        "continuation",
      );
    }
    this.org.delegate(taskId, agent.agentId, `Plan step "${step?.title ?? task.title}" assigned to ${agent.title}.`, "runtime");
    this.org.setState(taskId, "RUNNING", { actor: agent.agentId });

    // §6 arbitrate the runtime.
    if (!agent.harness) {
      const harness = this.arbitrate(task, step, agent);
      if (!harness) {
        this.org.setState(taskId, "FAILED", { error: "No eligible harness for this task.", actor: "arbitration" });
        await this.repair(taskId);
        return;
      }
    }

    const outcome = await this.invokeHarness(task, agent, step);
    if (outcome.simulated) this.simulatedUsed = true;

    const provenance = this.provenanceFor(agent, task, outcome);
    let artifact: Artifact | null = null;
    if (outcome.text || !outcome.ok) {
      artifact = this.services.artifacts.create(
        {
          missionId: this.mission.missionId,
          name: `${task.title} — ${agent.title}`,
          content: outcome.ok ? outcome.text : `FAILED: ${outcome.error ?? "no output"}`,
          contentType: step?.kind === "test" ? "report" : "markdown",
          createdBy: agent.title,
          parentArtifactIds: task.inputArtifactIds,
          inputs: task.inputArtifactIds,
          provenance,
          taskId,
        },
        this.recorder,
      );
      this.org.addOutput(taskId, artifact.artifactId);
      this.finalArtifactIds.push(artifact.artifactId);
    }

    // §18 independent evaluation. The producing agent never evaluates its own work.
    const evaluation = await this.evaluate(task, step, agent, outcome, artifact);
    if (artifact) this.services.artifacts.setEvaluation(artifact.artifactId, evaluation);
    this.recorder.record({
      kind: evaluation.passed ? "EVALUATION_PASSED" : "EVALUATION_FAILED",
      actor: "evaluation",
      authority: "policy:independent-evaluation",
      policy: "evaluation.no-self-certification",
      reason: evaluation.passed
        ? `All ${evaluation.checks.length} check(s) passed.`
        : evaluation.unmeasured.length
          ? `Not verified: ${evaluation.unmeasured.join("; ")}`
          : `Failed: ${evaluation.checks.filter((c) => !c.passed).map((c) => c.name).join(", ")}`,
      evidence: evaluation.checks.flatMap((c) => c.evidence).slice(0, 6),
      subjectId: artifact?.artifactId ?? taskId,
      data: { fullyMeasured: evaluation.fullyMeasured, checks: evaluation.checks.map((c) => ({ name: c.name, source: c.source, passed: c.passed, measured: c.measured })) },
    });

    this.services.ledger.record({
      missionId: this.mission.missionId,
      harness: (agent.harness ?? "hermes") as HarnessId,
      taskId,
      taskKind: step?.kind ?? "implementation",
      languages: step?.languages ?? [],
      repository: this.options.repository ?? this.mission.workspace,
      success: outcome.ok,
      independentlyVerified: evaluation.passed && evaluation.fullyMeasured,
      latencyMs: outcome.latencyMs,
      costUsd: outcome.costUsd,
      failureKind: outcome.ok ? null : "REPEATED_FAILURE",
    });
    this.services.reputation.note("agent", agent.definitionId, step?.kind ?? "general", evaluation.passed && evaluation.fullyMeasured, outcome.latencyMs);
    if (agent.harness) this.services.reputation.note("harness", agent.harness, step?.kind ?? "general", evaluation.passed && evaluation.fullyMeasured, outcome.latencyMs);
    this.org.recordWork(agent.agentId, {
      success: outcome.ok,
      tokensIn: Math.round((task.description.length) / 4),
      tokensOut: Math.round((outcome.text?.length ?? 0) / 4),
      costUsd: outcome.costUsd,
      latencyMs: outcome.latencyMs,
    });
    this.resources.spend({ costUsd: outcome.costUsd, tokens: Math.round(((task.description.length) + (outcome.text?.length ?? 0)) / 4) });

    if (outcome.ok && evaluation.passed) {
      this.org.setState(taskId, "DONE", { actor: agent.agentId, reason: `Completed and independently verified (${evaluation.checks.length} checks).` });
      const nodeId = this.taskToNode.get(taskId);
      if (nodeId) this.completedNodeIds.add(nodeId);
      this.doneLedger.markDone(doneKey, true); // verified completion — the only markDone
      this.durableSnapshot();
      this.services.memory.remember({
        scope: "AGENT",
        scopeKey: agent.definitionId,
        missionId: this.mission.missionId,
        kind: "what_worked",
        content: `${agent.title} delivered "${task.title}" via ${agent.harness ?? "in-process"}; verified by ${evaluation.checks.map((c) => c.name).join(", ")}.`,
        evidence: evaluation.checks.flatMap((c) => c.evidence).slice(0, 3),
        importance: 0.6,
      });
      return;
    }

    const failedMeasured = evaluation.checks.filter((c) => c.measured && !c.passed).map((c) => c.name);
    if (outcome.ok && failedMeasured.length === 0) {
      // §18: not verified is NOT the same as failed. Nothing measured a failure, so there is
      // nothing to repair — but the mission must not claim this work as verified either. The
      // task completes honestly and the shortfall is carried into the mission's completion.
      this.org.setState(taskId, "DONE", {
        actor: "evaluation",
        reason: `Delivered but not independently verified — unmeasured: ${evaluation.unmeasured.join("; ")}.`,
      });
      const nodeId = this.taskToNode.get(taskId);
      if (nodeId) this.completedNodeIds.add(nodeId);
      this.services.memory.remember({
        scope: "FAILURE",
        scopeKey: `${step?.kind ?? "task"}:unmeasured`,
        missionId: this.mission.missionId,
        kind: "what_failed",
        content: `"${task.title}" was accepted without independent verification: ${evaluation.unmeasured.join("; ")}. A future mission must run these checks for real.`,
        evidence: [`unmeasured=${evaluation.unmeasured.join("|")}`, `harness=${agent.harness ?? "in-process"}`],
        importance: 0.8,
      });
      return;
    }

    this.org.setState(taskId, "FAILED", {
      error: outcome.error ?? (evaluation.unmeasured.length ? `Not independently verified: ${evaluation.unmeasured.join("; ")}` : "Evaluation failed."),
      actor: agent.agentId,
    });
    this.recorder.record({
      kind: "AGENT_FAILED",
      actor: agent.agentId,
      authority: "runtime",
      policy: "task.failure",
      reason: outcome.error ?? "Evaluation did not pass.",
      subjectId: taskId,
      data: { attempts: task.attempts, harness: agent.harness },
    });
    await this.repair(taskId);
  }

  /* ------------------------------------------------------------------ §6 arbitration */

  private arbitrate(task: OrgTask, step: PlanStep | null, agent: OrgAgent): AgentRuntimeId | null {
    if (!step) return null;
    try {
      const decision = selectHarness(
        {
          mission: this.mission,
          step,
          installed: this.options.installed ?? {},
          allowSimulated: this.options.allowSimulated,
          repository: this.options.repository,
        },
        this.services.ledger,
      );
      agent.harness = decision.chosen as AgentRuntimeId as HarnessId;
      this.org.setHarness(agent.agentId, agent.harness, `Arbitration selected ${decision.chosen} for "${task.title}".`, "arbitration", decision.rationale);
      return decision.chosen as AgentRuntimeId;
    } catch (e) {
      this.recorder.record({
        kind: "POLICY_DENIED",
        actor: "arbitration",
        authority: "policy:arbitration",
        policy: "arbitration.no-eligible-harness",
        reason: e instanceof Error ? e.message : String(e),
        subjectId: task.taskId,
      });
      return null;
    }
  }

  private async invokeHarness(task: OrgTask, agent: OrgAgent, step: PlanStep | null) {
    const harness = getHarness((agent.harness ?? "hermes") as AgentRuntimeId);
    if (!harness) {
      return { ok: false, text: "", exitCode: null, latencyMs: 0, costUsd: 0, simulated: false, detail: "unknown harness", error: `unknown harness ${String(agent.harness)}` };
    }
    const prompt = [
      agent.contract.identity,
      "",
      `# Purpose`,
      agent.contract.purpose,
      "",
      `# Task`,
      task.title,
      task.description,
      "",
      `# Success criteria`,
      ...agent.contract.successCriteria.map((c) => `- ${c}`),
      "",
      "Report only what you actually did. If you could not verify something, say so.",
    ].join("\n");

    // §10/§33 The mission's risk class and boundary become the harness sandbox, and the stated
    // contract goes in front of the prompt. Both are recorded: the user must be able to see what
    // the agent was allowed to touch before it touched anything.
    const harnessTask: Parameters<typeof harness.invoke>[0] = {
      taskId: task.taskId,
      title: task.title,
      prompt,
      kind: step?.kind ?? "implementation",
      languages: step?.languages ?? [],
      cwd: this.mission.workspace,
      timeoutMs: agent.contract.timeoutMs,
      requiredCapabilities: step?.requiredCapabilities ?? [],
      risk: task.risk,
      mayWriteFiles: agent.contract.permissions.filesystemWrite,
      mayRunShell: agent.contract.permissions.shell,
      mayUseBrowser: agent.contract.permissions.browser,
      grantedPermissions: { ...agent.contract.permissions },
    };
    // The per-CLI permission preamble (harnessPolicy.preambleFor) went with the
    // external harnesses. The native loop enforces policy at the tool boundary
    // through the human gate, not by prepending vendor-specific flag text.
    {
      this.recorder.record({
        kind: "HARNESS_SELECTED",
        actor: "runtime",
        authority: `policy:risk-${task.risk}`,
        // No vendor argv any more. The native loop has no CLI flags to compose;
        // the receipt records the authority and the risk level, and enforcement
        // happens at the tool boundary through the human gate.
        policy: `sandbox.${!agent.contract.permissions.filesystemWrite ? "read-only" : "workspace-write"}`,
        reason: `${agent.harness ?? "hermes"} (native) will run "${task.title}" under ${task.risk} authority`,
        evidence: [`risk=${task.risk}`, "native-runtime", "no-external-cli"],
        subjectId: task.taskId,
        data: { runtime: "native", risk: task.risk, externalCli: false },
      });
    }
    return harness.invoke(harnessTask);
  }

  /* ------------------------------------------------------------------ §18 evaluation */

  private async evaluate(task: OrgTask, step: PlanStep | null, agent: OrgAgent, outcome: { ok: boolean; text: string; simulated: boolean }, artifact: Artifact | null) {
    const checks: EvaluationCheck[] = [];
    const kind = step?.kind ?? "implementation";

    checks.push(
      mkCheck({
        name: `Self-report by ${agent.title}`,
        source: "AGENT_SELF_REPORT",
        passed: outcome.ok,
        score: outcome.ok ? 1 : 0,
        detail: outcome.ok ? "The producing agent reports success. This is not verification." : "The producing agent reports failure.",
        evidence: outcome.text ? [outcome.text.slice(0, 500)] : [],
      }),
    );

    // §18 The strongest evidence available: the repository's own test suite, actually executed.
    // This is what lets a mission be verified rather than merely believed. It outranks both the
    // agent's self-report and any parsing of its prose.
    const real = await this.realCheckResults();
    const realTest = real.find((r) => r.spec.source === "TEST_RUN");
    const realStatic = real.filter((r) => r.spec.source === "STATIC_CHECK");

    if (kind === "test" || kind === "implementation") {
      const cmd = kind === "test" ? "test suite" : "build";
      if (realTest?.didRun) {
        checks.push(testRunCheck(`${realTest.spec.command} ${realTest.spec.args.join(" ")}`, realTest.output, realTest.exitCode));
      } else if (realTest) {
        checks.push(unmeasuredCheck(`Test run: ${cmd}`, "TEST_RUN", `the repository's own test command could not be run: ${realTest.reason}`));
      } else if (outcome.simulated) {
        checks.push(unmeasuredCheck(`Test run: ${cmd}`, "TEST_RUN", "the runtime was VH's labelled simulation, so no real command was executed"));
      } else {
        checks.push(testRunCheck(cmd, outcome.text, outcome.ok ? 0 : 1));
      }
    }

    if (kind === "implementation" || kind === "security") {
      const hasStaticEvidence = /\b(typecheck|tsc|eslint|ruff|mypy|clippy|lint)\b/i.test(outcome.text);
      if (realStatic.some((r) => r.didRun)) {
        for (const r of realStatic.filter((x) => x.didRun)) {
          checks.push(
            mkCheck({
              name: `Static checks: ${r.spec.label}`,
              source: "STATIC_CHECK",
              passed: r.exitCode === 0,
              score: r.exitCode === 0 ? 1 : 0,
              detail: `${r.spec.command} ${r.spec.args.join(" ")} exited ${r.exitCode ?? "?"} (${r.spec.discoveredFrom})`,
              evidence: [r.output.slice(0, 2000)],
            }),
          );
        }
      } else if (realStatic.length) {
        checks.push(unmeasuredCheck("Static checks", "STATIC_CHECK", `the repository's own static checks could not be run: ${realStatic[0].reason}`));
      } else if (!hasStaticEvidence) {
        checks.push(unmeasuredCheck("Static checks", "STATIC_CHECK", "no typecheck or lint output was produced"));
      } else {
        checks.push(mkCheck({ name: "Static checks", source: "STATIC_CHECK", passed: outcome.ok, score: outcome.ok ? 1 : 0, detail: "Static analysis output present in the result.", evidence: [outcome.text.slice(0, 500)] }));
      }
    }

    if (kind === "security") {
      const hasFindings = /\b(finding|severity|cve|vulnerab|risk)\b/i.test(outcome.text);
      checks.push(
        hasFindings
          ? mkCheck({ name: "Security review", source: "SECURITY_CHECK", passed: outcome.ok, score: outcome.ok ? 1 : 0, detail: "Findings recorded with severity.", evidence: [outcome.text.slice(0, 500)] })
          : unmeasuredCheck("Security review", "SECURITY_CHECK", "no findings were recorded, so nothing was reviewed"),
      );
    }

    // Independent review: a different agent, or none at all — never the producer.
    const reviewer = this.org.agents().find(
      (a) => a.agentId !== agent.agentId && ["agent.reviewer", "agent.judge", "agent.qa", "agent.critic"].includes(a.definitionId) && a.state !== "REMOVED",
    );
    if (reviewer && artifact) {
      // §18: the reviewer judges the artifact, not the producer's claim. Copying `outcome.ok`
      // here would make the "independent" check a second copy of the self-report.
      const review = this.reviewArtifact(reviewer, artifact);
      checks.push(
        mkCheck({
          name: `Independent review by ${reviewer.title}`,
          source: "INDEPENDENT_REVIEW",
          passed: review.passed,
          score: review.score,
          detail: review.detail,
          evidence: review.evidence,
        }),
      );
    } else if (kind !== "approval" && kind !== "release") {
      checks.push(unmeasuredCheck("Independent review", "INDEPENDENT_REVIEW", "no reviewer role exists in this organization"));
    }

    return evaluateArtifact({
      artifactId: artifact?.artifactId ?? task.taskId,
      kind,
      checks,
      selfReportedBy: agent.agentId,
    });
  }

  /**
   * §18 The independent review. The reviewer is a different agent and it looks at the artifact,
   * not at what the producer said about it: substance, coverage of the mission's success
   * criteria, and the absence of any self-declared failure in the work product.
   */
  private reviewArtifact(reviewer: OrgAgent, artifact: Artifact) {
    const content = artifact.content;
    const criteria = this.mission.successCriteria.filter((c) => c.trim().length > 0);
    const substantive = content.replace(/\s+/g, " ").trim().length >= 120;
    const concrete = /(```|\bfunction\b|\bclass\b|\bconst\b|\binterface\b|\bimport\b|\|)/.test(content);
    const covered = criteria.filter((c) => content.toLowerCase().includes(c.split(/\s+/).slice(0, 2).join(" ").toLowerCase()));
    const admitsFailure = /\b(failed|failing|error:|exception|cannot find|not implemented|todo:|fixme)\b/i.test(content);
    const findings: string[] = [];
    if (!substantive) findings.push("the artifact is too thin to review (under 120 characters of substance)");
    // `concrete` informs the score below but is not a reason to fail: a prose architecture
    // document is a legitimate artifact and contains no code block.
    // An unaddressed success criterion is an *unmet criterion* — the mission score reports it
    // separately. It is not grounds for the reviewer to fail the review.
    if (admitsFailure) findings.push("the work product itself records a failure or unfinished work");
    const score = Math.max(0, Math.round(((substantive ? 0.6 : 0) + (concrete ? 0.2 : 0) + (criteria.length ? (covered.length / criteria.length) * 0.2 : 0.2) + (admitsFailure ? 0 : 0)) * 100) / 100);
    return {
      passed: findings.length === 0,
      score,
      detail: findings.length
        ? `${reviewer.title} reviewed "${artifact.name}" and refused it: ${findings.join("; ")}.`
        : `${reviewer.title} reviewed "${artifact.name}": substantive (${content.length} chars)${concrete ? ", concrete content present" : ", no code or table present"}, ${covered.length}/${criteria.length} success criteria addressed, no failure admitted in the work product.`,
      evidence: [
        `reviewer=${reviewer.definitionId}`,
        `length=${content.length}`,
        `criteriaAddressed=${covered.length}/${criteria.length}`,
        `admitsFailure=${admitsFailure}`,
        content.slice(0, 240),
      ],
    };
  }

  /**
   * §18 Run the target repository's own verification, once per mission, and remember it. Running
   * a test suite per artifact would be wasteful and would make the evaluation depend on when in
   * the run an artifact happened to be produced.
   */
  private async realCheckResults(): Promise<CheckResult[]> {
    if (this.realChecks) return this.realChecks;
    const repoDir = this.options.repository ?? this.mission.workspace;
    if (!repoDir || repoDir === ".") {
      this.realChecks = [];
      return this.realChecks;
    }
    try {
      this.realChecks = await runAllChecks(repoDir);
    } catch (e) {
      // Discovery failing must never look like a failed check.
      this.realChecks = [];
      this.recorder.record({
        kind: "POLICY_DENIED",
        actor: "evaluation",
        authority: "policy:real-verification",
        policy: "evaluation.no-invented-results",
        reason: `Could not discover the repository's own verification commands in ${repoDir}: ${e instanceof Error ? e.message : String(e)}. Checks stay unmeasured rather than guessed.`,
        evidence: [`repository=${repoDir}`],
        subjectId: this.mission.missionId,
      });
    }
    if (this.realChecks.length) {
      this.recorder.record({
        kind: "EVALUATION_STARTED",
        actor: "evaluation",
        authority: "policy:real-verification",
        policy: "evaluation.repository-own-commands",
        reason: `Ran the repository's own verification: ${this.realChecks.map((r) => `${r.spec.label}=${r.didRun ? `exit ${r.exitCode}` : "not run"}`).join(", ")}`,
        evidence: this.realChecks.map((r) => `${r.spec.discoveredFrom} -> ${r.didRun ? `exit ${r.exitCode}` : r.reason}`),
        subjectId: this.mission.missionId,
        data: { checks: this.realChecks.map((r) => ({ id: r.spec.id, didRun: r.didRun, exitCode: r.exitCode })) },
      });
    }
    return this.realChecks;
  }

  /* ------------------------------------------------------------------ §16 repair */

  private async repair(taskId: string): Promise<void> {
    const task = this.org.task(taskId);
    if (!task) return;
    // A repair already running for this task must not be started again: the supervisor and the
    // task path can both ask for one in the same cycle.
    if (this.repairInFlight.has(taskId)) return;
    if (this.repairExhausted.has(taskId)) return;

    const count = (this.repairCount.get(taskId) ?? 0) + 1;
    this.repairCount.set(taskId, count);
    /* §RETRY LANES (Paperclip, MIT) — THE DURABLE FLOOR.
     *
     * `this.repairs` and `repairCount` are module-scope memory, and `persist()`
     * writes version 6 without either of them, while it DOES write
     * `resources.usage.retries`. So a run that crashed after three real failures
     * came back with a clean ladder and a ledger that remembered three — and a
     * ladder that can always find one more rung is, in this file's own words at
     * the hard stop below, a loop rather than a ladder. The durable chain is the
     * only account of what this run actually attempted that survives the process,
     * so the run-level ceiling now reads the HARDER of the two numbers.
     *
     * `failureRetries` counts the failure lane and nothing else, which is the
     * other half of the fix: the gate pauses, the settled waves and the busy
     * waits are tallied beside it and never in it. A crew that sat three hours
     * waiting for a human resumes with the retries it actually spent — none. */
    const durableFailureRetries = retryAccounting(this.durableRunId()).failureRetries;
    const ladderUsed = Math.max(this.repairs.length, durableFailureRetries);
    // Hard stop. A repair ladder that can always find one more rung is a loop, not a ladder.
    if (count > this.options.maxRepairAttempts || ladderUsed >= this.options.maxRepairAttempts * Math.max(1, this.org.tasks_().length)) {
      this.repairExhausted.add(taskId);
      this.recorder.record({
        kind: "FAILURE_DETECTED",
        actor: "supervisor",
        authority: "policy:repair-budget",
        policy: `budget.maxRetriesPerTask=${this.options.maxRepairAttempts}`,
        reason: `Repair budget exhausted for "${task.title}" after ${count - 1} attempt(s). Escalating instead of retrying.`,
        evidence: [`repairAttempts=${count - 1}`, `durableFailureRetries=${durableFailureRetries}`, `strategiesTried=${(this.triedStrategies.get(taskId) ?? []).join(", ")}`],
        subjectId: taskId,
        data: { failureKind: "TOOL_FAILURE_LOOP", severity: "CRITICAL" },
      });
      this.transition("BLOCKED", `Repair budget exhausted for "${task.title}". A human must decide.`);
      return;
    }
    this.repairInFlight.add(taskId);
    try {
      await this.repairInner(task, count);
    } finally {
      this.repairInFlight.delete(taskId);
    }
  }

  private async repairInner(task: OrgTask, attemptNumber: number): Promise<void> {
    const taskId = task.taskId;
    // §16/§26 A repair mutates the organization. Take the rollback point before it does, so
    // "undo the repair" is a real operation and not a hope.
    //
    // §RETRY LANES — the one site that charges a failure retry, stated rather than
    // inferred from the label. This is the lane's namesake: a repair ladder is what
    // the budget exists to bound, and a genuine failing step must still walk it.
    this.checkpoint(
      `before repairing "${task.title}"`,
      `Repair attempt ${attemptNumber}: the pre-repair organization state.`,
      "failure",
    );

    const failure: FailureSignal = {
      id: uid("fail"),
      missionId: this.mission.missionId,
      kind: "REPEATED_FAILURE",
      severity: task.attempts >= task.maxAttempts ? "ERROR" : "WARN",
      subject: taskId,
      detail: task.error ?? `Task "${task.title}" failed.`,
      evidence: [task.error ?? ""],
      detectedAt: new Date().toISOString(),
      resolvedBy: null,
    };
    this.failures.push(failure);

    const agent = task.agentId ? this.org.agent(task.agentId) : null;
    const tried = this.triedStrategies.get(taskId) ?? [];
    const choice = this.supervisor.nextRepairStrategy(task, tried, agent);
    if (!choice) {
      this.transition("BLOCKED", `No repair strategy remains for "${task.title}".`);
      return;
    }
    this.triedStrategies.set(taskId, [...tried, choice.strategy]);

    const attempt: RepairAttempt = {
      attemptId: uid("rep"),
      missionId: this.mission.missionId,
      taskId,
      failureId: failure.id,
      strategy: choice.strategy,
      order: attemptNumber,
      rationale: choice.rationale,
      changes: [],
      expectedImprovement: "",
      result: "PENDING",
      detail: "",
      costUsd: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    this.repairs.push(attempt);
    this.transition("REPAIRING", `Repair ${choice.strategy} for "${task.title}".`);
    this.recorder.record({
      kind: "REPAIR_STARTED",
      actor: "supervisor",
      authority: "supervisor",
      policy: `repair.${choice.strategy}`,
      reason: choice.rationale,
      evidence: failure.evidence,
      subjectId: attempt.attemptId,
      data: { strategy: choice.strategy, taskId, attempt: attempt.order, failure: failure.detail },
    });

    try {
      const result = await this.applyRepair(choice.strategy, task, agent, failure);
      attempt.result = result.ok ? "SUCCESS" : "FAILURE";
      attempt.detail = result.detail;
      attempt.changes = result.changes;
      attempt.expectedImprovement = result.expectedImprovement;
      attempt.costUsd = result.costUsd;
    } catch (e) {
      attempt.result = "FAILURE";
      attempt.detail = e instanceof Error ? e.message : String(e);
    }
    attempt.finishedAt = new Date().toISOString();
    this.resources.spend({ costUsd: attempt.costUsd, retries: 1 });

    this.recorder.record({
      kind: "REPAIR_COMPLETED",
      actor: "supervisor",
      authority: "supervisor",
      policy: `repair.${choice.strategy}`,
      reason: attempt.detail,
      evidence: attempt.changes,
      subjectId: attempt.attemptId,
      data: { strategy: choice.strategy, result: attempt.result, costUsd: attempt.costUsd, expectedImprovement: attempt.expectedImprovement },
    });

    if (attempt.result === "SUCCESS") {
      this.services.memory.remember({
        scope: "FAILURE",
        scopeKey: choice.strategy,
        missionId: this.mission.missionId,
        kind: "repair_strategy",
        content: `${choice.strategy} repaired "${task.title}": ${attempt.detail}`,
        importance: 0.7,
        evidence: attempt.changes,
      });
      this.transition("RUNNING", `Repair ${choice.strategy} succeeded; resuming.`);
      const after = this.org.task(taskId);
      // SPLIT_TASK resolves the parent by completing its children, not by re-running it.
      if (after && after.state !== "DONE" && this.org.dependenciesMet(after)) await this.executeTask(taskId);
    } else {
      this.transition("RUNNING", `Repair ${choice.strategy} did not resolve it; the ladder continues.`);
    }
  }

  private async applyRepair(
    strategy: RepairStrategy,
    task: OrgTask,
    agent: OrgAgent | null,
    failure: FailureSignal,
  ): Promise<{ ok: boolean; detail: string; changes: string[]; expectedImprovement: string; costUsd: number }> {
    switch (strategy) {
      case "RETRY": {
        this.org.setState(task.taskId, "PENDING", { error: undefined, actor: "supervisor" });
        return { ok: true, detail: "Task reset to PENDING for another attempt.", changes: ["state: FAILED -> PENDING"], expectedImprovement: "A transient failure will not repeat.", costUsd: 0 };
      }
      case "ENRICH_CONTEXT": {
        const prior = task.error ?? "";
        task.description = `${task.description}\n\n## Previous failure (must be addressed)\n${prior}\n\n## Acceptance criteria\n${this.mission.successCriteria.map((c) => `- ${c}`).join("\n")}`;
        this.org.setState(task.taskId, "PENDING", { error: undefined, actor: "supervisor" });
        return { ok: true, detail: "Task description enriched with the failure output and the acceptance criteria.", changes: ["description += failure + criteria"], expectedImprovement: "The agent addresses the specific failure instead of repeating it.", costUsd: 0 };
      }
      case "SWITCH_HARNESS": {
        const tried = this.triedHarnesses.get(task.taskId) ?? [];
        if (agent?.harness) tried.push(agent.harness as AgentRuntimeId);
        this.triedHarnesses.set(task.taskId, tried);
        const step = this.taskToStep.get(task.taskId) ?? null;
        if (!step || !agent) return { ok: false, detail: "No plan step or agent to re-arbitrate.", changes: [], expectedImprovement: "", costUsd: 0 };
        const decision = selectReplacementHarness(
          { mission: this.mission, step, installed: this.options.installed ?? {}, allowSimulated: this.options.allowSimulated, repository: this.options.repository },
          this.services.ledger,
          tried,
        );
        if (!decision) return { ok: false, detail: `No alternative harness after trying ${tried.join(", ") || "none"}.`, changes: [], expectedImprovement: "", costUsd: 0 };
        agent.harness = decision.chosen as HarnessId;
        this.org.setHarness(agent.agentId, agent.harness, `Switched runtime for "${task.title}" after failure.`, "supervisor", decision.rationale);
        this.org.setState(task.taskId, "PENDING", { error: undefined, actor: "supervisor" });
        return { ok: true, detail: `Harness switched to ${decision.chosen}.`, changes: [`harness: ${tried[tried.length - 1] ?? "none"} -> ${decision.chosen}`], expectedImprovement: "A different runtime may handle this task shape better.", costUsd: 0 };
      }
      case "SPAWN_SPECIALIST": {
        const proposal = this.supervisor.proposeReplacement(failure);
        const defId = proposal?.definitionId ?? "agent.architect";
        const created = this.org.spawn({
          definitionId: defId,
          purpose: task.description,
          planStepId: task.planStepId,
          spawnedBy: "repair",
          spawnReason: `Repair: ${task.title} failed ${task.attempts}×; escalating the role to ${defId}.`,
        });
        this.org.reassign(task.taskId, created.agentId, `Specialist ${created.title} takes over.`, "supervisor");
        return { ok: true, detail: `Spawned ${created.title} (${defId}) and reassigned the task.`, changes: [`spawn ${defId}`, `reassign ${task.taskId}`], expectedImprovement: "A stronger role has the capability the previous agent lacked.", costUsd: 0 };
      }
      case "SPLIT_TASK": {
        const halves = [
          { title: `${task.title} — part 1`, description: task.description.split("\n").slice(0, Math.ceil(task.description.split("\n").length / 2)).join("\n") },
          { title: `${task.title} — part 2`, description: task.description.split("\n").slice(Math.ceil(task.description.split("\n").length / 2)).join("\n") },
        ];
        const children = this.org.split(task.taskId, halves, `Repair: "${task.title}" is large enough to split.`, "supervisor");
        return { ok: true, detail: `Split into ${children.length} subtasks.`, changes: children.map((c) => `+ ${c.title}`), expectedImprovement: "Smaller units are more likely to succeed and easier to diagnose.", costUsd: 0 };
      }
      case "REDUCE_SCOPE": {
        task.description = `${task.description}\n\n## Reduced scope\nDeliver the smallest increment that satisfies: ${this.mission.successCriteria[0] ?? this.mission.objective}. Mark the rest as not done.`;
        this.org.setState(task.taskId, "PENDING", { error: undefined, actor: "supervisor" });
        return { ok: true, detail: "Scope reduced to the smallest verifiable increment.", changes: ["description += reduced scope"], expectedImprovement: "A smaller deliverable is verifiable now rather than never.", costUsd: 0 };
      }
      case "ROLLBACK_CHECKPOINT": {
        const cp = this.services.checkpoints.latest(this.mission.missionId);
        if (!cp) return { ok: false, detail: "No checkpoint exists to roll back to.", changes: [], expectedImprovement: "", costUsd: 0 };
        this.restoreCheckpoint(cp.checkpointId, `Repair: rolling back to "${cp.label}".`);
        return { ok: true, detail: `Rolled back to checkpoint "${cp.label}".`, changes: [`graph v${this.mission.graphVersion} -> v${cp.graphVersion}`], expectedImprovement: "Return to the last known-good state before retrying.", costUsd: 0 };
      }
      case "REORGANIZE": {
        const diagnosis = this.supervisor.diagnoseOrganization(this.failures, this.plan);
        await this.reorganize(diagnosis.reason || `Repair: reorganizing around "${task.title}".`, diagnosis.evidence);
        return { ok: true, detail: "Organization restructured.", changes: ["graph mutated"], expectedImprovement: "The missing role or dependency is now present.", costUsd: 0 };
      }
      case "ESCALATE_HUMAN": {
        const approved = await this.requestApproval(
          { ...task, risk: "CRITICAL" },
          this.taskToStep.get(task.taskId) ?? null,
          `Every automated repair strategy failed for "${task.title}".`,
        );
        if (approved) {
          this.org.setState(task.taskId, "PENDING", { error: undefined, actor: "human" });
          return { ok: true, detail: "A human approved continuing; task reset.", changes: ["human approval"], expectedImprovement: "Human judgement unblocks what automation could not.", costUsd: 0 };
        }
        return { ok: false, detail: "Human escalation was not approved.", changes: [], expectedImprovement: "", costUsd: 0 };
      }
    }
  }

  /* ------------------------------------------------------------------ §17 reorganize */

  private async reorganize(reason: string, evidence: string[]): Promise<void> {
    if (!this.plan) return;
    const diagnosis = this.supervisor.diagnoseOrganization(this.failures, this.plan);
    const nextSteps = [...this.plan.steps];
    for (const kind of diagnosis.addSteps) {
      if (nextSteps.some((s) => s.kind === kind)) continue;
      const defId = kind === "architecture" ? "agent.architect" : kind === "test" ? "agent.tester" : "agent.reviewer";
      nextSteps.push({
        // Unique by construction, even across a rollback: reusing "step-N" after a restore
        // created a second task for a step id that already existed.
        id: `step-x${++this.addedStepSeq}`,
        kind: kind as PlanStep["kind"],
        title: kind === "architecture" ? "Architecture (added by repair)" : kind === "test" ? "Verification (added by repair)" : "Review (added by repair)",
        agentDefId: defId,
        purpose: `Added after repeated failure: ${reason}`,
        requiredCapabilities: kind === "architecture" ? ["architecture"] : kind === "test" ? ["testing"] : ["review"],
        languages: [],
        preferredHarness: null,
        dependsOn: nextSteps.length ? [nextSteps[nextSteps.length - 1].id] : [],
        estimatedCostUsd: 0.5,
        estimatedMs: 90_000,
        risk: "LOW",
        requiresApproval: false,
        rationale: `Repair added this role because ${reason}`,
      });
    }
    const nextPlan: MissionPlan = { ...this.plan, version: this.plan.version + 1, steps: nextSteps };
    const nextGraph = graphFromSteps(this.mission, nextSteps);

    const outcome = proposeMutation(
      {
        mission: this.mission,
        graph: this.graph,
        nextGraph,
        reason,
        evidence,
        requestedBy: "supervisor",
        authority: "SUPERVISOR",
        completedWork: completedTitles(this.graph, this.completedNodeIds),
      },
      this.recorder,
    );
    this.mutations.push(outcome.mutation);

    if (!outcome.applied) {
      this.recorder.record({
        kind: "POLICY_DENIED",
        actor: "supervisor",
        authority: "policy:graph-mutation",
        policy: "graph.mutation-gates",
        reason: `Proposed reorganization refused: ${outcome.blockedBy}`,
        evidence,
        subjectId: outcome.mutation.mutationId,
      });
      this.transition("BLOCKED", `Reorganization refused: ${outcome.blockedBy}`);
      return;
    }

    this.graph = nextGraph;
    this.mission.graphVersion = outcome.mutation.toGraphVersion;
    this.plan = nextPlan;
    this.resources.spend({ graphMutations: 1 });
    // Spawn the new roles and create the new tasks.
    for (const step of nextSteps) {
      if (this.taskToStep.has(step.id)) continue;
      if (this.org.tasks_().some((t) => t.planStepId === step.id)) continue;
      if (!DEFINITIONS_BY_ID.has(step.agentDefId) || step.agentDefId.startsWith("control.")) continue;
      if (!this.org.byDefinition(step.agentDefId)) {
        try {
          this.org.spawn({
            definitionId: step.agentDefId,
            purpose: step.purpose,
            planStepId: step.id,
            spawnedBy: "supervisor",
            spawnReason: `Reorganization: ${reason}`,
          });
        } catch {
          /* concurrency limit — the supervisor will pick it up next cycle */
        }
      }
      const deps = step.dependsOn.map((d) => [...this.taskToStep.entries()].find(([, s]) => s.id === d)?.[0]).filter((x): x is string => Boolean(x));
      const task = this.org.createTask({ title: step.title, description: step.purpose, planStepId: step.id, dependsOn: deps, risk: step.risk });
      this.taskToStep.set(task.taskId, step);
      const nodeId = this.nodeIdForStep(step.id);
      if (nodeId) this.taskToNode.set(task.taskId, nodeId);
    }
    this.checkpoint("after reorganization", reason);
  }

  /* ------------------------------------------------------------------ §11 approvals */

  private async requestApproval(task: OrgTask, step: PlanStep | null, extraReason?: string): Promise<boolean> {
    const agent = task.agentId ? this.org.agent(task.agentId) : null;
    const gate = this.services.approvals.open(
      {
        mission: this.mission,
        requestedBy: agent?.title ?? "runtime",
        agentId: agent?.agentId ?? null,
        action: extraReason ? `${extraReason} — ${task.title}` : `${task.title}: ${task.description.slice(0, 200)}`,
        changes: [`${task.title} will run as ${agent?.title ?? "an agent"} with harness ${agent?.harness ?? "TBD"}`],
        evidence: [task.error ?? "no prior failure", ...(step ? [`plan rationale: ${step.rationale}`] : [])],
        expectedOutcome: this.mission.successCriteria.join("; ") || "The mission objective is advanced.",
        reversible: task.risk !== "CRITICAL",
        // The gate classifies the *action string*, which would score a task called "Release gate"
        // as MEDIUM and wave it through. The plan's classification is authoritative, so it is
        // handed to the gate as an override — the gate may still raise it, never lower it.
        riskOverride: {
          risk: task.risk,
          reason: `Classified ${task.risk} by the mission plan${step ? ` (step "${step.title}")` : ""}; the approval threshold for this mission is ${this.mission.riskPolicy.approvalThreshold}.`,
        },
      },
      this.recorder,
    );
    if (gate.autonomous) return true;
    if (!gate.request) return false;
    this.options.onApprovalRequired?.(gate.request.id);
    const decision = await this.services.approvals.waitFor(gate.request.id, this.options.approvalTimeoutMs, () => this.cancelled);
    return decision === "APPROVED";
  }

  private async drainApprovals(): Promise<void> {
    const pending = this.services.approvals.pendingForMission(this.mission.missionId);
    if (!pending.length) return;
    /* §RETRY LANES — the whole supervision loop blocks in here until a human
     * answers, and that block is the longest thing a mission does. It goes on the
     * chain as its OWN lane with the pending asks named, so a later reader can see
     * that the time went to a person rather than to a failure. Without this line
     * the wall clock is the only witness, and the wall clock cannot tell the two
     * apart — which is precisely the defect. */
    this.checkpoint(
      "awaiting-human (approval gate)",
      `Parked on ${pending.length} unanswered approval(s): ${pending.map((a) => a.id).join(", ")}. Waiting is not failing.`,
      "awaiting-human",
    );
    for (const req of pending) {
      await this.services.approvals.waitFor(req.id, this.options.approvalTimeoutMs, () => this.cancelled);
    }
  }

  /* ------------------------------------------------------------------ §5 detection */

  private detect(): FailureSignal[] {
    const found = detectAll({
      missionId: this.mission.missionId,
      agents: this.org.agents(),
      tasks: this.org.tasks_(),
      artifacts: this.services.artifacts.forMission(this.mission.missionId),
      repairs: this.repairs,
      usage: this.resources.export(),
      budget: this.mission.budget,
      now: Date.now(),
      taskAgeMs: this.org.taskAges(),
    });
    for (const f of found) {
      if (!this.failures.some((x) => x.kind === f.kind && x.subject === f.subject)) this.failures.push(f);
    }
    return found;
  }

  private async executeRecommendation(recId: string): Promise<void> {
    const rec = this.supervisor.list().find((r) => r.id === recId);
    if (!rec || rec.executed) return;
    switch (rec.kind) {
      case "ROLLBACK_CHECKPOINT": {
        const cp = this.services.checkpoints.latest(this.mission.missionId);
        if (cp) this.restoreCheckpoint(cp.checkpointId, rec.reason);
        break;
      }
      case "PAUSE_MISSION": {
        this.transition("PAUSED", rec.reason, "supervisor");
        break;
      }
      case "RETRY": {
        const task = rec.subjectId ? this.org.task(rec.subjectId) : null;
        if (task && task.state !== "DONE") this.org.setState(task.taskId, "PENDING", { error: undefined, actor: "supervisor" });
        break;
      }
      case "SWITCH_HARNESS":
      case "SPAWN_SPECIALIST": {
        if (rec.subjectId) await this.repair(rec.subjectId);
        break;
      }
      default:
        break;
    }
    this.supervisor.markExecuted(recId, rec.reason);
  }

  /* ------------------------------------------------------------------ §26 checkpoints */

  checkpoint(label: string, reason: string, lane?: RetryLane): void {
    this.services.checkpoints.take(
      {
        missionId: this.mission.missionId,
        label,
        reason,
        graphVersion: this.mission.graphVersion,
        graphSnapshot: this.graph,
        taskStates: Object.fromEntries(this.org.tasks_().map((t) => [t.taskId, t.state])),
        artifactVersions: Object.fromEntries(
          this.services.artifacts.forMission(this.mission.missionId).map((a) => [a.lineageRoot, a.version]),
        ),
        roster: this.org.agents().map((a) => ({ agentId: a.agentId, definitionId: a.definitionId, state: a.state })),
        pendingApprovalIds: this.services.approvals.pendingForMission(this.mission.missionId).map((a) => a.id),
        spentUsd: this.resources.usage.costUsd,
      },
      this.recorder,
    );
    this.mission.checkpointId = this.services.checkpoints.latest(this.mission.missionId)?.checkpointId ?? null;
    // 19.7.16 — the same moment also lands on the durable run chain, so the
    // rollback point survives the process that took it. `checkpoint()` is
    // the runtime's §26 hook; this is where its evidence becomes durable, and
    // where it becomes a LABELED step on that chain (§RETRY LANES).
    this.appendRunCheckpoint(label, reason, lane);
  }

  restoreCheckpoint(checkpointId: string, reason: string): boolean {
    const cp = this.services.checkpoints.rollbackTo(checkpointId, this.recorder, "supervisor", reason);
    if (!cp) return false;
    this.graph = structuredClone(cp.graphSnapshot);
    this.mission.graphVersion = cp.graphVersion;
    for (const [taskId, state] of Object.entries(cp.taskStates)) {
      const t = this.org.task(taskId);
      // Only roll tasks backwards; never mark completed work as undone.
      if (t && (t.state === "FAILED" || t.state === "BLOCKED" || t.state === "RUNNING")) {
        this.org.setState(taskId, state === "DONE" ? "PENDING" : state, { actor: "supervisor", reason });
      }
    }
    this.completedNodeIds = new Set(this.graph.nodes.filter((n) => cp.taskStates[taskForNode(this, n.id)] === "DONE").map((n) => n.id));
    return true;
  }

  /* ------------------------------------------------------------------ §26 durable runs */

  /** The run id this mission's steps land on in the durable chain. The
   *  executor and the human gate use the same `run:<slug>` convention, so
   *  one mission's chain is one chain from every seat that records it. */
  durableRunId(): string {
    return `run:${this.mission.missionId}`;
  }

  /** Where the durable chain says this run picked up, or null when nothing
   *  was resumed. Read by the UI alongside `resumeRefusals()`. */
  getResumePoint(): { fromStep: number; label: string; checkpoints: number; source: "journal" | "memory" } | null {
    return this.resumePoint ? { ...this.resumePoint } : null;
  }

  /** Every refusal the durability layer made, in words. A run whose journal
   *  exists but did not load is NOT a fresh run, and this is how a caller
   *  finds that out instead of guessing. */
  resumeRefusals(): string[] {
    return [...this.resumeRefusalLog];
  }

  /** Record a durability refusal. Goes on the flight recorder so it is in
   *  the mission's evidence, and stays readable for the UI. */
  private noteResumeRefusal(seat: "run-chain" | "runtime-state", detail: string): void {
    this.resumeRefusalLog.push(`[${seat}] ${detail}`);
    this.recorder.record({
      kind: "FAILURE_DETECTED",
      actor: "durable-store",
      authority: "policy:fail-closed",
      policy: "durability.fail-closed",
      reason: detail,
      subjectId: this.mission.missionId,
      data: { seat, refusals: this.resumeRefusalLog.length },
    });
  }

  /** Append this runtime's own §26 checkpoints to the durable run chain.
   *  Called from `checkpoint()` so every rollback point the runtime takes is
   *  also a tamper-evident run step that outlives the process.
   *
   *  §RETRY LANES (Paperclip, MIT) — it now appends them AS A LANE. This method
   *  is the runtime's single durable write path, which makes it the only place
   *  the distinction can be made once rather than at every call site: a repair
   *  rollback and a gate pause and a settled re-plan all used to land here
   *  indistinguishable, and the chain was the only thing about this run that
   *  survived a restart. `lane` overrides the label classification at the two
   *  sites where the runtime knows more than its label says; otherwise
   *  `laneOfLabel` reads the label, so a checkpoint taken by an older build —
   *  before any lane was ever written — still folds to the right number. */
  private appendRunCheckpoint(label: string, reason: string, lane?: RetryLane): void {
    try {
      const completed = [...this.completedNodeIds];
      recordLaneCheckpoint(
        this.durableRunId(),
        this.mission.missionId,
        completed.length,
        lane ?? laneOfLabel(label),
        label,
        {
          reason,
          status: this.mission.status,
          completedNodeIds: completed,
          spentUsd: this.resources.usage.costUsd,
        },
      );
      const refusal = lastJournalWriteRefusal();
      if (refusal) this.noteResumeRefusal("run-chain", refusal);
    } catch (e) {
      // The chain is evidence, not a gate on the mission's own progress: a
      // failure to record must not kill a running mission, but it is never
      // silent either.
      this.noteResumeRefusal("run-chain", `the run chain refused a checkpoint (${e instanceof Error ? e.message : String(e)}) — this step is not journalled.`);
    }
  }

  /** Force the run journal to storage. The UI calls this when a run parks
   *  at the gate or the window is closing — the moment a crash is most
   *  likely and most expensive. That sentence is load-bearing as of this
   *  release: `src/ui/store.ts` holds this method as its `DurableRunHandle`
   *  and calls it from `makeGate`, from `pagehide` and from a tab going
   *  hidden. A runtime attached to the store's seat is what answers. */
  flushRunJournal(): { ok: boolean; refused?: string } {
    const result = persistRunJournal();
    if (!result.ok && result.refused) this.noteResumeRefusal("run-chain", result.refused);
    return result.ok ? { ok: true } : { ok: false, refused: result.refused };
  }

  /**
   * The durable-run entry point `src/ui/store.ts` calls on startup, and
   * whenever the user asks whether an interrupted run can continue.
   *
   *   resumeDurableRun(runId?: string, store?: DurableKVLike)
   *     → { ok: true; runId; missionId; fromStep; label; state;
   *         checkpoints; source: "journal" | "memory" }
   *     | { ok: false; reason: string; detail: string }
   *
   * `runId` defaults to this mission's own `run:<missionId>`. `store`
   * defaults to the runtime's durable KV (localStorage in the app, an
   * injected Map under test). "no-journal" means a fresh start and says so;
   * "malformed"/"unknown-version"/"state-missing" mean a journal EXISTS and
   * will not load, and the caller must not restart from scratch over it.
   */
  resumeDurableRun(runId?: string, store?: DurableKVLike) {
    return resumeRun(runId ?? this.durableRunId(), store ?? this.durableKV);
  }

  /* ------------------------------------------------------------------ §25 pause/resume */

  pause(reason: string, actor = "human"): void {
    this.paused = true;
    this.transition("PAUSED", reason, actor);
  }

  resume(reason: string, actor = "human"): void {
    this.paused = false;
    this.transition("RUNNING", reason, actor);
  }

  cancel(reason: string): void {
    this.cancelled = true;
    this.recorder.record({ kind: "MISSION_FAILED", actor: "human", authority: "human", policy: "mission.cancel", reason, subjectId: this.mission.missionId });
  }

  /** §25 Persist everything needed to resume without repeating completed work. */
  persist(): PersistedMissionState {
    return {
      version: 6,
      savedAt: new Date().toISOString(),
      missionId: this.mission.missionId,
      agents: this.org.exportState().agents,
      tasks: this.org.exportState().tasks,
      taskUpdatedAt: this.org.exportState().taskUpdatedAt,
      artifacts: this.services.artifacts.export(),
      checkpoints: this.services.checkpoints.export(),
      approvals: this.services.approvals.export(),
      negotiations: this.services.negotiations.export(),
      recommendations: this.supervisor.exportState(),
      flightEvents: this.recorder.all(),
      usage: this.resources.export(),
      startedAt: this.startedAt,
      graphVersion: this.mission.graphVersion,
      graph: structuredClone(this.graph),
      completedNodeIds: [...this.completedNodeIds],
      pendingTaskIds: this.org.tasksInState("PENDING", "ASSIGNED", "RUNNING").map((t) => t.taskId),
    };
  }

  /** §25 Restore. Fails loudly rather than resuming into a half-restored mission. */
  restore(state: PersistedMissionState): { ok: boolean; errors: string[] } {
    const valid = validateRestoredState(state as Partial<PersistedMissionState>);
    if (!valid.ok || state.missionId !== this.mission.missionId) {
      return { ok: false, errors: valid.ok ? [`state belongs to ${state.missionId}, not ${this.mission.missionId}`] : valid.errors };
    }
    this.org.hydrate({ agents: state.agents, tasks: state.tasks, taskUpdatedAt: state.taskUpdatedAt });
    this.services.artifacts.hydrate(state.artifacts);
    this.services.checkpoints.hydrate(state.checkpoints);
    this.services.approvals.hydrate(state.approvals);
    this.services.negotiations.hydrate(state.negotiations);
    this.supervisor.hydrate(state.recommendations);
    this.resources.hydrate(state.usage, state.startedAt);
    this.graph = state.graph ?? this.graph;
    this.mission.graphVersion = state.graphVersion;
    this.completedNodeIds = new Set(state.completedNodeIds);
    const restoredEvents = this.recorder.seedHistory(state.flightEvents);
    this.recorder.record({
      kind: "MISSION_STATUS",
      actor: "runtime",
      authority: "policy:resume",
      policy: "mission.resume",
      reason: `Restored from checkpoint. ${state.completedNodeIds.length} node(s) already complete; their work is not repeated.`,
      subjectId: this.mission.missionId,
      data: { restoredEvents, pendingTasks: state.pendingTaskIds.length },
    });
    return { ok: true, errors: [] };
  }

  /* ------------------------------------------------------------------ §19 finish */

  private finish(): MissionRunResult {
    // §4/§17 Whether the organization changed is a decision, and decisions are recorded. If the
    // supervisor saw a structural gap, the user is told what it was and why nothing was mutated.
    if (this.plan) {
      const diagnosis = this.supervisor.diagnoseOrganization(this.failures, this.plan);
      if (diagnosis.reorganize) {
        const allowed = this.mission.riskPolicy.allowReorganization && this.mission.riskPolicy.allowGraphMutation;
        this.recorder.record({
          kind: allowed ? "GRAPH_MUTATED" : "POLICY_DENIED",
          actor: "supervisor",
          authority: "supervisor",
          policy: `allowReorganization=${this.mission.riskPolicy.allowReorganization};allowGraphMutation=${this.mission.riskPolicy.allowGraphMutation}`,
          reason: allowed
            ? `Structural gap noted and resolved during the run: ${diagnosis.reason}`
            : `Structural gap noted but the organization was not changed: ${diagnosis.reason}. ${allowed ? "" : "Reorganization or graph mutation is disabled by mission policy."}`,
          evidence: diagnosis.evidence.length ? diagnosis.evidence : [diagnosis.reason],
          subjectId: this.mission.missionId,
          data: { addSteps: diagnosis.addSteps, applied: false, missionEnded: true },
        });
      }
    }

    const tasks = this.org.tasks_();
    const done = tasks.filter((t) => t.state === "DONE").length;
    const artifacts = this.services.artifacts.forMission(this.mission.missionId);
    const allChecks = artifacts.flatMap((a) => a.evaluation?.checks ?? []);
    /* A BLANK CRITERION IS NOT SATISFIED. `"anything".includes("")` is
     * always true, so an empty success criterion was met by every artifact
     * that passed its own evaluation — a criterion nobody wrote was silently
     * fulfilled. A criterion with no words has no first word to match, so it
     * matches nothing. */
    const criteriaMet = this.mission.successCriteria.filter((c) => {
      const first = c.trim().split(/\s+/)[0]?.toLowerCase();
      if (!first) return false;
      return artifacts.some((a) => a.evaluation?.passed && a.content.toLowerCase().includes(first));
    });

    const score: MissionScore = scoreMission({
      successCriteria: this.mission.successCriteria,
      criteriaMet,
      checks: allChecks,
      testChecks: allChecks.filter((c) => c.source === "TEST_RUN"),
      securityChecks: allChecks.filter((c) => c.source === "SECURITY_CHECK"),
      spentUsd: this.resources.usage.costUsd,
      budgetUsd: this.mission.budget.maxCostUsd,
      elapsedMs: Date.now() - this.startedAt,
      deadlineMs: this.mission.deadline ? new Date(this.mission.deadline).getTime() - new Date(this.mission.startedAt ?? this.mission.createdAt).getTime() : null,
      humanInterventions: this.recorder.count("APPROVAL_GRANTED") + this.recorder.count("APPROVAL_REJECTED"),
      regressionCount: this.failures.filter((f) => f.kind === "REGRESSION").length,
    });

    const everyTaskDone = tasks.length > 0 && tasks.every((t) => t.state === "DONE" || t.state === "CANCELLED");
    /* AN UNEVALUATED ARTIFACT IS NOT A VERIFIED ARTIFACT. The old guard was
     * `artifacts.some((a) => a.evaluation && …)`, so an artifact with NO
     * evaluation at all was skipped entirely — and a mission that produced
     * nothing, or produced only unevaluated output, came out `anyUnverified
     * === false` and was reported as COMPLETED and verified. "No fake
     * success" means a mission with no evaluated artifact is not a success. */
    const anyUnverified = artifacts.length === 0
      ? true
      : artifacts.some((a) => !a.evaluation || !a.evaluation.passed || !a.evaluation.fullyMeasured);

    // §38 No fake success. A mission completes only when the work is done AND verified.
    if (everyTaskDone && !anyUnverified && !this.simulatedUsed) {
      this.transition("VERIFYING", "All tasks complete; verifying before completion.");
      this.transition("COMPLETED", `Mission verified: ${done}/${tasks.length} tasks, all artifacts independently evaluated.`);
    } else if (everyTaskDone) {
      this.transition("VERIFYING", "All tasks complete; verification is incomplete.");
      this.transition("BLOCKED", buildIncompleteReason(artifacts, this.simulatedUsed));
    } else if (this.mission.status !== "BLOCKED" && this.mission.status !== "PAUSED") {
      this.transition("BLOCKED", `${tasks.length - done} task(s) unfinished.`);
    }
    this.mission.endedAt = this.mission.status === "COMPLETED" ? new Date().toISOString() : this.mission.endedAt;

    this.services.memory.distil(this.mission.missionId, this.recorder);
    this.recorder.record({
      kind: this.mission.status === "COMPLETED" ? "MISSION_COMPLETED" : "MISSION_FAILED",
      actor: "runtime",
      authority: "policy:verification",
      policy: "mission.no-fake-success",
      reason:
        this.mission.status === "COMPLETED"
          ? `Verified completion: ${done}/${tasks.length} tasks, $${this.resources.usage.costUsd.toFixed(4)} spent.`
          : buildIncompleteReason(artifacts, this.simulatedUsed),
      evidence: score.unmeasured.map((u) => `unmeasured: ${u}`),
      subjectId: this.mission.missionId,
      data: { score, simulatedUsed: this.simulatedUsed },
    });

    return {
      missionId: this.mission.missionId,
      status: this.mission.status,
      score,
      finalArtifactIds: this.finalArtifactIds,
      failures: this.failures,
      repairs: this.repairs,
      mutations: this.mutations,
      approvals: this.services.approvals.forMission(this.mission.missionId),
      spentUsd: this.resources.usage.costUsd,
      durationMs: Date.now() - this.startedAt,
    };
  }

  /* ------------------------------------------------------------------ helpers */

  private pickAgentFor(task: OrgTask, step: PlanStep | null): OrgAgent | null {
    if (task.agentId) {
      const existing = this.org.agent(task.agentId);
      if (existing && existing.state !== "REMOVED" && existing.state !== "REPLACED") return existing;
    }
    if (step) {
      const byStep = this.org.agents().find((a) => a.state !== "REMOVED" && a.state !== "REPLACED" && this.plan?.steps.find((s) => s.id === a.taskIds[0])?.id === step.id);
      if (byStep) return byStep;
      const byDef = this.org.byDefinition(step.agentDefId);
      if (byDef) return byDef;
    }
    return this.org.agentsInState("IDLE", "ACTIVE")[0] ?? null;
  }

  private provenanceFor(agent: OrgAgent, task: OrgTask, outcome: { latencyMs: number; costUsd: number; simulated: boolean; detail: string }): ArtifactProvenance {
    return {
      missionId: this.mission.missionId,
      taskId: task.taskId,
      agentId: agent.agentId,
      agentTitle: agent.title,
      harness: (agent.harness ?? null) as HarnessId | null,
      model: outcome.simulated ? "local-test (simulated)" : null,
      toolsUsed: outcome.simulated ? ["local-test"] : [String(agent.harness ?? "in-process")],
      mcpServersUsed: [],
      costUsd: outcome.costUsd,
      latencyMs: outcome.latencyMs,
      startedAt: new Date(Date.now() - outcome.latencyMs).toISOString(),
      finishedAt: new Date().toISOString(),
    };
  }

  private buildGraphFromPlan(plan: MissionPlan): void {
    this.graph = graphFromSteps(this.mission, plan.steps);
    this.mission.graphVersion = 1;
  }

  private nodeIdForStep(stepId: string): string | null {
    const step = this.plan?.steps.find((s) => s.id === stepId);
    if (!step) return null;
    return this.graph.nodes.find((n) => n.templateKey === stepId)?.id ?? null;
  }

  getFailures(): FailureSignal[] {
    return [...this.failures];
  }

  getRepairs(): RepairAttempt[] {
    return [...this.repairs];
  }

  getMutations(): typeof this.mutations {
    return [...this.mutations];
  }

  getEvents(): FlightEvent[] {
    return this.recorder.all();
  }

  usage(): ResourceUsage {
    return this.resources.export();
  }
}

/* ------------------------------------------------------------------ graph building */

export function emptyGraph(mission: Mission): WorkflowGraph {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    id: mission.missionId,
    name: mission.name,
    nodes: [],
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    groups: [],
    notes: [],
  };
}

/**
 * §30 Build the visual graph from a plan. The graph mirrors the organization: one node per
 * step, wired by the step dependencies, using each definition's real first output/input port
 * so the wires survive the type gate.
 */
/**
 * §30 One authoritative structure: the executable graph is *derived from* the plan, so the
 * graph and the organization can never disagree about what the mission contains.
 *
 * Every step becomes exactly one node. Required inputs are wired deliberately, never by
 * "first port to first port": a wire that does not satisfy the type system is worse than no
 * wire at all, because the validator then reports a graph VH itself produced as broken.
 */
export function graphFromSteps(mission: Mission, steps: PlanStep[]): WorkflowGraph {
  const graph = emptyGraph(mission);
  const byStep = new Map<string, NodeInstance>();
  steps.forEach((step, i) => {
    const def = DEFINITIONS_BY_ID.get(step.agentDefId);
    if (!def) return;
    const node = createNodeFromDef(def, `${step.id}-${uid("n").slice(-5)}`, 120 + (i % 5) * 300, 120 + Math.floor(i / 5) * 220);
    node.templateKey = step.id;
    node.title = step.title;
    node.purpose = step.purpose;
    graph.nodes.push(node);
    byStep.set(step.id, node);
  });

  // The plan's entry steps have no predecessor, but their agents still need a brief. Start
  // carries the mission payload, so it is the one legitimate source for those wires.
  const startDef = DEFINITIONS_BY_ID.get("control.start");
  let startNode: NodeInstance | null = null;
  if (startDef) {
    startNode = createNodeFromDef(startDef, `start-${uid("n").slice(-5)}`, 20, 120);
    startNode.title = "Mission objective";
    startNode.purpose = `Mission "${mission.name}" — ${mission.objective}`;
    graph.nodes.push(startNode);
  }

  const wire = (src: NodeInstance, tgt: NodeInstance, srcPortId: string, tgtPortId: string, dataType: string) => {
    graph.connections.push({
      id: uid("c"),
      sourceNodeId: src.id,
      sourcePortId: srcPortId,
      targetNodeId: tgt.id,
      targetPortId: tgtPortId,
      dataType: dataType as Connection["dataType"],
      status: "idle",
    });
  };

  for (const step of steps) {
    const target = byStep.get(step.id);
    if (!target) continue;
    const upstream = step.dependsOn.map((d) => byStep.get(d)).filter((n): n is NodeInstance => Boolean(n));

    // 1. Required inputs first: take a type-compatible output from a dependency.
    for (const port of target.inputs) {
      if (!port.required || graph.connections.some((c) => c.targetNodeId === target.id && c.targetPortId === port.id)) continue;
      let done = false;
      for (const src of upstream) {
        const out = src.outputs.find((o) => portsCompatible(o.dataType, port.dataType));
        if (!out) continue;
        wire(src, target, out.id, port.id, out.dataType);
        done = true;
        break;
      }
      // 2. Then the Start node: an entry step's brief comes from the mission payload.
      if (!done && startNode) {
        const out = startNode.outputs.find((o) => portsCompatible(o.dataType, port.dataType));
        if (out) {
          wire(startNode, target, out.id, port.id, out.dataType);
          done = true;
        }
      }
      if (!done) {
        // Record the gap instead of faking a wire: an unresolvable required input is a
        // planning defect and must be visible, not silently papered over.
        recorderFor(mission.missionId).record({
          kind: "POLICY_DENIED",
          actor: "planner",
          authority: "policy:graph-structure",
          policy: "validation.required-inputs",
          reason: `Plan step "${step.title}" requires "${port.label}" (${port.dataType}) but nothing upstream emits a compatible value. The graph keeps the port unwired and validation will report it.`,
          evidence: [`step=${step.id}`, `port=${port.id}`, `dataType=${port.dataType}`, `upstream=${step.dependsOn.join(",") || "none"}`],
          subjectId: step.id,
          data: { portId: port.id, dataType: port.dataType },
        });
      }
    }

    // 3. Then the remaining compatible outputs of every dependency, so no upstream result is
    //    silently dropped.
    for (const src of upstream) {
      for (const out of src.outputs) {
        if (graph.connections.some((c) => c.sourceNodeId === src.id && c.sourcePortId === out.id && c.targetNodeId === target.id)) continue;
        const port = target.inputs.find((i) => !graph.connections.some((c) => c.targetNodeId === target.id && c.targetPortId === i.id) && portsCompatible(out.dataType, i.dataType));
        if (!port) continue;
        wire(src, target, out.id, port.id, out.dataType);
      }
    }
  }
  return graph;
}

function taskForNode(rt: MissionRuntime, nodeId: string): string {
  const found = (rt as unknown as { taskToNode: Map<string, string> }).taskToNode;
  for (const [taskId, nId] of found) if (nId === nodeId) return taskId;
  return "";
}

function buildIncompleteReason(artifacts: Artifact[], simulatedUsed: boolean): string {
  const parts: string[] = [];
  if (simulatedUsed) parts.push("execution used VH's labelled simulation, so nothing was really built");
  /* An artifact with NO evaluation is unverified, not absent — the same rule
     the completion guard uses. Reporting "Work unfinished." for a mission
     that produced four unevaluated artifacts hides the real reason. */
  const unverified = artifacts.filter((a) => !a.evaluation || !a.evaluation.passed || !a.evaluation.fullyMeasured);
  if (unverified.length) {
    parts.push(
      `${unverified.length} artifact(s) are not independently verified: ${unverified
        .slice(0, 3)
        .map((a) => `${a.name} (${a.evaluation?.unmeasured.join(", ") || (a.evaluation ? "failed checks" : "never evaluated")})`)
        .join("; ")}`,
    );
  }
  return parts.length ? `Not verified — ${parts.join("; ")}.` : "Work unfinished.";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export { DEFAULT_BUDGET, DEFAULT_BOUNDARY, DEFAULT_POLICY };
