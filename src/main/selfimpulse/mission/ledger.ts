/**
 * VH 11.12.2 — the Ledger: memory typed by the question it answers.
 *
 * The external review flagged "no typed memory architecture". VH never stored
 * one blob — lessons, invariants, strategies and skills already live in
 * separate stores — but the taxonomy and, crucially, the WRITE PERMISSIONS
 * were implicit. 11.12.2 names them (Varkha's cognitive decomposition) and
 * makes the write rules mechanical:
 *
 *   STANCE    working memory — this turn's live state; never "retrieved",
 *             just loaded. (session store / turn heartbeats)
 *   PRECEDENT episodic — what happened, in order, with outcomes (success and
 *             environment lessons)
 *   SCAR      failure memory — kept separate and queried FIRST (11.12.1), so
 *             diagnostic failures are never diluted by motivating successes
 *   DOCTRINE  semantic — durable house rules: learned invariants, gate
 *             policy. Agents may PROPOSE; only a human (or the gate) writes.
 *   RECOURSE  procedural — which strategies work: the strategy archive and
 *             approved learned skills. Written only by the measured
 *             experiment (adoption) or human approval.
 *
 * Separation alone is not sufficient — governance over who can write is the
 * other half, so `canWrite` is the rule every writer must pass, pinned by
 * probe/governanceAlign.test.ts.
 */
import { loadLessons, retrieveCausal, type Lesson } from "./lessons";
import { loadImprovement } from "./selfImprove";
import { loadSkills } from "./skillEvolution";

export type LedgerType = "STANCE" | "PRECEDENT" | "SCAR" | "DOCTRINE" | "RECOURSE";
export type Writer = "human" | "agent" | "experiment";

/**
 * The write-permission matrix. DOCTRINE is the load-bearing rule: an agent can
 * never unilaterally rewrite house rules — it proposes, a human (or the gate)
 * writes. RECOURSE belongs to the measured experiment and to humans; a plain
 * agent run cannot install a strategy or a skill.
 */
export function canWrite(type: LedgerType, writer: Writer): { ok: boolean; reason: string } {
  switch (type) {
    case "STANCE":
      return writer === "agent" || writer === "human"
        ? { ok: true, reason: "STANCE is live turn state; the runtime writes it" }
        : { ok: false, reason: "the experiment writes no live state" };
    case "PRECEDENT":
    case "SCAR":
      return writer === "agent" || writer === "human"
        ? { ok: true, reason: `${type} is written from MEASURED run facts only (reflection enforces this)` }
        : { ok: false, reason: "the experiment settles strategies, not episodes" };
    case "DOCTRINE":
      return writer === "human"
        ? { ok: true, reason: "house rules are human-written" }
        : { ok: false, reason: `DOCTRINE is human-only; ${writer} may propose, never write` };
    case "RECOURSE":
      return writer === "experiment" || writer === "human"
        ? { ok: true, reason: "RECOURSE changes only via measured adoption or human approval" }
        : { ok: false, reason: "an agent run cannot install strategies or skills on its own" };
  }
}

/**
 * VH 11.12.3 — the matrix is not just policy text: `enforceWrite` is called by
 * every governed store writer (lessons, skills, beliefs, improvement) BEFORE the
 * write lands. Knowing the rule and blocking on the rule are now the same thing:
 * any future writer that bypasses a store save-function is the only way around
 * the matrix, and there is no such path in this tree.
 */
export function enforceWrite(type: LedgerType, writer: Writer): void {
  const v = canWrite(type, writer);
  if (!v.ok) throw new Error(`ledger: refused — ${writer} may not write ${type} (${v.reason})`);
}

export interface LedgerSummary {
  stance: string;
  precedent: { count: number; newest: string | null };
  scar: { count: number; scarFirst: true };
  doctrine: { items: string[]; writeRule: string };
  recourse: { strategyGen: number; adoptedNote: string | null; approvedSkills: number };
}

/** Read-only typed view over the existing stores, for the Audit dashboard. */
export function ledgerSummary(_now: number): LedgerSummary {
  const lessons = loadLessons();
  const scars = lessons.filter((l) => l.kind === "failure");
  const precedent = lessons.filter((l) => l.kind !== "failure");
  const imp = loadImprovement();
  const adopted = imp.versions.find((v) => v.id === imp.adoptedId) ?? null;
  const skills = loadSkills().filter((s) => s.status === "approved").length;
  return {
    stance: "live turn state (session store + heartbeats) — loaded, never retrieved",
    precedent: { count: precedent.length, newest: precedent[0]?.text ?? null },
    scar: { count: scars.length, scarFirst: true },
    doctrine: {
      items: ["adversarial gate policy (STRICT default)", "learned invariants (human-approved)", "honesty rule: simulated runs teach nothing"],
      writeRule: canWrite("DOCTRINE", "agent").reason,
    },
    recourse: { strategyGen: adopted?.gen ?? 1, adoptedNote: adopted?.note ?? null, approvedSkills: skills },
  };
}

/** SCAR-before-PRECEDENT, exposed for the Chamber-style deliberation path. */
export function scarFirstQuery(goal: string, k: number, now: number): Lesson[] {
  return retrieveCausal(loadLessons().filter((l) => l.kind === "failure"), goal, k, now);
}
