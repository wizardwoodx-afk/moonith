/**
 * §5 OrganizationSupervisor + §17 self-healing graph.
 *
 * The supervisor sits above individual agents. It observes mission state, forms
 * recommendations, and — only when mission policy permits — executes them. Every
 * recommendation records whether it was auto-executable, and every execution is a
 * flight-recorder entry with actor, authority, policy, reason and evidence.
 *
 * The supervisor never mutates the graph directly. It proposes a `GraphMutation`, which
 * `graphMutator.ts` validates against policy, evaluation and regression before applying.
 */

import { uid } from "../app/id";
import type {
  FailureSignal,
  Mission,
  MissionPlan,
  OrgAgent,
  OrgTask,
  RepairStrategy,
  SupervisorRecommendation,
} from "./types";
import type { OrganizationRuntime } from "./organization";
import type { FlightRecorder } from "./flightRecorder";

export interface SupervisorObservation {
  missionId: string;
  at: string;
  agentsLive: number;
  agentsIdle: number;
  agentsFailed: number;
  tasksTotal: number;
  tasksDone: number;
  tasksRunning: number;
  tasksFailed: number;
  tasksBlocked: number;
  oldestLiveTaskMs: number;
  signals: FailureSignal[];
  progress: number;
}

export class OrganizationSupervisor {
  readonly id = "supervisor";
  private recommendations: SupervisorRecommendation[] = [];
  private handled = new Set<string>();
  /** `kind::subjectId` of every recommendation already raised, so one condition cannot be
   *  re-diagnosed into a fresh recommendation on every supervision cycle. */
  private openRecs = new Set<string>();
  /** Shapes already raised AND executed. Never cleared: a condition that keeps recurring after
   *  an executed recommendation gets an escalation, not an infinite stream of identical advice. */
  private executedShapes = new Set<string>();

  constructor(
    private mission: Mission,
    private org: OrganizationRuntime,
    private recorder: FlightRecorder,
  ) {}

  observe(signals: FailureSignal[]): SupervisorObservation {
    const agents = this.org.agents();
    const tasks = this.org.tasks_();
    const ages = this.org.taskAges();
    const live = tasks.filter((t) => t.state === "RUNNING" || t.state === "ASSIGNED" || t.state === "PENDING");
    const done = tasks.filter((t) => t.state === "DONE" || t.state === "CANCELLED").length;
    return {
      missionId: this.mission.missionId,
      at: new Date().toISOString(),
      agentsLive: agents.filter((a) => a.state === "ACTIVE" || a.state === "IDLE").length,
      agentsIdle: agents.filter((a) => a.state === "IDLE").length,
      agentsFailed: agents.filter((a) => a.state === "FAILED").length,
      tasksTotal: tasks.length,
      tasksDone: done,
      tasksRunning: tasks.filter((t) => t.state === "RUNNING").length,
      tasksFailed: tasks.filter((t) => t.state === "FAILED").length,
      tasksBlocked: tasks.filter((t) => t.state === "BLOCKED").length,
      oldestLiveTaskMs: live.length ? Math.max(...live.map((t) => ages[t.taskId] ?? 0)) : 0,
      signals,
      progress: tasks.length ? done / tasks.length : 0,
    };
  }

