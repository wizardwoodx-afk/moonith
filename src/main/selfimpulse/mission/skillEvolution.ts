/**
 * VH 11.11 SELF-EVOLVING — skill evolution.
 *
 * Self-evolving agents grow their own toolsets; VH does it the provable way.
 * A skill is proposed ONLY from a verified, non-simulated mission, names the
 * mission it was learned from, and never installs itself — a human approves
 * it on the Evolve page, and only then does it surface in the node library as
 * a learned node. Repeated failure lessons also propose a tool, because three
 * recurrences of the same mistake is a missing capability, not bad luck.
 *
 * 11.11.1 — described accurately: this subsystem learns reusable PROCEDURAL
 * knowledge (a learned node definition + a briefing line). It does not invent
 * or implement new executable tools, and it does not claim to.
 */

export interface SkillProposal {
  id: string;
  name: string;
  description: string;
  /** 11.13.1 — "observed-pattern": a capability pattern VH studied in another public agent system (patterns, never code).
   *  12.1.0 — "knowledge": a human-approved distillation of an external document (book/chapter/SKILL.md). It
   *  is approved HUMAN knowledge — never a claim of measured effect; it rides briefings as [knowledge]. */
  source: "verified-mission" | "repeated-failure" | "observed-pattern" | "knowledge";
  sourceMissionId: string;
  status: "proposed" | "approved" | "discarded";
  learnedAt: number;
}

export const PROPOSAL_CAP = 20;
const LS_KEY = "vh.skills.v1";

let seq = 0;

export interface SkillReflectInput {
  missionId: string;
  verified: boolean;
  simulated: boolean;
  tasks: Array<{ role: string; label: string; passed: boolean }>;
  recurringFailureTexts: string[]; // lesson texts with >= 3 recurrences
  now?: number;
}

export function proposeSkills(input: SkillReflectInput): SkillProposal[] {
  const now = input.now ?? Date.now();
  const out: SkillProposal[] = [];
  if (!input.simulated && input.verified) {
    const byRole = new Map<string, number>();
    for (const t of input.tasks) if (t.passed) byRole.set(t.role, (byRole.get(t.role) ?? 0) + 1);
    const rich = [...byRole.entries()].filter(([, n]) => n >= 2).slice(0, 2);
    for (const [role, n] of rich) {
      seq += 1;
      out.push({
        id: `skill-${now.toString(36)}-${seq}`,
        name: `${role}-pattern`,
        description: `Mission ${input.missionId} passed ${n} ${role} tasks on real execution — extract the shared pattern as a reusable ${role} node.`,
        source: "verified-mission",
        sourceMissionId: input.missionId,
        status: "proposed",
        learnedAt: now,
      });
    }
  }
  for (const text of input.recurringFailureTexts.slice(0, 1)) {
    seq += 1;
    out.push({
      id: `skill-${now.toString(36)}-${seq}`,
      name: "countermeasure-tool",
      description: `The same failure recurred three times ("${text.slice(0, 80)}…") — propose a dedicated tool that prevents it.`,
      source: "repeated-failure",
      sourceMissionId: input.missionId,
      status: "proposed",
      learnedAt: now,
    });
  }
  return out;
}

export function mergeProposals(memory: SkillProposal[], fresh: SkillProposal[]): SkillProposal[] {
  const next = [...memory];
  for (const f of fresh) {
    if (!next.some((p) => p.name === f.name && p.source === f.source)) next.push(f);
  }
  return next.slice(-PROPOSAL_CAP);
}

export function decideProposal(memory: SkillProposal[], id: string, status: "approved" | "discarded"): SkillProposal[] {
  return memory.map((p) => (p.id === id ? { ...p, status } : p));
}

/** Approved skills become library node defs — this is the runtime wiring. */
export interface LearnedNodeDef {
  id: string;
  label: string;
  description: string;
  learnedFrom: string;
}

export function approvedSkillDefs(memory: SkillProposal[]): LearnedNodeDef[] {
  return memory
    .filter((p) => p.status === "approved")
    .map((p) => ({
      id: `learned:${p.id}`,
      label: `★ ${p.name}`,
      description: p.description,
      learnedFrom: p.sourceMissionId,
    }));
}

import { enforceWrite } from "./ledger";

export function loadSkills(): SkillProposal[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as SkillProposal[];
      if (Array.isArray(p)) return p;
    }
  } catch { /* storage unavailable */ }
  return [];
}

export function saveSkills(memory: SkillProposal[], writer: "human" | "agent" | "experiment" = "human"): void {
  // 11.12.3 — governed write: only APPROVED skills are RECOURSE (installed
  // procedural memory), so only those records hit the matrix. Proposals remain
  // free evidence — an agent may propose anything; it may INSTALL nothing.
  for (const m of memory) if (m.status === "approved") enforceWrite("RECOURSE", writer);
  try { localStorage.setItem(LS_KEY, JSON.stringify(memory)); } catch { /* ignore */ }
}
