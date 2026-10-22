/**
 * VH 11.11 SELF-EVOLVING — inter-task lessons memory.
 *
 * The research consensus for 2026 agentic systems is blunt: an agent without a
 * serious memory layer plateaus. VH's version is measured-only. A lesson is
 * never a vibe — it is derived deterministically from facts a run already
 * produced (failure classifications, repair outcomes, gate verdicts, seat
 * outcomes), carries the evidence that produced it, decays with time unless
 * reinforced, and is retrieved into future team briefings so later missions
 * start smarter. Simulated runs produce environment lessons only: nothing
 * about real execution can be learned from a run that did not execute.
 */

export interface Lesson {
  id: string;
  kind: "failure" | "success" | "environment";
  text: string;
  sourceMissionId: string;
  /** The measured facts this lesson was derived from. Empty evidence = no lesson. */
  evidence: string[];
  strength: number; // 0..1, decays, reinforced by repetition
  createdAt: number;
  lastUsedAt: number;
  useCount: number;
  /** 11.12 MOSAIC — causal edges: decision/action/observation/outcome chain. */
  causal?: CausalEdge;
}

export interface CausalEdge {
  decision?: string;
  action?: string;
  observation?: string;
  outcome?: string;
}

export const LESSON_CAP = 200;
export const DECAY_PER_DAY = 0.95;
export const RETRIEVE_K = 3;

const LS_KEY = "vh.lessons.v1";

let seq = 0;
function nextId(prefix: string, now: number): string {
  seq += 1;
  return `${prefix}-${now.toString(36)}-${seq}`;
}

const FAILURE_TEXT: Record<string, string> = {
  AGENT_STARVATION: "Seats went idle waiting for inputs — briefings must name the artifact each seat consumes.",
  REPEATED_FAILURE: "The same failure recurred — isolate the failing task before retrying it a third time.",
  SEQUENTIAL_BOTTLENECK: "Exclusive tasks serialized the run — split independent work before assigning it.",
  UNMEASURED_COST: "Cost arrived unmeasured — treat the run's totals as absent, not zero.",
};

export interface ReflectInput {
  missionId: string;
  simulated: boolean;
  verified: boolean;
  failureClasses: string[];
  /** Repair strategies in execution order, e.g. ["RETRY", "ISOLATE"]; last one succeeded if repaired. */
  repairLadder: string[];
  repaired: boolean;
  seatOutcomes: Array<{ role: string; passed: boolean }>;
  now?: number;
}

/** Deterministic reflection: same measured facts in, same lessons out. */
export function reflectOnMission(input: ReflectInput): Lesson[] {
  const now = input.now ?? Date.now();
  const out: Lesson[] = [];
  const push = (kind: Lesson["kind"], text: string, evidence: string[], causal?: CausalEdge): void => {
    if (!text || evidence.length === 0) return;
    out.push({
      id: nextId("lesson", now),
      kind,
      text,
      sourceMissionId: input.missionId,
      evidence,
      strength: 1,
      createdAt: now,
      lastUsedAt: now,
      useCount: 0,
      causal,
    });
  };

  if (input.simulated) {
    push("environment",
      "Execution was simulated on this host — no lesson about real execution may be drawn; only host capability is known.",
      ["simulated=true"],
      { observation: "host executed nothing real", outcome: "simulated — capability fact only" });
    return out; // honest: a simulated run teaches nothing about real work
  }

  for (const cls of input.failureClasses) {
    const text = FAILURE_TEXT[cls];
    if (text) push("failure", text, [`failureClass=${cls}`],
      { observation: `failure class ${cls} observed on measured run`, outcome: cls });
  }

  if (input.repaired && input.repairLadder.length > 0) {
    push("success",
      `Repair ladder ${input.repairLadder.join(" -> ")} recovered the run — prefer the cheapest strategy that previously worked.`,
      [`ladder=${input.repairLadder.join(">")}`, "repaired=true"],
      { decision: "escalate through the repair ladder", action: input.repairLadder.join(" -> "), observation: input.failureClasses.join(", ") || "failure", outcome: "recovered" });
  }

  if (input.verified) {
    const reviewers = input.seatOutcomes.filter((s) => s.role === "reviewer" && s.passed).length;
    push("success",
      reviewers > 0
        ? "Cross-role review passed on real execution — keep an independent reviewer seat on missions like this."
        : "Mission verified on real execution — the team shape that produced this is worth reusing.",
      [`verified=true`, `reviewersPassed=${reviewers}`],
      { action: `team shape with ${reviewers} passing reviewer seat(s)`, outcome: "verified on real execution" });
  }
  return out;
}

