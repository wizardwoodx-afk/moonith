/**
 * §RETRY LANES — a wait is not a failure. SelfImpulse's lift from Paperclip
 * (`server/src/services/execution-recovery-attempt.ts` and
 * `server/src/services/approved-execution-wait.ts`, MIT — Copyright (c) 2025
 * Paperclip AI; licence text at `LICENSES/paperclip-MIT.txt`).
 *
 * THE DEFECT THIS CLOSES, STATED AGAINST OUR OWN CODE
 * Two counters in this product claim to mean "how many times this run tried and
 * failed", and neither of them can tell a retry from a wait:
 *
 *   1. `MissionRuntime.repairCount` (`src/mission/missionRuntime.ts`) is the
 *      per-task repair ladder and `persist()` writes version 6 WITHOUT it, so a
 *      crash or a restart re-arms every task's ladder to zero — while
 *      `resources.usage.retries`, which `persist()` DOES write, still remembers
 *      the charges. After a resume the run-level budget says three failures
 *      happened and the ladder says none did.
 *   2. The durable run chain (`src/mission/runCheckpoints.ts`) is the one thing
 *      that survives, and it has no retry accounting at all. Everything the
 *      runtime records lands in it — `before repairing "X"` for a real failure,
 *      `awaiting-human` for a gate pause, `wave settled` for a productive
 *      continuation — as a `label` and a `step`. So the only durable count
 *      available to a resuming run is one that cannot tell those three apart,
 *      and the honest reading of "this chain has four entries" is nothing at
 *      all.
 *
 *      The consequence is the bug the owner will actually feel: a crew parked on
 *      a human approval is a crew whose steps are AGING. `timeoutLoop` in
 *      `src/mission/failureDetection.ts` fires past 120s, `stall` past 180s, and
 *      `CapLedger.admissionError` fails the whole mission once the 30-minute
 *      wall clock in `crewMission.ts` elapses — all three measure the wait the
 *      same way they measure a hang. The run spends its failure budget, and
 *      eventually its ceiling, on the time a person took to read the ask.
 *
 * WHAT WAS ADOPTED
 * Paperclip's exact separation, and its two quieter disciplines:
 *   - A retry CHARGE is decided by its REASON, not by its occurrence:
 *     waits, repairs-by-scheduler and productive continuations never move the
 *     failure counter (`accountingForScheduledRetry`).
 *   - An ambiguous historical record is read CONSERVATIVELY, never reset
 *     (`historicalFailureCount`). A journal written before this module existed
 *     does not get to pretend the run started clean.
 *   - The accounting lives in the run's own context snapshot and is validated on
 *     read — a malformed or version-mismatched block is treated as absent, not
 *     trusted.
 *   - From `approved-execution-wait.ts`: an approval wait is bounded from when
 *     the ASK WAS PRESENTED while the ask is still being prepared, and from when
 *     execution BEGAN once it has begun, and the deadline only ever EXTENDS —
 *     never shortens — so a run cannot be timed out by a clock it never started.
 *
 * WHAT IS OURS, NOT THEIRS
 * Paperclip is a server over Postgres and its lane names are its own scheduler's
 * (`max_turns_continuation`, `ai_connection_busy`, `workspace_busy`). This module
 * names the lanes this repository's chains actually contain
 * (`awaiting-human` / `busy` / `continuation`), reads and writes the accounting
 * inside `runCheckpoints`' own `state` payload rather than a `contextSnapshot`
 * column, and carries no database, no clock of its own and no dependency.
 */

/** The four outcomes a recorded run step can mean. */
export type RetryLane = "failure" | "awaiting-human" | "busy" | "continuation";

/** Lanes that NEVER spend a failure retry. `failure` is the only one that does. */
export const NON_FAILURE_LANES: readonly RetryLane[] = ["awaiting-human", "busy", "continuation"];

/** True when a lane is a wait or a productive step rather than a failure. */
export function isNonFailureLane(lane: RetryLane): boolean {
  return NON_FAILURE_LANES.includes(lane);
}

/** The reserved member a checkpoint's `state` carries the accounting under, so
 *  one write path (`checkpoint()`) stays the only way anything lands in the
 *  chain and the accounting is digested with the state it describes. */
export const RETRY_ACCOUNTING_FIELD = "siRetry";

/** The durable record. `format` is versioned by name, the way every other
 *  persisted document in this tree is, so a reader that does not understand it
 *  says so instead of mis-reading it. */
