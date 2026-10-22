/**
 * CAPS — the money, the clock and the turn counter, enforced before dispatch.
 *
 * WHY THIS IS A SEPARATE MODULE
 *
 * A coding agent with no ceiling is a billing incident. Every orchestration layer that survives
 * contact with production has the same four controls: cost, turns, wall clock, and children. What
 * makes this one trustworthy is where the numbers come from.
 *
 * THE ONE RULE
 *
 * Cost is read out of the CLI's own output, or it is recorded as unknown. Never estimated. A token
 * count multiplied by a price VH guessed is a fabricated metric dressed up as accounting, and a
 * budget built on it is theatre. So `costUsd` stays `null` for CLIs that report tokens only, and the
 * ledger says so out loud instead of quietly charging zero.
 *
 * A second rule follows from the first: a zero token total is NOT reported as 0. Zero means "the CLI
 * told us nothing", which is different from "the CLI measured nothing". Conflating them would let a
 * failed invocation look like a free successful one.
 */

export type CapOutcome = "ok" | "timeout" | "cost_cap" | "turn_cap" | "mission_cap";

export interface InvocationCaps {
  /** Wall-clock ceiling for one invocation. */
  timeoutMs: number;
  /** How many agent turns VH will pay for. 0 disables. */
  maxTurns: number;
  /** Per-invocation cost ceiling in USD. 0 disables. */
  maxCostUsd: number;
}

export const DEFAULT_CAPS: InvocationCaps = { timeoutMs: 10 * 60 * 1000, maxTurns: 40, maxCostUsd: 5 };

/**
 * THE CEILING FOR WORK A REMOTE PRINCIPAL ASKED FOR.
 *
 * `DEFAULT_CAPS` above is what the OWNER gets for one invocation on their own
 * machine. This is smaller, on purpose: a delegation is somebody else's request
 * spending this owner's provider key, this owner's wall clock and this owner's
 * repository. It should not be able to out-spend the owner, and it must never be
 * "whatever the ledger was constructed with", because the one construction site
 * on the federation path used to be `new CapLedger({})` — no cost ceiling, no
 * turn ceiling, no invocation ceiling and no clock, which `admissionError`
 * scores as *admit, always*. Every number below is justified, not chosen.
 *
 *   maxTurns: 40        Identical to `DEFAULT_CAPS.maxTurns`. The rule is that a
 *                       remote caller never gets a bigger turn budget than the
 *                       owner gets locally for one invocation, so this is a
 *                       ceiling rather than a negotiation. One delegation
 *                       declares two seats (writer + read-only reviewer) at
 *                       `seat.maxTurns` each, 8 by default — 16 — so 40 admits
 *                       the whole run with room for a host that configures
 *                       larger seats, and refuses past it.
 *
 *   maxCostUsd: 2      Strictly under the owner's own $5 default. One
 *                       delegation is one unit of work, not a campaign: it is a
 *                       single task text, scoped to a single teammate, already
 *                       re-classified by the receiver's own risk policy. A
 *                       remote caller that can spend $5 here can spend more than
 *                       the person who owns the key.
 *
 *   maxInvocations: 4  The bridge builds exactly two seats, so this admits the
 *                       run plus one retry of headroom and refuses any growth in
 *                       dispatch count. Charged BEFORE dispatch, per seat, so the
 *                       executor's own per-turn admission check sees a real
 *                       number rather than a zero that never moves.
 *
 *   maxWallClockMs:    30 minutes — the same mission clock `missionLoop` runs
 *     30 * 60_000     with. Two sequential seats at the 600s per-seat default is
 *                       20 minutes, so 30 admits the whole delegation with 10 to
 *                       spare. This is the guard that actually binds for CLIs
 *                       that report tokens and no price (see the honesty rule
 *                       above): `spentUsd` stays 0 for those, so turns,
 *                       invocations and the clock are what stop a remote caller.
 *
 * WHAT THIS DOES NOT DO, STATED PLAINLY. It does not price a run whose CLI
 * reports no price, because there is no honest number to charge; it does not
 * rate-limit how many DISTINCT delegations arrive over time (that is a peer-level
 * concern, and the crossing ledger is where it belongs); and it does not by
 * itself stop a delegation that re-delegates — that bound is the hop limit in
 * `selfimpulseTeams.ts`, and it is enforced there.
 */
