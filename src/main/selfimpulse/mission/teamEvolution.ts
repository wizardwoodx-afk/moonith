/**
 * §40 TEAM SELF-EVOLUTION & FEEDBACK LOOP (V11.2).
 *
 * The Mission layer already evolves skills. Teams did not evolve at all: a seat's `instructions`
 * were written once, used forever, and every run re-measured the same mistakes.
 *
 * WHAT EVOLVES
 *   The only SI-authored text in a seat is its `instructions` (plus role/harness config). The
 *   harness binary's behaviour is the vendor's, not ours to mutate — so the loop evolves exactly
 *   one artifact per seat: the instruction text.
 *
 * THE LOOP
 *   run → measured signal per seat (did it run, did the repo's own check pass, what did it cost,
 *         what did the human rate it) → fold into per-seat stats → evidence accumulates →
 *   when the evidence is loud enough (≥2 failure/unverified/feedback signals across ≥3 runs and
 *   no candidate already pending) a rule-based candidate edit is produced (a SUPERSET edit:
 *   learned corrections appended, never a rewrite) → gates (size, growth, non-empty, superset
 *   preservation) → SUGGEST mode: human accepts; AUTONOMOUS mode: apply immediately.
 *
 * HONESTY RULES (the same ones the rest of VH obeys)
 *   1. A candidate's score is NEVER claimed before a run measured it. `candidateScore` stays
 *      null with the reason in `scoreNote`; the run after an application is what measures it.
 *   2. Simulated runs count toward the ledger's experience but never alone can justify a
 *      candidate — a fake agent that "fails" identically is not evidence, it is a fixture.
 *      (`minRealRuns` below.)
 *   3. Feedback is the human's signal, kept separate from measured facts: rating 1–2 is a
 *      signal with weight, a comment is quoted verbatim into the evidence, and a rating ≥4 is
 *      "do not change this seat" — it suppresses candidates for `suppressRunsAfterPraise` runs.
 *   4. Every decision is recorded: baseline text, candidate text, gate table, actor
 *      ("team-evolver" | "human:<name>"), decision, and timestamp. Nothing applies silently.
 *   5. OFF mode records but never proposes. SUGGEST proposes, never applies. AUTONOMOUS
 *      applies only what passes every gate — and even then the pre-apply text is preserved in
 *      the record, because an evolution you cannot roll back is not an evolution, it is drift.
 */

import { uid } from "../app/id";
import type { CliAgentTeam, TeamSeat } from "./agentTeam";

export type TeamEvolveMode = "OFF" | "SUGGEST" | "AUTONOMOUS";

/** One measured fact about one seat in one team run. */
export interface TeamSeatRunSignal {
  runId: string;
  ts: string;
  teamId: string;
  seatId: string;
  role: string;
  harness: string;
  ok: boolean;
  verified: boolean;
  /** Exit code of the CLI session, null when it never ran. */
  exitCode: number | null;
  costUsd: number;
  durationMs: number;
  /** True when the harness was VH's labelled local-test double. */
  simulated: boolean;
  /** Human feedback attached after the run (a later fold), if any. */
  rating: number | null;
  comment: string | null;
}

export interface TeamSeatStats {
  runs: number;
  realRuns: number;
  okRuns: number;
  verifiedRuns: number;
  totalCostUsd: number;
  totalMs: number;
  feedbackSum: number;
  feedbackCount: number;
  lastAt: string | null;
  okRate: number;
  verifiedRate: number;
  feedbackAvg: number | null;
}

export interface TeamSeatEvidence {
  kind: "failed-run" | "unverified" | "feedback" | "cost";
  text: string;
  weight: number;
}

export interface TeamGateRow {
  name: string;
  passed: boolean;
  message: string;
}

