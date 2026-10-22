/**
 * VH 11.11.1 SELF-EVOLVING — strategy self-improvement as a genuine online experiment.
 *
 * 11.11.0 kept an archive of strategy versions and scored a candidate on the accumulated
 * run log. The 11.11.0 review caught the flaw precisely: the runs in that log were executed
 * under the PARENT's parameters — the candidate never ran, yet could be credited with the
 * parent's results, and an unmeasured baseline (score null) lost to any real candidate score
 * after a couple of runs. "Strategy self-improvement" was ahead of the implementation.
 *
 * 11.11.1 rebuilds the loop as a causal chain:
 *
 *   candidate proposed → next runs ALTERNATE between baseline and candidate
 *   → each run records WHICH strategy governed it (attribution)
 *   → each arm is scored ONLY on runs executed under its own parameters
 *   → adoption requires MIN_TRIALS measured runs on BOTH arms and a strict margin
 *   → otherwise the candidate waits; at TRIAL_CAP without a verdict it retires inconclusive.
 *
 * A candidate can therefore never be credited with results it did not produce, and a
 * baseline can no longer be unmeasured: the adopted version's score is continuously
 * recomputed from the runs it actually governed. Simulated runs still teach nothing —
 * an arm with only simulated runs has score null and waits.
 *
 * The strategy parameters are not decorative: the runner executes them. serialExec
 * flattens the wave plan (one seat per wave), reviewDepth adds a second independent
 * review pass instruction to every reviewer briefing, checkBias sets how deep the web
 * evidence search is sliced, lessonBudget caps the org-memory lines in ORG_LESSONS.md.
 * The run report records the strategy id + params that governed it, so attribution is
 * a fact in the evidence, not an assumption in the settlement.
 */

export interface StrategyParams {
  reviewDepth: number;   // 1..2 — independent review passes instructed to reviewer seats
  checkBias: number;     // 0..1 — depth of the web-evidence search slice (2..8 triples)
  serialExec: boolean;   // flatten the wave plan: one seat per wave, strictly serial
  lessonBudget: number;  // org-memory lines injected into briefings
  /** 11.12 MOSAIC — regime dimension: extract on/off; measured as an experiment arm. */
  mosaic: boolean;
}

export interface StrategyVersion {
  id: string;
  gen: number;
  params: StrategyParams;
  parentId: string | null;
  status: "candidate" | "adopted" | "retired";
  score: number | null;        // verified-rate over MEASURED runs this strategy governed
  evaluatedOn: number;         // measured runs scored (own attributed runs only)
  note: string;
  createdAt: number;
}

export interface ImprovementState {
  versions: StrategyVersion[];
  adoptedId: string | null;
}

/** Measured runs required on EACH arm before any adopt/retire verdict. */
export const MIN_TRIALS = 3;
/** Attributed runs per arm after which an undecided experiment retires inconclusive. */
export const TRIAL_CAP = 8;
export const ADOPT_MARGIN = 0.05;
export const ARCHIVE_CAP = 24;

const LS_KEY = "vh.selfimprove.v1";

export const BASE_PARAMS: StrategyParams = {
  reviewDepth: 1,
  checkBias: 0.5,
  serialExec: false,
  lessonBudget: 3,
  mosaic: false,
};

export function initialState(now: number): ImprovementState {
  const v: StrategyVersion = {
    id: "strategy-v1",
    gen: 1,
    params: { ...BASE_PARAMS },
    parentId: null,
    status: "adopted",
    score: null,
    evaluatedOn: 0,
    note: "baseline — shipped defaults; measured on the runs it itself governs",
    createdAt: now,
  };
  return { versions: [v], adoptedId: v.id };
}

import { enforceWrite } from "./ledger";

export function loadImprovement(): ImprovementState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as ImprovementState;
      if (p && Array.isArray(p.versions) && p.versions.length > 0) return p;
    }
  } catch { /* storage unavailable */ }
  return initialState(Date.now());
}

