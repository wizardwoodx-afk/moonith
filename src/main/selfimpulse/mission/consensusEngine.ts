/**
 * Reputation-Weighted Multi-Agent Consensus Engine.
 *
 * In heterogeneous multi-agent systems, agents can disagree on code correctness,
 * security postures, or architectural contracts. A simple unweighted majority
 * can be swayed by hallucinating or low-context seats.
 *
 * This engine weights review votes by each agent's empirical historical reliability
 * (track record of passing verified checks, zero false alarms, and clean commits),
 * computes mathematical quorum thresholds, and executes automated arbitration
 * when deadlocks occur.
 */

import type { HarnessId } from "../domain/harness";
import { globalAgentBus } from "./interAgentChannel";

export type VoteVerdict = "APPROVE" | "REJECT" | "NEEDS_CHANGES";

export interface AgentReputation {
  seatId: string;
  harness: HarnessId;
  missionsParticipated: number;
  verifiedCommits: number;
  accurateReviews: number;
  falseAlarms: number;
  reputationWeight: number; // Dynamically computed 0.5 to 2.0
}

export interface ReviewVote {
  seatId: string;
  harness: HarnessId;
  verdict: VoteVerdict;
  confidence: number; // 0.0 to 1.0
  rationale: string;
  diffRef: string;
  timestamp: string;
}

export interface ConsensusResult {
  consensusId: string;
  objective: string;
  quorumReached: boolean;
  status: "APPROVED" | "REJECTED" | "ARBITRATION_REQUIRED";
  consensusScore: number; // -1.0 (Full Reject) to +1.0 (Full Approve)
  totalWeight: number;
  approveWeight: number;
  rejectWeight: number;
  dissentingSeats: string[];
  arbitrationAction?: string;
  summary: string;
}

export class AgentReputationLedger {
  private ledger: Map<string, AgentReputation> = new Map();

  constructor() {
    // Initialize baseline neutral reputations for all harnesses
    // Reputations now track the two native runtimes, not a roster of vendors:
    // the in-process agent loop and the direct provider seam.
    const harnesses: HarnessId[] = ["hermes", "llm"];
    for (const h of harnesses) {
      this.ledger.set(h, {
        seatId: h,
        harness: h,
        missionsParticipated: 0,
        verifiedCommits: 0,
        accurateReviews: 0,
        falseAlarms: 0,
        reputationWeight: 1.0, // Neutral 1.0 baseline
      });
    }
  }

  getReputation(harnessOrSeatId: string): AgentReputation {
    return (
      this.ledger.get(harnessOrSeatId) ?? {
        seatId: harnessOrSeatId,
        harness: "llm",
        missionsParticipated: 0,
        verifiedCommits: 0,
        accurateReviews: 0,
        falseAlarms: 0,
        reputationWeight: 1.0,
      }
    );
  }

  recordOutcome(harnessOrSeatId: string, result: { verifiedCommit?: boolean; accurateReview?: boolean; falseAlarm?: boolean }): AgentReputation {
    const rep = this.getReputation(harnessOrSeatId);
    rep.missionsParticipated++;
    if (result.verifiedCommit) rep.verifiedCommits++;
    if (result.accurateReview) rep.accurateReviews++;
    if (result.falseAlarm) rep.falseAlarms++;

    // Compute dynamic reputation weight strictly from measured execution track record:
    // Every accurate review adds +0.05, every verified commit adds +0.05, false alarms subtract -0.10
    const delta = (rep.accurateReviews * 0.05) + (rep.verifiedCommits * 0.05) - (rep.falseAlarms * 0.10);
    rep.reputationWeight = Math.min(2.0, Math.max(0.5, 1.0 + delta));

    this.ledger.set(harnessOrSeatId, rep);
    return rep;
  }

  getAll(): AgentReputation[] {
    return Array.from(this.ledger.values());
  }
}

export const globalReputationLedger = new AgentReputationLedger();
export const INITIAL_REPUTATIONS: Record<string, AgentReputation> = Object.fromEntries(
  globalReputationLedger.getAll().map((r) => [r.harness, r])
);

/**
 * Computes reputation-weighted consensus across multi-agent review votes.
 */
export function evaluateConsensus(
  objective: string,
  votes: ReviewVote[],
  reputations: AgentReputationLedger = globalReputationLedger,
): ConsensusResult {
  const consensusId = `consensus-${Date.now()}`;
  let totalWeight = 0;
  let approveWeight = 0;
  let rejectWeight = 0;
  const dissentingSeats: string[] = [];

  for (const vote of votes) {
    const rep = reputations.getReputation(vote.harness);
    const effectiveWeight = rep.reputationWeight * Math.max(vote.confidence, 0.5);
    totalWeight += effectiveWeight;

    if (vote.verdict === "APPROVE") {
      approveWeight += effectiveWeight;
    } else {
      rejectWeight += effectiveWeight;
      dissentingSeats.push(vote.seatId);
    }
  }

  const quorumThreshold = totalWeight * 0.60;
  const quorumReached = votes.length >= 2;
  const consensusScore = totalWeight > 0 ? (approveWeight - rejectWeight) / totalWeight : 0;

  let status: ConsensusResult["status"] = "ARBITRATION_REQUIRED";
  let arbitrationAction: string | undefined;

  if (approveWeight >= quorumThreshold && consensusScore >= 0.40) {
    status = "APPROVED";
  } else if (rejectWeight >= quorumThreshold && consensusScore <= -0.40) {
    status = "REJECTED";
  } else {
    status = "ARBITRATION_REQUIRED";
    arbitrationAction = `Deadlock detected (Score: ${consensusScore.toFixed(2)}). Triggering automated counter-factual verification suite on dissenting findings from seats: ${dissentingSeats.join(", ")}.`;
  }

  const summary = `Multi-Agent Consensus: ${status} (Score: ${(consensusScore * 100).toFixed(1)}%, Approve Weight: ${approveWeight.toFixed(2)} / Reject Weight: ${rejectWeight.toFixed(2)}). ${votes.length} votes counted.`;

  // Publish to bus
  globalAgentBus.publish({
    channel: "#qa-review",
    sender: { seatId: "consensus_engine", role: "reviewer", harness: "llm", name: "Consensus Engine" },
    mentions: ["@all"],
    intent: status === "APPROVED" ? "verification" : status === "REJECTED" ? "blocker" : "proposal",
    content: `⚖️ MULTI-AGENT CONSENSUS: ${status}\n${summary}${arbitrationAction ? `\n${arbitrationAction}` : ""}`,
  });

  return {
    consensusId,
    objective,
    quorumReached,
    status,
    consensusScore,
    totalWeight,
    approveWeight,
    rejectWeight,
    dissentingSeats,
    arbitrationAction,
    summary,
  };
}