export interface TeamEvolutionCandidate {
  id: string;
  teamId: string;
  teamName: string;
  seatId: string;
  role: string;
  harness: string;
  baseline: string;
  candidate: string;
  trigger: string;
  evidence: TeamSeatEvidence[];
  /** Measured score of the seat AS OF the moment the candidate was proposed. */
  baselineScore: number | null;
  /** Always null at proposal time. The next run measures it. */
  candidateScore: number | null;
  scoreNote: string;
  gates: TeamGateRow[];
  passed: boolean;
  status: "PROPOSED" | "DECIDED";
  decision: "PENDING" | "ACCEPTED" | "REJECTED";
  decidedBy: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface TeamSeatEvoState {
  stats: TeamSeatStats;
  /** Accumulated evidence across runs — this is what a candidate is built on, never a single run.
   *  Reset when a candidate is created (the evidence became the candidate). */
  evidence: TeamSeatEvidence[];
  instructionVersion: number;
  editCount: number;
  lastEditedAt: string | null;
  /** Suppression counter after a rating ≥4: no candidate while > 0. */
  praiseSuppression: number;
  /** Human feedback queued after a run (rating 1–2 with a comment). Consumed when a candidate
   *  is next created for this seat, so it becomes evidence without inflating the run count.
   *  Entries are per-run (runId): a newer rating for the SAME run supersedes older unconsumed
   *  entries (12.0.2 — the loop keeps one current human rating per cycle, so the pipeline
   *  matches; legacy entries without a runId cannot be matched and are kept). */
  pendingFeedback: Array<{ runId: string; rating: number; comment: string; at: string }>;
  /** Apps of candidates accepted for this seat (rollback trail, newest first). */
  applied: Array<{ at: string; from: string; to: string; by: string }>;
}

export interface TeamEvoStore {
  schemaVersion: 1;
  byTeam: Record<
    string,
    {
      mode: TeamEvolveMode;
      seats: Record<string, TeamSeatEvoState>;
    }
  >;
  candidates: TeamEvolutionCandidate[];
  /** Human feedback rows, kept verbatim with the run they belong to. */
  feedback: Array<{ id: string; runId: string; teamId: string; seatId: string | null; rating: number; comment: string; createdAt: string }>;
}

export const TEAM_EVO_CONFIG = {
  minRuns: 3,
  minRealRuns: 2,
  minEvidenceWeight: 3,
  maxInstructionsChars: 8_000,
  maxGrowth: 0.2,
  /** A flat append allowance: the growth budget is max(20% of baseline, this many chars), so a
   *  short instruction can still learn a real lesson instead of one 14-char bullet. */
  minAppendChars: 300,
  maxEvidenceBullets: 5,
  praiseSuppressRuns: 3,
} as const;

const LS_KEY = "vh.teamEvolution.v1";

export function emptyStats(): TeamSeatStats {
  return {
    runs: 0,
    realRuns: 0,
    okRuns: 0,
    verifiedRuns: 0,
    totalCostUsd: 0,
    totalMs: 0,
    feedbackSum: 0,
    feedbackCount: 0,
    lastAt: null,
    okRate: 0,
    verifiedRate: 0,
    feedbackAvg: null,
  };
}

export function emptyStore(): TeamEvoStore {
  return { schemaVersion: 1, byTeam: {}, candidates: [], feedback: [] };
}

/** Fold one run signal into accumulated per-seat stats. Pure: returns a new stats object. */
export function foldSignal(prev: TeamSeatStats, s: TeamSeatRunSignal): TeamSeatStats {
  const next: TeamSeatStats = {
    runs: prev.runs + 1,
    realRuns: prev.realRuns + (s.simulated ? 0 : 1),
    okRuns: prev.okRuns + (s.ok ? 1 : 0),
    verifiedRuns: prev.verifiedRuns + (s.verified ? 1 : 0),
    totalCostUsd: prev.totalCostUsd + (s.costUsd || 0),
    totalMs: prev.totalMs + (s.durationMs || 0),
    feedbackSum: prev.feedbackSum + (s.rating ?? 0),
    feedbackCount: prev.feedbackCount + (s.rating !== null ? 1 : 0),
    lastAt: s.ts,
    okRate: 0,
    verifiedRate: 0,
    feedbackAvg: null,
  };
  next.okRate = next.runs > 0 ? next.okRuns / next.runs : 0;
  next.verifiedRate = next.runs > 0 ? next.verifiedRuns / next.runs : 0;
  next.feedbackAvg = next.feedbackCount > 0 ? next.feedbackSum / next.feedbackCount : null;
  return next;
}

/**
 * Score a seat from measured facts. Mirrors the evolution fitness shape
 * (0.5 correctness + 0.3 procedure + 0.2 conciseness − length penalty) but every component is
 * a MEASURED run property, never an inference:
 *   correctness  = okRate (did the CLI session complete)
 *   procedure    = verifiedRate (did the repo's own check pass)
 *   conciseness  = feedback normalised to [0,1] (the human's view), 0.5 default when unseen
 *   lengthPenalty = from instructions size (long prompt == more room to drifts), capped 0.3
 */
export function seatScore(stats: TeamSeatStats, instructionsLength: number): number {
  const correctness = stats.runs > 0 ? stats.okRate : 0;
  const procedure = stats.runs > 0 ? stats.verifiedRate : 0;
  const conciseness = stats.feedbackAvg !== null ? Math.min(1, stats.feedbackAvg / 5) : 0.5;
  const raw = 0.5 * correctness + 0.3 * procedure + 0.2 * conciseness;
  const ratio = Math.min(1, instructionsLength / Math.max(1, TEAM_EVO_CONFIG.maxInstructionsChars));
  const penalty = ratio <= 0.9 ? 0 : Math.min(0.3, (ratio - 0.9) * 3.0);
  return Math.max(0, raw - penalty);
}

/** Build the evidence list a seat has earned. Deterministic order: failures first, then unverified, then feedback. */
export function evidenceFrom(s: TeamSeatRunSignal, harnessName: string): TeamSeatEvidence[] {
  const ev: TeamSeatEvidence[] = [];
  if (!s.ok) {
    ev.push({
      kind: "failed-run",
      text: s.simulated
        ? `Simulated failure (${harnessName}) — recorded, not evidence.`
        : `Run failed (${harnessName}, exit ${s.exitCode ?? "?"}).`,
      weight: s.simulated ? 0 : 2,
    });
  }
  if (s.ok && !s.verified) {
    ev.push({
      kind: "unverified",
      text: `Task ran but the repo's own verification did not pass (${harnessName}).`,
      weight: 1,
    });
  }
  if (s.costUsd > 0 && s.costUsd > 0.5) {
    ev.push({ kind: "cost", text: `High spend on one seat: $${s.costUsd.toFixed(4)}.`, weight: 1 });
  }
  if (s.rating !== null && s.rating <= 2) {
    ev.push({
      kind: "feedback",
      text: s.comment?.trim() ? `Human: ${s.comment.trim()}` : `Human rating ${s.rating}/5.`,
      weight: 2,
    });
  }
  return ev;
}

/**
 * The append budget. Growth is capped at max(maxGrowth of the baseline, minAppendChars) — the
 * point of the gate is to stop runaway prompt inflation, not to stop a seat from learning. The
 * absolute ceiling is maxInstructionsChars either way.
 */
export function growthOk(baseline: string, candidate: string): { ok: boolean; growth: number; allowed: number } {
  const base = Math.max(1, baseline.length);
  const allowed = Math.max(base * TEAM_EVO_CONFIG.maxGrowth, TEAM_EVO_CONFIG.minAppendChars);
  const growth = candidate.length - baseline.length;
  return {
    ok: growth <= allowed && candidate.length <= TEAM_EVO_CONFIG.maxInstructionsChars,
    growth,
    allowed,
  };
}

/**
 * Rule-based candidate: a SUPERSET edit. Appends a bounded "Learned corrections" section; the
 * baseline is always a prefix of the candidate, so nothing already known is ever lost. If the
 * evidence does not fit the growth budget, the highest-weight bullets win and the rest are
 * dropped (and named in `dropped`).
 */
export function composeSeatCandidate(
  seat: TeamSeat,
  evidence: TeamSeatEvidence[],
  instructionVersion: number,
): { candidate: string; dropped: string[]; trigger: string } {
  const baseline = (seat.instructions ?? "").trimEnd();
  const bullets = [...evidence]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, TEAM_EVO_CONFIG.maxEvidenceBullets)
    .map((e) => `- ${e.text}`);
  const dropped = evidence.length > bullets.length ? evidence.slice(bullets.length).map((e) => e.text) : [];
  const section = `\n\n## Learned corrections (v${instructionVersion + 1})\n\n${bullets.join("\n")}`;
  let candidate = `${baseline}${section}`;
  const cap = growthOk(baseline, candidate);
  // If the append is over budget, trim bullets until it fits.
  while (!cap.ok && bullets.length > 0) {
    const removed = bullets.pop();
    if (removed) dropped.unshift(removed.replace(/^- /, ""));
    candidate = `${baseline}${bullets.length ? `\n\n## Learned corrections (v${instructionVersion + 1})\n\n${bullets.join("\n")}` : ""}`;
    const again = growthOk(baseline, candidate);
    if (again.ok) break;
  }
  return { candidate: candidate || baseline, dropped, trigger: evidence.some((e) => e.kind === "feedback") ? "human-feedback" : "run-evidence" };
}

