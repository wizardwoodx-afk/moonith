/**
 * §AGENT FINOPS — the money law.
 *
 * 2027's enterprise ask, in one file: a fleet that can be billed. Every seat
 * run settles into this ledger at the moment the mission executor settles
 * its budget reservation — the same fact, one throat to feed it.
 *
 * THE HONESTY RULES THIS FILE ENFORCES
 *  1. USD-UNKNOWN IS ITS OWN COLUMN. Harnesses that report tokens without a
 *     price are counted as `usdUnknownRuns` — never folded into $0.00, never
 *     priced by guessing. A ledger that invents prices is worse than one
 *     that admits gaps.
 *  2. ROLLUPS ARE VIEWS, NOT WRITES. By-seat, by-mission, by-day are pure
 *     reads over the same entries the chargeback CSV exports — the books
 *     cannot differ from the detail.
 *  3. THE DIGEST IS CONTENT-BOUND. `ledgerDigest` is a short hash of the
 *     entries; two exports that disagree carry different digests, so an
 *     auditor can tell without reading a row.
 */
import { createHash } from "node:crypto";
import { stableStringify } from "../security/actionGraph";

/** How a settled run was judged — `verified` means the repo's own check ran
 *  and exited 0; `completed` means it ran clean but was not measured. */
export type FinopsVerdict = string;

export interface SeatRunEntry {
  at: number;
  seatId: string;
  missionId: string;
  /** Measured dollars, or null when the harness reported no price. */
  usd: number | null;
  tokens: number | null;
  turns: number | null;
  verdict: FinopsVerdict;
  source: string;
}

export interface FinopsRollup {
  key: string;
  runs: number;
  usdKnown: number;
  usdUnknownRuns: number;
  tokens: number;
  verified: number;
  failed: number;
}

const MAX_ENTRIES = 2000;
let all: SeatRunEntry[] = [];

/** Record one settled seat run. Called by the mission executor's settlement
 *  seam; the UI never writes here. */
export function recordSeatRun(e: SeatRunEntry): void {
  all.push(e);
  if (all.length > MAX_ENTRIES) all = all.slice(-MAX_ENTRIES);
}

/** The ledger, oldest first. */
export const ledger = (): SeatRunEntry[] => [...all];
export const entries = (): SeatRunEntry[] => ledger();

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

function rollup(keyOf: (e: SeatRunEntry) => string, rows: SeatRunEntry[]): FinopsRollup[] {
  const map = new Map<string, FinopsRollup>();
  for (const e of rows) {
    const key = keyOf(e);
    const g = map.get(key) ?? { key, runs: 0, usdKnown: 0, usdUnknownRuns: 0, tokens: 0, verified: 0, failed: 0 };
    g.runs += 1;
    if (e.usd === null || e.usd === undefined) g.usdUnknownRuns += 1;
    else g.usdKnown = round4(g.usdKnown + e.usd);
    g.tokens += e.tokens ?? 0;
    if (e.verdict === "verified") g.verified += 1;
    if (e.verdict === "failed") g.failed += 1;
    map.set(key, g);
  }
  return [...map.values()];
}

/** Per-seat rollup — what each desk costs and how often it verifies. */
export const bySeat = (rows: SeatRunEntry[] = entries()): FinopsRollup[] =>
  rollup((e) => e.seatId, rows);

/** Per-mission rollup — what a body of work cost. */
export const byMission = (rows: SeatRunEntry[] = entries()): FinopsRollup[] =>
  rollup((e) => e.missionId, rows);

/** Per-day rollup (UTC day boundaries — the billing day, not the local one). */
export const byDay = (rows: SeatRunEntry[] = entries()): FinopsRollup[] =>
  rollup((e) => new Date(e.at).toISOString().slice(0, 10), rows);

export interface FinopsSummary {
  runs: number;
  usdKnown: number;
  usdUnknownRuns: number;
  tokens: number;
  verified: number;
  failed: number;
  /** verified / (verified + failed); null when nothing was measured. */
  verifiedShare: number | null;
}

export function summary(rows: SeatRunEntry[] = entries()): FinopsSummary {
  const all: FinopsRollup = {
    key: "all", runs: rows.length, usdKnown: 0, usdUnknownRuns: 0, tokens: 0, verified: 0, failed: 0,
  };
  for (const e of rows) {
    if (e.usd === null || e.usd === undefined) all.usdUnknownRuns += 1;
    else all.usdKnown = round4(all.usdKnown + e.usd);
    all.tokens += e.tokens ?? 0;
    if (e.verdict === "verified") all.verified += 1;
    if (e.verdict === "failed") all.failed += 1;
  }
  const judged = all.verified + all.failed;
  return { ...all, verifiedShare: judged > 0 ? Math.round((all.verified / judged) * 100) / 100 : null };
}

/** The chargeback export. One CSV, three sections (seat / mission / day),
 *  dollar-known and dollar-unknown kept apart in their own columns. */
export function chargebackCsv(rows: SeatRunEntry[] = entries()): string {
  const head = "dimension,key,runs,usd_known,usd_unknown_runs,tokens,verified,failed";
  const lines: string[] = [head];
  const groups: Array<[string, FinopsRollup[]]> = [
    ["seat", bySeat(rows)],
    ["mission", byMission(rows)],
    ["day", byDay(rows)],
  ];
  for (const [dimension, group] of groups) {
    for (const g of group) {
      lines.push(`${dimension},${g.key},${g.runs},${g.usdKnown.toFixed(4)},${g.usdUnknownRuns},${g.tokens},${g.verified},${g.failed}`);
    }
  }
  return lines.join("\n") + "\n";
}

/** Short content-bound digest of the ledger — two exports that disagree
 *  carry different digests. */
export const ledgerDigest = (rows: SeatRunEntry[] = entries()): string =>
  createHash("sha256").update(stableStringify(rows)).digest("hex").slice(0, 16);

/** Probe seam — clears the ledger. Never called by the product. */
export function resetFinopsForProbe(): void {
  all = [];
}