export function saveImprovement(s: ImprovementState, writer: "human" | "agent" | "experiment" = "experiment"): void {
  // 11.12.3 — governed write: the strategy archive is RECOURSE; only the
  // measured experiment or a human may persist it.
  enforceWrite("RECOURSE", writer);
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function adoptedVersion(s: ImprovementState): StrategyVersion | null {
  return s.versions.find((v) => v.id === s.adoptedId) ?? null;
}

export function adoptedParams(s: ImprovementState): StrategyParams {
  return adoptedVersion(s)?.params ?? { ...BASE_PARAMS };
}

const DIMS: Array<keyof StrategyParams> = ["reviewDepth", "checkBias", "serialExec", "lessonBudget", "mosaic"];

/** One deterministic mutation per generation: rotate through the dimensions. */
export function proposeVariation(s: ImprovementState, now: number): ImprovementState {
  const parent = adoptedVersion(s);
  if (!parent) return s;
  if (s.versions.some((v) => v.status === "candidate")) return s; // one candidate at a time
  const gen = Math.max(...s.versions.map((v) => v.gen)) + 1; // unique even after retire/re-propose cycles
  const dim = DIMS[(gen - 2) % DIMS.length];
  const params: StrategyParams = { ...parent.params };
  if (dim === "reviewDepth") params.reviewDepth = params.reviewDepth === 1 ? 2 : 1;
  else if (dim === "checkBias") params.checkBias = params.checkBias >= 0.75 ? 0.25 : params.checkBias + 0.25;
  else if (dim === "serialExec") params.serialExec = !params.serialExec;
  else if (dim === "lessonBudget") params.lessonBudget = params.lessonBudget >= 6 ? 1 : params.lessonBudget + 1;
  else params.mosaic = !params.mosaic; // 11.12 — regime dimension: MOSAIC extract on/off
  const v: StrategyVersion = {
    id: `strategy-v${gen}`,
    gen,
    params,
    parentId: parent.id,
    status: "candidate",
    score: null,
    evaluatedOn: 0,
    note: `mutated ${String(dim)} from parent v${parent.gen}; will govern alternating runs and be judged only on its own measured results`,
    createdAt: now,
  };
  return { ...s, versions: [...s.versions, v].slice(-ARCHIVE_CAP) };
}

/** A run's outcome, attributed to the strategy whose parameters governed it. */
export interface RunOutcome { verified: boolean; simulated: boolean; strategyId: string | null }

/** Score = verified-rate over REAL runs. All-simulated => null (nothing observed). */
export function scoreRuns(runs: RunOutcome[]): { score: number | null; measured: number } {
  const real = runs.filter((r) => !r.simulated);
  if (real.length === 0) return { score: null, measured: 0 };
  return {
    score: real.filter((r) => r.verified).length / real.length,
    measured: real.length,
  };
}

export interface ArmScore { score: number | null; measured: number; attributed: number }

/** Each arm scored ONLY on runs executed under its own parameters. */
export function armScores(s: ImprovementState, runs: RunOutcome[]): { baseline: ArmScore; candidate: ArmScore | null; baselineId: string | null; candidateId: string | null } {
  const baseline = adoptedVersion(s);
  const candidate = s.versions.find((v) => v.status === "candidate") ?? null;
  const score = (id: string | null): ArmScore => {
    const own = runs.filter((r) => r.strategyId === id);
    return { ...scoreRuns(own), attributed: own.length };
  };
  return {
    baseline: score(baseline?.id ?? null),
    candidate: candidate ? score(candidate.id) : null,
    baselineId: baseline?.id ?? null,
    candidateId: candidate?.id ?? null,
  };
}

/**
 * Balanced assignment for the NEXT run: the arm with fewer attributed runs gets the run,
 * ties go to the candidate so a fresh experiment immediately gathers candidate data.
 * With no candidate, the adopted baseline governs. This interleaves the two arms over
 * the arriving workload so both see the same distribution of missions over time.
 */
export function nextAssignment(s: ImprovementState, runs: RunOutcome[]): StrategyVersion | null {
  const baseline = adoptedVersion(s);
  const candidate = s.versions.find((v) => v.status === "candidate") ?? null;
  if (!candidate) return baseline;
  if (!baseline) return candidate;
  const cN = runs.filter((r) => r.strategyId === candidate.id).length;
  const bN = runs.filter((r) => r.strategyId === baseline.id).length;
  return cN <= bN ? candidate : baseline;
}

/**
 * Settle the experiment on ATTRIBUTED measured runs.
 *
 * The baseline's stored score is always recomputed from the runs it governed, so a parent
 * is never "unmeasured" while an experiment is running. A verdict (adopt or retire) is
 * possible only when BOTH arms have >= MIN_TRIALS measured runs; adoption additionally
 * requires the candidate to beat the baseline by a strict margin. Runs without attribution
 * (pre-11.11.1 history) are excluded from both arms — they were not part of any experiment.
 */
export function settleCandidate(s: ImprovementState, runs: RunOutcome[], _now: number): ImprovementState {
  const baseline = adoptedVersion(s);
  if (!baseline) return s;
  const arms = armScores(s, runs);
  const base = arms.baseline;

  // Continuous measurement of the parent on its own runs.
  let versions = s.versions.map((v) => v.id === baseline.id
    ? { ...v, score: base.score, evaluatedOn: base.measured }
    : v);
  const candidate = versions.find((v) => v.status === "candidate");
  if (!candidate) return { ...s, versions };

  const cand = arms.candidate as ArmScore;
  const verdict = (status: "adopted" | "retired", note: string): ImprovementState => ({
    versions: versions.map((v) => {
      if (v.id === candidate.id) return { ...v, status, score: cand.score, evaluatedOn: cand.measured, note };
      if (status === "adopted" && v.id === baseline.id) return { ...v, status: "retired" as const, note: `retired — candidate ${candidate.id} beat it ${cand.score?.toFixed(2)} to ${base.score?.toFixed(2)} on ${cand.measured}/${base.measured} measured runs` };
      return v;
    }),
    adoptedId: status === "adopted" ? candidate.id : s.adoptedId,
  });

  const bothTrials = cand.measured >= MIN_TRIALS && base.measured >= MIN_TRIALS;
  const capped = cand.attributed >= TRIAL_CAP || base.attributed >= TRIAL_CAP;

  if (!bothTrials) {
    if (capped) {
      return verdict("retired",
        `retired inconclusive at the ${TRIAL_CAP}-run cap — candidate ${cand.measured}/${MIN_TRIALS}, baseline ${base.measured}/${MIN_TRIALS} measured; no verdict on insufficient trials`);
    }
    return {
      ...s,
      versions: versions.map((v) => v.id === candidate.id
        ? { ...v, note: `waiting — candidate ${cand.measured}/${MIN_TRIALS}, baseline ${base.measured}/${MIN_TRIALS} measured runs; each arm scored only on runs it governed` }
        : v),
    };
  }

  const better = (cand.score as number) > (base.score as number) + ADOPT_MARGIN;
  return better
    ? verdict("adopted",
        `adopted at ${(cand.score as number).toFixed(2)} over ${cand.measured} own measured runs (baseline ${(base.score as number).toFixed(2)} over ${base.measured}) — margin ${((cand.score as number) - (base.score as number)).toFixed(2)} > ${ADOPT_MARGIN}`)
    : verdict("retired",
        `retired at ${(cand.score as number).toFixed(2)} over ${cand.measured} own measured runs — baseline held ${(base.score as number).toFixed(2)} over ${base.measured}; no strict margin`);
}

/** 11.12.1 — ablation clarity: which dimensions differ between two param sets. */
export function diffDims(a: StrategyParams, b: StrategyParams): Array<keyof StrategyParams> {
  return (Object.keys(a) as Array<keyof StrategyParams>).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

/** serialExec flattens the wave plan: one seat per wave, strictly serial execution. */
export function strategyWaveShape<T extends { wave: number }>(assignments: T[], serial: boolean): T[][] {
  if (serial) return assignments.map((a) => [a]);
  const byWave = new Map<number, T[]>();
  for (const a of assignments) {
    const list = byWave.get(a.wave) ?? [];
    list.push(a);
    byWave.set(a.wave, list);
  }
  return [...byWave.entries()].sort((x, y) => x[0] - y[0]).map(([, v]) => v);
}

/** checkBias 0..1 maps to a web-evidence slice of 2..8 triples — how hard the check dimension searches. */
export function evidenceDepth(checkBias: number): number {
  return Math.max(2, Math.min(8, Math.round(2 + checkBias * 6)));
}

/** reviewDepth 2 instructs a second, adversarial independent review pass in reviewer briefings. */
export function reviewBriefingLines(reviewDepth: number): string[] {
  if (reviewDepth < 2) return [];
  return ["[strategy review depth 2] Reviewers: two independent passes. Pass 1 attacks correctness and demands re-run evidence for every pass claim. Pass 2 re-reads the diff assuming pass 1 missed something. Style nits last and labelled."];
}