/**
 * The gate table for a candidate. Honest scoring rule: `baselineScore` is measured; the
 * candidate's own score is NOT produced here — a text edit has not run yet. Acceptance is
 * therefore about textual safety + evidence weight, and the first run after application is
 * what measures the change. `passed` is what AUTONOMOUS mode keys off.
 */
export function gateTeamCandidate(args: {
  teamName: string;
  seat: TeamSeat;
  evidence: TeamSeatEvidence[];
  candidate: string;
  baselineScore: number | null;
}): { gates: TeamGateRow[]; passed: boolean } {
  const baseline = (args.seat.instructions ?? "").trimEnd();
  const gates: TeamGateRow[] = [];
  gates.push({
    name: "non_empty",
    passed: Boolean(args.candidate.trim()),
    message: args.candidate.trim() ? "Candidate is non-empty" : "Candidate is empty",
  });
  gates.push({
    name: "superset_preserves_baseline",
    passed: args.candidate.startsWith(baseline) || baseline.length === 0,
    message: baseline.length === 0 ? "No baseline; candidate defines the seat from scratch" : "Baseline retained verbatim as prefix",
  });
  const g = growthOk(baseline, args.candidate);
  gates.push({
    name: "growth_limit",
    passed: g.ok,
    message: g.ok
      ? `Append ${g.growth} chars under the ${g.allowed}-char budget; total ${args.candidate.length}/${TEAM_EVO_CONFIG.maxInstructionsChars}`
      : `Append ${g.growth} chars exceeds the ${g.allowed}-char budget`,
  });
  gates.push({
    name: "meaningful_change",
    passed: args.candidate.trim() !== baseline.trim(),
    message: args.candidate.trim() !== baseline.trim() ? "The candidate changes the seat text" : "No-op: the candidate equals the baseline",
  });
  const weight = args.evidence.reduce((a, e) => a + e.weight, 0);
  gates.push({
    name: "evidence_weight",
    passed: weight >= TEAM_EVO_CONFIG.minEvidenceWeight,
    message: `Evidence weight ${weight} (min ${TEAM_EVO_CONFIG.minEvidenceWeight})`,
  });
  return { gates, passed: gates.every((x) => x.passed) };
}