export const INBOUND_DELEGATION_CAPS: Required<Pick<MissionCaps, "maxCostUsd" | "maxTurns" | "maxInvocations" | "maxWallClockMs">> = {
  maxCostUsd: 2,
  maxTurns: 40,
  maxInvocations: 4,
  maxWallClockMs: 30 * 60_000,
};

export interface ReportedUsage {
  /** Real dollars, as reported by the CLI. null means the CLI does not report cost. */
  costUsd: number | null;
  /** Token total. null means no token data, which is not the same as zero tokens. */
  tokens: number | null;
  /** Turns the CLI says it used. null when it does not report them. */
  turns: number | null;
  /** Which harness reported this, so a mixed team can be audited per vendor. */
  source: string;
}

/** Why a charge is what it is. Kept as a sentence because it is shown to a human. */
export type CostBasis = "reported_usd" | "tokens_only" | "unknown";

export interface ChargeResult {
  chargedUsd: number;
  basis: CostBasis;
  /** Non-null when this charge put the invocation over a ceiling. */
  breach: CapOutcome | null;
  reason: string;
}

export interface MissionCapState {
  spentUsd: number;
  spentTokens: number;
  turnsUsed: number;
  invocationsUsed: number;
  startedAt: number;
  cappedInvocations: Array<{ id: string; outcome: CapOutcome; at: string; detail: string }>;
}

export interface MissionCaps {
  maxCostUsd?: number;
  maxTurns?: number;
  timeoutMs?: number;
  maxWallClockMs?: number;
  maxInvocations?: number;
}

/**
 * The mission-level ledger.
 *
 * One instance per mission, shared by every seat. That is deliberate: a per-seat budget lets N seats
 * each spend the full amount, so a team of six has six times the ceiling the user set. The ceiling
 * has to be the mission's.
 *
 * Charges are read-then-write with no await between, so concurrent seats inside a wave cannot
 * interleave and both get admitted under the same remaining budget.
 */
export class CapLedger {
  readonly caps: MissionCaps;
  readonly state: MissionCapState;

  constructor(caps: MissionCaps, now: number = Date.now()) {
    this.caps = caps;
    this.state = { spentUsd: 0, spentTokens: 0, turnsUsed: 0, invocationsUsed: 0, startedAt: now, cappedInvocations: [] };
  }

  beginInvocation(): void {
    this.state.invocationsUsed += 1;
  }

