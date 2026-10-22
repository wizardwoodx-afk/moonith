/**
 * §18 True agent evaluation + §19 mission success score.
 *
 * The rule this module exists to enforce: **an agent is never the sole authority on its own
 * success.** A self-report is recorded, weighted low, and can never make an evaluation pass
 * on its own.
 *
 * Equally important: a check that could not be run is recorded as `measured: false`. It is
 * never silently counted as a pass. `fullyMeasured` is false whenever a required check was
 * skipped, and the mission UI says so.
 */

import { uid } from "../app/id";
import type {
  ArtifactEvaluation,
  EvaluationCheck,
  EvidenceSource,
  MissionScore,
  PlanStep,
} from "./types";

/** Which checks are required for a given kind of work. */
export const REQUIRED_CHECKS: Record<PlanStep["kind"], EvidenceSource[]> = {
  research: ["INDEPENDENT_REVIEW"],
  architecture: ["INDEPENDENT_REVIEW"],
  implementation: ["TEST_RUN", "STATIC_CHECK", "INDEPENDENT_REVIEW"],
  test: ["INDEPENDENT_REVIEW"],
  security: ["SECURITY_CHECK", "INDEPENDENT_REVIEW"],
  review: ["INDEPENDENT_REVIEW"],
  synthesis: ["INDEPENDENT_REVIEW"],
  approval: [],
  release: ["INDEPENDENT_REVIEW", "REGRESSION_SUITE"],
};

export interface CheckInput {
  name: string;
  source: EvidenceSource;
  passed: boolean;
  score: number | null;
  detail: string;
  evidence?: string[];
  /** False when the check could not actually be run. */
  measured?: boolean;
}

export function check(input: CheckInput): EvaluationCheck {
  return {
    id: uid("chk"),
    name: input.name,
    source: input.source,
    passed: input.measured === false ? false : input.passed,
    score: input.measured === false ? null : input.score,
    detail: input.measured === false ? `NOT MEASURED — ${input.detail}` : input.detail,
    measured: input.measured !== false,
    evidence: input.evidence ?? [],
  };
}

/** A check that could not be run. Explicit, never a silent pass. */
export function unmeasuredCheck(name: string, source: EvidenceSource, why: string): EvaluationCheck {
  return check({ name, source, passed: false, score: null, detail: why, measured: false });
}

export interface EvaluateInput {
  artifactId: string;
  kind: PlanStep["kind"];
  checks: EvaluationCheck[];
  /** Set when the producing agent also produced one of the checks. */
  selfReportedBy?: string | null;
}

/**
 * Decide whether an artifact passes. Rules:
 *   1. Every required check for this kind of work must be present and measured.
 *   2. Every present check must pass.
 *   3. A self-report alone can never satisfy a requirement.
 */
export function evaluateArtifact(input: EvaluateInput): ArtifactEvaluation {
  const required = REQUIRED_CHECKS[input.kind] ?? [];
  const bySource = new Map<EvidenceSource, EvaluationCheck[]>();
  for (const c of input.checks) {
    const list = bySource.get(c.source) ?? [];
    list.push(c);
    bySource.set(c.source, list);
  }

  const unmeasured: string[] = [];
  for (const src of required) {
    const present = bySource.get(src) ?? [];
    if (!present.length) unmeasured.push(`${src} (absent)`);
    else if (present.every((c) => !c.measured)) unmeasured.push(`${src} (present but not measured)`);
  }

  // A self-report cannot stand in for an independent source.
  const onlySelfReport =
    input.checks.length > 0 && input.checks.every((c) => c.source === "AGENT_SELF_REPORT");
  if (onlySelfReport && required.length) {
    unmeasured.push("independent verification (only a self-report was offered)");
  }

  const failed = input.checks.filter((c) => !c.passed);
  const passed = unmeasured.length === 0 && failed.length === 0 && input.checks.length > 0;

  return {
    evaluationId: uid("eval"),
    artifactId: input.artifactId,
    checks: input.checks,
    passed,
    fullyMeasured: unmeasured.length === 0,
    unmeasured,
    decidedAt: new Date().toISOString(),
  };
}

/** Weighted composite for a single check set, 0..1. Unmeasured checks drag it down. */
export function compositeOfChecks(checks: EvaluationCheck[]): number {
  if (!checks.length) return 0;
  const weights: Record<EvidenceSource, number> = {
    AGENT_SELF_REPORT: 0.1,
    TEST_RUN: 1,
    STATIC_CHECK: 0.8,
    SECURITY_CHECK: 1,
    INDEPENDENT_REVIEW: 1,
    REGRESSION_SUITE: 1,
    HUMAN: 1.2,
  };
  let sum = 0;
  let weight = 0;
  for (const c of checks) {
    const w = weights[c.source] ?? 0.5;
    weight += w;
    if (!c.measured) continue; // contributes weight but no credit
    sum += w * (c.score ?? (c.passed ? 1 : 0));
  }
  return weight ? sum / weight : 0;
}

/* ------------------------------------------------------------------ §19 mission score */

