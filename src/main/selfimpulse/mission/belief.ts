/**
 * VH 11.12 MOSAIC-Ω alignment — belief-state tracking.
 *
 * The MOSAIC-Ω audit (docs/MOSAIC-OMEGA-COMPAT.md) found VH's one epistemic gap:
 * observations arrive with confidence scores (web triples, seat outcomes) but
 * nothing tracks what VH *believes* vs what it has *verified*, and contradicted
 * claims silently coexist. Agent-BRACE-style, belief about the world is kept
 * separate from the action policy.
 *
 * A belief carries: claim, class (known / probably / uncertain / contradicted /
 * unknown), confidence, source, timestamp, dependencies and evidence. Rules:
 *
 *  1. External claims are never "known". Web evidence maps to AT MOST
 *     "probably" — only measured local execution (verified seat outcomes,
 *     gate verdicts) may be "known".
 *  2. A belief is a prediction-shaped object: it NEVER enters lesson memory,
 *     arm scores, or a receipt's measured facts. Briefings surface beliefs
 *     labelled as beliefs; proofs still come only from execution.
 *  3. (11.12.1, Varkha extract) Write asymmetry: anything the agent infers
 *     ABOUT THE USER is written pending and only enters briefings after human
 *     approval; preferences the user states directly are active immediately.
 */

export type BeliefClass = "known" | "probably" | "uncertain" | "contradicted" | "unknown";

export interface Belief {
  id: string;
  claim: string;
  klass: BeliefClass;
  confidence: number; // 0..1
  source: string;
  ts: number;
  /** ids of beliefs this one depends on */
  deps: string[];
  evidence: string[];
  /** true for world-model predictions — displayed, never counted */
  isPrediction: boolean;
  /** 11.12.1 write asymmetry: who wrote this, and whether it is about the user */
  provenance: "user-stated" | "agent-inferred";
  aboutUser: boolean;
  /** agent-inferred beliefs ABOUT THE USER start pending and need human approval */
  approved: boolean;
}

export const BELIEF_CAP = 100;
const LS_KEY = "vh.beliefs.v1";

let seq = 0;
function nextId(now: number): string {
  seq += 1;
  return `belief-${now.toString(36)}-${seq}`;
}

/** Web/external evidence: confidence maps to at most "probably" — never "known". */
export function classForExternal(confidence: number): BeliefClass {
  if (confidence >= 0.8) return "probably";
  if (confidence >= 0.5) return "uncertain";
  return "unknown";
}

/** Measured local execution may be "known" — but only when verified. */
export function classForMeasured(verified: boolean, confidence: number): BeliefClass {
  if (!verified) return "uncertain";
  return confidence >= 0.8 ? "known" : "probably";
}

export function beliefFromExternal(claim: string, confidence: number, source: string, now: number, deps: string[] = [], opts?: { aboutUser?: boolean; userStated?: boolean }): Belief {
  return {
    id: nextId(now), claim, klass: classForExternal(confidence), confidence, source, ts: now, deps,
    evidence: [`${source}: ${claim}`], isPrediction: false,
    provenance: opts?.userStated ? "user-stated" : "agent-inferred", aboutUser: opts?.aboutUser ?? false, approved: false,
  };
}

export function beliefFromMeasured(claim: string, verified: boolean, confidence: number, source: string, now: number, deps: string[] = [], opts?: { aboutUser?: boolean; userStated?: boolean }): Belief {
  return {
    id: nextId(now), claim, klass: classForMeasured(verified, confidence), source, ts: now, deps,
    evidence: [`${source}: ${claim}`], isPrediction: false, confidence,
    provenance: opts?.userStated ? "user-stated" : "agent-inferred", aboutUser: opts?.aboutUser ?? false, approved: false,
  };
}

export function predictionBelief(claim: string, source: string, now: number): Belief {
  return { id: nextId(now), claim, klass: "uncertain", confidence: 0.5, source, ts: now, deps: [], evidence: [], isPrediction: true, provenance: "agent-inferred", aboutUser: false, approved: false };
}

