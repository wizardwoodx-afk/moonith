/**
 * §ADVERSARIAL VERIFICATION GATE (VH 11.9.9) — the heart of the verified agent factory.
 *
 * THE RESEARCH, IN ONE SENTENCE
 * Every 2026 orchestrator with a governance story — the automation platforms' agent modes, the graph-framework nodes, the vertical agents — the
 * whole fleet-orchestrator wave (Orca, Bernstein, Vibe Kanban) — solves COORDINATION.
 * Their own shared, admitted weakness is that nowhere in the stack does anyone solve
 * PROOF: the writer grades itself, and "it ran" is the only evidence on offer.
 *
 * This gate is VH's answer, enforced rather than encouraged:
 *   - a run is not "verified" unless a seat whose job is verification actually RAN
 *   - verification by the SAME harness that wrote the work is self-grading — in STRICT
 *     mode the run is BLOCKED, in ADVISORY mode it is marked FAIL with the reason attached
 *   - a verdict that rejects the work fails the gate regardless of who signed it
 *   - in STRICT mode the proof receipt must be attached, so the verification itself is
 *     part of the hash-chained evidence an auditor re-verifies
 *
 * Tiers, best first:
 *   cross-vendor     no verifier shares a harness with any writer — the strongest evidence
 *   cross-seat       every writer has a different-harness verifier, but harnesses overlap
 *                    elsewhere in the team (still adversarial where it matters)
 *   self-verification  at least one writer harness has no different-harness verifier
 *   unverified       no verifier seat ran at all
 *
 * Node-import-safe, deterministic, and probed by probe/verifyGate.test.ts.
 */

export type GatePolicy = "STRICT" | "ADVISORY";

export type GateTier = "cross-vendor" | "cross-seat" | "self-verification" | "unverified";

export type GateStatus = "PASS" | "FAIL" | "BLOCKED";

export interface GateWriter {
  seatId: string;
  harness: string;
}

export interface GateVerifier {
  seatId: string;
  harness: string;
  ran: boolean;
  verdict: "approve" | "reject" | "none";
  /**
   * 11.10 — WHAT the verifier looked at. The team runner records the review-snapshot sha
   * on every read-only seat; when present here, the gate can say not just "a writer ran" but
   * "a writer ran against snapshot abc123" — the writer-to-verifier evidence link.
   */
  reviewedSha?: string | null;
}

/**
 * The review snapshot the run produced (TeamRunReport.snapshot, shaped for the gate).
 * Optional only for callers that genuinely have no runner (pure unit inputs); the team
 * executor ALWAYS supplies it, so a missing snapshot there is an evidence failure, not a
 * formality.
 */
export interface GateSnapshotInput {
  built: boolean;
  sha: string | null;
  ref?: string;
  writerBranches?: string[];
}

export interface GateInput {
  /** The run's terminal status (TeamRunReport.status). */
  runStatus: string;
  writers: GateWriter[];
  verifiers: GateVerifier[];
  /** True when a proof receipt is attached to (or will be issued with) this run. */
  receiptAttached: boolean;
  policy: GatePolicy;
  /** 11.10 — the reviewed-snapshot evidence. See GateSnapshotInput. */
  snapshot?: GateSnapshotInput;
}

/** 11.10 — the writer→snapshot→verifier evidence chain the verdict stands on. */
export interface GateEvidence {
  snapshotBuilt: boolean;
  snapshotSha: string | null;
  snapshotRef: string;
  writerBranches: string[];
  /** Per verifier that ran: did it actually look at the snapshot? */
  reviewedBy: Array<{ seatId: string; harness: string; reviewedSha: string | null; matchesSnapshot: boolean }>;
}

export interface GateVerdict {
  status: GateStatus;
  tier: GateTier;
  reasons: string[];
  policy: GatePolicy;
  /** True when no writer harness graded its own work (tiers cross-vendor / cross-seat). */
  crossVerified: boolean;
  /** Null when the caller supplied no snapshot input (pure unit inputs only). */
  evidence: GateEvidence | null;
}

