/**
 * §15 Failure detection.
 *
 * Detectors are pure: they take mission state and return structured signals. Nothing here
 * repairs anything — repair is `repairStrategies.ts`, and the supervisor decides.
 *
 * Every detector must be able to say *why* it fired, with evidence. A detector that cannot
 * cite evidence does not fire.
 */

import { uid } from "../app/id";
import type {
  Artifact,
  FailureKind,
  FailureSignal,
  MissionBudget,
  OrgAgent,
  OrgTask,
  RepairAttempt,
  ResourceUsage,
} from "./types";

export interface DetectionInput {
  missionId: string;
  agents: OrgAgent[];
  tasks: OrgTask[];
  artifacts: Artifact[];
  repairs: RepairAttempt[];
  usage: ResourceUsage;
  budget: MissionBudget;
  now: number;
  /** Task id -> wall-clock ms of its last state change. */
  taskAgeMs: Record<string, number>;
  /** Node/task outputs keyed by task id, for contradiction checks. */
  outputs?: Record<string, string>;
}

export type Detector = (input: DetectionInput) => FailureSignal[];

function signal(kind: FailureKind, severity: FailureSignal["severity"], input: DetectionInput, subject: string, detail: string, evidence: string[]): FailureSignal {
  return {
    id: uid("fail"),
    missionId: input.missionId,
    kind,
    severity,
    subject,
    detail,
    evidence,
    detectedAt: new Date(input.now).toISOString(),
    resolvedBy: null,
  };
}

/** The same task failing repeatedly. */
export const repeatedFailure: Detector = (input) => {
  const out: FailureSignal[] = [];
  for (const t of input.tasks) {
    if (t.attempts >= 2 && (t.state === "FAILED" || t.state === "BLOCKED")) {
      out.push(
        signal(
          "REPEATED_FAILURE",
          t.attempts >= 3 ? "ERROR" : "WARN",
          input,
          t.taskId,
          `Task "${t.title}" has failed ${t.attempts} of ${t.maxAttempts} allowed attempts.`,
          [t.error ?? "no error recorded", `attempts=${t.attempts}`],
        ),
      );
    }
  }
  return out;
};

/** A task that has been in a non-terminal state far longer than its peers. */
export const timeoutLoop: Detector = (input) => {
  const out: FailureSignal[] = [];
  const ages = Object.entries(input.taskAgeMs);
  if (ages.length < 2) return out;
  const median = medianOf(ages.map(([, ms]) => ms));
  for (const t of input.tasks) {
    if (t.state !== "RUNNING" && t.state !== "ASSIGNED") continue;
    const age = input.taskAgeMs[t.taskId] ?? 0;
    if (median > 0 && age > Math.max(5 * median, 120_000)) {
      out.push(
        signal(
          "TIMEOUT_LOOP",
          "WARN",
          input,
          t.taskId,
          `Task "${t.title}" has been ${Math.round(age / 1000)}s in ${t.state}, against a mission median of ${Math.round(median / 1000)}s.`,
          [`ageMs=${age}`, `medianMs=${median}`],
        ),
      );
    }
  }
  return out;
};

/** Repair attempts that keep failing on the same task. */
export const toolFailureLoop: Detector = (input) => {
  const out: FailureSignal[] = [];
  const byTask = new Map<string, RepairAttempt[]>();
  for (const r of input.repairs) {
    const list = byTask.get(r.taskId) ?? [];
    list.push(r);
    byTask.set(r.taskId, list);
  }
  for (const [taskId, attempts] of byTask) {
    const failed = attempts.filter((a) => a.result === "FAILURE");
    if (failed.length >= 2) {
      out.push(
        signal(
          "TOOL_FAILURE_LOOP",
          "ERROR",
          input,
          taskId,
          `${failed.length} repair attempts failed on this task (${failed.map((f) => f.strategy).join(", ")}). Further retries of the same shape are unlikely to help.`,
          failed.map((f) => `${f.strategy}: ${f.detail}`),
        ),
      );
    }
  }
  return out;
};