  /**
   * Can another invocation start at all? Checked BEFORE dispatch — refusing is control, charging after is bookkeeping.
   *
   * TWO FAIL-CLOSED RULES, both added because an unpopulated `MissionCaps` used
   * to mean "no ceiling at all":
   *
   *  1. A DECLARED-BUT-UNREADABLE CAP IS A REFUSAL, NOT AN ABSENT CAP. Every
   *     guard below reads `?? 0`, and `NaN > 0` is false, so `{ maxTurns: NaN }`
   *     and `{ maxCostUsd: -1 }` each silently disable themselves. A ceiling
   *     nobody can read is not a ceiling, so any declared value that is not a
   *     finite non-negative number refuses the dispatch and names the field.
   *
   *  2. A LEDGER WITH NO ARMED GUARD ADMITS NOTHING. `new CapLedger({})` scored
   *     zero on every guard, so it returned `null` — admit, forever — which meant
   *     the federation path's `new CapLedger({})` was an unbounded budget for
   *     whoever reached the port. There is no honest reading of "no ceiling was
   *     declared" as "run without limit", so it refuses and says so.
   *
   * An explicit `0` is still this build's way of saying "this one dimension is
   * unlimited" (`mayRunTurn` documents the same convention) and stays honoured.
   * What is refused is the ABSENCE of every armed guard, not a chosen zero.
   *
   * `missionLoop` constructs a ledger with `maxTurns: 120` and a numeric
   * `maxCostUsd`, so rule 2 never fires on the mission path; rule 1 only fires
   * on a malformed value, which is the direction it is meant to fail.
   */
  admissionError(now: number = Date.now()): string | null {
    for (const [field, value] of Object.entries(this.caps) as Array<[string, unknown]>) {
      if (value === undefined || value === null) continue;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return `the ${field} ceiling is declared as ${JSON.stringify(value)}, which is not a usable number — refusing rather than treating a broken ceiling as no ceiling`;
      }
    }
    const maxCost = this.caps.maxCostUsd ?? 0;
    if (maxCost > 0 && this.state.spentUsd >= maxCost) {
      return `the mission has already spent $${this.state.spentUsd.toFixed(4)} of its $${maxCost.toFixed(4)} ceiling`;
    }
    const maxTurns = this.caps.maxTurns ?? 0;
    if (maxTurns > 0 && this.state.turnsUsed >= maxTurns) {
      return `the mission has already used ${this.state.turnsUsed} of its ${maxTurns} turns`;
    }
    const maxInvocations = this.caps.maxInvocations ?? 0;
    if (maxInvocations > 0 && this.state.invocationsUsed >= maxInvocations) {
      return `the mission has used all ${maxInvocations} permitted invocations`;
    }
    const maxWall = this.caps.maxWallClockMs ?? this.caps.timeoutMs ?? 0;
    if (maxWall > 0 && now - this.state.startedAt >= maxWall) {
      return `the mission's ${Math.round(maxWall / 1000)}s wall clock has elapsed`;
    }
    if (maxCost <= 0 && maxTurns <= 0 && maxInvocations <= 0 && maxWall <= 0) {
      return `no ceiling is set — cost, turns, invocations and the wall clock are all absent or zero, so this ledger would admit without limit; dispatch is refused until a real ceiling is declared`;
    }
    return null;
  }

  /** Record what a CLI actually consumed. Returns why, so the caller can show it. */
  charge(r: ReportedUsage): ChargeResult {
    if (r.tokens !== null && Number.isFinite(r.tokens)) {
      this.state.spentTokens += r.tokens;
    }
    if (r.costUsd !== null && Number.isFinite(r.costUsd)) {
      this.state.spentUsd += r.costUsd;
      const maxCost = this.caps.maxCostUsd ?? 0;
      const breach = maxCost > 0 && this.state.spentUsd > maxCost ? "mission_cap" : null;
      return {
        chargedUsd: r.costUsd,
        basis: "reported_usd",
        breach,
        reason: breach
          ? `Charged $${r.costUsd.toFixed(4)} from ${r.source}, taking the mission to $${this.state.spentUsd.toFixed(4)} over a $${maxCost.toFixed(4)} ceiling.`
          : `Charged $${r.costUsd.toFixed(4)} reported by ${r.source}. Mission total $${this.state.spentUsd.toFixed(4)}.`,
      };
    }
    if (r.tokens !== null) {
      return {
        chargedUsd: 0,
        basis: "tokens_only",
        breach: null,
        reason: `${r.source} reported ${r.tokens} tokens and no price. Recorded as tokens; NOT converted to dollars, because a guessed price would be a fabricated cost.`,
      };
    }
    return { chargedUsd: 0, basis: "unknown", breach: null, reason: `${r.source} reported neither cost nor tokens, so nothing was charged and the true spend is unknown.` };
  }

  /** Note that something was stopped by a cap. Kept separately from charges: a refusal is not a spend. */
  recordCapped(id: string, outcome: CapOutcome, detail: string, at = new Date().toISOString()): void {
    this.state.cappedInvocations.push({ id, outcome, at, detail });
  }

  addTurns(n: number): void {
    this.state.turnsUsed += n;
  }

  snapshot(): MissionCapState {
    return { ...this.state, cappedInvocations: [...this.state.cappedInvocations] };
  }
}

export interface EnforcedResult<T> {
  outcome: CapOutcome;
  value: T | null;
  timedOut: boolean;
  elapsedMs: number;
  detail: string;
}

/**
 * Race work against a wall clock.
 *
 * The honest part: when the deadline wins, VH cannot promise the child stopped. Killing a process is
 * the caller's job and is not always possible, so the detail says the caller must terminate it rather
 * than implying the deadline was enforced on the child.
 */
