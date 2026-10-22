/**
 * §6 Harness selection + §7 arbitration learning.
 *
 * Selection is a weighted score over evidence, and every component of the score is returned
 * so the UI can show *why* a harness won. Nothing is hardcoded as permanent truth:
 * historical performance is one weighted signal among several, it decays with age, and a
 * harness with no history is never penalised for having none.
 */

import type { HarnessId } from "../domain/harness";
import type {
  ArbitrationDecision,
  HarnessRunRecord,
  HarnessStats,
  Mission,
  PlanStep,
} from "./types";
import { allHarnesses, getHarness, type AgentRuntimeId } from "./harnessAdapters";
import { uid } from "../app/id";

/** Weights are explicit and sum-independent; they are the policy, and the UI shows them. */
export const ARBITRATION_WEIGHTS = {
  capabilityMatch: 0.3,
  languageMatch: 0.15,
  historicalSuccess: 0.25,
  latency: 0.1,
  cost: 0.05,
  permissionFit: 0.1,
  recency: 0.05,
} as const;

/** Evidence older than this counts for nothing (§7: evidence, not truth). */
export const EVIDENCE_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

export interface ArbitrationContext {
  mission: Mission;
  step: PlanStep;
  /** Harnesses detected as installed on this machine. Null = unknown. */
  installed: Record<string, boolean | null>;
  /** Allow the labelled test double. Off unless the mission says otherwise. */
  allowSimulated: boolean;
  repository?: string;
  now?: number;
}

export class HarnessLedger {
  private records: HarnessRunRecord[] = [];

  record(rec: Omit<HarnessRunRecord, "id" | "at"> & { at?: string }): HarnessRunRecord {
    const full: HarnessRunRecord = { ...rec, id: uid("hr"), at: rec.at ?? new Date().toISOString() };
    this.records.push(full);
    return full;
  }

  all(): HarnessRunRecord[] {
    return [...this.records];
  }

  forHarness(harness: HarnessId): HarnessRunRecord[] {
    return this.records.filter((r) => r.harness === harness);
  }

  /**
   * §7 Aggregate performance. `verifiedSuccessRate` counts only runs whose outcome an
   * independent check confirmed — an agent saying "done" is not a success.
   */
  stats(harness: HarnessId, scope?: { repository?: string; taskKind?: string; language?: string }): HarnessStats {
    let recs = this.forHarness(harness);
    if (scope?.repository) recs = recs.filter((r) => r.repository === scope.repository);
    if (scope?.taskKind) recs = recs.filter((r) => r.taskKind === scope.taskKind);
    if (scope?.language) recs = recs.filter((r) => r.languages.includes(scope.language!));

    const kindAcc = new Map<string, { runs: number; success: number; ms: number[] }>();
    const langAcc = new Map<string, { runs: number; success: number }>();
    for (const r of recs) {
      const k = kindAcc.get(r.taskKind) ?? { runs: 0, success: 0, ms: [] };
      k.runs += 1;
      if (r.success) k.success += 1;
      k.ms.push(r.latencyMs);
      kindAcc.set(r.taskKind, k);
      for (const lang of r.languages) {
        const l = langAcc.get(lang) ?? { runs: 0, success: 0 };
        l.runs += 1;
        if (r.success) l.success += 1;
        langAcc.set(lang, l);
      }
    }
    const latencies = recs.map((r) => r.latencyMs).sort((a, b) => a - b);
    return {
      harness,
      runs: recs.length,
      successRate: recs.length ? recs.filter((r) => r.success).length / recs.length : 0,
      verifiedSuccessRate: recs.length ? recs.filter((r) => r.independentlyVerified).length / recs.length : 0,
      medianLatencyMs: latencies.length ? latencies[Math.floor(latencies.length / 2)] : 0,
      totalCostUsd: recs.reduce((s, r) => s + r.costUsd, 0),
      byTaskKind: Object.fromEntries(
        [...kindAcc.entries()].map(([k, v]) => [
          k,
          { runs: v.runs, successRate: v.runs ? v.success / v.runs : 0, medianLatencyMs: median(v.ms) },
        ]),
      ),
      byLanguage: Object.fromEntries(
        [...langAcc.entries()].map(([k, v]) => [k, { runs: v.runs, successRate: v.runs ? v.success / v.runs : 0 }]),
      ),
    };
  }