/** Roles VH treats as verifiers for gate purposes (matches fleet.ts / receipts). */
export const GATE_VERIFIER_ROLES: ReadonlySet<string> = new Set(["reviewer", "security", "tester"]);

/** Roles VH treats as writers for gate purposes. */
export const GATE_WRITER_ROLES: ReadonlySet<string> = new Set(["coder", "debugger"]);

const POLICY_KEY = "vh.gatepolicy.v1";

export function loadGatePolicy(): GatePolicy {
  try {
    const raw = globalThis.localStorage?.getItem(POLICY_KEY);
    return raw === "ADVISORY" ? "ADVISORY" : "STRICT";
  } catch {
    return "STRICT";
  }
}

export function saveGatePolicy(policy: GatePolicy): void {
  try {
    globalThis.localStorage?.setItem(POLICY_KEY, policy);
  } catch {
    /* storage unavailable — the in-memory default still governs this session */
  }
}

/**
 * The gate itself. Deterministic: same input, same verdict, every time.
 *
 * BLOCKED is only ever produced in STRICT mode. ADVISORY mode downgrades every block to a
 * FAIL with the reasons attached — the run is visible, named, and exportable, but it can
 * never claim to be verified.
 *
 * 11.10 — EVIDENCE BINDING. When snapshot input is supplied (the team executor always
 * does), a verifier only counts toward cross-verification if it RAN and its recorded
 * reviewedSha EQUALS the snapshot sha — i.e. it demonstrably looked at the writers' merged
 * work, not the base and not nothing. "a writer completed" is no longer sufficient; the gate
 * now says "a writer ran against snapshot <sha> and approved it." Writers present but no
 * snapshot built means nobody can prove they reviewed anything: unverified.
 */
