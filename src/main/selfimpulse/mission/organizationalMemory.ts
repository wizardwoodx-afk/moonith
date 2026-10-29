/**
 * Causal Organizational Memory & Cross-Mission Invariant Compiler.
 *
 * Traditional agent frameworks either suffer from amnesia (forgetting past bugs)
 * or rely on flat vector RAG that retrieves irrelevant text without causal context.
 *
 * VH's Organizational Memory Cortex extracts verified failure-to-repair causal
 * chains from the Flight Recorder, distills empirical invariants, and automatically
 * compiles them into machine-readable briefings (`.si-brief/LEARNED_INVARIANTS.md`)
 * and `AGENTS.md` before subsequent missions execute.
 */

import { globalAgentBus } from "./interAgentChannel";

export interface CausalInvariant {
  id: string;
  category: "architecture" | "concurrency" | "testing" | "security" | "sandbox";
  rule: string;
  originatingMissionId: string;
  failureObserved: string;
  verifiedRepairAction: string;
  timesApplied: number;
  successRate: number; // 0.0 to 1.0
  active: boolean;
}

export interface MemoryCortexReport {
  cortexId: string;
  invariantsCompiled: number;
  activeRules: CausalInvariant[];
  generatedBriefingMarkdown: string;
  agentsMdInjections: string[];
}

/**
 * Starts empty on purpose. A memory that opens with invented run counts is not a
 * memory, and these rules claim missions that never happened. Real invariants
 * are recorded by recordRepairSuccess below.
 */
export const SEED_INVARIANTS: CausalInvariant[] = [];


export class OrganizationalMemoryCortex {
  private invariants: Map<string, CausalInvariant> = new Map();

  constructor(initial: CausalInvariant[] = SEED_INVARIANTS) {
    for (const inv of initial) {
      this.invariants.set(inv.id, inv);
    }
  }

  recordRepairSuccess(
    category: CausalInvariant["category"],
    failureObserved: string,
    verifiedRepairAction: string,
    missionId: string,
    rule: string,
  ): CausalInvariant {
    const id = `inv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const invariant: CausalInvariant = {
      id,
      category,
      rule,
      originatingMissionId: missionId,
      failureObserved,
      verifiedRepairAction,
      timesApplied: 1,
      successRate: 1.0,
      active: true,
    };
    this.invariants.set(id, invariant);

    // Write to blackboard
    globalAgentBus.writeBlackboard(
      `cortex.invariants.${id}`,
      `Rule: ${rule}\nOrigin: ${missionId}\nAction: ${verifiedRepairAction}`,
      "memory_cortex",
      "architecture",
    );

    return invariant;
  }

  compileBriefing(): MemoryCortexReport {
    const active = Array.from(this.invariants.values()).filter((i) => i.active);
    const cortexId = `cortex-${Date.now()}`;

    const lines: string[] = [
      "# ORGANIZATIONAL MEMORY & LEARNED INVARIANTS",
      `<!-- Auto-compiled by VH Memory Cortex for Mission Execution (${new Date().toISOString()}) -->`,
      "",
      "The following architectural invariants were derived from past empirical failures and proven repairs:",
      "",
    ];

    for (const inv of active) {
      lines.push(`### [${inv.category.toUpperCase()}] ${inv.rule}`);
      lines.push(`- **Failure Observed**: ${inv.failureObserved}`);
      lines.push(`- **Proven Repair**: ${inv.verifiedRepairAction}`);
      lines.push(`- **Historical Reliability**: ${(inv.successRate * 100).toFixed(0)}% across ${inv.timesApplied} runs`);
      lines.push("");
    }

    const generatedBriefingMarkdown = lines.join("\n");
    const agentsMdInjections = active.map((i) => `MUST OBEY: ${i.rule}`);

    return {
      cortexId,
      invariantsCompiled: active.length,
      activeRules: active,
      generatedBriefingMarkdown,
      agentsMdInjections,
    };
  }

  getInvariants(): CausalInvariant[] {
    return Array.from(this.invariants.values());
  }
}

export const globalMemoryCortex = new OrganizationalMemoryCortex();