/** Two agents assigned tasks with the same normalised title. */
export const duplicateWork: Detector = (input) => {
  const out: FailureSignal[] = [];
  const seen = new Map<string, OrgTask[]>();
  for (const t of input.tasks) {
    if (t.state === "DONE" || t.state === "CANCELLED") continue;
    const key = t.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const list = seen.get(key) ?? [];
    list.push(t);
    seen.set(key, list);
  }
  for (const [key, group] of seen) {
    if (group.length > 1) {
      out.push(
        signal(
          "DUPLICATE_WORK",
          "WARN",
          input,
          group[0].taskId,
          `${group.length} live tasks share the objective "${key}".`,
          group.map((t) => `${t.taskId} -> ${t.agentId ?? "unassigned"}`),
        ),
      );
    }
  }
  return out;
};

/**
 * Contradictory outputs: two artifacts for the same logical lineage carrying an explicit
 * negative verdict about the same subject. Deliberately conservative — it only fires on
 * structured verdict markers, never on vague prose, so it does not cry wolf.
 */
export const contradictoryOutput: Detector = (input) => {
  const out: FailureSignal[] = [];
  const byRoot = new Map<string, Artifact[]>();
  for (const a of input.artifacts) {
    const list = byRoot.get(a.lineageRoot) ?? [];
    list.push(a);
    byRoot.set(a.lineageRoot, list);
  }
  for (const [root, group] of byRoot) {
    if (group.length < 2) continue;
    const passes = group.filter((a) => /\b(verdict|result)\s*:\s*(pass|passed|approved)\b/i.test(a.content));
    const fails = group.filter((a) => /\b(verdict|result)\s*:\s*(fail|failed|rejected)\b/i.test(a.content));
    if (passes.length && fails.length) {
      out.push(
        signal(
          "CONTRADICTORY_OUTPUT",
          "ERROR",
          input,
          root,
          `${passes.length} artifact(s) record a pass and ${fails.length} record a failure for the same lineage.`,
          [...passes.map((a) => `PASS ${a.artifactId} by ${a.createdBy}`), ...fails.map((a) => `FAIL ${a.artifactId} by ${a.createdBy}`)],
        ),
      );
    }
  }
  return out;
};

/** Agents with nothing to do while tasks wait. */
export const agentStarvation: Detector = (input) => {
  const out: FailureSignal[] = [];
  const waiting = input.tasks.filter((t) => t.state === "PENDING");
  if (!waiting.length) return out;
  for (const a of input.agents) {
    if (a.state !== "IDLE") continue;
    const eligible = waiting.filter(
      (t) => !t.dependsOn.length || t.dependsOn.every((d) => input.tasks.find((x) => x.taskId === d)?.state === "DONE"),
    );
    if (eligible.length) {
      out.push(
        signal(
          "AGENT_STARVATION",
          "WARN",
          input,
          a.agentId,
          `${a.title} is idle while ${eligible.length} unblocked task(s) wait.`,
          eligible.map((t) => t.taskId),
        ),
      );
    }
  }
  return out;
};

/** Cyclic or unsatisfiable dependencies among live tasks. */
export const dependencyDeadlock: Detector = (input) => {
  const out: FailureSignal[] = [];
  const live = new Set(input.tasks.filter((t) => t.state !== "DONE" && t.state !== "CANCELLED").map((t) => t.taskId));
  const state = new Map<string, "visiting" | "done">();
  const byId = new Map(input.tasks.map((t) => [t.taskId, t]));

  const visit = (id: string, stack: string[]): string[] | null => {
    if (state.get(id) === "done") return null;
    if (state.get(id) === "visiting") return [...stack, id];
    state.set(id, "visiting");
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (!live.has(dep)) continue;
      const cycle = visit(dep, [...stack, id]);
      if (cycle) return cycle;
    }
    state.set(id, "done");
    return null;
  };

  for (const id of live) {
    const cycle = visit(id, []);
    if (cycle) {
      out.push(
        signal(
          "DEPENDENCY_DEADLOCK",
          "CRITICAL",
          input,
          cycle[cycle.length - 1],
          `Circular dependency among live tasks: ${cycle.join(" -> ")}.`,
          cycle.map((c) => `${c} waits on ${(byId.get(c)?.dependsOn ?? []).join(", ")}`),
        ),
      );
      break;
    }
  }

  // A dependency on a task that no longer exists is also a deadlock.
  for (const t of input.tasks) {
    if (!live.has(t.taskId)) continue;
    const missing = t.dependsOn.filter((d) => !byId.has(d));
    if (missing.length) {
      out.push(
        signal(
          "DEPENDENCY_DEADLOCK",
          "ERROR",
          input,
          t.taskId,
          `Task "${t.title}" depends on missing task(s): ${missing.join(", ")}.`,
          [t.taskId, ...missing],
        ),
      );
    }
  }
  return out;
};

