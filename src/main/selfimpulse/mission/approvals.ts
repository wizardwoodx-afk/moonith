/**
 * §11 Human approval gates.
 *
 * Approval is a first-class execution state, not a log line. When a gate opens, the mission
 * enters BLOCKED and stays there until a human decides. Every request carries the seven
 * fields the spec requires: what, why, who, what changes, risk, evidence, expected outcome.
 */

import { uid } from "../app/id";
import type {
  ApprovalDecision,
  ApprovalRequest,
  AutonomyMode,
  Mission,
  RiskClass,
} from "./types";
import { classifyRisk, requiresHuman } from "./riskPolicy";
import { recorderFor, type FlightRecorder } from "./flightRecorder";

export interface ApprovalGateInput {
  mission: Mission;
  requestedBy: string;
  agentId?: string | null;
  action: string;
  toolName?: string;
  changes?: string[];
  evidence?: string[];
  expectedOutcome?: string;
  reversible?: boolean;
  /** Override the derived risk class only with an explicit reason. */
  riskOverride?: { risk: RiskClass; reason: string };
}

export interface GateDecision {
  /** True when the action may proceed without a human. */
  autonomous: boolean;
  /** Present when a human must decide. */
  request: ApprovalRequest | null;
  risk: RiskClass;
  why: string;
}

export class ApprovalGateService {
  private requests = new Map<string, ApprovalRequest>();
  private waiters = new Map<string, Array<(d: ApprovalDecision) => void>>();

  list(): ApprovalRequest[] {
    return [...this.requests.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  pending(): ApprovalRequest[] {
    return this.list().filter((r) => r.status === "PENDING");
  }

  get(id: string): ApprovalRequest | null {
    return this.requests.get(id) ?? null;
  }

  forMission(missionId: string): ApprovalRequest[] {
    return this.list().filter((r) => r.missionId === missionId);
  }

  pendingForMission(missionId: string): ApprovalRequest[] {
    return this.forMission(missionId).filter((r) => r.status === "PENDING");
  }

  /**
   * Decide the risk class and whether a human is needed. The risk class is derived from the
   * action by `classifyRisk`; an override must justify itself and can only ever be recorded,
   * never applied silently.
   */
  evaluate(input: ApprovalGateInput): GateDecision {
    const derived = classifyRisk(input.action, input.toolName);
    let risk = derived.risk;
    let why = derived.why;
    if (input.riskOverride) {
      // An override may raise the class, never lower it below the derived one.
      const order: RiskClass[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
      if (order.indexOf(input.riskOverride.risk) > order.indexOf(derived.risk)) {
        risk = input.riskOverride.risk;
        why = `${input.riskOverride.reason} (derived: ${derived.why})`;
      } else {
        why = `${derived.why} (requested downgrade to ${input.riskOverride.risk} refused: overrides may only raise risk)`;
      }
    }

    const autonomy: AutonomyMode = input.mission.riskPolicy.autonomy;
    const needsHuman = requiresHuman(risk, input.mission.riskPolicy.approvalThreshold, autonomy);

    if (!needsHuman) {
      return { autonomous: true, request: null, risk, why };
    }

    const request: ApprovalRequest = {
      id: uid("apr"),
      missionId: input.mission.missionId,
      requestedBy: input.requestedBy,
      agentId: input.agentId ?? null,
      action: input.action,
      risk,
      summary: input.action,
      justification: why,
      changes: input.changes ?? [],
      evidence: input.evidence ?? [],
      expectedOutcome: input.expectedOutcome ?? "No stated expected outcome.",
      reversible: input.reversible ?? true,
      status: "PENDING",
      decidedBy: null,
      reason: null,
      createdAt: new Date().toISOString(),
      decidedAt: null,
    };
    this.requests.set(request.id, request);
    return { autonomous: false, request, risk, why };
  }

  /** Open a gate and record it in the flight recorder. */
  open(input: ApprovalGateInput, recorder: FlightRecorder): GateDecision {
    const decision = this.evaluate(input);
    if (decision.request) {
      recorder.record({
        kind: "APPROVAL_REQUIRED",
        actor: input.requestedBy,
        authority: "policy:risk-gate",
        policy: `autonomy=${input.mission.riskPolicy.autonomy};threshold=${input.mission.riskPolicy.approvalThreshold}`,
        reason: decision.why,
        evidence: decision.request.evidence,
        subjectId: decision.request.id,
        data: {
          risk: decision.risk,
          action: input.action,
          changes: decision.request.changes,
          expectedOutcome: decision.request.expectedOutcome,
          reversible: decision.request.reversible,
        },
      });
    }
    return decision;
  }

  decide(id: string, decision: "APPROVED" | "REJECTED", decidedBy: string, reason: string, recorder?: FlightRecorder): ApprovalRequest {
    const req = this.requests.get(id);
    if (!req) throw new Error(`unknown approval ${id}`);
    if (req.status !== "PENDING") throw new Error(`approval ${id} is already ${req.status}`);
    req.status = decision;
    req.decidedBy = decidedBy;
    req.reason = reason;
    req.decidedAt = new Date().toISOString();
    // The decision must reach the mission's flight recorder whoever clicked the button. Without
    // this a UI-initiated approval left no trace and "resumed after approval" was unverifiable.
    const rec = recorder ?? recorderFor(req.missionId);
    rec.record({
      kind: decision === "APPROVED" ? "APPROVAL_GRANTED" : "APPROVAL_REJECTED",
      actor: decidedBy,
      authority: "human",
      policy: "approval.gate",
      reason,
      evidence: req.evidence,
      subjectId: req.id,
      data: { risk: req.risk, action: req.action },
    });
    const waiting = this.waiters.get(id);
    if (waiting) {
      this.waiters.delete(id);
      for (const fn of waiting) fn(decision);
    }
    return req;
  }

  /**
   * Block until a human decides. Returns TIMED_OUT rather than defaulting to approval —
   * silence is never consent.
   */
  waitFor(id: string, timeoutMs: number, isCancelled: () => boolean = () => false): Promise<ApprovalDecision> {
    const existing = this.requests.get(id);
    if (!existing) return Promise.resolve("TIMED_OUT");
    if (existing.status !== "PENDING") return Promise.resolve(existing.status);
    return new Promise((resolve) => {
      const list = this.waiters.get(id) ?? [];
      list.push(resolve);
      this.waiters.set(id, list);
      const started = Date.now();
      const tick = setInterval(() => {
        const req = this.requests.get(id);
        if (!req || req.status !== "PENDING") {
          clearInterval(tick);
          resolve(req?.status ?? "TIMED_OUT");
          return;
        }
        if (isCancelled()) {
          clearInterval(tick);
          resolve("TIMED_OUT");
        } else if (Date.now() - started > timeoutMs) {
          clearInterval(tick);
          req.status = "TIMED_OUT";
          req.decidedAt = new Date().toISOString();
          req.reason = `No decision within ${Math.round(timeoutMs / 1000)}s. Timed out rather than auto-approved.`;
          resolve("TIMED_OUT");
        }
      }, 150);
    });
  }

  /** Restore from persisted state (pause/resume, §25). */
  hydrate(requests: ApprovalRequest[]): void {
    for (const r of requests) this.requests.set(r.id, r);
  }

  export(): ApprovalRequest[] {
    return this.list();
  }
}