export interface RunRetryAccounting {
  format: "si-retry-accounting/1";
  /** Retries charged to a genuine failure. This is the number a repair budget is
   *  measured against and the only one that may ever trigger the hard stop. */
  failureRetries: number;
  /** Productive continuation steps — a wave that settled, a re-plan, a redeemed
   *  capability. Work that advanced. */
  continuations: number;
  /** How many times this run parked on a human. A three-hour wait is one of
   *  these and zero of `failureRetries`. */
  humanWaits: number;
  /** How many times this run parked on a resource — a busy provider, a full
   *  dispatch lane, a rate limit. Also never a failure. */
  busyWaits: number;
  /** The lane of the step that produced this record, so an auditor can see the
   *  run's last known situation and not only its tallies. */
  lastLane: RetryLane;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export const EMPTY_RETRY_ACCOUNTING: RunRetryAccounting = {
  format: "si-retry-accounting/1",
  failureRetries: 0,
  continuations: 0,
  humanWaits: 0,
  busyWaits: 0,
  lastLane: "continuation",
};

/**
 * Read a saved accounting out of a checkpoint's `state`.
 *
 * Validation is the point, not the shape: a document missing the format tag, or
 * carrying a field that is not a safe non-negative integer, returns `null` and
 * the caller falls back to the conservative historical derivation below. A torn
 * or hand-edited journal must not be able to hand a run a flattering number —
 * nor, by the same token, should an unknown `format` be silently upgraded.
 */
export function savedRetryAccounting(state: unknown): RunRetryAccounting | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const block = (state as Record<string, unknown>)[RETRY_ACCOUNTING_FIELD];
  if (!block || typeof block !== "object" || Array.isArray(block)) return null;
  const b = block as Record<string, unknown>;
  if (b.format !== "si-retry-accounting/1") return null;
  const failureRetries = count(b.failureRetries);
  const continuations = count(b.continuations);
  const humanWaits = count(b.humanWaits);
  const busyWaits = count(b.busyWaits);
  if (failureRetries === null || continuations === null || humanWaits === null || busyWaits === null) return null;
  const lanes: RetryLane[] = ["failure", "awaiting-human", "busy", "continuation"];
  const lastLane = lanes.includes(b.lastLane as RetryLane) ? (b.lastLane as RetryLane) : "failure";
  return { format: "si-retry-accounting/1", failureRetries, continuations, humanWaits, busyWaits, lastLane };
}

/**
 * Which lane a recorded step belongs to, read from the label this repository
 * actually writes.
 *
 * The patterns are anchored on the real call sites rather than on a general
 * theory of what a label looks like, because a mis-classified label is a
 * mis-charged retry and that is the entire bug:
 *   - `awaiting-human` — the gate. `selfimpulse.ts` writes the literal
 *     `awaiting-human`; `missionRuntime` parks with "Waiting on a human approval
 *     gate". `decision expired` is the same lane (a person did not answer), not
 *     a failure.
 *   - `busy` — a resource wait. The wall clock elapsing and the dispatch lane
 *     filling up are the two this product has today.
 *   - `continuation` — the run advanced: a wave settled, a capability redeemed,
 *     a re-plan landed, a rollback point taken after approval.
 *   - `failure` — the default, deliberately. An unrecognised label is charged as
 *     a failure rather than waved through, because the failure direction of a
 *     guess is the one that stops a run from looping forever. This mirrors
 *     upstream's "historical ambiguous counters remain conservative".
 */
export function laneOfLabel(label: string): RetryLane {
  const l = (label ?? "").toLowerCase();
  if (/awaiting[-_ ]human|human approval|approval gate|awaiting your|at the gate|decision expired|waiting on a human/.test(l)) return "awaiting-human";
  if (/busy|rate[-_ ]limit|\b429\b|lane is full|dispatch lane|pool wait|resource exhausted|deadline/.test(l)) return "busy";
  if (/wave settled|capability redeemed|after planning|after reorganization|resuming|resumed|rollback point|decision granted|settled a (?:new|fresh) budget/.test(l)) return "continuation";
  return "failure";
}

/**
 * The conservative reading of a chain that carries no accounting — a journal
 * written before this module existed.
 *
 * It counts the entries whose label classifies as a failure and nothing else.
 * That is deliberately not `chain.length`: a run that parked at the gate four
 * times and failed once would otherwise be told it had five failures, which is
 * the exact defect, re-expressed as a migration. And it is deliberately not
 * zero: a pre-existing run that really did burn its ladder must not be handed a
 * fresh one by the upgrade.
 */
export function historicalFailureRetries(entries: readonly { label: string }[]): number {
  return entries.reduce((n, e) => (laneOfLabel(e.label) === "failure" ? n + 1 : n), 0);
}

/**
 * Advance the accounting by one recorded step.
 *
 * This is the load-bearing rule and the reason the module exists: only the
 * `failure` lane moves `failureRetries`. Every other lane moves its own counter
 * and leaves the failure budget exactly where it was. A caller that charged a
 * wait here would be reintroducing the bug behind a different name.
 */