/**
 * The loop driver. Folds the signal, decides whether a candidate is due, and (in AUTONOMOUS)
 * applies it. Returns the updated store plus, when a candidate was created or applied, that
 * candidate. Pure with respect to its inputs: returns a NEW store object.
 */
export function evolveTeamAfterRun(args: {
  store: TeamEvoStore;
  team: CliAgentTeam;
  signal: TeamSeatRunSignal;
  actor: string;
  nowIso?: string;
}): { store: TeamEvoStore; candidate: TeamEvolutionCandidate | null; applied: boolean } {
  const now = args.nowIso ?? new Date().toISOString();
  const team = args.team;
  const seat = team.seats.find((s) => s.id === args.signal.seatId);
  if (!seat) return { store: args.store, candidate: null, applied: false };

  const store: TeamEvoStore = {
    schemaVersion: 1,
    byTeam: { ...args.store.byTeam },
    candidates: [...args.store.candidates],
    feedback: [...args.store.feedback],
  };
  const teamEvo = store.byTeam[team.id] ?? { mode: "SUGGEST" as TeamEvolveMode, seats: {} };
  const seatEvo: TeamSeatEvoState = teamEvo.seats[seat.id] ?? {
    stats: emptyStats(),
    evidence: [],
    instructionVersion: (team.revision ?? 1) || 1,
    editCount: 0,
    lastEditedAt: null,
    praiseSuppression: 0,
    pendingFeedback: [],
    applied: [],
  };
  const folded = foldSignal(seatEvo.stats, args.signal);
  // Evidence ACCUMULATES across runs — a ledger of every failure mode this seat has shown, not a
  // snapshot of the last one. Capped so a long-lived seat cannot grow an unbounded history; the
  // newest signals win. Pending human feedback joins the accumulated evidence below.
  //
  // V11.4 fix: the UI path queues feedback here because run signals never carry a rating
  // (signalsFromSeatRecords sets rating: null). Praise (rating ≥4) queued that way used to
  // become weight-2 *failure* evidence — the exact opposite of the documented rule and of the
  // promise the Teams page shows ("praise suppresses new candidates for the next 3 runs").
  // Now: rating ≤2 is evidence, rating 3 is neutral (recorded, not weighted), rating ≥4
  // arms praiseSuppression for N runs — identical to a rating carried by a run signal.
  const pendingFeedback = seatEvo.pendingFeedback ?? [];
  const praiseQueued = pendingFeedback.some((f) => f.rating >= 4);
  const fresh = [
    ...evidenceFrom(args.signal, seat.harness),
    ...pendingFeedback
      .filter((f) => f.rating <= 2)
      .map((f) => ({
        kind: "feedback" as const,
        text: f.comment.trim() ? `Human: ${f.comment.trim()}` : `Human rating ${f.rating}/5`,
        weight: 2,
      })),
  ];
  const evidence = [...(seatEvo.evidence ?? []), ...fresh].slice(-8);
  const nextSeat: TeamSeatEvoState = {
    ...seatEvo,
    stats: folded,
    evidence,
    // V11.4 fix: the queue is consumed BY THIS FOLD — it became accumulated evidence (or armed
    // suppression) above. Before, it survived until a candidate was created, so queued praise
    // re-armed suppression on every subsequent fold (a permanently frozen seat) and queued
    // criticism re-added its weight on every run (ledger double-counting).
    pendingFeedback: [],
    praiseSuppression: Math.max(0, seatEvo.praiseSuppression - 1),
    lastEditedAt: folded.lastAt,
  };
  if (args.signal.rating !== null && args.signal.rating >= 4) {
    nextSeat.praiseSuppression = TEAM_EVO_CONFIG.praiseSuppressRuns;
  }
  if (praiseQueued) {
    nextSeat.praiseSuppression = TEAM_EVO_CONFIG.praiseSuppressRuns;
  }
  store.byTeam[team.id] = { ...teamEvo, seats: { ...teamEvo.seats, [seat.id]: nextSeat } };

  // Feedback row is stored verbatim, whether or not it triggers a candidate.
  if (args.signal.rating !== null || args.signal.comment) {
    store.feedback.unshift({
      id: uid("tefb"),
      runId: args.signal.runId,
      teamId: team.id,
      seatId: seat.id,
      rating: args.signal.rating ?? 0,
      comment: args.signal.comment ?? "",
      createdAt: now,
    });
  }

  const mode = teamEvo.mode;
  if (mode === "OFF") return { store, candidate: null, applied: false };

  const realWeight = evidence.filter((e) => e.kind !== "failed-run" || e.weight > 0).reduce((a, e) => a + e.weight, 0);
  const statsOk = folded.runs >= TEAM_EVO_CONFIG.minRuns && folded.realRuns >= TEAM_EVO_CONFIG.minRealRuns;
  const alreadyPending = store.candidates.some((c) => c.teamId === team.id && c.seatId === seat.id && c.status === "PROPOSED");
  const due = statsOk && realWeight >= TEAM_EVO_CONFIG.minEvidenceWeight && !alreadyPending && nextSeat.praiseSuppression === 0;

  if (!due) {
    // Still record the run: a store the loop cannot see is a ledger that lies by omission.
    return { store, candidate: null, applied: false };
  }

  const composed = composeSeatCandidate(seat, evidence, nextSeat.instructionVersion);
  const baselineScore = seatScore(folded, (seat.instructions ?? "").length);
  const gate = gateTeamCandidate({
    teamName: team.name,
    seat,
    evidence,
    candidate: composed.candidate,
    baselineScore,
  });
  const candidate: TeamEvolutionCandidate = {
    id: uid("teev"),
    teamId: team.id,
    teamName: team.name,
    seatId: seat.id,
    role: seat.role,
    harness: seat.harness,
    baseline: (seat.instructions ?? "").trimEnd(),
    candidate: composed.candidate,
    trigger: composed.trigger,
    evidence,
    baselineScore,
    candidateScore: null,
    scoreNote: "Not measured: the candidate has not run yet. The next run after application is what measures it.",
    gates: gate.gates,
    passed: gate.passed,
    status: "PROPOSED",
    decision: "PENDING",
    decidedBy: null,
    createdAt: now,
    decidedAt: null,
  };
  store.candidates.unshift(candidate);
  // The evidence became the candidate: consume it. The candidate record carries it verbatim, so
  // nothing is lost — it is just no longer available to build a second candidate on.
  nextSeat.pendingFeedback = [];
  nextSeat.evidence = [];

  let applied = false;
  if (mode === "AUTONOMOUS" && candidate.passed) {
    candidate.status = "DECIDED";
    candidate.decision = "ACCEPTED";
    candidate.decidedBy = args.actor;
    candidate.decidedAt = now;
    nextSeat.editCount += 1;
    nextSeat.instructionVersion += 1;
    nextSeat.applied.unshift({ at: now, from: candidate.baseline, to: candidate.candidate, by: args.actor });
    applied = true;
  }
  store.byTeam[team.id] = { ...teamEvo, seats: { ...teamEvo.seats, [seat.id]: nextSeat } };
  return { store, candidate, applied };
}