/** Budget ceilings. Reported at 80% (WARN) and 100% (CRITICAL). */
export const budgetExhaustion: Detector = (input) => {
  const out: FailureSignal[] = [];
  const check = (label: string, value: number, ceiling: number) => {
    if (ceiling <= 0) return;
    const ratio = value / ceiling;
    if (ratio >= 1) {
      out.push(
        signal("BUDGET_EXHAUSTION", "CRITICAL", input, label, `${label} exhausted: ${round(value)} of ${round(ceiling)}.`, [`ratio=${ratio.toFixed(2)}`]),
      );
    } else if (ratio >= 0.8) {
      out.push(
        signal("BUDGET_EXHAUSTION", "WARN", input, label, `${label} at ${Math.round(ratio * 100)}%: ${round(value)} of ${round(ceiling)}.`, [`ratio=${ratio.toFixed(2)}`]),
      );
    }
  };
  check("cost", input.usage.costUsd, input.budget.maxCostUsd);
  check("tokens", input.usage.tokens, input.budget.maxTokens);
  check("wall clock (ms)", input.usage.wallClockMs, input.budget.maxWallClockMs);
  check("retries", input.usage.retries, input.budget.maxRetriesPerTask * Math.max(1, input.tasks.length));
  check("graph mutations", input.usage.graphMutations, input.budget.maxGraphMutations);
  return out;
};

/** Tasks that failed specifically because a permission was not granted. */
export const permissionDenial: Detector = (input) => {
  const out: FailureSignal[] = [];
  for (const t of input.tasks) {
    if (!t.error) continue;
    if (/not granted|permission denied|not permitted|forbidden|unauthorised|unauthorized/i.test(t.error)) {
      out.push(
        signal(
          "PERMISSION_DENIAL",
          "WARN",
          input,
          t.taskId,
          `Task "${t.title}" was blocked by a permission boundary. Either grant the permission or replan without it.`,
          [t.error],
        ),
      );
    }
  }
  return out;
};

/** Artifacts that should have been evaluated and were not, or that failed and were used anyway. */
export const invalidArtifactState: Detector = (input) => {
  const out: FailureSignal[] = [];
  for (const a of input.artifacts) {
    if (!a.evaluation) {
      out.push(
        signal("INVALID_ARTIFACT_STATE", "WARN", input, a.artifactId, `Artifact "${a.name}" v${a.version} was never evaluated.`, [`createdBy=${a.createdBy}`]),
      );
    } else if (!a.evaluation.passed && a.approvalState === "APPROVED") {
      out.push(
        signal(
          "INVALID_ARTIFACT_STATE",
          "ERROR",
          input,
          a.artifactId,
          `Artifact "${a.name}" v${a.version} failed evaluation but is marked APPROVED.`,
          a.evaluation.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`),
        ),
      );
    }
  }
  return out;
};

/** A later version scoring worse than an earlier one on the same lineage. */
export const regression: Detector = (input) => {
  const out: FailureSignal[] = [];
  const byRoot = new Map<string, Artifact[]>();
  for (const a of input.artifacts) {
    const list = byRoot.get(a.lineageRoot) ?? [];
    list.push(a);
    byRoot.set(a.lineageRoot, list);
  }
  for (const [, group] of byRoot) {
    const sorted = group.filter((a) => a.evaluation?.fullyMeasured).sort((a, b) => a.version - b.version);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1].evaluation!;
      const cur = sorted[i].evaluation!;
      const score = (e: typeof prev) => e.checks.filter((c) => c.score != null).reduce((s, c) => s + (c.score ?? 0), 0) / Math.max(1, e.checks.filter((c) => c.score != null).length);
      if (prev.passed && !cur.passed) {
        out.push(
          signal(
            "REGRESSION",
            "ERROR",
            input,
            sorted[i].artifactId,
            `"${sorted[i].name}" v${sorted[i].version} fails where v${prev.checks.length ? sorted[i - 1].version : sorted[i - 1].version} passed.`,
            cur.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`),
          ),
        );
      } else if (score(cur) + 0.05 < score(prev)) {
        out.push(
          signal(
            "REGRESSION",
            "WARN",
            input,
            sorted[i].artifactId,
            `"${sorted[i].name}" v${sorted[i].version} scores ${score(cur).toFixed(2)} against ${score(prev).toFixed(2)} for v${sorted[i - 1].version}.`,
            [`prev=${score(prev).toFixed(3)}`, `cur=${score(cur).toFixed(3)}`],
          ),
        );
      }
    }
  }
  return out;
};