export async function withDeadline<T>(
  work: (signal: { cancelled: boolean }) => Promise<T>,
  timeoutMs: number,
  now: () => number = Date.now,
): Promise<EnforcedResult<T>> {
  const t0 = now();
  const signal = { cancelled: false };
  if (timeoutMs <= 0) {
    const value = await work(signal);
    return { outcome: "ok", value, timedOut: false, elapsedMs: now() - t0, detail: "No deadline set." };
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<"__timeout__">((resolve) => {
    timer = setTimeout(() => {
      signal.cancelled = true;
      resolve("__timeout__");
    }, timeoutMs);
  });
  const winner = await Promise.race([work(signal).then((v) => ({ v })), deadline]);
  if (timer) clearTimeout(timer);
  if (winner === "__timeout__") {
    return {
      outcome: "timeout",
      value: null,
      timedOut: true,
      elapsedMs: now() - t0,
      detail: `Deadline of ${timeoutMs}ms reached. The caller must terminate the child process; VH cannot assume it stopped.`,
    };
  }
  return { outcome: "ok", value: (winner as { v: T }).v, timedOut: false, elapsedMs: now() - t0, detail: `Finished in ${now() - t0}ms, inside the ${timeoutMs}ms deadline.` };
}

/* ------------------------------------------------------------------ turn accounting */

export interface TurnAccount {
  used: number;
  cap?: number;
  limit?: number;
  /** Turns the CLI itself reported, which may differ from VH's count. */
  reported?: number | null;
}

export function mayRunTurn(account: TurnAccount): { allowed: boolean; reason: string } {
  const cap = account.cap ?? account.limit ?? 0;
  if (cap <= 0) return { allowed: true, reason: "No turn limit is set (cap 0 means no cap)." };
  // When the CLI reports its own turn count, that is the better number: VH counts invocations, the
  // CLI counts its internal reasoning steps, and the internal one is what costs money.
  const effective = account.reported !== null && account.reported !== undefined ? Math.max(account.used, account.reported) : account.used;
  if (effective >= cap) {
    return { allowed: false, reason: `Turn cap reached: ${effective} of ${cap} turns used.` };
  }
  return { allowed: true, reason: `${effective} of ${cap} turns used.` };
}

export function nextTurn(account: TurnAccount): TurnAccount {
  return { ...account, used: account.used + 1 };
}

/* ------------------------------------------------------------------ parsing real output */

/**
 * Read usage out of a CLI's own bytes.
 *
 * Each shape here was checked against real output rather than a manual. Two nested layouts occur in
 * practice and a flat lookup silently returns null for the second, which would bill those runs at
 * zero:
 *   { total_cost_usd, num_turns, usage: { input_tokens, output_tokens } }
 *   { part: { cost, tokens: { total, input, output, reasoning, cache } } }
 *
 * One emitter's tokens.total is CUMULATIVE across steps (observed 8019 then 8038), so the last value
 * is the run total and summing would multiply-count.
 */
export function parseReportedUsage(harness: string, raw: string): ReportedUsage {
  const empty: ReportedUsage = { costUsd: null, tokens: null, turns: null, source: harness };
  if (!raw.trim()) return empty;

  const candidates = jsonChunks(raw);
  let costUsd: number | null = null;
  let tokens: number | null = null;
  let turns: number | null = null;

  for (const obj of candidates) {
    const c = findNumber(obj, ["total_cost_usd", "cost_usd", "costUsd", "cost"], 0);
    if (c !== null) costUsd = c;
    const t = findNumber(obj, ["total_tokens"], 0) ?? sumTokens(obj);
    if (t === null) {
      const flat = findNumber(obj, ["tokens"], 0);
      if (flat !== null) tokens = flat;
    } else {
      tokens = t;
    }
    const n = findNumber(obj, ["num_turns", "turns", "total_turns"], 0);
    if (n !== null) turns = n;
  }

  // A CLI documented as never reporting a price must not have one inferred from a field that happens
  // to share a name.
  return { costUsd, tokens, turns, source: harness };
}

/** Split NDJSON or a JSON array into objects. Malformed lines are skipped, not fatal. */
function jsonChunks(raw: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const tryOne = (s: string) => {
    try {
      const v = JSON.parse(s) as unknown;
      if (v && typeof v === "object") out.push(v as Record<string, unknown>);
    } catch {
      /* not JSON */
    }
  };
  tryOne(raw.trim());
  for (const line of raw.split(/\r?\n/)) if (line.trim()) tryOne(line.trim());
  return out;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

/**
 * Breadth-first search for the first key holding a number.
 *
 * BFS rather than DFS so a top-level key always beats a deeply nested one with the same name, and
 * depth-limited so a pathological payload cannot cost unbounded time.
 */
function findNumber(obj: unknown, keys: string[], depth: number): number | null {
  if (depth > 3 || !obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const direct = pickNumber(o, keys);
  if (direct !== null) return direct;
  for (const v of Object.values(o)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = findNumber(v, keys, depth + 1);
      if (nested !== null) return nested;
    }
  }
  return null;
}

/** Token totals from a nested usage block, handling both real shapes. */
function sumTokens(obj: Record<string, unknown>): number | null {
  const blocks: Array<Record<string, unknown>> = [];
  const collect = (o: unknown, depth: number) => {
    if (depth > 3 || !o || typeof o !== "object" || Array.isArray(o)) return;
    const rec = o as Record<string, unknown>;
    for (const k of ["usage", "tokens"]) {
      const v = rec[k];
      if (v && typeof v === "object" && !Array.isArray(v)) blocks.push(v as Record<string, unknown>);
    }
    for (const v of Object.values(rec)) collect(v, depth + 1);
  };
  collect(obj, 0);

  let best: number | null = null;
  for (const u of blocks) {
    const total = typeof u.total === "number" && Number.isFinite(u.total) ? u.total : null;
    const i = typeof u.input_tokens === "number" ? u.input_tokens : typeof u.input === "number" ? u.input : 0;
    const o = typeof u.output_tokens === "number" ? u.output_tokens : typeof u.output === "number" ? u.output : 0;
    // `total` wins when present: it is authoritative, and input+output omits reasoning and cache
    // reads, so summing would understate real consumption.
    const candidate = total !== null && total > 0 ? total : i + o > 0 ? i + o : null;
    if (candidate !== null) best = candidate;
  }
  return best;
}

/* ------------------------------------------------------------------ deriving caps from a seat */

/**
 * Turn a seat's declared limits into enforced ones.
 *
 * A limit too small to be usable is refused rather than honoured: a 5-second timeout on a coding
 * agent is not a cap, it is a guaranteed failure, and VH says so instead of quietly running something
 * that cannot finish.
 */
export function capsForSeat(seat: { timeoutSecs: number; maxTurns: number | null }, costUsd: number | null): { caps: InvocationCaps; warnings: string[] } {
  const warnings: string[] = [];
  const timeoutMs = seat.timeoutSecs > 0 ? seat.timeoutSecs * 1000 : DEFAULT_CAPS.timeoutMs;
  if (seat.timeoutSecs > 0 && seat.timeoutSecs < 30) {
    warnings.push(`${seat.timeoutSecs}s is below the 30s floor for a coding agent; using it anyway, but expect a timeout on any real edit.`);
  }
  if (seat.maxTurns === null || seat.maxTurns === undefined) {
    warnings.push("No turn cap was specified for this seat; using default.");
  }
  const maxTurns = seat.maxTurns !== null && seat.maxTurns !== undefined && seat.maxTurns > 0 ? seat.maxTurns : DEFAULT_CAPS.maxTurns;
  if (seat.maxTurns !== null && seat.maxTurns !== undefined && seat.maxTurns > 0 && seat.maxTurns < 3) {
    warnings.push(`${seat.maxTurns} turns is almost certainly too few to read a file and edit it.`);
  }
  const maxCostUsd = costUsd !== null && costUsd > 0 ? costUsd : DEFAULT_CAPS.maxCostUsd;
  return { caps: { timeoutMs, maxTurns, maxCostUsd }, warnings };
}
