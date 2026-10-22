/**
 * §20 Mission memory + §21 organization memory + §22 reputation.
 *
 * Six scopes, each with a clear boundary:
 *
 *   MISSION   what happened in this mission
 *   TEAM      what a team discovered
 *   AGENT     what one agent learned
 *   ARTIFACT  lineage and versions
 *   DECISION  what was decided and by whom
 *   FAILURE   what failed and how it was repaired
 *
 * Retrieval is always scoped and always ranked. `retrieve` refuses to return the whole
 * store: dumping all historical memory into an agent context is exactly the failure mode
 * §20 warns against, so a scope key and a limit are mandatory.
 */

import { uid } from "../app/id";
import type {
  MemoryEntry,
  MemoryScope,
  ReputationRecord,
  ReputationView,
} from "./types";
import type { FlightRecorder } from "./flightRecorder";

export interface RememberInput {
  scope: MemoryScope;
  scopeKey: string;
  missionId: string;
  kind: MemoryEntry["kind"];
  content: string;
  evidence?: string[];
  importance?: number;
  tags?: string[];
}

export class OrganizationMemory {
  private entries: MemoryEntry[] = [];

  remember(input: RememberInput): MemoryEntry {
    if (!input.scopeKey) throw new Error("memory: a scope key is required; unscoped memory is not stored");
    const entry: MemoryEntry = {
      id: uid("mem"),
      scope: input.scope,
      scopeKey: input.scopeKey,
      missionId: input.missionId,
      kind: input.kind,
      content: input.content,
      evidence: input.evidence ?? [],
      importance: input.importance ?? 0.5,
      tags: input.tags ?? [],
      createdAt: new Date().toISOString(),
    };
    this.entries.push(entry);
    return entry;
  }

  /**
   * Scoped retrieval. Both `scope` and `scopeKey` are required — there is no "give me
   * everything" path.
   */
  retrieve(scope: MemoryScope, scopeKey: string, limit = 8, query?: string): MemoryEntry[] {
    const pool = this.entries.filter((e) => e.scope === scope && e.scopeKey === scopeKey);
    const scored = pool.map((e) => ({ e, s: rank(e, query) }));
    scored.sort((a, b) => b.s - a.s || b.e.createdAt.localeCompare(a.e.createdAt));
    return scored.slice(0, Math.max(1, limit)).map((x) => x.e);
  }