export function advanceRetryAccounting(prior: RunRetryAccounting, lane: RetryLane): RunRetryAccounting {
  const next: RunRetryAccounting = {
    format: "si-retry-accounting/1",
    failureRetries: prior.failureRetries,
    continuations: prior.continuations,
    humanWaits: prior.humanWaits,
    busyWaits: prior.busyWaits,
    lastLane: lane,
  };
  if (lane === "failure") next.failureRetries = prior.failureRetries + 1;
  else if (lane === "awaiting-human") next.humanWaits = prior.humanWaits + 1;
  else if (lane === "busy") next.busyWaits = prior.busyWaits + 1;
  else next.continuations = prior.continuations + 1;
  return next;
}

/** Fold a run's chain into its accounting: trust a saved block when the last
 *  entry carries one, fall back to the conservative count when it does not.
 *  `Math.max` of the two, so a journal whose saved block was written by an older
 *  entry and whose later labels look like failures is read at whichever number
 *  is harder on the run. Never the softer one. */
export function foldRetryAccounting(
  entries: readonly { label: string; state?: unknown }[],
): RunRetryAccounting {
  const last = entries[entries.length - 1];
  const saved = last ? savedRetryAccounting(last.state) : null;
  const historical = historicalFailureRetries(entries);
  if (!saved) {
    return {
      format: "si-retry-accounting/1",
      failureRetries: historical,
      continuations: entries.reduce((n, e) => (laneOfLabel(e.label) === "continuation" ? n + 1 : n), 0),
      humanWaits: entries.reduce((n, e) => (laneOfLabel(e.label) === "awaiting-human" ? n + 1 : n), 0),
      busyWaits: entries.reduce((n, e) => (laneOfLabel(e.label) === "busy" ? n + 1 : n), 0),
      lastLane: last ? laneOfLabel(last.label) : "continuation",
    };
  }
  return { ...saved, failureRetries: Math.max(saved.failureRetries, historical) };
}

/** Put the accounting into a checkpoint's `state` without disturbing the rest
 *  of it — the state is the caller's payload and the chain digests it as one
 *  document, so the reserved member is merged rather than wrapped.
 *
 *  A `state` that is not a plain object is kept under `payload` rather than
 *  being dropped: this product legitimately checkpoints primitives (a count, a
 *  sentence), and an accounting that destroyed the resume payload would be a
 *  worse bug than the one it fixes. */
export function stateWithRetryAccounting(state: unknown, accounting: RunRetryAccounting): unknown {
  if (state !== null && typeof state === "object" && !Array.isArray(state)) {
    return { ...(state as Record<string, unknown>), [RETRY_ACCOUNTING_FIELD]: accounting };
  }
  return { payload: state ?? null, [RETRY_ACCOUNTING_FIELD]: accounting };
}

/* ── the approval-wait deadline ────────────────────────────────────────────
 * Paperclip's `extendApprovedExecutionWaitDeadline`, in this product's terms.
 *
 * THE ONE SENTENCE VERSION: a wait whose ask has not been answered yet is
 * measured from when the ask was PRESENTED, and a wait whose work has started is
 * measured from when it STARTED — and in both cases the deadline only ever
 * moves later. Re-entering a supervision loop must never restart a clock, and
 * a run must never be killed for time it spent being the thing a human asked it
 * to be: patient.
 *
 * `lane` replaces upstream's `invocationStatus`, and the preparation set
 * replaces its `PREPARATION_STATUSES`: `awaiting-human` and `busy` are the two
 * lanes where nothing has begun and the operator's own patience — not the
 * agent's — is what is being timed.
 */
export interface WaitDeadlineInput {
  currentDeadlineMs: number;
  lane: RetryLane;
  /** When the ask was opened. Null when nothing has been presented yet. */
  waitStartedAt: number | null;
  /** How long a presented-but-unanswered ask may run. */
  preparationWaitMs: number;
  /** How long the work itself may run once it has begun. */
  executionWaitMs: number;
}

export function extendApprovalWaitDeadline(input: WaitDeadlineInput): number {
  if (input.lane === "awaiting-human" || input.lane === "busy") {
    return input.waitStartedAt === null
      ? input.currentDeadlineMs
      : Math.max(input.currentDeadlineMs, input.waitStartedAt + input.preparationWaitMs);
  }
  return input.waitStartedAt === null
    ? input.currentDeadlineMs
    : Math.max(input.currentDeadlineMs, input.waitStartedAt + input.executionWaitMs);
}

/** True when a wait has run past the deadline `extendApprovalWaitDeadline`
 *  computed for it. Kept separate from the extension so a caller can report
 *  WHICH clock it timed out on instead of saying "too long". */
export function waitExpired(nowMs: number, deadlineMs: number): boolean {
  return nowMs > deadlineMs;
}