export function evaluateVerifyGate(input: GateInput): GateVerdict {
  const reasons: string[] = [];
  const ranVerifiers = input.verifiers.filter((v) => v.ran);
  const snap = input.snapshot;

  if (input.runStatus !== "completed") {
    reasons.push(`Run status is "${input.runStatus}" — only completed runs can be verified.`);
  }

  const rejections = ranVerifiers.filter((v) => v.verdict === "reject");
  for (const r of rejections) {
    reasons.push(`Verifier "${r.seatId}" (${r.harness}) rejected the work.`);
  }

  const writerHarnesses = [...new Set(input.writers.map((w) => w.harness))];

  // 11.10 — the evidence record. Built even when the verdict fails, because an auditor
  // needs to see WHY, with the shas, not just the conclusion.
  let evidence: GateEvidence | null = null;
  if (snap) {
    evidence = {
      snapshotBuilt: snap.built,
      snapshotSha: snap.sha,
      snapshotRef: snap.ref ?? "",
      writerBranches: snap.writerBranches ?? [],
      reviewedBy: ranVerifiers.map((v) => ({
        seatId: v.seatId,
        harness: v.harness,
        reviewedSha: v.reviewedSha ?? null,
        matchesSnapshot: snap.built && snap.sha !== null && v.reviewedSha === snap.sha,
      })),
    };
  }

  /** Verifiers whose review is EVIDENCE-GRADE: ran, and provably against the snapshot. */
  const countingVerifiers = !snap
    ? ranVerifiers
    : ranVerifiers.filter((v) => snap.built && snap.sha !== null && (v.reviewedSha ?? null) === snap.sha);

  let tier: GateTier;
  let crossVerified = false;

  if (ranVerifiers.length === 0) {
    tier = "unverified";
    reasons.push("No verifier seat ran — the work was never checked by anyone.");
  } else if (writerHarnesses.length === 0) {
    // A read-only mission has nothing to adversarially gate; verification still needs a
    // verifier that ran and (in STRICT) a receipt.
    tier = "cross-vendor";
    crossVerified = true;
  } else if (snap && (!snap.built || snap.sha === null)) {
    tier = "unverified";
    reasons.push("Writers produced work but no review snapshot was built — no verifier can prove it saw the writers' output, so the run is unverified.");
  } else {
    if (snap && countingVerifiers.length < ranVerifiers.length) {
      const off = ranVerifiers.filter((v) => !(snap.built && snap.sha !== null && (v.reviewedSha ?? null) === snap.sha));
      for (const o of off) {
        reasons.push(`Verifier "${o.seatId}" (${o.harness}) ran, but its reviewed ref (${o.reviewedSha ?? "none recorded"}) does not match the snapshot (${snap.sha}) — it cannot selfimpulse for the writers' work.`);
      }
    }
    // The adversarial core: for EVERY writer harness, some evidence-grade verifier with a
    // DIFFERENT harness must have run. Anything less means an author graded its own work.
    const selfVerified = writerHarnesses.filter(
      (wh) => !countingVerifiers.some((v) => v.harness !== wh),
    );
    if (selfVerified.length > 0) {
      tier = "self-verification";
      reasons.push(
        `Self-verification: writer harness(es) ${selfVerified.join(", ")} had no verifier from a different harness that reviewed the snapshot. An author grading its own work is not a review.`,
      );
    } else {
      crossVerified = true;
      const verifierHarnesses = new Set(countingVerifiers.map((v) => v.harness));
      const overlap = writerHarnesses.some((wh) => verifierHarnesses.has(wh));
      tier = overlap ? "cross-seat" : "cross-vendor";
    }
  }

  if (!input.receiptAttached) {
    reasons.push("No proof receipt attached — verification without a hash-chained record is a claim, not evidence.");
  }

  const hardFail = input.runStatus !== "completed" || rejections.length > 0;
  let status: GateStatus;
  if (hardFail) {
    status = "FAIL";
  } else if (crossVerified && input.receiptAttached) {
    status = "PASS";
  } else {
    status = input.policy === "STRICT" ? "BLOCKED" : "FAIL";
  }

  return { status, tier, reasons, policy: input.policy, crossVerified, evidence };
}

/** Seat-shaped input, matching TeamRunReport / AutonomyRunSummary seat records. */
export interface GateSeatRecord {
  seatId: string;
  role: string;
  harness: string;
  outcome: string;
  verified: boolean;
  /** 11.10 — what the seat looked at (SeatRecord.reviewedSha). Verifier evidence. */
  reviewedSha?: string | null;
}

/**
 * Derive gate inputs from a finished team run and evaluate.
 *
 * Verifier verdicts come from measured outcomes, never from self-reports: a verifier that
 * completed its run approves; one that failed or timed out rejects; anything else has no
 * verdict. Seats listed in `notRun` did not run and cannot count.
 *
 * 11.10 — pass the run's snapshot whenever one exists: each verifier's reviewedSha is then
 * checked against the snapshot sha, binding the verdict to the actual reviewed artifact.
 */