  /**
   * Cross-mission retrieval for a new mission: only distilled, high-importance evidence,
   * and only from the scopes that generalise. Never the raw trace of another mission.
   */
  relevantEvidence(query: string, limit = 6, excludeMissionId?: string): MemoryEntry[] {
    const generalises = new Set<MemoryScope>(["DECISION", "FAILURE", "TEAM", "AGENT"]);
    const kinds = new Set<MemoryEntry["kind"]>([
      "what_worked",
      "what_failed",
      "harness_success",
      "tool_failure",
      "rejected_architecture",
      "repair_strategy",
    ]);
    const pool = this.entries.filter(
      (e) => generalises.has(e.scope) && kinds.has(e.kind) && e.missionId !== excludeMissionId && e.importance >= 0.4,
    );
    return pool
      .map((e) => ({ e, s: rank(e, query) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map((x) => x.e);
  }

  forMission(missionId: string): MemoryEntry[] {
    return this.entries.filter((e) => e.missionId === missionId);
  }

  byScope(scope: MemoryScope): MemoryEntry[] {
    return this.entries.filter((e) => e.scope === scope);
  }

  /** Distil a finished mission into the entries worth carrying forward. */
  distil(missionId: string, recorder: FlightRecorder): MemoryEntry[] {
    const out: MemoryEntry[] = [];
    for (const e of recorder.ofKind("EVALUATION_PASSED")) {
      out.push(
        this.remember({
          scope: "MISSION",
          scopeKey: missionId,
          missionId,
          kind: "what_worked",
          content: `${String(e.data.artifact ?? e.subjectId ?? "artifact")} passed independent evaluation: ${e.reason}`,
          evidence: e.evidence,
          importance: 0.7,
          tags: ["evaluation"],
        }),
      );
    }
    for (const e of recorder.ofKind("REPAIR_COMPLETED")) {
      out.push(
        this.remember({
          scope: "FAILURE",
          scopeKey: String(e.data.strategy ?? "repair"),
          missionId,
          kind: "repair_strategy",
          content: `Repair ${String(e.data.strategy ?? "?")} succeeded: ${e.reason}`,
          evidence: e.evidence,
          importance: 0.8,
          tags: ["repair"],
        }),
      );
    }
    for (const e of recorder.ofKind("APPROVAL_REQUIRED")) {
      out.push(
        this.remember({
          scope: "DECISION",
          scopeKey: String(e.data.risk ?? "risk"),
          missionId,
          kind: "approval_required",
          content: `${String(e.data.risk)} action required human approval: ${e.reason}`,
          evidence: e.evidence,
          importance: 0.6,
          tags: ["approval", "governance"],
        }),
      );
    }
    for (const e of recorder.ofKind("GRAPH_MUTATED")) {
      out.push(
        this.remember({
          scope: "DECISION",
          scopeKey: String(e.data.reason ?? "reorganization"),
          missionId,
          kind: "decision",
          content: `Organization changed: ${e.reason}`,
          evidence: e.evidence,
          importance: 0.75,
          tags: ["graph", "reorganization"],
        }),
      );
    }
    return out;
  }

  hydrate(entries: MemoryEntry[]): void {
    this.entries = [...entries];
  }

  export(): MemoryEntry[] {
    return [...this.entries];
  }

  get size(): number {
    return this.entries.length;
  }
}

/** Lexical relevance. Deliberately simple and deterministic; never silently semantic. */
function rank(entry: MemoryEntry, query?: string): number {
  let score = entry.importance;
  if (query) {
    const q = new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
    const hay = `${entry.content} ${entry.tags.join(" ")} ${entry.kind}`.toLowerCase();
    let hits = 0;
    for (const w of q) if (hay.includes(w)) hits += 1;
    score += q.size ? 0.5 * (hits / q.size) : 0;
  }
  if (entry.evidence.length) score += 0.1; // evidenced memory outranks assertion
  return score;
}

/* ------------------------------------------------------------------ §22 reputation */

/**
 * Reputation is evidence about agents, teams, frameworks and harnesses. It informs routing;
 * it never guarantees an outcome. `confidence` is a function of sample size, so a subject
 * with two runs is visibly less trustworthy than one with fifty.
 */
export class ReputationLedger {
  private records: ReputationRecord[] = [];

  note(subjectKind: ReputationRecord["subjectKind"], subjectId: string, dimension: string, success: boolean, ms: number): ReputationRecord {
    let rec = this.records.find((r) => r.subjectKind === subjectKind && r.subjectId === subjectId && r.dimension === dimension);
    if (!rec) {
      rec = { subjectKind, subjectId, dimension, wins: 0, losses: 0, totalMs: 0, runs: 0, updatedAt: new Date().toISOString() };
      this.records.push(rec);
    }
    rec.runs += 1;
    if (success) rec.wins += 1;
    else rec.losses += 1;
    rec.totalMs += ms;
    rec.updatedAt = new Date().toISOString();
    return rec;
  }

  view(subjectKind: ReputationRecord["subjectKind"], subjectId: string): ReputationView {
    const recs = this.records.filter((r) => r.subjectKind === subjectKind && r.subjectId === subjectId);
    const runs = recs.reduce((s, r) => s + r.runs, 0);
    const wins = recs.reduce((s, r) => s + r.wins, 0);
    const totalMs = recs.reduce((s, r) => s + r.totalMs, 0);
    return {
      subjectId,
      subjectKind,
      runs,
      successRate: runs ? wins / runs : 0,
      medianMs: runs ? Math.round(totalMs / runs) : 0,
      byDimension: recs.map((r) => ({
        dimension: r.dimension,
        runs: r.runs,
        successRate: r.runs ? r.wins / r.runs : 0,
        label: labelFor(r.runs ? r.wins / r.runs : 0, r.runs),
      })),
      confidence: Math.min(1, runs / 20),
    };
  }

  /** Every subject with at least one record, for the reputation page. */
  allViews(): ReputationView[] {
    const keys = new Set(this.records.map((r) => `${r.subjectKind}::${r.subjectId}`));
    return [...keys].map((k) => {
      const [subjectKind, subjectId] = k.split("::") as [ReputationRecord["subjectKind"], string];
      return this.view(subjectKind, subjectId);
    });
  }

  hydrate(records: ReputationRecord[]): void {
    this.records = [...records];
  }

  export(): ReputationRecord[] {
    return [...this.records];
  }
}

function labelFor(rate: number, runs: number): string {
  if (runs < 3) return `insufficient evidence (${runs} run${runs === 1 ? "" : "s"})`;
  if (rate >= 0.85) return "strong";
  if (rate >= 0.6) return "adequate";
  if (rate >= 0.35) return "weak";
  return "poor";
}