/** Apply an accepted candidate to a team (human accept in SUGGEST mode). */
export function applyCandidateToTeam(team: CliAgentTeam, candidate: TeamEvolutionCandidate, _actor: string): CliAgentTeam {
  const next: CliAgentTeam = {
    ...team,
    revision: (team.revision ?? 1) + 1,
    seats: team.seats.map((s) => (s.id === candidate.seatId ? { ...s, instructions: candidate.candidate } : s)),
  };
  return next;
}

/**
 * Human feedback from the UI, attached to a run and a seat. It is stored verbatim in
 * `store.feedback` and queued on the seat as pending evidence for the next candidate —
 * a rating is a signal about the seat, not a new run, so it never inflates the run count.
 */
export function applyTeamFeedback(
  store: TeamEvoStore,
  args: { teamId: string; seatId: string; runId: string; rating: number; comment: string; nowIso?: string },
): TeamEvoStore {
  const now = args.nowIso ?? new Date().toISOString();
  const teamEvo = store.byTeam[args.teamId] ?? { mode: "SUGGEST" as TeamEvolveMode, seats: {} };
  const seatEvo: TeamSeatEvoState = teamEvo.seats[args.seatId] ?? {
    stats: emptyStats(),
    evidence: [],
    instructionVersion: 1,
    editCount: 0,
    lastEditedAt: null,
    praiseSuppression: 0,
    pendingFeedback: [],
    applied: [],
  };
  const next: TeamEvoStore = {
    ...store,
    byTeam: {
      ...store.byTeam,
      [args.teamId]: {
        ...teamEvo,
        seats: {
          ...teamEvo.seats,
          [args.seatId]: {
            ...seatEvo,
            // 12.0.2 — per-run supersede: the last human word for a run wins until the fold
            // consumes it. (Legacy queued entries without a runId survive — they cannot be
            // matched to a run, so dropping them would lose real human input.)
            pendingFeedback: [
              ...(seatEvo.pendingFeedback ?? []).filter((f) => f.runId !== args.runId),
              { runId: args.runId, rating: args.rating, comment: args.comment, at: now },
            ],
          },
        },
      },
    },
    feedback: [
      { id: uid("tefb"), runId: args.runId, teamId: args.teamId, seatId: args.seatId, rating: args.rating, comment: args.comment, createdAt: now },
      ...store.feedback,
    ],
  };
  return next;
}