export function gateForTeamReport(
  report: { status: string; seats: GateSeatRecord[]; notRun?: string[]; snapshot?: GateSnapshotInput },
  policy: GatePolicy,
  receiptAttached: boolean,
): GateVerdict {
  const notRun = new Set(report.notRun ?? []);
  const seats = report.seats.filter((s) => !notRun.has(s.seatId));
  const failedOutcomes = new Set(["failed", "timeout", "blocked_budget"]);
  const writers: GateWriter[] = seats
    .filter((s) => GATE_WRITER_ROLES.has(s.role))
    .map((s) => ({ seatId: s.seatId, harness: s.harness }));
  const verifiers: GateVerifier[] = seats
    .filter((s) => GATE_VERIFIER_ROLES.has(s.role))
    .map((s) => ({
      seatId: s.seatId,
      harness: s.harness,
      ran: s.outcome !== "not_run" && s.outcome !== "skipped",
      verdict: s.outcome === "completed" ? "approve" : failedOutcomes.has(s.outcome) ? "reject" : "none",
      reviewedSha: s.reviewedSha ?? null,
    }));
  return evaluateVerifyGate({ runStatus: report.status, writers, verifiers, receiptAttached, policy, snapshot: report.snapshot });
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 11.10 — MERGE ENFORCEMENT.
 *
 * 11.9.9 shipped the gate as a post-run verification authority: it judged the run, but the
 * merge path did not consult it. The review named that gap precisely. From 11.10 the gate
 * controls the merge: STRICT + not-PASS means the writers' branches may not merge into the
 * base — the report says so, the UI says so, and the only way past is an explicit human
 * decision from Mission Control, recorded as a fleet event (a break-glass, not a bypass).
 * ADVISORY keeps 11.9.9 semantics: merge allowed, warnings attached.
 * ───────────────────────────────────────────────────────────────────────────── */

export interface MergeGateResult {
  /** True when the writers' branches may merge into the base branch. */
  allowed: boolean;
  /** Empty when allowed without reservation; otherwise the gate's reasons, joined. */
  reason: string;
  /** STRICT + not-PASS: only an explicit recorded human approval unlocks the merge. */
  overrideRequired: boolean;
  /** The verdict this decision stands on (so the merge record can carry it verbatim). */
  verdict: GateVerdict;
}

export function enforceMergeGate(verdict: GateVerdict): MergeGateResult {
  if (verdict.status === "PASS") {
    return { allowed: true, reason: "", overrideRequired: false, verdict };
  }
  if (verdict.policy === "ADVISORY") {
    return {
      allowed: true,
      reason: `Merged under ADVISORY policy despite gate verdict ${verdict.status} (${verdict.tier}): ${verdict.reasons.join(" ")}`,
      overrideRequired: false,
      verdict,
    };
  }
  return {
    allowed: false,
    reason: `STRICT gate: merge blocked — ${verdict.reasons[0] ?? `verdict ${verdict.status} (${verdict.tier})`}`,
    overrideRequired: true,
    verdict,
  };
}

/** Team-shaped findings, for display next to validateTeam's (same shape, same honesty). */
export interface GateTeamFinding {
  severity: "error" | "warning";
  code: string;
  message: string;
}

/**
 * Predict the gate's behaviour for a team BEFORE it runs: if every verifier harness is
 * also a writer harness, the gate will block every run in STRICT mode. Cheaper to say so
 * at configuration time than at run time.
 */
export function gateFindingsForTeam(
  team: { seats: Array<{ role: string; harness: string; mayWrite: boolean }> },
  policy: GatePolicy,
): GateTeamFinding[] {
  const out: GateTeamFinding[] = [];
  const writerHarnesses = new Set(team.seats.filter((s) => s.mayWrite).map((s) => s.harness));
  const verifierSeats = team.seats.filter((s) => GATE_VERIFIER_ROLES.has(s.role));
  if (writerHarnesses.size === 0) return out;
  if (verifierSeats.length === 0) {
    out.push({
      severity: policy === "STRICT" ? "error" : "warning",
      code: "no_verifier_seat",
      message: "No reviewer/security/tester seat — the Adversarial Verification Gate will block this team's runs in STRICT mode because nothing checks the writers' work.",
    });
    return out;
  }
  const verifierHarnesses = new Set(verifierSeats.map((s) => s.harness));
  const covered = [...writerHarnesses].every((wh) => [...verifierHarnesses].some((vh) => vh !== wh));
  if (!covered) {
    out.push({
      severity: policy === "STRICT" ? "error" : "warning",
      code: "self_verification_locked_in",
      message: `Every verifier shares a harness with a writer (${[...verifierHarnesses].join(", ")}). The gate treats that as self-verification and will block runs in STRICT mode — assign a different harness to a verifier seat.`,
    });
  }
  return out;
}
