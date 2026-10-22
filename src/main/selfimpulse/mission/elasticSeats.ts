/**
 * §ELASTIC SEATS — teams that scale to the work, under a cap (VH 11.9.4-Major).
 *
 * The 2026 orchestration consensus (Deloitte TMT predictions, orchestration
 * guides) is "human-on-the-loop": the platform scales and routes, the human
 * keeps the telemetry and the veto. VH's teams were fixed at composition
 * time — a run that produced six writer artifacts for zero reviewers still
 * shipped with zero reviewers. Elastic seats lets the runtime propose (and,
 * when the team's evolve mode allows, perform) seat scaling with the same
 * honesty rules the evolution loop obeys:
 *
 *   1. Every decision is a pure function of measured signals — pending tasks,
 *      unreviewed artifacts, failed seats, idle runs. No vibes.
 *   2. Caps are hard: `maxSeats` is never exceeded, `minSeats` never undercut.
 *   3. A seat a human praised (rating ≥4 in the evolution loop) is never
 *      scaled in on — praise suppresses change there too.
 *   4. The planner returns ONE action per call (add-debugger beats
 *      add-reviewer beats scale-in beats hold) so a caller can log the exact
 *      reason; nothing mutates the team behind anyone's back.
 */

export interface ElasticPolicy {
  enabled: boolean;
  minSeats: number;
  maxSeats: number;
  /** Add a reviewer when unreviewed artifacts reach this ratio of writer seats. */
  unreviewedRatio: number;
  /** Consecutive failed seats that summon a debugger. */
  failStreak: number;
  /** Consecutive idle runs before a scale-in is proposed. */
  scaleInIdleRuns: number;
}

export const DEFAULT_ELASTIC_POLICY: ElasticPolicy = {
  enabled: false,
  minSeats: 2,
  maxSeats: 9,
  unreviewedRatio: 1,
  failStreak: 2,
  scaleInIdleRuns: 3,
};

export interface ScaleSignal {
  currentSeats: number;
  writerSeats: number;
  reviewerSeats: number;
  debuggerSeats: number;
  pendingTasks: number;
  unreviewedArtifacts: number;
  /** seat ids that failed in the trailing window (most recent last). */
  failedSeats: string[];
  /** seat ids a human rated ≥4 — never touch these. */
  praisedSeats: string[];
  idleRuns: number;
}

export type ScaleAction =
  | { kind: "add-reviewer"; reason: string }
  | { kind: "add-debugger"; reason: string }
  | { kind: "scale-in"; reason: string }
  | { kind: "hold"; reason: string };

/** One measured decision. Pure — the same signals always give the same action. */
export function planElasticScale(s: ScaleSignal, p: ElasticPolicy = DEFAULT_ELASTIC_POLICY): ScaleAction {
  if (!p.enabled) return { kind: "hold", reason: "elastic seats disabled" };

  if (s.currentSeats >= p.maxSeats) {
    return { kind: "hold", reason: `at maxSeats (${p.maxSeats}) — cap is hard` };
  }

  const failWindow = s.failedSeats.slice(-p.failStreak);
  if (failWindow.length >= p.failStreak) {
    if (s.debuggerSeats === 0) {
      return {
        kind: "add-debugger",
        reason: `${failWindow.length} consecutive failed seats (${failWindow.join(", ")}) with no debugger on the team`,
      };
    }
  }

  const reviewPressure = s.unreviewedArtifacts >= Math.max(1, s.writerSeats) * p.unreviewedRatio;
  if (reviewPressure && s.unreviewedArtifacts > 0) {
    return {
      kind: "add-reviewer",
      reason: `${s.unreviewedArtifacts} unreviewed artifact(s) against ${s.writerSeats} writer seat(s) — reviewers are the bottleneck`,
    };
  }

  if (s.pendingTasks === 0 && s.unreviewedArtifacts === 0 && s.idleRuns >= p.scaleInIdleRuns) {
    if (s.currentSeats > p.minSeats) {
      const spare = s.currentSeats - p.minSeats;
      return {
        kind: "scale-in",
        reason: `${s.idleRuns} idle run(s) and nothing queued — release ${Math.min(1, spare)} seat(s), keep ≥ minSeats (${p.minSeats}), praised seats untouched`,
      };
    }
    return { kind: "hold", reason: "idle but already at minSeats" };
  }

  return { kind: "hold", reason: "signals within band — no scaling needed" };
}

/** The event the runtime records when it acts on a decision (flight-recorder shape). */
export function scaleEvent(action: ScaleAction, teamId: string): { kind: string; teamId: string; action: ScaleAction; ts: string } {
  return { kind: "SEAT_SCALED", teamId, action, ts: new Date().toISOString() };
}
