/**
 * §AUTONOMY RUNTIME — the engines join the real execution path (VH 11.9.4-Major+).
 *
 * The 11.9.4(Major) review was right: three tested engines that no production
 * call site consumed are validated prototypes, not features. This module is
 * the missing wiring, mirroring how the older evolution loop is folded in
 * (TeamsPage calls evolveTeamAfterRun after every run):
 *
 *   BEFORE a run  — `prepareAutonomy` asks the bandit router which strategy
 *     arms to search this run and hands them to executeTeam via
 *     `req.autonomy` (review depth and check strictness modulate the actual
 *     briefing text agents read; exec:serial really flattens the wave plan;
 *     webEvidence lets the Researcher briefing carry live web evidence).
 *
 *   AFTER a run   — `settleAutonomyAfterRun` records the measured outcome on
 *     exactly the arms the run executed (echoed back in the report), folds a
 *     ScaleSignal from the seat records, and lets the elastic policy act —
 *     AUTONOMOUS teams get the added seat applied to the team, SUGGEST teams
 *     get the decision logged as a suggestion, OFF teams get telemetry only.
 *     Simulated runs remain experience-only (bandit rule), and the whole
 *     settlement lands in the shared autonomyStore so the Evolution page and
 *     the next run read the same state.
 */
import { uid } from "../app/id";
import type { CliAgentTeam, TeamSeat } from "./agentTeam";
import { loadAutonomy, saveAutonomy, type AutonomyLogEntry } from "./autonomyStore";
import { planElasticScale, type ElasticPolicy, type ScaleAction, type ScaleSignal } from "./elasticSeats";
import { recordOutcome, selectArms, type ArmId, type BanditState } from "./evolutionBandit";
import { currentEdition, proUnlocked } from "./licensing";
import type { TeamEvolveMode } from "./teamEvolution";

/** What executeTeam accepts on the request (declared here to avoid an import cycle). */
export interface AutonomyRequest {
  arms: ArmId[];
  webEvidence: boolean;
}

/** The narrow shape settle needs — TeamRunReport satisfies it structurally. */
export interface AutonomyRunSummary {
  status: string;
  /**
   * 11.10.1 — `harness` is optional per seat; when present, the proof receipt embeds a
   * deterministic seat identity digest (sha256 of seatId|role|harness) so the evidence
   * names which agent harness sat in which role.
   */
  seats: Array<{ seatId: string; role: string; outcome: string; verified: boolean; harness?: string }>;
  /** The arms executeTeam actually executed (echoed from the report). */
  autonomyArms?: ArmId[];
  /** True when a review snapshot was built — writers' work was actually reviewed. */
  reviewedBySnapshot?: boolean;
  /**
   * 11.9.9 — the adversarial verification gate's verdict for this run, when one was
   * evaluated. Optional: pre-11.9.9 call sites (and older probes) settle without it, and
   * receipts then simply carry no gate event.
   */
  gateStatus?: "PASS" | "FAIL" | "BLOCKED" | "n/a";
  gateTier?: string;
  /**
   * 11.10 — the review snapshot sha the gate verdict stands on (null when there was no
   * snapshot). Makes the receipt say "verified against snapshot <sha>", not just
   * "verified".
   */
  gateSnapshotSha?: string | null;
  /**
   * 11.14.8 — the governance-arena preflight stamp from the run report, when the
   * run was admitted through the arena. Optional: pre-11.14.8 summaries carry no
   * arena event, keeping older receipt shapes byte-stable.
   */
  arenaGate?: { gate: "PASS" | "REFUSED"; digest: string; summary: string; total: number; defended: number; breached: number } | null;
}

export interface SettleResult {
  arms: ArmId[];
  verified: boolean;
  simulated: boolean;
  action: ScaleAction;
  applied: boolean;
  suggestion: string | null;
  updatedTeam: CliAgentTeam | null;
  bandit: BanditState;
  elastic: ElasticPolicy;
  /** The edition that governed this settlement (Commercial gating). */
  license: "personal" | "trial" | "pro";
}

const REVIEW_ROLES = new Set(["reviewer", "tester", "security"]);
const FAILED_OUTCOMES = new Set(["failed", "timeout"]);

export function prepareAutonomy(): AutonomyRequest {
  const state = loadAutonomy();
  return { arms: selectArms(state.bandit), webEvidence: true };
}

/**
 * Harness choice for auto-added seats (11.9.4-Redesign review fix): inherit a
 * harness the team ALREADY runs instead of defaulting to one binary. A
 * reviewer inherits from the team's read-only seats, a debugger from its
 * writers; "llm" (direct provider call, zero binaries) is the guaranteed
 * fallback, so an elastic seat can never depend on a CLI the user lacks.
 */