/** A task needs a capability no roster member has. */
export const missingCapability: Detector = (input) => {
  const out: FailureSignal[] = [];
  for (const t of input.tasks) {
    if (!t.error) continue;
    const m = t.error.match(/missing capabilit(?:y|ies): ([^.;]+)/i);
    if (m) {
      out.push(
        signal(
          "MISSING_CAPABILITY",
          "ERROR",
          input,
          t.taskId,
          `No agent in the roster can perform "${t.title}": ${m[1]}.`,
          [t.error, ...input.agents.map((a) => `${a.title}: ${a.contract.capabilities.join(", ") || "none"}`)],
        ),
      );
    }
  }
  return out;
};

/** Nothing is progressing at all. */
export const stall: Detector = (input) => {
  const live = input.tasks.filter((t) => t.state === "RUNNING" || t.state === "ASSIGNED" || t.state === "PENDING");
  if (!live.length) return [];
  const ages = live.map((t) => input.taskAgeMs[t.taskId] ?? 0);
  const youngest = Math.min(...ages);
  if (youngest > 180_000) {
    return [
      signal(
        "STALL",
        "ERROR",
        input,
        input.missionId,
        `No task has changed state for ${Math.round(youngest / 1000)}s while ${live.length} remain live.`,
        live.map((t) => `${t.taskId} ${t.state} ${Math.round((input.taskAgeMs[t.taskId] ?? 0) / 1000)}s`),
      ),
    ];
  }
  return [];
};

export const ALL_DETECTORS: Array<{ kind: FailureKind; fn: Detector }> = [
  { kind: "REPEATED_FAILURE", fn: repeatedFailure },
  { kind: "TIMEOUT_LOOP", fn: timeoutLoop },
  { kind: "TOOL_FAILURE_LOOP", fn: toolFailureLoop },
  { kind: "DUPLICATE_WORK", fn: duplicateWork },
  { kind: "CONTRADICTORY_OUTPUT", fn: contradictoryOutput },
  { kind: "AGENT_STARVATION", fn: agentStarvation },
  { kind: "DEPENDENCY_DEADLOCK", fn: dependencyDeadlock },
  { kind: "BUDGET_EXHAUSTION", fn: budgetExhaustion },
  { kind: "PERMISSION_DENIAL", fn: permissionDenial },
  { kind: "INVALID_ARTIFACT_STATE", fn: invalidArtifactState },
  { kind: "REGRESSION", fn: regression },
  { kind: "MISSING_CAPABILITY", fn: missingCapability },
  { kind: "STALL", fn: stall },
];

export function detectAll(input: DetectionInput): FailureSignal[] {
  const out: FailureSignal[] = [];
  for (const { fn } of ALL_DETECTORS) {
    try {
      out.push(...fn(input));
    } catch (e) {
      // A broken detector must not stop the mission, but it must not be silent either.
      out.push(
        signal("INVALID_ARTIFACT_STATE", "WARN", input, "detector", `Detector threw: ${e instanceof Error ? e.message : String(e)}`, []),
      );
    }
  }
  return out;
}

function medianOf(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function round(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(4);
}