  /**
   * Turn failure signals into recommendations. One recommendation per signal, deduplicated
   * by signal id so repeated observation cycles do not spam the same advice.
   */
  recommend(signals: FailureSignal[]): SupervisorRecommendation[] {
    const out: SupervisorRecommendation[] = [];
    for (const sig of signals) {
      if (this.handled.has(sig.id)) continue;
      const rec = this.recommendFor(sig);
      if (!rec) continue;
      // Detection re-raises the same condition every cycle with a fresh signal id. Without this
      // the supervisor manufactures a new recommendation for an unchanged situation forever.
      const fp = `${rec.kind}::${rec.subjectId ?? "mission"}`;
      if (this.openRecs.has(fp) || this.executedShapes.has(fp)) {
        this.handled.add(sig.id);
        this.recorder.record({
          kind: "POLICY_DENIED",
          actor: this.id,
          authority: "supervisor",
          policy: "supervisor.one-recommendation-per-condition",
          reason: `${sig.kind} on "${sig.subject}" is already covered by an open ${rec.kind} recommendation. Not raising a second one.`,
          evidence: sig.evidence,
          subjectId: sig.subject,
          data: { failureKind: sig.kind, recommendation: rec.kind },
        });
        continue;
      }
      this.openRecs.add(fp);
      this.handled.add(sig.id);
      this.recommendations.push(rec);
      out.push(rec);
      this.recorder.record({
        kind: "FAILURE_DETECTED",
        actor: this.id,
        authority: "supervisor",
        policy: `autonomy=${this.mission.riskPolicy.autonomy}`,
        reason: sig.detail,
        evidence: sig.evidence,
        subjectId: sig.subject,
        data: { failureKind: sig.kind, severity: sig.severity, recommendation: rec.kind, autoExecutable: rec.autoExecutable },
      });
    }
    return out;
  }

  private recommendFor(sig: FailureSignal): SupervisorRecommendation | null {
    const base = {
      id: uid("rec"),
      missionId: this.mission.missionId,
      subjectId: sig.subject,
      evidence: sig.evidence,
      executed: false,
      createdAt: new Date().toISOString(),
    };
    const allowReorg = this.mission.riskPolicy.allowReorganization;

    switch (sig.kind) {
      case "REPEATED_FAILURE":
        return {
          ...base,
          kind: "SWITCH_HARNESS",
          reason: `Repeated failure on this task; a different runtime is the cheapest next variable to change.`,
          autoExecutable: this.mission.riskPolicy.allowHarnessSwitch,
        };
      case "TOOL_FAILURE_LOOP":
        return {
          ...base,
          kind: "SPAWN_SPECIALIST",
          reason: `Repair attempts of the same shape keep failing; the task needs a different kind of agent, not another retry.`,
          autoExecutable: allowReorg,
        };
      case "TIMEOUT_LOOP":
      case "STALL":
        return {
          ...base,
          kind: "PAUSE_MISSION",
          reason: `Nothing is progressing. Pausing preserves state and prevents spending budget on a stuck organization.`,
          autoExecutable: true,
        };
      case "DEPENDENCY_DEADLOCK":
        return {
          ...base,
          kind: "REORGANIZE",
          reason: `The dependency structure cannot be satisfied. This is a plan defect, not an agent defect.`,
          autoExecutable: false, // a human must agree to restructure around a deadlock
        };
      case "BUDGET_EXHAUSTION":
        return {
          ...base,
          kind: "ESCALATE_HUMAN",
          reason: `A budget ceiling was reached. Only a human may raise it.`,
          autoExecutable: false,
        };
      case "PERMISSION_DENIAL":
        return {
          ...base,
          kind: "ESCALATE_HUMAN",
          reason: `A permission boundary blocked the work. Widening a boundary is a human decision (§33).`,
          autoExecutable: false,
        };
      case "MISSING_CAPABILITY":
        return {
          ...base,
          kind: "SPAWN_SPECIALIST",
          reason: `No roster member has the required capability.`,
          autoExecutable: allowReorg,
        };
      case "DUPLICATE_WORK":
        return {
          ...base,
          kind: "REORGANIZE",
          reason: `Two live tasks are doing the same work.`,
          autoExecutable: allowReorg,
        };
      case "CONTRADICTORY_OUTPUT":
        return {
          ...base,
          kind: "ESCALATE_HUMAN",
          reason: `Agents produced contradictory verdicts on the same artifact. A supervisor should not pick a side without evidence.`,
          autoExecutable: false,
        };
      case "REGRESSION":
        return {
          ...base,
          kind: "ROLLBACK_CHECKPOINT",
          reason: `A later version is worse than an earlier one. Roll back to the last known good.`,
          autoExecutable: true,
        };
      case "AGENT_STARVATION":
        return {
          ...base,
          kind: "RETRY",
          reason: `Idle agents with unblocked work: re-run the scheduling pass.`,
          autoExecutable: true,
        };
      case "INVALID_ARTIFACT_STATE":
        return {
          ...base,
          kind: "ESCALATE_HUMAN",
          reason: `An artifact is in a state the pipeline should not produce (unevaluated, or approved despite failing).`,
          autoExecutable: false,
        };
      default:
        return null;
    }
  }