  /** Recency-weighted success rate. Old evidence fades instead of ossifying. */
  decayedSuccessRate(harness: HarnessId, now = Date.now()): { rate: number; effectiveRuns: number } {
    const recs = this.forHarness(harness);
    if (!recs.length) return { rate: 0, effectiveRuns: 0 };
    let weightedSuccess = 0;
    let weight = 0;
    for (const r of recs) {
      const age = Math.max(0, now - new Date(r.at).getTime());
      const w = Math.pow(0.5, age / EVIDENCE_HALF_LIFE_MS);
      weight += w;
      if (r.independentlyVerified) weightedSuccess += w;
      else if (r.success) weightedSuccess += w * 0.6; // self-reported success counts less
    }
    return { rate: weight ? weightedSuccess / weight : 0, effectiveRuns: weight };
  }

  hydrate(records: HarnessRunRecord[]): void {
    this.records = [...records];
  }

  export(): HarnessRunRecord[] {
    return this.all();
  }
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * §6 Decide which harness runs a step.
 *
 * Returns the full scoring table, not just a winner: the flight recorder stores the
 * rationale, and the UI can show why any engine won or lost for any task.
 */
export function selectHarness(ctx: ArbitrationContext, ledger: HarnessLedger): ArbitrationDecision {
  const candidates = allHarnesses().filter((h) => {
    if (h.simulated) return ctx.allowSimulated;
    if (!ctx.mission.allowedHarnesses.length) return true;
    return ctx.mission.allowedHarnesses.includes(h.id as HarnessId);
  });

  const rejected: ArbitrationDecision["rejected"] = [];
  const scores: ArbitrationDecision["scores"] = [];
  let usedHistoricalEvidence = false;

  for (const h of candidates) {
    // A harness we know is absent cannot run. Unknown is allowed (it may be installed under
    // a name we did not probe) but scored down.
    const installState = ctx.installed[h.id] ?? null;
    if (installState === false) {
      rejected.push({ harness: h.id, reason: "not installed on this machine" });
      continue;
    }
    const components: Record<string, number> = {};

    // Capability match: fraction of required capabilities the adapter actually provides.
    const required = ctx.step.requiredCapabilities;
    components.capabilityMatch = required.length
      ? required.filter((c) => h.capabilities.includes(c) || h.capabilities.includes("simulation")).length / required.length
      : 0.5;

    // Language match.
    const langs = ctx.step.languages;
    components.languageMatch = langs.length
      ? langs.filter((l) => h.languages.includes(l) || h.languages.includes("any")).length / langs.length
      : 0.5;

    // Historical evidence — scoped to this repository and task kind when we have it.
    const hid = h.id as HarnessId;
    const scoped = ledger.stats(hid, { repository: ctx.repository, taskKind: ctx.step.kind });
    const broad = ledger.stats(hid);
    const decayed = ledger.decayedSuccessRate(hid, ctx.now);
    const basis = scoped.runs >= 3 ? scoped : broad;
    if (basis.runs > 0) {
      usedHistoricalEvidence = true;
      // Blend the raw rate with the recency-decayed rate; never let one run dominate.
      const confidence = Math.min(1, basis.runs / 10);
      components.historicalSuccess = confidence * (0.5 * basis.verifiedSuccessRate + 0.5 * decayed.rate) + (1 - confidence) * 0.5;
    } else {
      // No history is neutral, not a penalty (§7).
      components.historicalSuccess = 0.5;
    }

    // Latency: only meaningful with history; neutral otherwise.
    components.latency = basis.medianLatencyMs > 0 ? Math.max(0, 1 - basis.medianLatencyMs / 300_000) : 0.5;

    // Cost: CLI harnesses bill the user's subscription, so cost is neutral unless measured.
    components.cost = basis.totalCostUsd > 0 ? Math.max(0, 1 - basis.totalCostUsd / Math.max(0.01, ctx.mission.budget.maxCostUsd)) : 0.5;

    // Permission fit: prefer a harness that needs fewer privileges than the mission grants.
    components.permissionFit = h.canEditFiles === ctx.mission.boundary.filesystemWrite ? 1 : 0.6;

    // Recency bonus for harnesses that ran recently and succeeded.
    components.recency = installState === true ? 0.7 : 0.4;

    const score =
      components.capabilityMatch * ARBITRATION_WEIGHTS.capabilityMatch +
      components.languageMatch * ARBITRATION_WEIGHTS.languageMatch +
      components.historicalSuccess * ARBITRATION_WEIGHTS.historicalSuccess +
      components.latency * ARBITRATION_WEIGHTS.latency +
      components.cost * ARBITRATION_WEIGHTS.cost +
      components.permissionFit * ARBITRATION_WEIGHTS.permissionFit +
      components.recency * ARBITRATION_WEIGHTS.recency;

    scores.push({ harness: h.id, score: Number(score.toFixed(4)), components });
  }

  scores.sort((a, b) => b.score - a.score);

  if (!scores.length) {
    // Fall back to the test double only when it is allowed; otherwise this is a hard failure
    // that the mission must surface, not paper over.
    if (ctx.allowSimulated) {
      return {
        chosen: "local-test",
        scores: [{ harness: "local-test", score: 0, components: { fallback: 1 } }],
        rationale: ["No eligible harness. Falling back to the labelled simulation because the mission allows it."],
        rejected,
        usedHistoricalEvidence: false,
        simulated: true,
      };
    }
    throw new Error(
      `No eligible harness for "${ctx.step.title}". Rejected: ${rejected.map((r) => `${r.harness} (${r.reason})`).join("; ") || "none"}. ` +
        `Install a coding CLI or widen mission.allowedHarnesses.`,
    );
  }

  const winner = scores[0];
  const rationale: string[] = [];
  const w = mustHarness(winner.harness);
  rationale.push(`${w.name} scored ${winner.score.toFixed(3)} — the highest of ${scores.length} eligible runtime(s).`);
  const top = Object.entries(winner.components).sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [k, v] of top) rationale.push(`${k}: ${v.toFixed(2)} (weight ${ARBITRATION_WEIGHTS[k as keyof typeof ARBITRATION_WEIGHTS] ?? 0})`);
  if (!usedHistoricalEvidence) {
    rationale.push("No historical evidence for any candidate; selection rests on capability and language fit. This is a first impression, not a verdict.");
  }
  if (scores.length > 1) {
    rationale.push(`Runner-up ${scores[1].harness} at ${scores[1].score.toFixed(3)} — margin ${(winner.score - scores[1].score).toFixed(3)}.`);
  }
  if (w.simulated) {
    rationale.push("WARNING: the selected runtime is VH's labelled simulation. Its output is recorded as simulated and is not independently verified.");
  }