/** 11.12.1 write asymmetry: agent-inferred beliefs about the user need a human. */
export function needsApproval(b: Belief): boolean {
  return b.provenance === "agent-inferred" && b.aboutUser && !b.approved;
}

export function approveBelief(memory: Belief[], id: string): Belief[] {
  return memory.map((b) => (b.id === id ? { ...b, approved: true } : b));
}

function subjectTokens(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
}
/** Overlap over the shorter token set — 1 means same subject wording. */
function subjectOverlap(a: string, b: string): number {
  const ta = subjectTokens(a);
  const tb = subjectTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  ta.forEach((w) => { if (tb.has(w)) inter += 1; });
  return inter / Math.min(ta.size, tb.size);
}

/**
 * Merge incoming beliefs into memory. Two assertions about the SAME subject
 * (identical claim, or high subject overlap) from different sources that say
 * different things become "contradicted" — both sources kept as evidence.
 * Identical claims reinforce instead of duplicating.
 */
export function mergeBeliefs(memory: Belief[], incoming: Belief[]): Belief[] {
  let out = [...memory];
  for (const b of incoming) {
    const idx = out.findIndex((m) => m.claim === b.claim || (!b.isPrediction && !m.isPrediction && subjectOverlap(m.claim, b.claim) >= 0.7));
    if (idx === -1) {
      out.push(b);
      continue;
    }
    const m = out[idx];
    const sameAssertion = m.claim === b.claim;
    const conflicts = !sameAssertion && m.source !== b.source;
    out[idx] = conflicts
      ? { ...m, klass: "contradicted", confidence: Math.min(m.confidence, b.confidence), evidence: [...m.evidence, ...b.evidence].slice(0, 8), deps: [...new Set([...m.deps, ...b.deps])] }
      : { ...m, confidence: Math.max(m.confidence, b.confidence), ts: Math.max(m.ts, b.ts), evidence: [...m.evidence, ...b.evidence].slice(0, 8) };
  }
  return out.slice(-BELIEF_CAP);
}

/** Contradictions and relevant uncertainty surface in briefings, labelled as beliefs. Pending (write-asymmetry) beliefs do not. */
export function beliefsForBriefing(memory: Belief[], goal: string, now: number): string[] {
  void now;
  const goalWords = goal.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const relevant = (b: Belief) => {
    if (needsApproval(b)) return false; // inferred-about-user waits for a human
    const low = b.claim.toLowerCase();
    return b.klass === "contradicted" || b.isPrediction || goalWords.some((w) => low.includes(w));
  };
  const lines: string[] = [];
  for (const b of memory.filter(relevant)) {
    if (b.isPrediction) lines.push(`[prediction — NOT evidence] ${b.claim}`);
    else if (b.klass === "contradicted") lines.push(`[belief contradicted] ${b.claim} — sources disagree; verify before acting on it`);
    else lines.push(`[belief ${b.klass}] ${b.claim} (${b.source})`);
  }
  return lines.slice(0, 6);
}

/** Digest input for embedding the current world-belief into action packets. */
export function beliefDigestInput(memory: Belief[]): string {
  return JSON.stringify(memory.map((b) => [b.id, b.claim, b.klass, b.confidence, b.source, b.ts]));
}

import { enforceWrite } from "./ledger";

export function loadBeliefs(): Belief[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Belief[];
      if (Array.isArray(p)) return p;
    }
  } catch { /* storage unavailable */ }
  return [];
}

export function saveBeliefs(memory: Belief[], writer: "human" | "agent" | "experiment" = "agent"): void {
  // 11.12.3 — governed write: beliefs are STANCE; the matrix decides who may
  // persist them (the approval asymmetry lives one layer up, in needsApproval).
  for (const _ of memory) enforceWrite("STANCE", writer);
  try { localStorage.setItem(LS_KEY, JSON.stringify(memory)); } catch { /* ignore */ }
}