  /**
   * Close a recommendation out. Returns false — and records nothing — when the recommendation
   * does not exist or was already executed, because a completion entry for a repair that never
   * ran is exactly the kind of fake success this system exists to prevent.
   */
  markExecuted(recommendationId: string, detail: string): boolean {
    const rec = this.recommendations.find((r) => r.id === recommendationId);
    if (!rec || rec.executed) return false;
    rec.executed = true;
    const fp = `${rec.kind}::${rec.subjectId ?? "mission"}`;
    this.openRecs.delete(fp);
    this.executedShapes.add(fp);
    // Deliberately NOT "REPAIR_COMPLETED": that event belongs to the repair ladder and every one
    // of them must pair with a REPAIR_STARTED. Closing a recommendation out is its own fact.
    this.recorder.record({
      kind: "RECOMMENDATION_EXECUTED",
      actor: this.id,
      authority: "supervisor",
      policy: `supervisor.execute:${rec.kind}`,
      reason: `${rec.kind} executed: ${detail}`,
      evidence: rec.evidence,
      subjectId: rec.subjectId ?? rec.id,
      data: { recommendationId, kind: rec.kind },
    });
    return true;
  }

  list(): SupervisorRecommendation[] {
    return [...this.recommendations];
  }

  pending(): SupervisorRecommendation[] {
    return this.recommendations.filter((r) => !r.executed);
  }

  /**
   * §17 Decide whether repeated failure means the organization itself is wrong.
   * Returns a proposed roster change; `graphMutator` applies it under policy.
   */
  diagnoseOrganization(signals: FailureSignal[], plan: MissionPlan | null): {
    reorganize: boolean;
    reason: string;
    addSteps: string[];
    evidence: string[];
  } {
    const implFailures = signals.filter(
      (s) => s.kind === "REPEATED_FAILURE" || s.kind === "TOOL_FAILURE_LOOP" || s.kind === "MISSING_CAPABILITY",
    );
    const structural = signals.filter((s) => s.kind === "DEPENDENCY_DEADLOCK" || s.kind === "CONTRADICTORY_OUTPUT");
    if (structural.length) {
      return {
        reorganize: true,
        reason: `Structural failure (${structural.map((s) => s.kind).join(", ")}): the plan shape cannot deliver this objective.`,
        addSteps: [],
        evidence: structural.flatMap((s) => s.evidence),
      };
    }
    if (implFailures.length >= 1) {
      const hasArchitect = plan?.steps.some((s) => s.kind === "architecture") ?? false;
      const hasTest = plan?.steps.some((s) => s.kind === "test") ?? false;
      // §18: if nobody on the roster can review work independently, that is an organizational
      // defect, not an evaluation inconvenience — the artifacts cannot be verified at all.
      const hasReviewer = this.org
        .agents()
        .some((a) => ["agent.reviewer", "agent.judge", "agent.critic", "agent.qa"].includes(a.definitionId) && a.state !== "REMOVED" && a.state !== "REPLACED");
      const add: string[] = [];
      if (!hasArchitect) add.push("architecture");
      if (!hasTest) add.push("test");
      if (!hasReviewer) add.push("review");
      return {
        reorganize: true,
        reason: `${implFailures.length} implementation-side failure(s). The organization is missing ${add.join(", ") || "nothing identifiable"}${hasReviewer ? "" : " — no roster member can review work independently"}.`,
        addSteps: add,
        evidence: implFailures.flatMap((s) => [`${s.kind}: ${s.detail}`, ...s.evidence]),
      };
    }
    return { reorganize: false, reason: "Failure rate does not yet indicate an organizational defect.", addSteps: [], evidence: [] };
  }

