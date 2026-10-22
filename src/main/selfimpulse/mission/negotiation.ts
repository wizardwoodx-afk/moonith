/**
 * §8 Agent-to-agent negotiation.
 *
 * Agents may propose, accept, reject, challenge, ask for clarification, or offer an
 * alternative. Disagreement is not an error state — it is evidence, and every position is
 * preserved in the mission trace.
 *
 * Resolution order: consensus, then the supervisor decides, then a human. A thread that
 * cannot be resolved stays UNRESOLVED and blocks the task; it is never silently closed.
 */

import { uid } from "../app/id";
import type {
  NegotiationPosition,
  NegotiationPositionKind,
  NegotiationThread,
} from "./types";
import type { FlightRecorder } from "./flightRecorder";

export interface OpenThreadInput {
  missionId: string;
  topic: string;
  taskId?: string | null;
  openedBy: string;
}

export interface PositionInput {
  threadId: string;
  agentId: string;
  agentTitle: string;
  kind: NegotiationPositionKind;
  statement: string;
  evidence?: string[];
  proposal?: string | null;
}

export class NegotiationTable {
  private threads = new Map<string, NegotiationThread>();

  open(input: OpenThreadInput, recorder: FlightRecorder): NegotiationThread {
    const thread: NegotiationThread = {
      threadId: uid("neg"),
      missionId: input.missionId,
      taskId: input.taskId ?? null,
      topic: input.topic,
      positions: [],
      resolution: null,
      decidedBy: null,
      decisionRationale: null,
      openedAt: new Date().toISOString(),
      closedAt: null,
    };
    this.threads.set(thread.threadId, thread);
    recorder.record({
      kind: "NEGOTIATION_OPENED",
      actor: input.openedBy,
      authority: "runtime",
      policy: "negotiation.open",
      reason: `Disagreement or decision required on: ${input.topic}`,
      subjectId: thread.threadId,
      data: { taskId: thread.taskId },
    });
    return thread;
  }

  /**
   * Record a position. A REJECT or CHALLENGE without evidence is refused: an objection you
   * cannot support does not get to block a mission.
   */
  position(input: PositionInput, recorder: FlightRecorder): NegotiationPosition {
    const thread = this.threads.get(input.threadId);
    if (!thread) throw new Error(`unknown negotiation thread ${input.threadId}`);
    if (thread.resolution) throw new Error(`thread ${input.threadId} is already ${thread.resolution}`);
    if ((input.kind === "REJECT" || input.kind === "CHALLENGE") && !(input.evidence?.length)) {
      throw new Error(
        `negotiation: ${input.agentTitle} cannot ${input.kind.toLowerCase()} without evidence. State what you observed.`,
      );
    }
    if (input.kind === "ALTERNATIVE" && !input.proposal) {
      throw new Error(`negotiation: ${input.agentTitle} offered an alternative without stating it.`);
    }
    const pos: NegotiationPosition = {
      positionId: uid("pos"),
      threadId: thread.threadId,
      agentId: input.agentId,
      agentTitle: input.agentTitle,
      kind: input.kind,
      statement: input.statement,
      evidence: input.evidence ?? [],
      proposal: input.proposal ?? null,
      at: new Date().toISOString(),
    };
    thread.positions.push(pos);
    recorder.record({
      kind: "NEGOTIATION_POSITION",
      actor: input.agentTitle,
      authority: `agent:${input.agentId}`,
      policy: "negotiation.position",
      reason: input.statement,
      evidence: pos.evidence,
      subjectId: thread.threadId,
      data: { position: pos.kind, proposal: pos.proposal },
    });
    return pos;
  }

  /** True when every participant who spoke has accepted and nobody has an open objection. */
  consensusReached(threadId: string): { reached: boolean; objectors: string[] } {
    const thread = this.threads.get(threadId);
    if (!thread) return { reached: false, objectors: [] };
    const objectors: string[] = [];
    const lastByAgent = new Map<string, NegotiationPosition>();
    for (const p of thread.positions) lastByAgent.set(p.agentId, p);
    for (const p of lastByAgent.values()) {
      if (p.kind === "REJECT" || p.kind === "CHALLENGE") objectors.push(p.agentTitle);
    }
    const hasAccept = [...lastByAgent.values()].some((p) => p.kind === "ACCEPT");
    return { reached: objectors.length === 0 && hasAccept, objectors };
  }

  resolve(
    threadId: string,
    resolution: "AGREED" | "SUPERVISOR_DECIDED" | "ESCALATED_HUMAN" | "UNRESOLVED",
    decidedBy: string,
    rationale: string,
    recorder: FlightRecorder,
  ): NegotiationThread {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`unknown negotiation thread ${threadId}`);
    thread.resolution = resolution;
    thread.decidedBy = decidedBy;
    thread.decisionRationale = rationale;
    thread.closedAt = new Date().toISOString();
    recorder.record({
      kind: "NEGOTIATION_RESOLVED",
      actor: decidedBy,
      authority: resolution === "ESCALATED_HUMAN" ? "human" : resolution === "SUPERVISOR_DECIDED" ? "supervisor" : "consensus",
      policy: "negotiation.resolve",
      reason: rationale,
      subjectId: thread.threadId,
      data: { resolution, positions: thread.positions.length },
    });
    return thread;
  }

  get(threadId: string): NegotiationThread | null {
    return this.threads.get(threadId) ?? null;
  }

  forMission(missionId: string): NegotiationThread[] {
    return [...this.threads.values()].filter((t) => t.missionId === missionId);
  }

  openThreads(missionId: string): NegotiationThread[] {
    return this.forMission(missionId).filter((t) => !t.resolution);
  }

  hydrate(threads: NegotiationThread[]): void {
    for (const t of threads) this.threads.set(t.threadId, t);
  }

  export(): NegotiationThread[] {
    return [...this.threads.values()];
  }

  /** Render a thread the way the UI shows it. */
  static render(thread: NegotiationThread): string {
    const lines = [`Topic: ${thread.topic}`, `Status: ${thread.resolution ?? "OPEN"}`];
    for (const p of thread.positions) {
      lines.push(`${p.agentTitle} [${p.kind}]: ${p.statement}`);
      if (p.proposal) lines.push(`  proposal: ${p.proposal}`);
      for (const e of p.evidence) lines.push(`  evidence: ${e}`);
    }
    if (thread.decisionRationale) lines.push(`Decision by ${thread.decidedBy}: ${thread.decisionRationale}`);
    return lines.join("\n");
  }
}