/** Mark a candidate decided in the store. */
export function decideCandidate(store: TeamEvoStore, candidateId: string, decision: "ACCEPTED" | "REJECTED", by: string, nowIso?: string): TeamEvoStore {
  return {
    ...store,
    candidates: store.candidates.map((c) =>
      c.id === candidateId
        ? { ...c, status: "DECIDED" as const, decision, decidedBy: by, decidedAt: nowIso ?? new Date().toISOString() }
        : c,
    ),
  };
}

/* ------------------------------------------------------------------ persistence */

export function loadTeamEvoStore(): TeamEvoStore {
  try {
    if (typeof localStorage === "undefined") return emptyStore();
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return emptyStore();
    const p = JSON.parse(raw) as Partial<TeamEvoStore>;
    return {
      schemaVersion: 1,
      byTeam: p.byTeam ?? {},
      candidates: Array.isArray(p.candidates) ? p.candidates : [],
      feedback: Array.isArray(p.feedback) ? p.feedback : [],
    };
  } catch {
    return emptyStore();
  }
}

export function saveTeamEvoStore(store: TeamEvoStore): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(LS_KEY, JSON.stringify(store));
  } catch {
    /* persistence is best-effort in browser builds */
  }
}

/** Build run signals from a real TeamRunReport (imported lazily by the caller to avoid cycles). */
export function signalsFromSeatRecords(args: {
  runId: string;
  ts: string;
  teamId: string;
  seats: Array<{
    seatId: string;
    role: string;
    harness: string;
    outcome: string;
    exitCode: number | null;
    chargedUsd: number;
    durationMs: number;
    verified: boolean;
    simulated?: boolean;
  }>;
}): TeamSeatRunSignal[] {
  return args.seats.map((s) => ({
    runId: args.runId,
    ts: args.ts,
    teamId: args.teamId,
    seatId: s.seatId,
    role: s.role,
    harness: s.harness,
    ok: s.outcome === "completed",
    verified: Boolean(s.verified),
    exitCode: s.exitCode,
    costUsd: s.chargedUsd || 0,
    durationMs: s.durationMs || 0,
    simulated: Boolean(s.simulated),
    rating: null,
    comment: null,
  }));
}