  /** Which agent to replace, and with what, given a failure. */
  proposeReplacement(sig: FailureSignal): { agentId: string; definitionId: string; reason: string } | null {
    const task = this.org.task(sig.subject);
    if (!task?.agentId) return null;
    const agent = this.org.agent(task.agentId);
    if (!agent) return null;
    const upgrade: Record<string, string> = {
      "agent.coder": "agent.architect",
      "agent.tester": "agent.qa",
      "agent.reviewer": "agent.judge",
      "agent.researcher": "agent.synthesizer",
    };
    const next = upgrade[agent.definitionId];
    if (!next) {
      return {
        agentId: agent.agentId,
        definitionId: agent.definitionId,
        reason: `Re-run ${agent.title} with enriched context; no stronger role exists for this job.`,
      };
    }
    return {
      agentId: agent.agentId,
      definitionId: next,
      reason: `${agent.title} failed ${task.attempts}×; escalating the role to ${next}.`,
    };
  }

  /**
   * §16 Choose the next repair strategy for a task, given what has already been tried.
   * The order is deliberate and cheap-first: retry, then change the input, then change the
   * runtime, then change the organization, then a human.
   */
  nextRepairStrategy(task: OrgTask, tried: RepairStrategy[], agent: OrgAgent | null): { strategy: RepairStrategy; rationale: string } | null {
    const ladder: Array<{ strategy: RepairStrategy; when: boolean; rationale: string }> = [
      {
        strategy: "RETRY",
        when: !tried.includes("RETRY") && task.attempts < task.maxAttempts,
        rationale: `Cheapest option and this is attempt ${task.attempts + 1} of ${task.maxAttempts}. Transient failure is the most common cause.`,
      },
      {
        strategy: "ENRICH_CONTEXT",
        when: !tried.includes("ENRICH_CONTEXT"),
        rationale: "Same agent, better input: attach the failure output and the acceptance criteria it missed.",
      },
      {
        strategy: "SWITCH_HARNESS",
        when: !tried.includes("SWITCH_HARNESS") && this.mission.riskPolicy.allowHarnessSwitch && Boolean(agent?.harness),
        rationale: `The task shape is fine but ${agent?.harness} could not deliver it. Change the runtime, not the plan.`,
      },
      {
        strategy: "SPLIT_TASK",
        when: !tried.includes("SPLIT_TASK") && task.description.length > 200,
        rationale: "The task is large enough that a smaller unit of work is more likely to succeed and easier to diagnose.",
      },
      {
        strategy: "SPAWN_SPECIALIST",
        when: !tried.includes("SPAWN_SPECIALIST") && this.mission.riskPolicy.allowReorganization,
        rationale: "Three cheaper strategies failed. The role itself is probably wrong for this job.",
      },
      {
        strategy: "REDUCE_SCOPE",
        when: !tried.includes("REDUCE_SCOPE"),
        rationale: "Deliver a smaller verified increment rather than nothing.",
      },
      {
        strategy: "ROLLBACK_CHECKPOINT",
        when: !tried.includes("ROLLBACK_CHECKPOINT"),
        rationale: "Restore the last known-good state before continuing.",
      },
      {
        strategy: "ESCALATE_HUMAN",
        when: true,
        rationale: "Every automated strategy has been tried. A human decides next.",
      },
    ];
    for (const rung of ladder) {
      if (rung.when) return { strategy: rung.strategy, rationale: rung.rationale };
    }
    return null;
  }

  /** Progress summary for the mission header. */
  summarise(): string {
    const tasks = this.org.tasks_();
    const done = tasks.filter((t) => t.state === "DONE").length;
    const failed = tasks.filter((t) => t.state === "FAILED").length;
    return `${done}/${tasks.length} tasks done, ${failed} failed, ${this.org.agents().filter((a) => a.state === "ACTIVE").length} agents active`;
  }

  exportState(): SupervisorRecommendation[] {
    return this.list();
  }

  hydrate(recs: SupervisorRecommendation[], handledSignals: string[] = []): void {
    this.recommendations = [...recs];
    for (const h of handledSignals) this.handled.add(h);
  }
}