function inheritHarness(team: CliAgentTeam, role: "reviewer" | "debugger"): TeamSeat["harness"] {
  const pool = role === "reviewer" ? team.seats.filter((x) => !x.mayWrite) : team.seats.filter((x) => x.mayWrite);
  return pool[0]?.harness ?? team.seats[0]?.harness ?? "llm";
}

function newSeat(team: CliAgentTeam, role: "reviewer" | "debugger", reason: string): TeamSeat {
  return {
    id: uid("seat"),
    role,
    harness: inheritHarness(team, role),
    model: null,
    mayWrite: false,
    timeoutSecs: 600,
    maxTurns: null,
    instructions:
      role === "reviewer"
        ? `Added by elastic seats: ${reason}. Diff-only review — block on correctness, nits last and labelled.`
        : `Added by elastic seats: ${reason}. Reproduce, isolate, fix, and prove with a re-run of the failing case.`,
  };
}

export function settleAutonomyAfterRun(args: {
  team: CliAgentTeam;
  report: AutonomyRunSummary;
  mode: TeamEvolveMode;
  simulated: boolean;
}): SettleResult {
  const { team, report, simulated } = args;
  const state = loadAutonomy();

  /* Commercial gating (declared, narrow, honest): AUTONOMOUS application and
     elastic caps above 5 seats are Pro; everything else stays free forever. */
  const pro = proUnlocked();
  let mode = args.mode;
  let proNote = "";
  if (mode === "AUTONOMOUS" && !pro) {
    mode = "SUGGEST";
    proNote = " [PRO] AUTONOMOUS runs require a Pro license — recorded as a suggestion instead.";
  }
  const elasticPolicy: ElasticPolicy = pro
    ? state.elastic
    : { ...state.elastic, maxSeats: Math.min(state.elastic.maxSeats, 5) };

  const arms = (report.autonomyArms ?? []) as ArmId[];
  const verified = report.status === "completed" && report.seats.some((s) => s.verified);

  // Bandit: only the arms the run actually executed, measured runs only.
  const bandit = arms.length > 0 ? recordOutcome(state.bandit, arms, verified, simulated) : state.bandit;

  // Elastic: fold the seat records into a measured signal.
  const writers = report.seats.filter((s) => !REVIEW_ROLES.has(s.role));
  const reviewers = report.seats.filter((s) => REVIEW_ROLES.has(s.role));
  const failed = report.seats.filter((s) => FAILED_OUTCOMES.has(s.outcome)).map((s) => s.seatId);
  const committedWriters = writers.filter((s) => s.outcome === "completed").length;
  const unreviewedArtifacts = report.reviewedBySnapshot ? 0 : reviewers.length === 0 ? committedWriters : 0;
  const idle = report.seats.every((s) => s.outcome.startsWith("skipped") || s.outcome.startsWith("blocked"));
  const idleRuns = idle ? state.idleRuns + 1 : 0;
  const recentFailed = failed.length > 0 ? [...state.recentFailed, ...failed].slice(-4) : verified ? [] : state.recentFailed;

  const teamSeats = team.seats;
  const signal: ScaleSignal = {
    currentSeats: teamSeats.length,
    writerSeats: Math.max(1, teamSeats.filter((s) => s.mayWrite).length),
    reviewerSeats: teamSeats.filter((s) => REVIEW_ROLES.has(s.role)).length,
    debuggerSeats: teamSeats.filter((s) => s.role === "debugger").length,
    pendingTasks: 0,
    unreviewedArtifacts,
    failedSeats: recentFailed,
    praisedSeats: [],
    idleRuns,
  };
  const action = planElasticScale(signal, elasticPolicy);

  let applied = false;
  let suggestion: string | null = null;
  let updatedTeam: CliAgentTeam | null = null;
  if (action.kind === "add-reviewer" || action.kind === "add-debugger") {
    const seat = newSeat(team, action.kind === "add-reviewer" ? "reviewer" : "debugger", action.reason);
    if (mode === "AUTONOMOUS") {
      updatedTeam = { ...team, seats: [...team.seats, seat], updatedAt: new Date().toISOString() };
      applied = true;
    } else if (mode === "SUGGEST") {
      suggestion = `${action.kind}: ${action.reason}${proNote}`;
    }
  } else if (action.kind === "scale-in" && mode === "AUTONOMOUS") {
    // Removing a seat the user composed is a human decision; log it as a suggestion even in AUTONOMOUS.
    suggestion = `scale-in: ${action.reason}`;
  }

  const entry: AutonomyLogEntry = {
    ts: new Date().toISOString(),
    teamId: team.id,
    arms,
    verified,
    simulated,
    action,
    applied,
  };
  saveAutonomy({ bandit, elastic: state.elastic, log: [...state.log.slice(-19), entry], idleRuns, recentFailed });

  return { arms, verified, simulated, action, applied, suggestion, updatedTeam, bandit, elastic: elasticPolicy, license: currentEdition() };
}