export function decayedStrength(l: Lesson, now: number): number {
  const days = Math.max(0, (now - l.createdAt) / 86_400_000);
  return l.strength * Math.pow(DECAY_PER_DAY, days);
}

/** Merge new lessons into memory: identical text reinforces instead of duplicating. */
export function mergeLessons(memory: Lesson[], fresh: Lesson[], now: number): Lesson[] {
  const next = memory.map((l) => ({ ...l }));
  for (const f of fresh) {
    const hit = next.find((l) => l.text === f.text);
    if (hit) {
      hit.strength = Math.min(1, hit.strength + 0.25);
      hit.useCount += 1;
      hit.lastUsedAt = now;
      hit.evidence = [...new Set([...hit.evidence, ...f.evidence])].slice(0, 12);
    } else {
      next.push({ ...f });
    }
  }
  // strongest survive; the rest decay out of the cap
  next.sort((a, b) => decayedStrength(b, now) - decayedStrength(a, now));
  return next.slice(0, LESSON_CAP);
}

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3));
}

/** Rank memory against a mission goal: strength × recency × goal overlap. */
export function retrieveLessons(memory: Lesson[], goal: string, k: number, now: number): Lesson[] {
  const g = tokens(goal);
  const scored = memory.map((l) => {
    const t = tokens(l.text);
    let overlap = 0;
    g.forEach((w) => { if (t.has(w)) overlap += 1; });
    const recency = 1 / (1 + (now - l.lastUsedAt) / 86_400_000);
    return { l, score: decayedStrength(l, now) * (1 + overlap) * (0.5 + 0.5 * recency) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((s) => s.l);
}

/**
 * Briefing lines injected into team runs: the organization's remembered
 * experience. 11.12.1 (Varkha extract) — SCAR before PRECEDENT: matching
 * FAILURE lessons are retrieved first, then the rest; success stories are
 * motivating and get over-weighted, failure stories are diagnostic and must be
 * forced into the query path first.
 */
/**
 * 11.12 MOSAIC — causal retrieval: "what happened when we tried X under similar
 * conditions". Zero overlap retrieves nothing — no similarity bleed.
 */
export function retrieveCausal(memory: Lesson[], condition: string, k: number, now: number): Lesson[] {
  const c = tokens(condition);
  const causalText = (l: Lesson): string =>
    l.causal ? [l.causal.decision, l.causal.action, l.causal.observation, l.causal.outcome].filter(Boolean).join(" ") : "";
  const scored = memory
    .filter((l) => l.causal)
    .map((l) => {
      const t = tokens(causalText(l));
      let overlap = 0;
      c.forEach((w) => { if (t.has(w)) overlap += 1; });
      return { l, score: overlap === 0 ? 0 : decayedStrength(l, now) * overlap };
    })
    .filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((x) => x.l);
}

export function lessonsForBriefing(memory: Lesson[], goal: string, now: number): string[] {
  const scars = retrieveLessons(memory.filter((l) => l.kind === "failure"), goal, RETRIEVE_K, now);
  const scarIds = new Set(scars.map((l) => l.id));
  const rest = retrieveLessons(memory, goal, RETRIEVE_K, now).filter((l) => !scarIds.has(l.id));
  return [...scars, ...rest].slice(0, RETRIEVE_K).map(
    (l) => (l.kind === "failure" ? `[org memory scar] ${l.text}` : `[org memory] ${l.text}`),
  );
}

import { enforceWrite } from "./ledger";

export function loadLessons(): Lesson[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Lesson[];
      if (Array.isArray(p)) return p.filter((l) => l && typeof l.text === "string");
    }
  } catch { /* storage unavailable */ }
  return [];
}

export function saveLessons(memory: Lesson[], writer: "human" | "agent" | "experiment" = "agent"): void {
  // 11.12.3 — governed write: each record is checked against the ledger matrix
  // (failure -> SCAR, everything else -> PRECEDENT) before anything lands.
  for (const l of memory) enforceWrite(l.kind === "failure" ? "SCAR" : "PRECEDENT", writer);
  try { localStorage.setItem(LS_KEY, JSON.stringify(memory)); } catch { /* ignore */ }
}
