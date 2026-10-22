/**
 * §FLEET ASSURANCE SCORE — a measured trust metric for agent teams (VH 14.0).
 *
 * WHY THIS EXISTS
 * Risk committees and cyber-insurers keep asking the same question about agent fleets:
 * "how much of this team's work is actually EVIDENCED?" Benchmarks answer capability;
 * this answers assurance — how much of what the team did was cross-vendor verified,
 * arena-gated, budget-disciplined, egress-clean and human-rated. Every factor is
 * derived from artifacts VH already issues (gate verdicts, arena digests, the budget
 * ledger, the egress ledger, human feedback), so the score is an audit input with a
 * breakdown, not a badge.
 *
 * THE HONESTY RULES
 *  - No measured runs → `unevaluated`. The score refuses to exist without evidence —
 *    the same settlement rule the bandit follows. Nothing simulated counts.
 *  - Simulated runs never ADD assurance; they DILUTE it through evidence coverage:
 *    score = rawPoints × measured/(measured+simulated). A team that hides half its
 *    work in labeled simulation gets half-strength assurance.
 *  - The breakdown IS the product: every point names the factor that earned it, and
 *    the score is monotone in each factor (more verification never lowers it).
 */

export interface AssuranceInput {
  /** Missions that RAN for real (exit-code-measured). */
  measuredRuns: number;
  /** Labeled-simulation runs — dilute coverage, never add points. */
  simulatedRuns: number;
  /** Of the measured runs: verified by a DIFFERENT vendor's harness than the writer's. */
  crossVendorVerifiedRuns: number;
  /** Verified, but only by the same vendor (weaker evidence; capped contribution). */
  sameVendorVerifiedRuns: number;
  /** Measured runs admitted through a PASSing governance arena. */
  arenaPassRuns: number;
  /** Per measured mission: budget adherence in (0,1] from the chargeback module; null = unmeasurable. */
  budgetAdherences: Array<number | null>;
  /** Recorded egress-gate violations (departures that were refused are NOT violations). */
  egressViolations: number;
  /** Human 1–5 ratings on measured cycles. */
  feedbackRatings: number[];
}

export interface AssuranceFactor {
  name: string;
  points: number;
  max: number;
  note: string;
}

export interface AssuranceScore {
  status: "evaluated" | "unevaluated";
  score: number | null;
  band: "A" | "B" | "C" | "D" | null;
  evidenceCoverage: number | null;
  factors: AssuranceFactor[];
  unevaluatedReason?: string;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function scoreAssurance(i: AssuranceInput): AssuranceScore {
  if (!Number.isFinite(i.measuredRuns) || i.measuredRuns <= 0) {
    return {
      status: "unevaluated",
      score: null,
      band: null,
      evidenceCoverage: null,
      factors: [],
      unevaluatedReason: "No measured runs — the score refuses to exist without evidence (simulated runs teach nothing).",
    };
  }
  const measured = i.measuredRuns;
  const factors: AssuranceFactor[] = [];

  // 1 · Verification (max 35): cross-vendor verification is the strong form; same-vendor
  // verification earns a capped share because the adversarial core is the vendor mix.
  const cvRatio = clamp(i.crossVendorVerifiedRuns / measured, 0, 1);
  const svRatio = clamp(i.sameVendorVerifiedRuns / measured, 0, 1);
  // Perfect vendor-diverse coverage is the ONE way to earn the full 35: a fleet that
  // cross-vendor-verified every measured run has no self-grading surface left at all.
  const verificationPoints = cvRatio === 1 ? 35 : round2(25 * cvRatio + Math.min(10, 10 * svRatio));
  factors.push({
    name: "verification",
    points: verificationPoints,
    max: 35,
    note: cvRatio === 1
      ? "100% cross-vendor verified — the full factor"
      : `${Math.round(cvRatio * 100)}% cross-vendor verified (25 pts), ${Math.round(svRatio * 100)}% same-vendor (capped 10)`,
  });

  // 2 · Governance arena (max 20): measured runs admitted through a PASSing battery.
  const arenaRatio = clamp(i.arenaPassRuns / measured, 0, 1);
  factors.push({
    name: "governance arena",
    points: round2(20 * arenaRatio),
    max: 20,
    note: `${Math.round(arenaRatio * 100)}% of measured runs passed the arena preflight`,
  });

  // 3 · Budget discipline (max 20): mean adherence over the MEASURABLE missions,
  // scaled by how many missions were measurable at all.
  const measurable = i.budgetAdherences.filter((a): a is number => a !== null);
  const budgetCoverage = clamp(measurable.length / measured, 0, 1);
  const meanAdherence = measurable.length > 0 ? measurable.reduce((a, b) => a + b, 0) / measurable.length : 0;
  factors.push({
    name: "budget discipline",
    points: round2(20 * meanAdherence * budgetCoverage),
    max: 20,
    note: measurable.length === 0
      ? "no mission reported measured spend against a cap"
      : `mean adherence ${round2(meanAdherence)} over ${measurable.length}/${measured} measurable missions`,
  });

  // 4 · Egress integrity (max 15): violations subtract; clean fleets keep the full 15.
  const integrityPoints = round2(clamp(15 - 5 * i.egressViolations, 0, 15));
  factors.push({
    name: "egress integrity",
    points: integrityPoints,
    max: 15,
    note: i.egressViolations === 0 ? "no egress-gate violations on record" : `${i.egressViolations} violation(s) on record`,
  });

  // 5 · Human feedback (max 10): mean rating (1–5) scaled ×2.
  const feedbackMean = i.feedbackRatings.length > 0 ? i.feedbackRatings.reduce((a, b) => a + b, 0) / i.feedbackRatings.length : 0;
  factors.push({
    name: "human feedback",
    points: round2(clamp(2 * feedbackMean, 0, 10)),
    max: 10,
    note: i.feedbackRatings.length === 0 ? "no human ratings yet" : `mean rating ${round2(feedbackMean)} over ${i.feedbackRatings.length} cycle(s)`,
  });

  const raw = round2(factors.reduce((a, f) => a + f.points, 0));
  const coverage = clamp(measured / (measured + Math.max(0, i.simulatedRuns)), 0, 1);
  const score = Math.round(clamp(raw * coverage, 0, 100));
  const band = score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : "D";

  return { status: "evaluated", score, band, evidenceCoverage: round2(coverage), factors };
}