  return { chosen: winner.harness, scores, rationale, rejected, usedHistoricalEvidence, simulated: w.simulated };
}

/**
 * §16 Pick the next harness to try after a failure, excluding the ones already tried.
 * Returns null when nothing else is eligible — the caller must then escalate rather than
 * loop.
 */
export function selectReplacementHarness(
  ctx: ArbitrationContext,
  ledger: HarnessLedger,
  tried: AgentRuntimeId[],
): ArbitrationDecision | null {
  const filtered: ArbitrationContext = {
    ...ctx,
    mission: {
      ...ctx.mission,
      allowedHarnesses: ctx.mission.allowedHarnesses.filter((h) => !(tried as string[]).includes(h)),
    },
  };
  try {
    const decision = selectHarness(filtered, ledger);
    if ((tried as string[]).includes(decision.chosen)) return null;
    return decision;
  } catch {
    return null;
  }
}

function mustHarness(id: string) {
  const h = getHarness(id as AgentRuntimeId);
  if (!h) throw new Error(`unknown harness "${id}"`);
  return h;
}

/** §7 The evidence table the Providers page shows. */
export function evidenceTable(ledger: HarnessLedger, repository?: string): Array<{ harness: HarnessId; stats: HarnessStats; decayed: { rate: number; effectiveRuns: number } }> {
  return (Object.keys(
    ledger.all().reduce<Record<string, true>>((acc, r) => {
      acc[r.harness] = true;
      return acc;
    }, {}),
  ) as HarnessId[]).map((h) => ({
    harness: h,
    stats: ledger.stats(h, { repository }),
    decayed: ledger.decayedSuccessRate(h),
  }));
}