export interface ScoreInput {
  successCriteria: string[];
  criteriaMet: string[];
  checks: EvaluationCheck[];
  testChecks: EvaluationCheck[];
  securityChecks: EvaluationCheck[];
  spentUsd: number;
  budgetUsd: number;
  elapsedMs: number;
  deadlineMs: number | null;
  humanInterventions: number;
  regressionCount: number;
}

/**
 * §19 Dimensions are reported separately. There is deliberately no single "mission score"
 * number: collapsing security and latency into one figure hides exactly the thing a reader
 * needs to see.
 */
export function scoreMission(input: ScoreInput): MissionScore {
  const unmeasured: string[] = [];

  const goalCompletion = input.successCriteria.length
    ? input.criteriaMet.length / input.successCriteria.length
    : (unmeasured.push("goal completion (no success criteria were declared)"), 0);

  const measuredChecks = input.checks.filter((c) => c.measured);
  if (!measuredChecks.length) unmeasured.push("quality (no measured checks)");
  const quality = measuredChecks.length ? compositeOfChecks(measuredChecks) : 0;

  const measuredTests = input.testChecks.filter((c) => c.measured);
  if (!measuredTests.length) unmeasured.push("tests (none were run)");
  const tests = measuredTests.length ? measuredTests.filter((c) => c.passed).length / measuredTests.length : 0;

  const measuredSec = input.securityChecks.filter((c) => c.measured);
  if (!measuredSec.length) unmeasured.push("security (no security checks were run)");
  const security = measuredSec.length ? measuredSec.filter((c) => c.passed).length / measuredSec.length : 0;

  const costEfficiency = input.budgetUsd > 0 ? clamp01(1 - input.spentUsd / input.budgetUsd) : (unmeasured.push("cost (no budget was set)"), 0);

  let latencyEfficiency = 0;
  if (input.deadlineMs && input.deadlineMs > 0) {
    latencyEfficiency = clamp01(1 - input.elapsedMs / input.deadlineMs);
  } else {
    unmeasured.push("latency (no deadline was set)");
  }

  return {
    goalCompletion: round(goalCompletion),
    quality: round(quality),
    tests: round(tests),
    security: round(security),
    costEfficiency: round(costEfficiency),
    latencyEfficiency: round(latencyEfficiency),
    humanInterventions: input.humanInterventions,
    regressionCount: input.regressionCount,
    unmeasured,
  };
}

/** Render the score the way the mission UI shows it — dimensions, not a single number. */
export function renderScore(score: MissionScore): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const lines = [
    `Goal completion      ${pct(score.goalCompletion)}`,
    `Quality              ${pct(score.quality)}`,
    `Tests                ${pct(score.tests)}`,
    `Security             ${pct(score.security)}`,
    `Cost                 ${pct(score.costEfficiency)}`,
    `Latency              ${pct(score.latencyEfficiency)}`,
    `Human interventions  ${score.humanInterventions}`,
    `Regressions          ${score.regressionCount}`,
  ];
  if (score.unmeasured.length) {
    lines.push("", "Not measured (not counted as passes):");
    for (const u of score.unmeasured) lines.push(`  - ${u}`);
  }
  return lines.join("\n");
}

/**
 * Independent test-run check built from real command output. The output is the evidence;
 * if there is no output, the check is unmeasured rather than passed.
 */
export function testRunCheck(command: string, output: string, exitCode: number | null): EvaluationCheck {
  if (!output.trim()) {
    return unmeasuredCheck(`Test run: ${command}`, "TEST_RUN", "the command produced no output, so nothing was verified");
  }
  // V11.8.1: the exit code is the measured verdict; text is corroboration, never a veto.
  // The 7th review ran the shipped offline gate on a machine whose environment injected an
  // unrelated artifact-tool startup Traceback into captured stderr, and the old any-match
  // regex (fail/error/✗/FAILED/panic:/Traceback) flipped a green pytest run
  // (exit 0, "1 passed") to FAILED. Now a zero exit is overturned only by the RUNNER'S OWN
  // failure summary: a counted "N failed/failing/failures" with N > 0, a TAP "not ok"
  // line, a "FAILED" summary line, or a Go "panic:". Ambient noise words can no longer
  // veto a measured pass; a non-zero exit fails regardless of cheerful text.
  const failedCounts = [...output.matchAll(/(\d+)[ ,]+fail(?:ed|ing|ures?)?\b/gi)].map((m) => Number(m[1]));
  const summaryFailed =
    failedCounts.some((n) => n > 0) ||
    /^not ok\b/m.test(output) ||
    /^FAILED\b/m.test(output) ||
    /\bpanic:/.test(output);
  const passed = exitCode === 0 && !summaryFailed;
  return check({
    name: `Test run: ${command}`,
    source: "TEST_RUN",
    passed,
    score: passed ? 1 : 0,
    detail: `exit=${exitCode ?? "?"}, ${output.length} bytes of output, ${summaryFailed ? "runner summary reports failures" : "no failure summary"}`,
    evidence: [output.slice(0, 2000)],
  });
}

export function staticCheckOutput(): string {
  return "static analysis";
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
