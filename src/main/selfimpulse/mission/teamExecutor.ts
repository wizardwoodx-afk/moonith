/**
 * TEAM EXECUTOR — the part that actually runs.
 *
 * Everything else is planning: which seat does what, which flags to pass, which worktree to work in,
 * what the budget is. This module is where a real child process is spawned, real bytes come back, real
 * dollars are charged and real evidence is collected.
 *
 * THE THREE RULES THIS MODULE IS BUILT AROUND
 *
 * 1. NOTHING IS INFERRED THAT COULD BE MEASURED.
 *    Did the agent succeed? Run the repository's own check and look at the exit code. Did it change
 *    anything? Ask git. How much did it cost? Read the number out of the CLI's own output. When a
 *    measurement is not available, VH says "not measured" — it never substitutes an assumption.
 *
 * 2. CONTINUITY IS REAL OR IT IS DECLARED ABSENT.
 *    Each seat keeps a session. Turn 1 creates it, later turns resume it, and the id is captured from
 *    the CLI's own output rather than assumed.
 *
 * 3. A SEAT THAT COULD NOT RUN IS NOT A SEAT THAT PASSED.
 *    Missing binary, refused by the budget, killed by the deadline, nothing to review, or a check that
 *    never ran — each is a distinct outcome with its own reason, and each propagates into the merge
 *    plan. An unverified branch does not merge.
 *
 * THE REVIEW-VISIBILITY INVARIANT
 *
 * A read-only seat never runs against the base checkout while writers have uncommitted or unmerged
 * work. Before any read-only seat runs, VH builds a REVIEW SNAPSHOT — the base plus every writer
 * branch merged — and points the read-only worktrees at that. So a reviewer sees the work it was asked
 * to review, and the base branch stays pristine until a human decides to merge.
 */

import { mainStorage } from "../persist/mainStorage";
import * as path from "node:path";

import type { HarnessId } from "../domain/harness";
import type { AutonomyRequest } from "./autonomyRuntime";
import type { ArmId } from "./evolutionBandit";
import { searchWeb, toTriples } from "./webSearch";
import { runGovernanceArena, type ArenaGateReport } from "./arenaGate";
import { resolveCaps } from "./agentCapabilities";
import { composeSeatArgv, type CliAgentTeam, type TeamSeat } from "./agentTeam";
import { gitApi, type GitRunner } from "./git";
import { parseReportedUsage, type CapLedger, type ReportedUsage, withDeadline } from "./caps";
import {
  briefingContents,
  planWorktrees,
  reviewSnapshotArgv,
  reviewWorktreeArgv,
  snapshotPreflightArgv,
  teardownArgv,
  writeContextFiles,
  type ContextFile,
  type WorktreePlan,
} from "./collaboration";
import { planMerge, type MergeCandidate } from "./mergePlan";
import { enforceMergeGate, gateForTeamReport, loadGatePolicy, type GatePolicy, type GateVerdict, type MergeGateResult } from "./verifyGate";
import { detectResumeFailure, followUpPrompt, parseSessionId, SessionStore, type SessionKey } from "./sessions";
import { globalAgentBus } from "./interAgentChannel";
import { globalMemoryCortex } from "./organizationalMemory";
import { briefingArtifactForMission, type RunAssignment } from "./selfEvolveRuntime";
import { strategyWaveShape, evidenceDepth, reviewBriefingLines, type StrategyParams } from "./selfImprove";
import { verifyActionPacket, packetAllowsExecution, type ActionPacket } from "./actionPacket";
import { attenuate, BudgetGate, budgetCheck, checkEnvelope, type AuthorityEnvelope, type BudgetTicket } from "./custody";
import { recordSeatRun as finopsRecordSeatRun } from "../engine/finops";
import { checkpoint as durableCheckpoint } from "./runCheckpoints";
import { scrubAuditText } from "../security/auditScrub";
import { createDispatchLanes, isLaneRefusal, laneForSeat, SEAT_LANE_CONCURRENCY } from "./dispatchLanes";
import { globalReputationLedger } from "./consensusEngine";
import { markUntrusted, UNTRUSTED_CONTENT_RULE } from "../security/untrustedContent";

/* ------------------------------------------------------------------ injected capabilities */

export interface CliResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Wall-clock ms the child actually ran, as measured by whoever spawned it. */
  durationMs: number;
  /** True when the runner killed the child for exceeding its timeout. */
  timedOut: boolean;
}

export interface TeamRunnerDeps {
  /**
   * Run a seat IN-PROCESS on the owner's own provider key. This is the only
   * path to real execution. There is no other path: the product has no external execution tier.
   *
   * Added in 19.7.15. Previously every seat — including the native runtimes —
   * went out through `cliInvoke`, which composed a seat into argv and spawned a
   * binary. With the CLI tier deleted, that path refuses in words, so seats
   * would have silently stopped running. Routing the native seats here is what
   * keeps the product a working multi-agent platform rather than a removal note.
   *
   * `prompt` is the composed turn text; `readOnly` is the authority envelope the
   * Governor already derived. The implementation must honour it.
   */
  nativeInvoke?: (req: {
    harness: HarnessId;
    prompt: string;
    cwd: string;
    readOnly: boolean;
    mayWriteFiles: boolean;
    mayRunShell: boolean;
    model: string | null;
    timeoutSecs: number;
  }) => Promise<CliResult>;

  /**
   * NOT PART OF THE PRODUCT. No external execution path exists: no binary is
   * spawned, no argv is composed, and nothing that could do either is shipped.
   * A seat that somehow reaches this dep is refused in words with
   * exit 127; it is not silently rerouted, because a caller that still thinks
   * it is spawning a process must fail loudly rather than run something else.
   */
  cliInvoke: (req: { bin: string; argv: string[]; env?: Record<string, string>; cwd: string; timeoutSecs: number }) => Promise<CliResult>;
  /**
   * Resolve a harness's bin name to an absolute executable path, or null when it is not installed.
   *
   * Used for pre-flight so VH can say up front which seats cannot run, instead of spending three
   * invocations to discover that the reviewer's CLI does not exist.
   */
  resolveBin: (bin: string) => Promise<string | null>;
  /** Run git. Optional: without it VH reports that it could not inspect the repository. */
  git?: GitRunner;
  /** Write a file. Optional: without it VH reports the briefing it could not write. */
  writeFile?: (absPath: string, contents: string) => Promise<void>;
  /** The repository's own verification command, run in the seat's working directory. */
  verify?: (cwd: string) => Promise<CliResult>;
  /** Per-turn callback, for live UI updates. */
  onTurn?: (rec: SeatRecord) => void;
  now?: () => number;
  /**
   * 11.14.8 — the governance-arena preflight runner. Defaults to runGovernanceArena;
   * tests inject a battery that reports REFUSED to prove the admission refusal path.
   */
  arenaRunner?: (now: number) => Promise<ArenaGateReport>;
}

/* ------------------------------------------------------------------ the plan the executor runs */

export interface SeatAssignment {
  seat: TeamSeat;
  prompt: string;
  /** Which wave this seat runs in. Lower runs first. */
  wave: number;
  readOnly: boolean;
  /** Branches this seat's work depends on; drives merge order. */
  dependsOn?: string[];
  /** A follow-up turn to run after the first, e.g. a repair pass. */
  followUp?: string;
}

export interface TeamRunRequest {
  team: CliAgentTeam;
  assignments: SeatAssignment[];
  repoRoot: string;
  baseBranch: string;
  missionSlug: string;
  objective: string;
  /**
   * Per-seat step ledger for THIS mission.
   *
   * Omitted: a fresh, empty ledger — which is exactly the old behaviour, because
   * nothing has been applied yet. Supply one that survives the process (the
   * default shared-storage-backed ledger does) and a re-run resumes instead of
   * re-applying: a step an earlier run settled is read BEFORE dispatch and is
   * not dispatched again. See `SeatStepLedger`.
   */
  steps?: SeatStepLedger;
  constraints?: string[];
  doNotTouch?: string[];
  /** The repository's own test command, e.g. ["npm","test"]. */
  testCommand?: string[];
  ledger: CapLedger;
  /** Refuse to start at all if this many seats cannot run. Prevents a half-empty team looking like a result. */
  minimumRunnableSeats?: number;
  /**
   * OPEN-14 — leave the run's worktrees and branches in place. DEFAULT FALSE: the
   * product path tears everything down, because a leftover `vh/<mission>/<seat>`
   * branch makes the next delegation to the same teammate fail on
   * `git worktree add -b`.
   *
   * True is for the two callers that genuinely need the tree afterwards — a
   * resuming mission whose step ledger says the seat's commit is already on its
   * branch, and a probe that inspects a worktree from the outside. It is stated on
   * the run report, because "kept" is the state that breaks the next run.
   */
  keepWorktrees?: boolean;
  /** 11.9.4(Major+): the autonomy engines' plan for this run (bandit arms + web evidence). */
  autonomy?: AutonomyRequest;
  /** 11.10 — which adversarial-gate policy governs this run (default: the stored one, STRICT). */
  gatePolicy?: GatePolicy;
  /**
   * 11.11.1 — the strategy version this run MUST execute (experiment assignment).
   * The executor applies its parameters for real (wave shape, review depth,
   * evidence depth, lesson budget) and the report records the id so settlement
   * can attribute the run's measured outcomes to the strategy that produced them.
   */
  strategy?: RunAssignment | null;
  /** 11.12 MOSAIC — signed pre-action packet; 11.12.1: verified cryptographically before permission. */
  actionPacket?: ActionPacket | null;
  /** 11.12.2 — the runner's root authority envelope (human principal, expiring). */
  rootEnvelope?: AuthorityEnvelope | null;
}

/* ------------------------------------------------------------------ records */

export type SeatOutcome =
  | "completed"
  | "failed"
  | "blocked_missing_binary"
  | "blocked_budget"
  | "timeout"
  | "skipped_wave_failed"
  | "skipped_budget"
  | "skipped_nothing_to_review"
  | "review_snapshot_failed"
  | "resume_failed";

export interface GitEvidence {
  /** False when git could not be run at all — which is not the same as "no changes". */
  measured: boolean;
  detail: string;
  additions: number;
  deletions: number;
  filesChanged: number;
}

export interface SeatRecord {
  seatId: string;
  role: string;
  harness: HarnessId;
  harnessName: string;
  bin: string;
  argv: string[];
  cwd: string;
  branch: string;
  worktreePath: string;
  /**
   * What this seat actually looked at. For a read-only seat this is the review snapshot, which is the
   * whole point: it says, in the record, that the reviewer saw the writers' work and not the base.
   */
  reviewedRef: string;
  /** The snapshot commit, so a review can be reproduced exactly later. */
  reviewedSha: string | null;
  wave: number;
  turnsRun: number;
  sessionId: string | null;
  continuity: "session" | "none";
  outcome: SeatOutcome;
  /** Plain-language reason. Never empty when the outcome is not "completed". */
  reason: string;
  exitCode: number | null;
  durationMs: number;
  usage: ReportedUsage;
  chargedUsd: number;
  /** True only when the repo's own check ran AND exited 0. */
  verified: boolean;
  /** Why verification is what it is. "not measured" is a real value here. */
  verificationDetail: string;
  git: GitEvidence;
  /** What VH did with the seat's work on its branch. */
  commit: string;
  warnings: string[];
  /** Claims the agent made about itself, kept separate from measured facts. */
  selfReport: string | null;
  /** Truncated tail of the CLI's own output, so a human can see what actually happened. */
  outputTail: string;
  /**
   * What the per-seat step ledger did for this seat. Present whenever the run
   * carried a ledger (`TeamRunRequest.steps`); a run that dispatched everything
   * records every step under `applied` and nothing under `reused`, so the field
   * reads the same either way.
   */
  idempotency?: SeatIdempotencyRecord;
}

export type RunStatus = "completed" | "partial" | "blocked" | "aborted";

export interface SetupRecord {
  seatId: string;
  path: string;
  ok: boolean;
  detail: string;
}

export interface BriefingRecord {
  path: string;
  writtenTo: string[];
  excludedFromGit: boolean;
  detail: string;
}

export interface ReviewSnapshotRecord {
  /** False when no snapshot was built, with the reason in `detail`. */
  built: boolean;
  branch: string;
  sha: string | null;
  writerBranches: string[];
  /** Conflicts found by the in-memory pre-flight, before anything was merged. */
  conflicts: string[];
  detail: string;
}

export interface TeamRunReport {
  seats: SeatRecord[];
  status: RunStatus;
  /** The single most important sentence about this run. */
  summary: string;
  spentUsd: number;
  notRun: Array<{ seatId: string; reason: string }>;
  setup: SetupRecord[];
  /**
   * OPEN-14 — what the run's teardown did, command by command, as git reported it.
   * Absent when the mission was refused before it touched git (nothing to clean);
   * present with `ok: false` rows when a worktree or branch refused to go away —
   * which is the state that makes the NEXT delegation fail on `git worktree add -b`.
   */
  teardown?: TeardownRecord[];
  /**
   * OPEN-14 — set instead of `teardown` when the run was told to keep its
   * worktrees, in the executor's own words about what that leaves behind.
   */
  teardownNote?: string;
  briefings: BriefingRecord[];
  snapshot: ReviewSnapshotRecord;
  /**
   * 11.10 — the merge record now carries the adversarial gate. `gate.allowed === false`
   * means the writers' branches may NOT merge into the base: the gate verdict is a merge
   * authority, not a comment. In STRICT mode the only way past is a recorded human
   * override (Mission Control approval inbox).
   */
  merge: { candidates: MergeCandidate[]; plan: ReturnType<typeof planMerge>; gate: MergeGateResult };
  /** 11.9.9 gate verdict, evaluated INSIDE the run (11.10) with snapshot evidence bound. */
  gate: GateVerdict;
  startedAt: string;
  finishedAt: string;
  wallClockMs: number;
  /** 11.9.4(Major+): the strategy arms the autonomy router executed this run. */
  autonomyArms?: ArmId[];
  /** 11.11.1 — the strategy version whose parameters governed this run (experiment attribution). */
  strategy?: RunAssignment | null;
  /** Exact organizational-memory records exposed in this run's briefings. */
  lessonIds?: string[];
  /** 11.12 MOSAIC — the action packet that permitted this run, cryptographically verified. */
  actionPacket?: { id: string; digest: string; permission: string; reversible: boolean; verification: string; verified: boolean } | null;
  /** 11.12.1/2 — attenuated seat envelopes (custody chain when a root envelope exists). */
  envelopes?: Array<{ seatId: string; scope: string[]; attenuatedFrom: string | null; principal?: string; delegationChain?: string[]; expiresAt?: number | null }>;
  /** 11.13.1 — atomic budget admission accounting (present when the run carried a cap). */
  budget?: { capUsd: number; admittedByReservation: number; refusedByReservation: number; overrunUsd: number; tokensOnlySeats: string[] };
  /** 11.12.1 — step-repetition escalation signals observed in turn heartbeats. */
  repetition?: Array<{ seatId: string; repeated: number }>;
  /**
   * 11.14.8 — the governance-arena preflight stamp: the hostile battery PASSED
   * before any seat was invoked. `arena` is null only when the runner itself
   * could not execute (an honest gap, never a silent one) — a REFUSED gate
   * aborts the mission before dispatch, so a completed run implies PASS.
   */
  arena: { gate: "PASS" | "REFUSED"; digest: string; summary: string; total: number; defended: number; breached: number } | null;
}

/* ------------------------------------------------------------------ execution */

const OUTPUT_TAIL_CHARS = 4000;
/** Briefings live here, inside the worktree only, and are excluded from git. */
const BRIEF_DIR = ".si-brief";

export function waveGroups(assignments: SeatAssignment[]): SeatAssignment[][] {
  const byWave = new Map<number, SeatAssignment[]>();
  for (const a of assignments) {
    const list = byWave.get(a.wave) ?? [];
    list.push(a);
    byWave.set(a.wave, list);
  }
  return [...byWave.entries()].sort((x, y) => x[0] - y[0]).map(([, v]) => v);
}

/* ------------------------------------------------------------------ per-seat idempotency */

/**
 * A seat's work produces two kinds of effect, and only one of them is dangerous
 * to repeat: the effects the AGENT causes by running (bytes written into its
 * worktree, provider spend, tool calls) and the effects VH causes afterwards
 * (verify, git commit).
 *
 * THE DEFECT THIS CLOSES. Before the ledger, `runSeat` began every turn at
 * index 1 with no memory of the previous attempt, so a re-run dispatched the
 * agent again over a worktree its own earlier self had already changed — and
 * `git add -A` + `commit` then ran unconditionally per seat, so a seat whose
 * work was already committed went through a second `add -A` over the same tree.
 * A seat that failed half way through was therefore re-driven from a tree that
 * already contained its partial effect: the model saw its own earlier output as
 * pre-existing code and either redid it or compounded it.
 *
 * THE RULE. A step is keyed on (missionSlug, seatId, step) — facts that do not
 * change between runs — and it is READ BEFORE DISPATCH, never after. That
 * ordering is the whole property:
 *   - `settled`   → the effect exists; do not dispatch it again.
 *   - `in_flight` → a dispatch was started and never confirmed; NOT applied, so
 *                   the next run retries exactly this step.
 *   - `failed`    → the step ran and did not take; NOT applied, retry it.
 *   - absent      → never attempted; run it.
 *
 * `missionRuntime.ts` carries the same idea for graph nodes (`completedNodeIds`).
 * This is the seat-level equivalent, keyed on the seat's turn rather than on a
 * node id, because the executor's unit of work is a turn inside a seat.
 */
export type SeatStepState = "in_flight" | "settled" | "failed";

export interface SeatStepRecord {
  stepId: string;
  missionSlug: string;
  seatId: string;
  /** `turn:1`, `turn:2`, `commit` — the unit of work this record is about. */
  step: string;
  state: SeatStepState;
  at: number;
  /**
   * For a settled turn: the turn's own summary, kept so a re-run can resume the
   * conversation with the same context the earlier attempt ended on instead of
   * a blank one. For a commit: what git said.
   */
  note: string;
  /** The session id the agent reported on a settled turn, so a re-run can resume it. */
  sessionId?: string | null;
}

export interface SeatStepLedger {
  /** Stable identity for one step of one seat in one mission. */
  stepId(parts: { missionSlug: string; seatId: string; step: string }): string;
  get(stepId: string): SeatStepRecord | undefined;
  mark(rec: SeatStepRecord): void;
  /** Everything the ledger holds — for the run report, a resume audit, and tests. */
  entries(): SeatStepRecord[];
}

/** The identity itself, exported so a host can pre-compute or inspect a step id. */
export function seatStepId(missionSlug: string, seatId: string, step: string): string {
  return `${missionSlug}::${seatId}::${step}`;
}

export const SEAT_STEP_STORAGE_KEY = "vh.seatSteps.v1";

interface StepStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isStepRecord(r: unknown): r is SeatStepRecord {
  if (!r || typeof r !== "object") return false;
  const o = r as Partial<SeatStepRecord>;
  return (
    typeof o.stepId === "string" &&
    typeof o.missionSlug === "string" &&
    typeof o.seatId === "string" &&
    typeof o.step === "string" &&
    typeof o.at === "number" &&
    (o.state === "in_flight" || o.state === "settled" || o.state === "failed")
  );
}

/**
 * A step ledger.
 *
 * Persistence is best-effort and NEVER a precondition for running: the default
 * store is the shared Storage boundary (browser storage or native files in
 * Electron), and the ledger falls back to memory only when a caller explicitly
 * requests that mode or a probe has no storage. Pass `store: null` to force memory, or a Storage-shaped object to
 * thread a host's own store. A corrupt or unreadable ledger is read as an EMPTY
 * ledger — it can never fail a mission, and it can never claim a step settled.
 */
export function createSeatStepLedger(opts?: { store?: StepStore | null }): SeatStepLedger {
  const store: StepStore | null =
    opts && "store" in opts ? (opts.store ?? null) : (mainStorage() as StepStore);
  const mem = new Map<string, SeatStepRecord>();
  let loaded = false;

  const load = (): void => {
    if (loaded) return;
    loaded = true;
    try {
      const raw = store?.getItem(SEAT_STEP_STORAGE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) for (const r of parsed) if (isStepRecord(r)) mem.set(r.stepId, r);
    } catch {
      /* unreadable ledger → nothing is known to be applied */
    }
  };

  const persist = (): void => {
    try {
      store?.setItem(SEAT_STEP_STORAGE_KEY, JSON.stringify([...mem.values()]));
    } catch {
      /* memory-only when the store refuses */
    }
  };

  return {
    stepId: (p) => seatStepId(p.missionSlug, p.seatId, p.step),
    get: (id) => {
      load();
      return mem.get(id);
    },
    mark: (rec) => {
      load();
      mem.set(rec.stepId, rec);
      persist();
    },
    entries: () => {
      load();
      return [...mem.values()];
    },
  };
}

/** What a seat's idempotency did, in the record. Never absent when steps were supplied. */
export interface SeatIdempotencyRecord {
  /** Steps an earlier run of THIS mission already applied. Not dispatched again. */
  reused: string[];
  /** Steps this invocation applied. */
  applied: string[];
  /** Steps whose dispatch was attempted and did not settle — safe to retry. */
  unresolved: string[];
  /** The seat's branch carries this mission's commit, whether this run made it or an earlier one did. */
  commitApplied: boolean;
  /** True only when THIS invocation ran the commit. */
  commitAppliedThisRun: boolean;
}

/**
 * A seat's own account of its previous turn, marked as data before the NEXT seat reads it.
 *
 * `lastSummary` is `summariseOutput(res.stdout)` — text a model produced after reading files,
 * web pages and tool output it did not author. It is handed to the follow-up turn as "what
 * happened so far", which means an attacker who planted a sentence in a file the seat read
 * gets to speak, in this mission's own words, to every later turn and to the reviewer.
 * Nobody downstream can tell that from the planner's note, and that is exactly the gap
 * `src/security/untrustedContent.ts` closes: the report is still passed on whole — the run's
 * continuity depends on it — but it is passed on labelled, with the disclaimer in front.
 *
 * The owner's own instruction (`t.prompt`) is deliberately NOT wrapped. Labelling the
 * operator's words as a stranger's data would be the same lie pointing the other way.
 */
function priorSeatReport(summary: string): string {
  return summary.trim() ? markUntrusted(summary, "seat report (previous turn)") : summary;
}

/** The rule that makes the labels above mean something to a seat that reads them. */
const UNTRUSTED_BRIEFING_LINE = `[content policy] ${UNTRUSTED_CONTENT_RULE}`;

/** Run one git argv, returning a uniform shape the executor can reason about. */
async function git(deps: TeamRunnerDeps, args: string[], cwd: string): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number | null }> {
  if (!deps.git) return { ok: false, stdout: "", stderr: "", exitCode: null };
  const r = await deps.git(args, cwd);
  return { ok: r.exitCode === 0, stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode };
}

/**
 * Run a team for real.
 *
 * Waves run in order; seats inside a wave run concurrently, because they are working in separate
 * worktrees and cannot overwrite each other.
 *
 * OPEN-14 — the teardown wrapper. `runTeamMission` creates the writers' worktrees and
 * the reviewers' snapshot worktrees, and it used to stop there: nothing removed them
 * and nothing deleted their branches, so the SECOND delegation against the same
 * repository asked `git worktree add -b` for a branch that still existed, git exited
 * 255 ("a branch named '…' already exists"), the seat was recorded failed and the run
 * reported blocked. `teardownArgv` already described the cleanup — it had no caller.
 * Here it gets one, in a `finally`, so a worktree and its branch can never outlive the
 * run that made them: not on the completed path, not on an abort, not on a throw.
 */
export async function executeTeam(req: TeamRunRequest, deps: TeamRunnerDeps, sessions = new SessionStore()): Promise<TeamRunReport> {
  let report: TeamRunReport | null = null;
  try {
    report = await runTeamMission(req, deps, sessions);
    return report;
  } finally {
    await teardownRun(req, deps, report);
  }
}

/* ------------------------------------------------------------------ worktree teardown */

/** What one cleanup command did. `ok` is git's exit code, never an assumption. */
export interface TeardownRecord {
  /** The argv VH ran, `git` included, so the record is reproducible by hand. */
  argv: string[];
  ok: boolean;
  detail: string;
}

/**
 * Close out the run's isolation: remove every worktree it made and delete the
 * branches it made, by running the argv `collaboration.teardownArgv` describes —
 * the same list the plan owns, not a copy of its logic.
 *
 * Order is the helper's and it matters: `git worktree remove --force` before
 * `git branch -D` (a branch checked out in a worktree cannot be deleted), and
 * `git worktree prune` last, to clear registrations a crash left behind.
 *
 * `report` is null when the run threw instead of finishing. Worktrees can exist
 * without a report, which is exactly how the next mission dies, so that path is
 * cleaned too. Every command's real outcome lands on the report, because an
 * invisible cleanup is how this defect survived: nobody could see that it had
 * never happened.
 */
async function teardownRun(req: TeamRunRequest, deps: TeamRunnerDeps, report: TeamRunReport | null): Promise<void> {
  /* A run that never reached the worktree loop created nothing, so there is
     nothing to remove and no failed git command to report for it. `setup` is
     written by that loop and only by that loop: empty means the mission was
     refused before VH touched git. */
  if (report && report.setup.length === 0) return;
  if (req.keepWorktrees) {
    if (report) {
      report.teardownNote = `Teardown SKIPPED because this run asked to keep its worktrees (keepWorktrees) — the worktrees and \`vh/${req.missionSlug}/…\` branches are still on disk, and a mission that reuses this slug will collide on 'git worktree add -b'.`;
      report.summary += ` ${report.teardownNote}`;
    }
    return;
  }
  if (!deps.git) return;
  const worktrees = planWorktrees(req.team, { repoRoot: req.repoRoot, baseBranch: req.baseBranch, missionSlug: req.missionSlug, deferReview: true });
  const records: TeardownRecord[] = [];
  for (const argv of teardownArgv({ worktrees })) {
    const cmd = argv[0] === "git" ? argv.slice(1) : argv;
    const r = await git(deps, cmd, req.repoRoot);
    records.push({
      argv,
      ok: r.ok,
      detail: r.ok
        ? `git ${cmd.join(" ")} exited 0.`
        : r.exitCode === null
          ? `git ${cmd.join(" ")} could not run — no git runner on this host.`
          : `git ${cmd.join(" ")} exited ${r.exitCode}: ${(r.stderr || r.stdout).trim().slice(0, 200) || "(no output)"}`,
    });
  }
  if (!report) return;
  report.teardown = records;
  const failed = records.filter((t) => !t.ok);
  report.summary += failed.length
    ? ` Teardown INCOMPLETE: ${failed.length} of ${records.length} cleanup command(s) failed — first: ${failed[0].detail.slice(0, 160)} A leftover worktree or branch makes the next mission against this repository fail on 'git worktree add -b'.`
    : ` Teardown: ${records.length} cleanup command(s) ran; worktrees removed and mission branches deleted.`;
}

/**
 * 11.10 — evaluate the adversarial gate INSIDE the run, on the run's own measured facts,
 * with the review-snapshot evidence bound (each verifier's reviewedSha checked against the
 * snapshot sha). The gate verdict and its merge consequence are computed once, here, and
 * travel with the report — the UI and the receipt consume them, they never recompute them.
 * receiptAttached is true by construction: the issuing path records the receipt together
 * with this verdict (see TeamsPage runner / receiptVault).
 */
function gateTheRun(args: {
  status: RunStatus;
  seats: SeatRecord[];
  notRun: string[];
  snapshot: ReviewSnapshotRecord;
  policy: GatePolicy;
}): { gate: GateVerdict; mergeGate: MergeGateResult } {
  const gate = gateForTeamReport(
    {
      status: args.status,
      seats: args.seats.map((s) => ({
        seatId: s.seatId,
        role: s.role,
        harness: s.harness,
        outcome: s.outcome,
        verified: s.verified,
        reviewedSha: s.reviewedSha,
      })),
      notRun: args.notRun,
      snapshot: {
        built: args.snapshot.built,
        sha: args.snapshot.sha,
        ref: args.snapshot.branch,
        writerBranches: args.snapshot.writerBranches,
      },
    },
    args.policy,
    true,
  );
  return { gate, mergeGate: enforceMergeGate(gate) };
}

/** The mission itself. Call `executeTeam`, which wraps this in the teardown. */
async function runTeamMission(req: TeamRunRequest, deps: TeamRunnerDeps, sessions: SessionStore): Promise<TeamRunReport> {
  const now = deps.now ?? (() => Date.now());
  const t0 = now();
  // The step ledger. Supplied by the caller when the mission is being RESUMED
  // (so an applied step is not applied twice); absent otherwise, in which case
  // an empty in-memory ledger is created and every step is simply new.
  const steps: SeatStepLedger = req.steps ?? createSeatStepLedger({ store: null });
  const startedAt = new Date(t0).toISOString();
  const seats: SeatRecord[] = [];
  const notRun: TeamRunReport["notRun"] = [];
  const setup: SetupRecord[] = [];
  const repCount = new Map<string, { last: string; run: number; max: number }>();
  // 11.12.1 — step-repetition signal tracked in THIS scope via wrapped deps.onTurn.
  const depsWithRep: TeamRunnerDeps = {
    ...deps,
    onTurn: (rec) => {
      const sig = `${rec.seatId}|${rec.exitCode}|${(rec.outputTail ?? "").length}|${(rec.selfReport ?? "").slice(0, 80)}`;
      const st = repCount.get(rec.seatId) ?? { last: "", run: 0, max: 0 };
      st.run = sig === st.last ? st.run + 1 : 1;
      st.last = sig;
      st.max = Math.max(st.max, st.run);
      repCount.set(rec.seatId, st);
      if (deps.onTurn) deps.onTurn(rec);
    },
  };
  // 11.13.1 — atomic admission: one gate per run; every concurrent seat must RESERVE
  // before dispatch. Declared before `finish` so early-exit reports can read it safely.
  const budgetGate = req.rootEnvelope && req.rootEnvelope.budgetUsd !== null ? new BudgetGate(req.rootEnvelope.budgetUsd) : null;
  const budgetAccounting = { admitted: 0, refused: 0, overrun: 0, tokensOnly: new Set<string>() };

  /* §DISPATCH LANES (claw-enterprise, MIT) — the run's ONE concurrency ceiling.
   * Declared at run level, not per wave, because the ceiling is a property of
   * the run: a fresh queue per wave would let wave 2 open its streams while
   * wave 1's stragglers were still settling, and nobody would have written that
   * down on purpose.
   *
   * Before this, `Promise.all` over the wave started EVERY seat in it at the
   * same instant, and nothing in the repo ceilings `team.seats`. Each seat is
   * now an in-process agent loop against the owner's key, so an unbounded fan
   * out is a spend incident, a rate-limit incident and — the part this product
   * cares about most — N live write-capable loops with only a reservation
   * between them and the cap. The crew layer already bounded itself
   * (`CREW_CONCURRENCY`); this closes the executor layer.
   *
   * `maximumQueued` is the wave's own size, so an already-admitted seat is never
   * refused for queue space: the overflow arm is a guard against a caller that
   * enqueues more than it declared, not a path this wave can reach. What the
   * lane CAN do to a seat here is refuse it on the stop check — the cap tripping
   * while that seat waited — and that is recorded as an unrun seat below. */
  const lanes = createDispatchLanes({ concurrency: SEAT_LANE_CONCURRENCY, maximumQueued: Math.max(1, req.team.seats.length) });
  let laneRefusals = 0;
  let seatEnvelopes: Array<{ seatId: string; scope: string[]; attenuatedFrom: string | null; principal?: string; delegationChain?: string[]; expiresAt?: number | null }> = [];
  let packetVerified = false;
  let arenaStamp: TeamRunReport["arena"] = null;
  let usedLessonIds: string[] = [];
  const emptySnapshot: ReviewSnapshotRecord = { built: false, branch: "", sha: null, writerBranches: [], conflicts: [], detail: "Not attempted." };

  /* ONE sentence about what the cap did, shared by both return paths so the
     early exit and the full run cannot describe the same BudgetGate differently. */
  const budgetNote = (): string =>
    budgetGate
      ? ` Budget authority: $${budgetGate.capUsd.toFixed(2)} cap; ${budgetAccounting.admitted} seat(s) admitted by atomic reservation, ${budgetAccounting.refused} refused${budgetAccounting.overrun > 0 ? `; $${budgetAccounting.overrun.toFixed(4)} measured overrun settled after the fact` : ""}${budgetAccounting.tokensOnly.size > 0 ? `; ${[...budgetAccounting.tokensOnly].join(", ")} reported tokens only, so VH marks their dollar spend UNKNOWN rather than inventing a price` : ""}${laneRefusals > 0 ? `; ${laneRefusals} seat(s) never started because the run's cap tripped while they waited behind the ${SEAT_LANE_CONCURRENCY}-seat dispatch ceiling` : ""}.`
      : laneRefusals > 0
        /* The lane refuses against the ledger cap, which exists whether or not a
         * custody envelope was minted — so the sentence belongs here too. A run
         * that never started seats has to say so even when it had no BudgetGate. */
        ? ` Labour ceiling: ${laneRefusals} seat(s) never started because the run's cap tripped while they waited behind the ${SEAT_LANE_CONCURRENCY}-seat dispatch ceiling.`
        : "";


  const finish = (status: RunStatus, summary: string, spentUsd: number, snapshot: ReviewSnapshotRecord, briefings: BriefingRecord[]): TeamRunReport => {
    if (status === "completed") {
      globalMemoryCortex.recordRepairSuccess(
        "architecture",
        `Mission ${req.missionSlug} task completed`,
        `Verified worktree commit and review passed on ${req.baseBranch}`,
        req.missionSlug,
        `Mission "${req.objective}" verified with 0 regressions.`,
      );
    }
    globalAgentBus.publish({
      channel: "#general",
      sender: { seatId: "orchestrator", role: "planner", harness: "llm", name: "Team Orchestrator" },
      mentions: ["@all"],
      intent: "broadcast",
      content: `Team mission "${req.missionSlug}" finished with status ${status.toUpperCase()} ($${(spentUsd || 0).toFixed(4)} spent). Summary: ${summary}`,
    });
    globalAgentBus.writeBlackboard("mission.verdict", `Status: ${status}\nSummary: ${summary}\nSpent: $${(spentUsd || 0).toFixed(4)}`, "orchestrator", "finding");
    // 11.10 — even an early-exit run is gated: whatever seats did run get judged, and the
    // merge record says plainly whether their branches may merge.
    const gated = gateTheRun({
      status,
      seats,
      notRun: notRun.map((n) => n.seatId),
      snapshot,
      policy: req.gatePolicy ?? loadGatePolicy(),
    });
    // 11.13.1 — the report states plainly what a cap does and does not guarantee.
    return {
      seats,
      status,
      summary: summary + budgetNote(),
      spentUsd,
      notRun,
      setup,
      briefings,
      snapshot,
      merge: { candidates: [], plan: planMerge([], { baseBranch: req.baseBranch, repoRoot: req.repoRoot, testCommand: req.testCommand }), gate: gated.mergeGate },
      gate: gated.gate,
      startedAt,
      finishedAt: new Date(now()).toISOString(),
      wallClockMs: now() - t0,
      autonomyArms: req.autonomy?.arms,
      strategy: req.strategy ?? null,
      lessonIds: usedLessonIds,
      actionPacket: req.actionPacket
        ? { id: req.actionPacket.id, digest: req.actionPacket.digest, permission: req.actionPacket.permission, reversible: req.actionPacket.reversible, verification: req.actionPacket.verification, verified: packetVerified }
        : null,
      envelopes: seatEnvelopes,
      budget: budgetGate ? { capUsd: budgetGate.capUsd, admittedByReservation: budgetAccounting.admitted, refusedByReservation: budgetAccounting.refused, overrunUsd: budgetAccounting.overrun, tokensOnlySeats: [...budgetAccounting.tokensOnly] } : undefined,
      repetition: [...repCount.entries()].map(([seatId, r]) => ({ seatId, repeated: r.max })).filter((r) => r.repeated >= 2),
      arena: arenaStamp,
    };
  };

  // 11.12.2 — custody: a root envelope must permit the mission and be unexpired.
  if (req.rootEnvelope) {
    const envCheck = checkEnvelope(req.rootEnvelope, "run:team-mission", now());
    if (!envCheck.ok) {
      return finish("aborted", `Custody refused the mission before any invocation — ${envCheck.reason}`, 0, emptySnapshot, []);
    }
  }

  // 11.12.2 — custody chain: when a root envelope exists, every seat gets an attenuated
  // envelope — a strict subset of the parent scope, never outliving it. Failure to attenuate
  // (e.g. the root scope shrank) is recorded honestly as scope: [] rather than executed around.
  if (req.rootEnvelope) {
    for (const st of req.team.seats) {
      const sub = ["role:any", "read:review-snapshot", "spend:capped-by-ledger", ...(st.mayWrite ? ["write:worktrees"] : [])].filter((x) => req.rootEnvelope!.scope.includes(x));
      const att = await attenuate(req.rootEnvelope, `seat:${st.id}`, sub, { now: now() });
      if (att.envelope) {
        seatEnvelopes.push({ seatId: st.id, scope: att.envelope.scope, attenuatedFrom: req.rootEnvelope.id, principal: att.envelope.principal, delegationChain: att.envelope.delegationChain, expiresAt: att.envelope.expiresAt ?? null });
      } else {
        seatEnvelopes.push({ seatId: st.id, scope: [], attenuatedFrom: null });
      }
    }
  }

  // 11.13.0 — budget authority: a cap already exhausted refuses the mission
  // before any invocation, the same way an expired envelope does.
  if (req.rootEnvelope && req.rootEnvelope.budgetUsd !== null) {
    const bc = budgetCheck(req.rootEnvelope, 0);
    if (!bc.ok) {
      return finish("aborted", `Budget authority refused the mission before any invocation — ${bc.reason}. Nothing executed, nothing spent.`, 0, emptySnapshot, []);
    }
  }

  // 11.12.1 — proof-carrying actions, cryptographic-first at the boundary:
  // verify digest + signature FIRST, then the mechanical permission rule.
  if (req.actionPacket) {
    const integrity = await verifyActionPacket(req.actionPacket);
    if (!integrity.ok) {
      return finish("aborted", `Action packet ${req.actionPacket.id} FAILED cryptographic verification — ${integrity.reason}. Nothing executed, nothing spent.`, 0, emptySnapshot, []);
    }
    packetVerified = true;
  }
  const packetGate = packetAllowsExecution(req.actionPacket ?? null);
  if (!packetGate.ok) {
    return finish("aborted", `Refused before any invocation by its action packet — ${packetGate.reason}`, 0, emptySnapshot, []);
  }

  // 11.14.8 — the governance-arena preflight: the hostile battery must PASS before any
  // seat is invoked. A REFUSED gate aborts the mission in words — nothing executed,
  // nothing spent — the same admission discipline as custody, budget and action packets.
  // The arena stamp rides the run report and (via the receipt path) the mission receipt.
  const arenaReport = await (deps.arenaRunner ?? ((n: number) => runGovernanceArena({ now: n })))(t0);
  arenaStamp = {
    gate: arenaReport.gate,
    digest: arenaReport.digest,
    summary: arenaReport.summary,
    total: arenaReport.total,
    defended: arenaReport.defended,
    breached: arenaReport.breached,
  };
  if (arenaReport.gate === "REFUSED") {
    return finish("aborted", `Refused before any invocation by the governance arena — ${arenaReport.summary} Nothing executed, nothing spent.`, 0, emptySnapshot, []);
  }

  globalAgentBus.publish({
    channel: "#general",
    sender: { seatId: "orchestrator", role: "planner", harness: "llm", name: "Team Orchestrator" },
    mentions: ["@all"],
    intent: "broadcast",
    content: `Launching Team Mission "${req.missionSlug}": ${req.objective} with ${req.team.seats.length} seats.`,
  });

  const worktrees = planWorktrees(req.team, { repoRoot: req.repoRoot, baseBranch: req.baseBranch, missionSlug: req.missionSlug, deferReview: true });
  const wtBySeat = new Map(worktrees.map((w) => [w.seatId, w]));

  /* 11.9.4(Major+): the autonomy engines modulate THIS run for real.
     Web evidence is gathered (best-effort, honestly labelled) and the chosen
     bandit arms become briefing lines the agents actually read. */
  const autonomyLines: string[] = [];
  const arms = req.autonomy?.arms ?? [];
  if (arms.includes("review:deep")) autonomyLines.push("[autonomy arm review:deep] Reviewers: attack correctness first; require re-run evidence for every pass claim; style nits last and labelled.");
  if (arms.includes("review:shallow")) autonomyLines.push("[autonomy arm review:shallow] Reviewers: blockers only this run; defer nits.");
  if (arms.includes("check:strict")) autonomyLines.push("[autonomy arm check:strict] Testers/QA: run EVERY listed check and quote failures verbatim; a pass without output is not a pass.");
  if (arms.includes("check:lenient")) autonomyLines.push("[autonomy arm check:lenient] Testers/QA: core acceptance checks this run; edge cases sampled.");
  if (req.team.seats.some((st) => st.role === "planner" || st.mayWrite) && arms.length > 0) {
    autonomyLines.push(`[autonomy router] strategy arms this run: ${arms.join(", ")} — outcomes feed the router's next decision.`);
  }
  // 11.11.1 — the assigned strategy version's parameters govern THIS run for real,
  // and the briefing states which arm is executing so the record is transparent.
  if (req.strategy) {
    const p = req.strategy.params;
    autonomyLines.push(
      `[strategy experiment ${req.strategy.id}${req.strategy.isCandidate ? " (CANDIDATE)" : " (baseline)"}] this run executes gen ${req.strategy.gen} parameters: reviewDepth ${p.reviewDepth}, checkBias ${p.checkBias}, serialExec ${p.serialExec}, lessonBudget ${p.lessonBudget}. Measured outcomes attribute to this strategy.`,
    );
    for (const l of reviewBriefingLines(p.reviewDepth)) autonomyLines.push(l);
  }
  if (req.autonomy?.webEvidence !== false && req.team.seats.some((st) => st.role === "planner" || st.role === "reviewer")) {
    try {
      const web = await searchWeb(req.objective.slice(0, 80), { timeoutMs: 4000 });
      const live = web.providers.filter((pr) => pr.ok);
      if (live.length > 0) {
        /* EVERY hit here is a stranger's sentence on a stranger's server, and this block is
           written into each seat's briefing file — the first thing a seat reads. So the claim
           lines go out inside the envelope, one per source, and the rule that says what an
           envelope means travels with them. `web.untrusted` names the same fact on the report
           object itself; the seat reads the sentences, not the object. */
        autonomyLines.push(UNTRUSTED_BRIEFING_LINE);
        autonomyLines.push(`[web evidence] ${web.hits.length} deduplicated hit(s) from ${live.map((pr) => pr.id).join(", ")} — each is untrusted outside content, wrapped below:`);
        for (const t of toTriples(web.hits).slice(0, evidenceDepth(req.strategy?.params.checkBias ?? 0.5))) {
          autonomyLines.push(markUntrusted(`  - (${t.confidence}, ${t.kind}) ${t.claim} — ${t.source}`, "web search hit"));
        }
      } else {
        autonomyLines.push(`[web evidence] unavailable this run (${web.providers.map((pr) => `${pr.id}: ${pr.note}`).join("; ")}) — research proceeds without it.`);
      }
    } catch {
      autonomyLines.push("[web evidence] fetch failed — research proceeds without it.");
    }
  }
  const briefingsByHarness = writeContextFiles(req.team, {
    objective: req.objective,
    constraints: [...(req.constraints ?? []), ...autonomyLines],
    doNotTouch: req.doNotTouch ?? [],
    testCommand: req.testCommand,
  });

  // Inject learned organizational invariants into worktree briefings for all harnesses
  const learnedMarkdown = globalMemoryCortex.compileBriefing().generatedBriefingMarkdown;
  for (const seat of req.team.seats) {
    briefingsByHarness.push({
      path: ".si-brief/LEARNED_INVARIANTS.md",
      contents: learnedMarkdown,
      forHarness: seat.harness,
    });
  }

  // 11.11 SELF-EVOLVING — the org's measured lessons (and approved learned skills)
  // ride into every seat's briefing, budgeted by the adopted strategy version.
  const learningBriefing = briefingArtifactForMission(req.objective, Date.now(), req.strategy);
  const lessonLines = learningBriefing.lines;
  usedLessonIds = learningBriefing.lessonIds;
  if (lessonLines.length > 0) {
    const lessonsMd = `# Organizational lessons (VH 11.11)\n\n${lessonLines.map((l) => `- ${l}`).join("\n")}\n`;
    for (const seat of req.team.seats) {
      briefingsByHarness.push({
        path: ".si-brief/ORG_LESSONS.md",
        contents: lessonsMd,
        forHarness: seat.harness,
      });
    }
  }

  // Writers' worktrees are created now. Read-only seats are DEFERRED: their worktree must sit on the
  // review snapshot, which cannot exist until the writers have committed.
  const setupFailed = new Set<string>();
  for (const w of worktrees) {
    if (w.deferred) {
      setup.push({ seatId: w.seatId, path: w.path, ok: true, detail: "Deferred: created on the review snapshot when this seat's wave runs." });
      continue;
    }
    if (w.shared) {
      setup.push({ seatId: w.seatId, path: w.path, ok: true, detail: "Runs in the base checkout — no writer exists on this team, so there is nothing to snapshot." });
      continue;
    }
    if (!deps.git) {
      setup.push({ seatId: w.seatId, path: w.path, ok: false, detail: "VH has no git runner here, so the worktree was NOT created. This seat would have written into the base checkout, which defeats isolation, so it is blocked instead." });
      setupFailed.add(w.seatId);
      continue;
    }
    let failed: string | null = null;
    for (const argv of w.createArgv) {
      const r = await git(deps, argv, req.repoRoot);
      if (!r.ok) {
        failed = r.exitCode === null ? `git ${argv.join(" ")} could not run.` : `git ${argv.join(" ")} exited ${r.exitCode}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`;
        break;
      }
    }
    if (failed) {
      setup.push({ seatId: w.seatId, path: w.path, ok: false, detail: failed });
      setupFailed.add(w.seatId);
    } else {
      setup.push({ seatId: w.seatId, path: w.path, ok: true, detail: `Created ${w.branch} at ${w.path}.` });
    }
  }

  // Briefings go into worktrees only — never into the base checkout. Polluting the base would mean the
  // "pristine" tree that gets merged into is dirty before any agent runs, and the briefing files would
  // ride along into the commit.
  const briefings: BriefingRecord[] = [];
  const writerWorktrees = worktrees.filter((w) => !w.shared && !w.deferred && !setupFailed.has(w.seatId));
  for (const f of briefingsByHarness) {
    const writtenTo: string[] = [];
    const writeFailures: string[] = [];
    for (const w of writerWorktrees) {
      const target = `${w.path}/${BRIEF_DIR}/${f.path}`;
      if (deps.writeFile) {
        try {
          await deps.writeFile(target, f.contents);
          writtenTo.push(w.path);
        } catch (e) {
          /* The REASON is kept, not only the count. "No writable worktree existed" and
             "fs_write refused: path outside a registered workspace root" are different
             diagnoses for whoever reads this record, and a writer that used to swallow its
             own errors (hostDeps, fixed here) is exactly how a briefing could read as written
             while no file was on disk. */
          writeFailures.push(`${w.path}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    briefings.push({
      path: `${BRIEF_DIR}/${f.path}`,
      writtenTo,
      excludedFromGit: false,
      detail: writtenTo.length
        ? `Written into ${writtenTo.length} worktree(s), under ${BRIEF_DIR}/, which VH adds to .git/info/exclude so it can never be committed.${writeFailures.length ? ` ${writeFailures.length} worktree(s) FAILED to receive it — those seats will not see this briefing: ${writeFailures[0]}` : ""}`
        : deps.writeFile
          ? writeFailures.length
            ? `NOT written — the write failed for every worktree, so no seat will see this briefing. First failure: ${writeFailures[0]}`
            : "No writable worktree existed for this briefing."
          : "VH has no file writer here, so the briefing was composed but NOT written. The agents will not see it.",
    });
  }
  // Exclude the briefing directory so a `git add -A` cannot pick it up. The result is recorded per
  // worktree: if exclusion failed, the briefings WOULD be committed into the agent's work, and saying
  // otherwise would be the exact kind of false claim this module exists to avoid.
  let excludedEverywhere = true;
  for (const w of writerWorktrees) {
    const okExcl = await excludeBriefDir(deps, w.path);
    if (!okExcl) excludedEverywhere = false;
  }
  for (const b of briefings) {
    b.excludedFromGit = excludedEverywhere && b.writtenTo.length > 0;
    if (b.writtenTo.length > 0 && !excludedEverywhere) {
      b.detail = `Written into ${b.writtenTo.length} worktree(s), but VH could NOT exclude ${BRIEF_DIR}/ from git. Those files will appear as untracked and WILL be picked up by a commit — treat this seat's diff as containing the briefing.`;
    }
  }

  // Pre-flight: find out which binaries exist BEFORE spending anything.
  // 11.11.1: the assigned strategy's serialExec param (or the autonomy arm) flattens the wave plan.
  const waves = strategyWaveShape(req.assignments, arms.includes("exec:serial") || req.strategy?.params.serialExec === true);
  const runnable = new Map<string, boolean>();
  const binPaths = new Map<string, string>();
  for (const w of waves) {
    for (const a of w) {
      if (runnable.has(a.seat.id)) continue;
      // The resolver is total — every seat resolves to one of the two in-process
      // engines (unknown ids to the native default), never undefined.
      const rc = resolveCaps(a.seat.harness);
      const caps = rc.caps;
      // 19.7.15: an in-process seat has no binary to resolve. It is runnable
      // when the host can run a seat at all — the native loop itself is the
      // capability. Requiring a resolved binary here marked EVERY native seat
      // unrunnable and aborted the mission before it started, which is why a
      // delegation against a healthy drill host reported "no seat ran".
      if (typeof deps.nativeInvoke === "function") {
        runnable.set(a.seat.id, true);
        continue;
      }
      // No in-process runner on this host. Fall back to the binary check for
      // any seat that somehow still names an external tool, and say so in
      // words when neither path can run it.
      let resolved: string | null = null;
      for (const b of caps.bins) {
        const r = await deps.resolveBin(b);
        if (r) { resolved = r; break; }
      }
      if (resolved) binPaths.set(a.seat.harness, resolved);
      const ok = resolved !== null;
      runnable.set(a.seat.id, ok);
      if (!ok) {
        notRun.push({
          seatId: a.seat.id,
          reason: `this host cannot run "${caps.name}": there is no in-process seat runner, and no agent binary is looked up any more. Refused in words.`,
        });
      }
    }
  }

  const minSeats = req.minimumRunnableSeats ?? 1;
  const runnableCount = [...runnable.values()].filter(Boolean).length;
  if (runnableCount < minSeats) {
    return finish(
      "aborted",
      `Aborted before any invocation: only ${runnableCount} of ${req.assignments.length} seats can run, and ${minSeats} is the minimum. Nothing was executed and nothing was charged.`,
      0,
      emptySnapshot,
      briefings,
    );
  }

  let waveFailed = false;
  /** 11.13.0 — set when spend authority runs out mid-run; remaining waves skip with the real reason. */
  let budgetStop: string | null = null;
  let snapshot: ReviewSnapshotRecord = emptySnapshot;
  /** Branches that actually hold committed work, in the order they landed. */
  const committedBranches: string[] = [];

  /* Durable missions: every settled wave leaves a checkpoint on a tamper-
     evident chain, so a crash resumes from the last settled wave instead
     of restarting the mission from zero. */
  let waveNo = 0;
  const durableRunId = `run:${req.missionSlug}`;
  for (const wave of waves) {
    if (waveFailed) {
      const skipReason = budgetStop
        ? `Spend authority ran out — ${budgetStop}`
        : "An earlier wave did not complete, so this seat was skipped rather than asked to review work that does not exist.";
      for (const a of wave) {
        notRun.push({ seatId: a.seat.id, reason: skipReason });
        seats.push(unrunRecord(a, wtBySeat.get(a.seat.id) ?? null, "skipped_wave_failed", `Skipped: ${skipReason}`));
      }
      continue;
    }

    const hasReadOnly = wave.some((a) => a.readOnly || !a.seat.mayWrite);
    const skippedIds = new Set<string>();
    if (hasReadOnly && worktrees.some((w) => w.deferred)) {
      // THE FIX. Build the review snapshot from everything the writers committed, then point the
      // read-only worktrees at it. Without this step a reviewer runs against the base checkout and
      // reviews the tree as it was BEFORE the work happened.
      snapshot = await buildReviewSnapshot(req, deps, worktrees, committedBranches, setupFailed);
      if (!snapshot.built) {
        for (const a of wave.filter((x) => x.readOnly || !x.seat.mayWrite)) {
          const wt = wtBySeat.get(a.seat.id);
          if (!wt?.deferred) continue;
          skippedIds.add(a.seat.id);
          const outcome: SeatOutcome = committedBranches.length === 0 ? "skipped_nothing_to_review" : "review_snapshot_failed";
          seats.push(
            unrunRecord(
              a,
              wt,
              outcome,
              committedBranches.length === 0
                ? "Nothing was committed by any writer, so there was no work to review. Reviewing the untouched base would have produced a verdict about code nobody wrote."
                : `The review snapshot could not be built: ${snapshot.detail}`,
            ),
          );
          notRun.push({ seatId: a.seat.id, reason: committedBranches.length === 0 ? "No writer committed anything, so there was nothing to review." : snapshot.detail });
        }
      }
    }

    let runnableWave = wave.filter((a) => !skippedIds.has(a.seat.id));
    // 11.13.1 — atomic budget admission (review fix): the remainder is split into
    // reservations and a seat is admitted ONLY if its reservation commits. The
    // check-and-commit holds no await, so concurrent seats cannot all read the
    // same balance and overshoot — the cap cannot be crossed at dispatch time.
    const tickets = new Map<string, BudgetTicket>();
    if (budgetGate && runnableWave.length > 0) {
      if (budgetGate.remaining <= 0) {
        budgetStop = `spend authority exhausted before the wave — the $${budgetGate.capUsd.toFixed(2)} cap is fully committed`;
        waveFailed = true;
        for (const a of runnableWave) {
          notRun.push({ seatId: a.seat.id, reason: `Budget reservation refused — ${budgetStop}.` });
          seats.push(unrunRecord(a, wtBySeat.get(a.seat.id) ?? null, "skipped_budget", `Skipped: ${budgetStop}`));
          budgetAccounting.refused += 1;
        }
        continue;
      }
      const share = budgetGate.remaining / runnableWave.length;
      const admitted: typeof runnableWave = [];
      for (const a of runnableWave) {
        const tk = budgetGate.reserve(a.seat.id, share);
        if (tk) { tickets.set(a.seat.id, tk); admitted.push(a); budgetAccounting.admitted += 1; }
        else {
          notRun.push({ seatId: a.seat.id, reason: `Budget reservation refused — the remaining $${budgetGate.remaining.toFixed(2)} cannot admit another concurrent seat under the $${budgetGate.capUsd.toFixed(2)} cap.` });
          seats.push(unrunRecord(a, wtBySeat.get(a.seat.id) ?? null, "skipped_budget", "Skipped: the budget cap could not admit this seat concurrently."));
          budgetAccounting.refused += 1;
        }
      }
      runnableWave = admitted;
    }
    /* THE LABOUR CEILING. One entry per seat in the wave, dispatched through the
     * run's lanes rather than started all at once. `Promise.all` still gathers
     * them in wave order, so the seat records a downstream gate reads are in the
     * same sequence they were in before this change — only the number of them
     * that are alive at one instant is bounded now.
     *
     * A lane REFUSAL is not a seat failure. It means the run's own cap tripped
     * while this seat waited behind the ceiling, and the honest record is the
     * `skipped_budget`-shaped one it already used for a reservation refusal —
     * never dispatched, nothing spent, the reason in the ledger's words. Anything
     * that is NOT a refusal rethrows, because a seat that started and threw is
     * the executor's problem to fail on, exactly as it was before. */
    const results = await Promise.all(
      runnableWave.map((a) => {
        const entry = () =>
          runSeat(
            req,
            depsWithRep,
            a,
            sessions,
            wtBySeat.get(a.seat.id) ?? null,
            runnable.get(a.seat.id) ?? false,
            binPaths.get(a.seat.harness) ?? null,
            setupFailed,
            snapshot,
            briefingsByHarness,
            now,
            steps,
          );
        return lanes.run(entry, {
          priority: laneForSeat(a.seat.mayWrite),
          stopReason: () => req.ledger.admissionError(now()),
        }).catch((e: unknown) => {
          if (!isLaneRefusal(e)) throw e;
          laneRefusals += 1;
          /* `skipped_budget`, not a new outcome: a lane refusal here can only come
           * from `req.ledger.admissionError`, which IS the cap — cost, turns,
           * invocations or wall clock — so the record says what actually stopped
           * it and the report vocabulary does not grow for a case the existing
           * word already describes. */
          notRun.push({ seatId: a.seat.id, reason: e.message });
          return unrunRecord(a, wtBySeat.get(a.seat.id) ?? null, "skipped_budget", `Never dispatched: ${e.message}`);
        });
      }),
    );
    seats.push(...results);

    // 11.13.1 — settle every reservation against the REAL charge: overruns are
    // measured and named (a seat cannot hide outspending its reservation), and
    // token-only harnesses are recorded as USD-unknown — VH never invents prices.
    for (const r of results) {
      const tk = tickets.get(r.seatId);
      if (budgetGate && tk) budgetAccounting.overrun += budgetGate.settle(tk, r.chargedUsd ?? 0).overrunUsd;
      if ((r.usage?.costUsd === null || r.usage?.costUsd === undefined) && (r.usage?.tokens ?? 0) > 0) budgetAccounting.tokensOnly.add(r.seatId);
      /* The books: every settled run lands in the FinOps ledger — the
         chargeback export and the assurance score read these same rows.
         USD-unknown stays unknown (null), never a guessed price. */
      finopsRecordSeatRun({
        at: Date.now(),
        seatId: r.seatId,
        missionId: req.missionSlug,
        usd: r.usage?.costUsd ?? null,
        tokens: r.usage?.tokens ?? null,
        turns: r.usage?.turns ?? null,
        verdict: r.verified ? "verified" : r.outcome === "completed" ? "completed" : r.outcome,
        source: r.usage?.source ?? "unknown",
      });
    }

    /* the wave checkpoint — the crash-recovery point */
    durableCheckpoint(durableRunId, req.missionSlug, waveNo, "wave settled", {
      settled: results.length,
      verified: results.filter((x) => x.verified).length,
      budgetStop,
      failed: waveFailed,
    });
    waveNo += 1;

    // 11.13.0 — budget authority is checked after every wave against REAL
    // charged spend; once the cap is crossed, no further seat is invoked.
    if (req.rootEnvelope && req.rootEnvelope.budgetUsd !== null && !budgetStop) {
      const spentSoFar = seats.reduce((sum, r) => sum + (r.chargedUsd ?? 0), 0);
      const bc = budgetCheck(req.rootEnvelope, spentSoFar);
      if (!bc.ok) {
        budgetStop = bc.reason;
        waveFailed = true;
      }
    }

    for (const r of results) {
      if (r.outcome === "completed" && r.branch && r.branch !== req.baseBranch && !committedBranches.includes(r.branch)) {
        if (/Committed on/.test(r.commit)) committedBranches.push(r.branch);
      }
    }
    /* A RESUMED run's reused seats contribute their branches too. A seat this run
       did not dispatch still holds the commit an earlier run of this same mission
       applied, and that branch has to reach the review snapshot — otherwise the
       resumed attempt reviews LESS than the first attempt did, and the review
       snapshot would silently cover only the seats that happened to be retried. */
    for (const r of results) {
      if (r.outcome !== "completed" || !r.branch || r.branch === req.baseBranch || committedBranches.includes(r.branch)) continue;
      if (r.idempotency?.commitApplied) committedBranches.push(r.branch);
    }
    if (results.every((r) => r.outcome !== "completed")) waveFailed = true;
  }

  const spentUsd = seats.reduce((s, r) => s + r.chargedUsd, 0);
  const candidates: MergeCandidate[] = seats
    .filter((r) => r.branch && r.branch !== req.baseBranch && !r.branch.startsWith(`vh/${req.missionSlug}/review`))
    .map((r) => ({
      seatId: r.seatId,
      branch: r.branch,
      worktreePath: r.worktreePath,
      role: r.role,
      dependsOn: req.assignments.find((a) => a.seat.id === r.seatId)?.dependsOn ?? [],
      verified: r.verified,
      additions: r.git.measured ? r.git.additions : 0,
      deletions: r.git.measured ? r.git.deletions : 0,
    }));
  const plan = planMerge(candidates, { baseBranch: req.baseBranch, repoRoot: req.repoRoot, testCommand: req.testCommand });

  const completed = seats.filter((r) => r.outcome === "completed").length;
  const verifiedCount = seats.filter((r) => r.verified).length;
  const status: RunStatus = seats.length === 0 ? "blocked" : completed === seats.length && completed > 0 ? "completed" : completed > 0 ? "partial" : "blocked";

  // 11.10 — THE GATE OWNS THE MERGE PATH. It is evaluated here, inside the run, on the
  // measured seats + the review snapshot they produced. When it blocks (STRICT), the merge
  // record says so and the branches stay unmerged until a human records an override.
  const gated = gateTheRun({
    status,
    seats,
    notRun: notRun.map((n) => n.seatId),
    snapshot,
    policy: req.gatePolicy ?? loadGatePolicy(),
  });
  if (!gated.mergeGate.allowed) {
    globalAgentBus.publish({
      channel: "#general",
      sender: { seatId: "orchestrator", role: "planner", harness: "llm", name: "Team Orchestrator" },
      mentions: ["@all"],
      intent: "blocker",
      content: `MERGE BLOCKED by the adversarial gate (${gated.gate.status}, ${gated.gate.tier}): ${gated.mergeGate.reason} A recorded human approval from Mission Control can override.`,
    });
  }

  return {
    seats,
    status,
    // The same budget note the early-exit `finish()` path carries. It was missing
    // here, which meant a run that actually reserved, dispatched and SETTLED
    // against a `BudgetGate` returned a report whose `budget` was undefined —
    // the atomic admission accounting was computed and then thrown away on the
    // only path that had anything to account for. A mission report that omits
    // what its cap did is a report that cannot answer "did the cap hold?".
    summary: buildSummary({ status, seats, verifiedCount, spentUsd, notRun, briefings, snapshot }) + (budgetGate ? budgetNote() : ""),
    spentUsd,
    notRun,
    setup,
    briefings,
    snapshot,
    merge: { candidates, plan, gate: gated.mergeGate },
    gate: gated.gate,
    startedAt,
    finishedAt: new Date(now()).toISOString(),
    wallClockMs: now() - t0,
    autonomyArms: req.autonomy?.arms,
    strategy: req.strategy ?? null,
    lessonIds: usedLessonIds,
    actionPacket: req.actionPacket
      ? { id: req.actionPacket.id, digest: req.actionPacket.digest, permission: req.actionPacket.permission, reversible: req.actionPacket.reversible, verification: req.actionPacket.verification, verified: packetVerified }
      : null,
    envelopes: seatEnvelopes,
    budget: budgetGate ? { capUsd: budgetGate.capUsd, admittedByReservation: budgetAccounting.admitted, refusedByReservation: budgetAccounting.refused, overrunUsd: budgetAccounting.overrun, tokensOnlySeats: [...budgetAccounting.tokensOnly] } : undefined,
    repetition: [...repCount.entries()].map(([seatId, r]) => ({ seatId, repeated: r.max })).filter((r) => r.repeated >= 2),
    arena: arenaStamp,
  };
}

/* ------------------------------------------------------------------ the review snapshot */

/**
 * Build the tree the reviewers look at, and create their worktrees on it.
 *
 * Order matters: pre-flight the pairwise merges in memory first, so a conflict between two writers is
 * reported as a finding rather than discovered halfway through building the snapshot.
 */
async function buildReviewSnapshot(
  req: TeamRunRequest,
  deps: TeamRunnerDeps,
  worktrees: WorktreePlan[],
  committedBranches: string[],
  setupFailed: Set<string>,
): Promise<ReviewSnapshotRecord> {
  const plan = reviewSnapshotArgv({ repoRoot: req.repoRoot, baseBranch: req.baseBranch, missionSlug: req.missionSlug, writerBranches: committedBranches });
  if (plan.problem || !deps.git) {
    return { built: false, branch: plan.snapshotBranch, sha: null, writerBranches: committedBranches, conflicts: [], detail: plan.problem ?? "VH has no git runner, so the snapshot could not be built." };
  }

  // Pre-flight in memory. merge-tree takes TWO branches; the base is derived from their history.
  const conflicts: string[] = [];
  for (const argv of snapshotPreflightArgv(req.baseBranch, committedBranches)) {
    const r = await git(deps, argv, req.repoRoot);
    if (r.exitCode === 1) {
      const paths = r.stdout.split(/\r?\n/).slice(1).filter((l) => l.trim()).join(", ");
      conflicts.push(`Writers disagree: ${paths || "conflicting changes"}`);
    }
  }

  let failed: string | null = null;
  for (const argv of plan.argv) {
    const r = await git(deps, argv, req.repoRoot);
    if (!r.ok) {
      failed = `git ${argv.join(" ")} exited ${r.exitCode ?? "null"}: ${(r.stderr || r.stdout).trim().slice(0, 240)}`;
      break;
    }
  }
  if (failed) {
    return { built: false, branch: plan.snapshotBranch, sha: null, writerBranches: committedBranches, conflicts, detail: failed };
  }

  const head = await git(deps, ["rev-parse", "HEAD"], req.repoRoot);
  const sha = head.ok ? head.stdout.trim() || null : null;

  // Now the read-only worktrees, detached so they cannot commit.
  for (const w of worktrees) {
    if (!w.deferred || setupFailed.has(w.seatId)) continue;
    for (const argv of reviewWorktreeArgv(plan.snapshotBranch, w.path)) {
      const r = await git(deps, argv, req.repoRoot);
      if (!r.ok) {
        setupFailed.add(w.seatId);
        await git(deps, ["checkout", "-q", req.baseBranch], req.repoRoot);
        return { built: false, branch: plan.snapshotBranch, sha, writerBranches: committedBranches, conflicts, detail: `git ${argv.join(" ")} exited ${r.exitCode ?? "null"}: ${(r.stderr || r.stdout).trim().slice(0, 240)}` };
      }
    }
    await excludeBriefDir(deps, w.path);
  }

  // Put the base checkout back on the base branch.
  //
  // Building the snapshot required `git checkout -B` in the base checkout, which switches it to the
  // snapshot branch. Leaving it there would mean the user's own working copy silently ended the run on
  // a branch they never asked for, showing the merged state as if it were their branch. The snapshot
  // still exists as a ref and as the reviewers' worktrees, so nothing is lost by switching back.
  await git(deps, ["checkout", "-q", req.baseBranch], req.repoRoot);

  return {
    built: true,
    branch: plan.snapshotBranch,
    sha,
    writerBranches: committedBranches,
    conflicts,
    detail: `Built ${plan.snapshotBranch} from ${committedBranches.join(" + ")} on top of ${req.baseBranch}.`,
  };
}

/**
 * Keep the briefing directory out of git, in the COMMON exclude file.
 *
 * `.git/info/exclude` is the local, uncommitted ignore file — unlike `.gitignore` it is not itself a
 * tracked change, so excluding the briefings does not dirty the tree it is meant to protect.
 *
 * It has to be the COMMON one. A linked worktree has its own git dir at
 * `.git/worktrees/<name>/`, and git does NOT read `info/exclude` from there — verified by experiment:
 * writing `.si-brief/` into the worktree's own exclude file left it showing as `?? .si-brief/`, and the
 * subsequent `git add -A` committed the briefing into the agent's code commit. Only
 * `--git-common-dir` reaches the file git actually consults, and it applies to every worktree at once.
 */
async function excludeBriefDir(deps: TeamRunnerDeps, worktreePath: string): Promise<boolean> {
  if (!deps.git || !deps.writeFile) return false;
  const r = await git(deps, ["rev-parse", "--git-common-dir"], worktreePath);
  if (!r.ok) return false;
  let gitDir = r.stdout.trim();
  if (!gitDir) return false;
  // --git-common-dir can be relative to the worktree (".git" when run in the main checkout).
  const isAbs = gitDir.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(gitDir);
  if (!isAbs) gitDir = path.resolve(worktreePath, gitDir);
  try {
    const excludePath = path.join(gitDir, "info", "exclude");
    await deps.writeFile(excludePath, `${BRIEF_DIR}/\n`);
    // Prove it worked rather than assuming: if the briefings are still visible to git, the caller has
    // to know, because the alternative is committing them silently.
    const check = await git(deps, ["status", "--porcelain"], worktreePath);
    return check.ok && !check.stdout.includes(BRIEF_DIR);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ one seat */

async function runSeat(
  req: TeamRunRequest,
  deps: TeamRunnerDeps,
  a: SeatAssignment,
  sessions: SessionStore,
  wt: WorktreePlan | null,
  binaryExists: boolean,
  resolvedBin: string | null,
  setupFailedSeats: Set<string>,
  snapshot: ReviewSnapshotRecord,
  briefings: ContextFile[],
  now: () => number,
  steps: SeatStepLedger,
): Promise<SeatRecord> {
  // V11.6.1: resolver — never undefined, custom seats included.
  const caps = resolveCaps(a.seat.harness).caps;
  const readOnly = a.readOnly || !a.seat.mayWrite;
  const cwd = wt?.path ?? req.repoRoot;
  // A deferred read-only seat reviews the snapshot; anything else works on its own branch.
  const branch = wt?.deferred ? snapshot.branch : (wt?.branch ?? req.baseBranch);
  const reviewedRef = wt?.deferred ? (snapshot.sha ?? snapshot.branch) : branch;

  /* The seat's ledger view. Populated as the turn loop and the commit run, and
     attached to every exit from this function so the record always states
     whether this invocation applied anything or merely reused what was there. */
  const idem: SeatIdempotencyRecord = { reused: [], applied: [], unresolved: [], commitApplied: false, commitAppliedThisRun: false };
  /* THE IDEMPOTENCY LEDGER IS EXCLUSIVE. A step is APPLIED (its effect landed)
     or UNRESOLVED (an attempt was left dangling) — never both, and never
     listed twice. The old code pushed a step into `unresolved` the moment a
     prior attempt was seen, and then pushed the SAME name into `applied` when
     the retry succeeded: a step that had been retried successfully appeared
     in both lists, and the seat's "everything here was reused cleanly"
     verdict (`unresolved.length === 0`) came out false for a seat that had in
     fact settled. Marking a step applied retires its unresolved entry;
     marking it unresolved never duplicates it. */
  const markApplied = (step: string): void => {
    const at = idem.unresolved.indexOf(step);
    if (at >= 0) idem.unresolved.splice(at, 1);
    if (!idem.applied.includes(step)) idem.applied.push(step);
  };
  const markUnresolved = (step: string): void => {
    if (!idem.unresolved.includes(step)) idem.unresolved.push(step);
  };
  const markStep = (step: string, state: SeatStepState, note: string, sessionId: string | null): void => {
    steps.mark({ stepId: steps.stepId({ missionSlug: req.missionSlug, seatId: a.seat.id, step }), missionSlug: req.missionSlug, seatId: a.seat.id, step, state, at: now(), note, ...(sessionId ? { sessionId } : {}) });
  };

  const base: Omit<SeatRecord, "outcome" | "reason"> = {
    seatId: a.seat.id,
    role: a.seat.role,
    harness: a.seat.harness,
    harnessName: caps.name,
    bin: resolvedBin ?? caps.bins[0] ?? "",
    argv: [],
    cwd,
    branch,
    worktreePath: cwd,
    reviewedRef,
    reviewedSha: wt?.deferred ? snapshot.sha : null,
    wave: a.wave,
    turnsRun: 0,
    sessionId: null,
    continuity: "none",
    exitCode: null,
    durationMs: 0,
    usage: { costUsd: null, tokens: null, turns: null, source: a.seat.harness },
    chargedUsd: 0,
    verified: false,
    verificationDetail: "Not run.",
    git: { measured: false, detail: "Not measured.", additions: 0, deletions: 0, filesChanged: 0 },
    commit: "Never ran, so nothing was committed.",
    warnings: [],
    selfReport: null,
    outputTail: "",
    idempotency: idem,
  };

  if (!binaryExists) {
    return { ...base, outcome: "blocked_missing_binary", reason: `${caps.name} is not installed, so this seat never ran. Install: ${caps.install}` };
  }
  if (setupFailedSeats.has(a.seat.id)) {
    return {
      ...base,
      outcome: wt?.deferred ? "review_snapshot_failed" : "failed",
      reason: wt?.deferred
        ? "This seat's review worktree could not be created, so it never ran. Running it in the base checkout instead would have it review the tree from before the work happened — the exact mistake the review snapshot exists to prevent."
        : "This seat's worktree could not be created, so it never ran. Running it anyway would have pointed it at the base checkout and let it overwrite another seat's work.",
    };
  }

  // A read-only seat on a snapshot that was never built has nothing to look at.
  if (wt?.deferred && !snapshot.built) {
    return { ...base, outcome: "skipped_nothing_to_review", reason: "No review snapshot exists, so there was no work to review." };
  }

  // Declared above the first thing that can fail, so a failure below has somewhere to be
  // recorded. It reaches the seat record and the operator's warnings list.
  const warnings: string[] = [];

  // Write this seat's briefing into its own directory now that the directory exists.
  if (deps.writeFile && cwd !== req.repoRoot) {
    for (const f of briefings) {
      try {
        await deps.writeFile(`${cwd}/${BRIEF_DIR}/${f.path}`, f.contents);
      } catch (e) {
        /* NOT a silent catch. The run record said "briefing written" from the earlier loop's
           bookkeeping, so a failure here has to reach the seat's own warnings or the receipt
           would claim the seat was briefed when its directory has no briefing in it. */
        warnings.push(`briefing "${f.path}" was NOT written for this seat — ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  const sessionKey: SessionKey = { seatId: a.seat.id, harness: a.seat.harness, model: a.seat.model, cwd };
  const session = sessions.obtain(sessionKey);

  const channel = a.seat.role === "planner" || a.seat.role === "architect"
    ? "#architecture"
    : a.seat.role === "security"
    ? "#security-audit"
    : a.seat.mayWrite
    ? "#implementation-sync"
    : "#qa-review";

  globalAgentBus.publish({
    channel,
    sender: { seatId: a.seat.id, role: a.seat.role, harness: a.seat.harness, name: caps.name },
    mentions: ["@all"],
    intent: a.seat.role === "planner" || a.seat.role === "architect" ? "proposal" : a.seat.mayWrite ? "proposal" : "verification",
    content: `[Wave ${a.wave}] Commencing execution in ${cwd} (${branch}).`,
  });

  const turns: Array<{ prompt: string; turn: number }> = [{ prompt: a.prompt, turn: 1 }];
  if (a.followUp) turns.push({ prompt: a.followUp, turn: 2 });

  let last: CliResult | null = null;
  let continuity: "session" | "none" = "none";
  let chargedTotal = 0;
  let usage: ReportedUsage = base.usage;
  // NOTE: `warnings` is declared above the briefing-write block (it has to exist before the
  // first thing that can push into it). The duplicate declaration that used to sit here is
  // gone — two `const warnings` in one scope is a redeclaration error, not a second list.
  let lastArgv: string[] = [];
  let lastSummary = "";
  /** True once at least one turn has actually been dispatched in THIS invocation. */
  let dispatchedAnyTurn = false;
  /** Turns THIS invocation dispatched. A reused turn is never counted here. */
  let turnsDispatched = 0;

  for (const t of turns) {
    /* ── IDEMPOTENCY, READ BEFORE DISPATCH ──────────────────────────────────────
       This check sits above the budget admission check on purpose: a step an
       earlier run already applied is not going to be dispatched, so there is
       nothing to admit and nothing to spend. The admission check below still
       precedes every dispatch that DOES happen — refusing beforehand is control,
       charging afterwards is bookkeeping. */
    const stepName = `turn:${t.turn}`;
    const stepKey = steps.stepId({ missionSlug: req.missionSlug, seatId: a.seat.id, step: stepName });
    const prior = steps.get(stepKey);
    if (prior?.state === "settled") {
      idem.reused.push(stepName);
      /* Rehydrate what the earlier attempt left behind, so a resumed follow-up
         continues the same conversation instead of a blank one: the session id
         the agent itself reported, and the summary it ended on. */
      if (prior.sessionId) {
        sessions.recordTurn(sessionKey, prior.sessionId, t.prompt);
        continuity = "session";
      }
      if (prior.note) lastSummary = prior.note;
      continue;
    }
    if (prior) markUnresolved(stepName);

    // Budget check BEFORE dispatch. Charging afterwards is bookkeeping; refusing beforehand is control.
    const admission = req.ledger.admissionError(now());
    if (admission) {
      markStep(stepName, "failed", `refused before dispatch: ${admission}`, session.sessionId);
      return { ...base, argv: lastArgv, sessionId: session.sessionId, continuity, turnsRun: turnsDispatched, chargedUsd: chargedTotal, usage, warnings, outcome: "blocked_budget", reason: `Turn ${t.turn} was never started: ${admission}` };
    }

    const composed = composeSeatArgv(a.seat, {
      prompt: t.turn === 1 ? t.prompt : followUpPrompt({ continuity, harnessName: caps.name, previousSummary: priorSeatReport(lastSummary), instruction: t.prompt }),
      cwd,
      readOnly,
      sessionId: session.sessionId,
      turn: t.turn,
    });
    lastArgv = composed.argv;
    warnings.push(...composed.warnings.filter((w) => !warnings.includes(w)));

    const timeoutSecs = a.seat.timeoutSecs > 0 ? a.seat.timeoutSecs : 600;
    // 19.7.15: seats run in-process. External CLIs are removed, so this no
    // longer composes argv and spawns a binary — it hands the turn to the
    // native loop under the authority envelope the Governor derived. If the
    // host supplied no nativeInvoke, that is a host bug and it is refused
    // loudly rather than faked with a transcript.
    const turnText = t.turn === 1
      ? t.prompt
      : followUpPrompt({ continuity, harnessName: caps.name, previousSummary: priorSeatReport(lastSummary), instruction: t.prompt });
    const native = deps.nativeInvoke;
    /* in_flight BEFORE the await. A dispatch that is killed mid-flight leaves the
       step in_flight, never settled, so the next run retries exactly this turn
       instead of treating an unconfirmed effect as an applied one. */
    markStep(stepName, "in_flight", `dispatching turn ${t.turn} of ${req.missionSlug}`, session.sessionId);
    dispatchedAnyTurn = true;
    turnsDispatched += 1;
    const enforced = native
      ? await withDeadline(
          () =>
            native({
              harness: a.seat.harness,
              prompt: turnText,
              cwd,
              readOnly,
              mayWriteFiles: !readOnly,
              mayRunShell: !readOnly,
              model: a.seat.model,
              timeoutSecs,
            }),
          timeoutSecs * 1000,
          now,
        )
      : {
          value: {
            exitCode: 127,
            stdout: "",
            stderr: `no native seat runner is configured for "${caps.name}" — this host cannot run agents`,
            durationMs: 0,
            timedOut: false,
          } satisfies CliResult,
          outcome: "ok" as const,
          timedOut: false,
          elapsedMs: 0,
          detail: "No native seat runner is configured on this host.",
        };

    const res = enforced.value;
    const durationMs = res ? res.durationMs : enforced.elapsedMs;

    if (enforced.outcome === "timeout" || res?.timedOut) {
      req.ledger.recordCapped(a.seat.id, "timeout", `${caps.name} exceeded its ${timeoutSecs}s deadline on turn ${t.turn}. The child had to be killed; VH cannot assume it stopped cleanly.`);
      markStep(stepName, "failed", `killed at the ${timeoutSecs}s deadline on turn ${t.turn}`, session.sessionId);
      markUnresolved(stepName);
      return {
        ...base,
        argv: composed.argv,
        sessionId: session.sessionId,
        continuity,
        turnsRun: turnsDispatched,
        chargedUsd: chargedTotal,
        usage,
        warnings,
        durationMs,
        outputTail: tail(res?.stdout ?? ""),
        outcome: "timeout",
        reason: `Turn ${t.turn} ran past its ${timeoutSecs}s deadline and was killed. Partial work may be left in the worktree.`,
      };
    }
    if (!res) {
      markStep(stepName, "failed", `no result on turn ${t.turn}: ${enforced.detail}`, session.sessionId);
      markUnresolved(stepName);
      return { ...base, argv: composed.argv, sessionId: session.sessionId, continuity, turnsRun: turnsDispatched, chargedUsd: chargedTotal, usage, warnings, outcome: "failed", reason: `Turn ${t.turn} produced no result: ${enforced.detail}` };
    }
    last = res;

    // Read the session id back from the CLI's own output. VH may have chosen it, but the CLI owns the
    // conversation — and a mismatch means the session did not start the way VH assumed.
    const reportedId = parseSessionId(a.seat.harness, res.stdout);
    if (reportedId) continuity = "session";
    sessions.recordTurn(sessionKey, reportedId, t.prompt);

    const resumeProblem = detectResumeFailure(res.stdout + "\n" + res.stderr);
    if (resumeProblem && t.turn > 1) {
      sessions.markResumeFailed(sessionKey);
      markStep(stepName, "failed", `could not resume the session: ${resumeProblem}`, session.sessionId);
      markUnresolved(stepName);
      return {
        ...base,
        argv: composed.argv,
        sessionId: session.sessionId,
        continuity: "none",
        turnsRun: turnsDispatched,
        chargedUsd: chargedTotal,
        usage,
        warnings,
        durationMs,
        exitCode: res.exitCode,
        outputTail: tail(res.stdout || res.stderr),
        outcome: "resume_failed",
        reason: `Turn ${t.turn} could not resume the session: ${resumeProblem}. The follow-up never ran, so the repair was not applied.`,
      };
    }

    // Money and turns come out of the CLI's own output. Not estimated, not modelled.
    const parsed = parseReportedUsage(a.seat.harness, res.stdout);
    usage = parsed;
    const charge = req.ledger.charge(parsed);
    chargedTotal += charge.chargedUsd;
    if (charge.reason && !charge.reason.startsWith("Charged $0.0000")) warnings.push(charge.reason);
    if (charge.breach) req.ledger.recordCapped(a.seat.id, charge.breach === "mission_cap" ? "mission_cap" : "cost_cap", charge.reason);

    lastSummary = summariseOutput(res.stdout);
    if (deps.onTurn) {
      deps.onTurn({ ...base, argv: composed.argv, turnsRun: t.turn, sessionId: session.sessionId, continuity, outcome: "completed", reason: "", exitCode: res.exitCode, durationMs, usage, chargedUsd: chargedTotal, outputTail: tail(res.stdout), commit: "", warnings, selfReport: lastSummary });
    }

    // A non-zero exit is a real failure. Some CLIs exit 0 while reporting is_error:true, so the payload
    // is checked too — an agent that says it failed did not succeed.
    if (res.exitCode !== 0 || reportsError(res.stdout)) {
      markStep(stepName, "failed", `turn ${t.turn} failed (exit ${res.exitCode ?? "null"}${reportsError(res.stdout) ? ", error payload" : ""})`, session.sessionId);
      markUnresolved(stepName);
      return {
        ...base,
        argv: composed.argv,
        sessionId: session.sessionId,
        continuity,
        turnsRun: turnsDispatched,
        chargedUsd: chargedTotal,
        usage,
        warnings,
        durationMs,
        exitCode: res.exitCode,
        selfReport: lastSummary,
        // stdout when there is any, stderr when that is all the CLI produced. Throwing stderr away is
        // what once hid `Error: Session not found`.
        outputTail: tail(res.stdout || res.stderr),
        outcome: "failed",
        reason:
          res.exitCode !== 0
            ? `${caps.name} exited ${res.exitCode} on turn ${t.turn}. ${res.stderr.trim() ? `It said: ${tail(res.stderr, 500)}` : "It wrote nothing to stderr."}`
            : `${caps.name} exited 0 but reported an error in its own output, so VH treats it as a failure rather than a success.`,
      };
    }

    /* The turn is confirmed: exit 0, no error payload. THIS is the point at which
       the effect may be called applied — and it is settled after the check, never
       before it, so a turn that reported failure is never recorded as done. */
    markApplied(stepName);
    markStep(stepName, "settled", lastSummary || "(the agent returned no summary)", session.sessionId);
  }

  // Verification: the repository's own check, in this seat's directory. This is the only thing that
  // makes "verified" true — the agent saying it worked never does.
  let verified = false;
  let verificationDetail = "No verification command is configured for this mission, so nothing was checked. This seat's work is UNVERIFIED.";
  if (deps.verify) {
    const v = await deps.verify(cwd);
    if (v.exitCode === 0) {
      verified = true;
      verificationDetail = `The repository's own check ran in ${cwd} and exited 0.`;
    } else if (v.exitCode === null) {
      verificationDetail = "The verification command did not run at all, so this is NOT a failed check — it is an unmeasured one. The seat is unverified either way.";
    } else {
      verificationDetail = `The repository's own check ran and FAILED (exit ${v.exitCode}). ${tail(v.stdout || v.stderr, 600)}`;
    }
  }

  // Evidence, measured while this seat's work is still the only thing in its tree.
  const gitEv = await collectGitEvidence(deps.git, cwd);

  /* Commit a writer's work on its own branch. Read-only seats never commit — a
     reviewer that commits is not a reviewer.

     THE IDEMPOTENCY RULE HERE. `git add -A` over a tree whose work is already
     committed is not free: it re-stages everything the earlier run produced and
     offers it for a second commit, which is how one seat's work turns into two
     commits and how a resume reports progress it did not make. So the commit is
     gated on the ONE fact that matters — did this invocation dispatch an agent?

       dispatched   → there may be new bytes; commit them (over the earlier commit).
       not dispatched → every turn was already applied, so there are no new bytes;
                       running `add -A` again would re-apply the effect that the
                       ledger already accounts for. Skip it and say so.

     Verification is NOT gated. It is a measurement of the tree as it stands now,
     and `verified` may only be true because the repository's own check actually
     ran and exited 0 in this invocation. */
  const commitStep = "commit";
  const priorCommit = steps.get(steps.stepId({ missionSlug: req.missionSlug, seatId: a.seat.id, step: commitStep }));
  let commitDetail = readOnly ? "Read-only seat; nothing to commit." : "No git runner, so the work could not be committed.";
  if (deps.git && !readOnly && !dispatchedAnyTurn) {
    const earlier = priorCommit?.state === "settled";
    commitDetail = earlier
      ? `Already committed by an earlier run of this mission${priorCommit.at ? ` (${new Date(priorCommit.at).toISOString()})` : ""}. This run dispatched no agent for this seat — every turn was already applied — so nothing was re-added and nothing was re-committed.`
      : "This run dispatched no agent for this seat (every turn was already applied by an earlier run), so nothing was added and nothing was committed.";
    idem.commitApplied = earlier;
    if (earlier) {
      warnings.push(`Skipped git commit for "${a.seat.id}": this run applied nothing, so re-staging the branch would re-apply work the step ledger already accounts for.`);
    }
  } else if (deps.git && !readOnly) {
    markStep(commitStep, "in_flight", `staging and committing ${branch} for ${req.missionSlug}`, session.sessionId);
    await git(deps, ["add", "-A"], cwd);
    const commit = await git(deps, ["-c", "user.email=vh@selfimpulse.selfimpulse", "-c", "user.name=VH", "commit", "-q", "-m", `vh(${a.seat.id}): ${req.missionSlug}`], cwd);
    commitDetail = commit.ok
      ? `Committed on ${branch}.`
      : commit.exitCode === null
        ? "Could not run git commit."
        : /nothing to commit|no changes added/i.test(commit.stderr + commit.stdout)
          ? "Nothing to commit — this seat changed no files."
          : `git commit exited ${commit.exitCode}: ${(commit.stderr || commit.stdout).trim().slice(0, 200)}`;
    const landed = commit.ok || /Committed on/.test(commitDetail);
    if (landed) {
      markApplied(commitStep);
      markStep(commitStep, "settled", commitDetail, session.sessionId);
    } else if (/nothing to commit/i.test(commitDetail)) {
      markStep(commitStep, "settled", commitDetail, session.sessionId);
    } else {
      markStep(commitStep, "failed", commitDetail, session.sessionId);
      markUnresolved(commitStep);
    }
    idem.commitApplied = commit.ok;
    idem.commitAppliedThisRun = commit.ok;
    if (priorCommit?.state === "settled" && commit.ok) {
      warnings.push(`This run re-committed "${a.seat.id}" on top of the commit an earlier run of this mission already applied — that is new work over an existing commit, not a second application of the same effect.`);
    }
  }

  /* A resumed seat's own verdict has to say WHY it is not a fresh one. "Completed"
     with no word about reuse would read as a second execution of the same work. */
  const reusedAll = idem.reused.length > 0 && !dispatchedAnyTurn && idem.unresolved.length === 0;
  const finalRecord: SeatRecord = {
    ...base,
    argv: lastArgv,
    sessionId: session.sessionId,
    continuity,
    /* ONLY the turns THIS invocation dispatched. A turn an earlier run applied and
       this one reused is NOT a turn that ran, and counting it is exactly the
       double-count a resume must not make. */
    turnsRun: turnsDispatched,
    chargedUsd: chargedTotal,
    usage,
    warnings,
    durationMs: last?.durationMs ?? 0,
    exitCode: last?.exitCode ?? null,
    verified,
    verificationDetail,
    git: gitEv,
    commit: commitDetail,
    selfReport: lastSummary,
    outputTail: tail(last?.stdout ?? ""),
    outcome: "completed",
    reason: reusedAll
      ? `Nothing was dispatched: ${idem.reused.join(", ")} ${idem.reused.length === 1 ? "was" : "were"} already applied by an earlier run of this mission and ${idem.reused.length === 1 ? "was" : "were"} not applied again. ${verified ? "The repository's own check was re-run against the worktree as it stands and exited 0." : `This invocation did not confirm it — ${verificationDetail}`}`
      : idem.reused.length > 0
        ? `${idem.reused.join(", ")} ${idem.reused.length === 1 ? "was" : "were"} already applied by an earlier run of this mission and ${idem.reused.length === 1 ? "was" : "were"} not repeated; the remaining turn(s) ran in this invocation.${verified ? " The repository's own check exited 0." : " Not verified — see verificationDetail."}`
        : verified
          ? "Completed and verified by the repository's own check."
          : "Completed, but not verified — see verificationDetail.",
  };

  if (!readOnly && commitDetail.includes("Committed on")) {
    globalReputationLedger.recordOutcome(a.seat.harness, { verifiedCommit: true });
    globalAgentBus.publish({
      channel: "#implementation-sync",
      sender: { seatId: a.seat.id, role: a.seat.role, harness: a.seat.harness, name: caps.name },
      mentions: ["@reviewer", "@architect"],
      intent: "handoff",
      content: `[Wave ${a.wave}] Changes committed on ${branch}: ${commitDetail}`,
    });
    globalAgentBus.writeBlackboard(`commits.${a.seat.id}`, `Worktree: ${cwd}\nBranch: ${branch}\n${commitDetail}`, a.seat.id, "contract");
  } else if (readOnly) {
    globalReputationLedger.recordOutcome(a.seat.harness, { accurateReview: true });
    globalAgentBus.publish({
      channel: "#qa-review",
      sender: { seatId: a.seat.id, role: a.seat.role, harness: a.seat.harness, name: caps.name },
      mentions: ["@all"],
      intent: "verification",
      content: `[Wave ${a.wave}] Review finished on ${reviewedRef}. Verdict: ${lastSummary || (verified ? "VERIFIED_PASS" : "DONE")}`,
    });
    globalAgentBus.writeBlackboard(`qa.verdict.${a.seat.id}`, `Ref: ${reviewedRef}\nVerdict: ${lastSummary || (verified ? "VERIFIED_PASS" : "DONE")}\nVerified: ${verified}`, a.seat.id, "test_criteria");
  }

  return finalRecord;
}

/* ------------------------------------------------------------------ evidence */

/**
 * Ask git what actually changed.
 *
 * `measured:false` is deliberately distinct from "no changes": if git could not run, VH does not know,
 * and an unknown must not be reported as a clean tree.
 */
export async function collectGitEvidence(gitRunner: GitRunner | undefined, cwd: string): Promise<GitEvidence> {
  if (!gitRunner) return { measured: false, detail: "No git runner is available, so VH cannot say what changed. This is not a clean tree — it is an unmeasured one.", additions: 0, deletions: 0, filesChanged: 0 };
  const api = gitApi(gitRunner);
  const status = await api.status(cwd);
  if (!status.ok) return { measured: false, detail: `git status failed: ${status.reason ?? "unknown reason"}`, additions: 0, deletions: 0, filesChanged: 0 };
  const diff = await api.diff(cwd);
  if (!diff.ok || !diff.summary) return { measured: false, detail: `git diff failed: ${diff.reason ?? "unknown reason"}`, additions: 0, deletions: 0, filesChanged: 0 };
  const files = diff.summary.files;
  return {
    measured: true,
    detail: files.length === 0 ? "git reports no changes in this worktree." : `${files.length} file(s) changed: ${files.map((f) => f.path).slice(0, 8).join(", ")}${files.length > 8 ? ", …" : ""}`,
    additions: diff.summary.totalAdditions,
    deletions: diff.summary.totalDeletions,
    filesChanged: files.length,
  };
}

/** Some CLIs exit 0 and put the failure in the payload. Both mean the same thing. */
export function reportsError(raw: string): boolean {
  for (const line of raw.split(/\r?\n/).reverse()) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as Record<string, unknown>;
      if (typeof o.is_error === "boolean") return o.is_error;
    } catch {
      /* not JSON */
    }
    break;
  }
  return /"is_error"\s*:\s*true/.test(raw);
}

/** The agent's own account of what it did — labelled as self-report, never as evidence. */
export function summariseOutput(raw: string): string {
  const texts: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as Record<string, unknown>;
      if (typeof o.result === "string") texts.push(o.result);
      else if (o.part && typeof o.part === "object") {
        const p = o.part as Record<string, unknown>;
        if (p.type === "text" && typeof p.text === "string") texts.push(p.text);
      }
    } catch {
      /* not JSON */
    }
  }
  if (texts.length === 0) return raw.trim().slice(-800);
  return texts.join("\n").trim().slice(-800);
}

function tail(s: string, n = OUTPUT_TAIL_CHARS): string {
  const t = s.trimEnd();
  /* §AUDIT SCRUB (claw-enterprise, MIT) — this is the one place a seat's raw
   * stdout/stderr becomes text that OUTLIVES the run: it lands in the seat
   * record, the mission record, the receipt events and the verification detail
   * an auditor reads later. A CLI that failed to push quotes its remote back
   * with the credential inside it, and the model's own transcript is echoed into
   * stdout. Truncate FIRST (the budget is the reason this function exists),
   * scrub SECOND, so a secret sitting in the discarded head cannot arrive via
   * the tail and a secret in the tail is caught on its way out.
   *
   * Ordinary tool output is unchanged — see src/security/auditScrub.ts. */
  return scrubAuditText(t.length > n ? `…(truncated ${t.length - n} chars)…\n${t.slice(-n)}` : t);
}

function unrunRecord(a: SeatAssignment, wt: WorktreePlan | null, outcome: SeatOutcome, reason: string): SeatRecord {
  // V11.6.1: resolver — never undefined, custom seats included.
  const caps = resolveCaps(a.seat.harness).caps;
  return {
    seatId: a.seat.id,
    role: a.seat.role,
    harness: a.seat.harness,
    harnessName: caps.name,
    bin: caps.bins[0] ?? "",
    argv: [],
    cwd: wt?.path ?? "",
    branch: wt?.branch ?? "",
    worktreePath: wt?.path ?? "",
    reviewedRef: "",
    reviewedSha: null,
    wave: a.wave,
    turnsRun: 0,
    sessionId: null,
    continuity: "none",
    outcome,
    reason,
    exitCode: null,
    durationMs: 0,
    usage: { costUsd: null, tokens: null, turns: null, source: a.seat.harness },
    chargedUsd: 0,
    verified: false,
    verificationDetail: "Never ran, so nothing was verified.",
    git: { measured: false, detail: "Never ran, so nothing was measured.", additions: 0, deletions: 0, filesChanged: 0 },
    commit: "Never ran, so nothing was committed.",
    warnings: [],
    selfReport: null,
    outputTail: "",
  };
}

/**
 * The one-sentence truth about a run.
 *
 * Written to survive being read by someone who did not watch it happen. It never says "success"
 * without saying what was verified, and it never hides a seat that could not run.
 */
export function buildSummary(o: {
  status: RunStatus;
  seats: SeatRecord[];
  verifiedCount: number;
  spentUsd: number;
  notRun: Array<{ seatId: string; reason: string }>;
  briefings: BriefingRecord[];
  snapshot: ReviewSnapshotRecord;
}): string {
  const ran = o.seats.filter((s) => s.turnsRun > 0).length;
  const parts: string[] = [];
  parts.push(`${ran} of ${o.seats.length} seats ran real CLI invocations; ${o.verifiedCount} were verified by the repository's own check.`);
  if (o.snapshot.built) parts.push(`Reviewers ran against snapshot ${o.snapshot.sha ? o.snapshot.sha.slice(0, 8) : o.snapshot.branch}.`);
  else if (o.snapshot.writerBranches.length === 0) parts.push("No review snapshot was built because no writer committed anything.");
  if (o.spentUsd > 0) parts.push(`Reported spend $${o.spentUsd.toFixed(4)}.`);
  else parts.push("No cost was reported by any CLI, so the true spend is unknown rather than zero.");
  if (o.notRun.length) parts.push(`${o.notRun.length} seat(s) never ran: ${o.notRun.map((n) => n.seatId).join(", ")}.`);
  if (o.briefings.some((f) => f.writtenTo.length === 0)) parts.push("At least one briefing could not be written, so some agents ran without the mission brief.");
  if (o.status === "blocked") parts.push("Nothing completed — this run produced no usable work.");
  return parts.join(" ");
}

/** Flatten a report into the lines a human reads in the UI. */
export function renderRun(report: TeamRunReport): string {
  const lines: string[] = [];
  lines.push(`TEAM RUN — ${report.status.toUpperCase()}`);
  lines.push(report.summary);
  if (report.snapshot.built) {
    lines.push("");
    lines.push(`review snapshot: ${report.snapshot.branch} @ ${report.snapshot.sha ?? "?"}`);
    lines.push(`  merged: ${report.snapshot.writerBranches.join(" + ")}`);
    for (const c of report.snapshot.conflicts) lines.push(`  ! ${c}`);
  }
  lines.push("");
  for (const s of report.seats) {
    lines.push(`[${s.wave}] ${s.seatId} (${s.role} · ${s.harnessName}) — ${s.outcome}`);
    lines.push(`    turns=${s.turnsRun} continuity=${s.continuity} exit=${s.exitCode ?? "n/a"} ${(s.durationMs / 1000).toFixed(1)}s charged=$${s.chargedUsd.toFixed(4)}`);
    lines.push(`    ${s.reason}`);
    lines.push(`    looked at: ${s.reviewedRef || "(nothing)"}`);
    lines.push(`    verification: ${s.verificationDetail}`);
    lines.push(`    git: ${s.git.detail}`);
    lines.push(`    commit: ${s.commit}`);
    if (s.sessionId) lines.push(`    session: ${s.sessionId}`);
    for (const w of s.warnings.slice(0, 4)) lines.push(`    ! ${w}`);
  }
  if (report.notRun.length) {
    lines.push("");
    lines.push("never ran:");
    for (const n of report.notRun) lines.push(`  ${n.seatId} — ${n.reason}`);
  }
  return lines.join("\n");
}

/** The briefing text for one seat, exposed so the UI can show exactly what an agent was told. */
export function seatBriefing(seat: TeamSeat, req: { objective: string; constraints?: string[]; doNotTouch?: string[]; testCommand?: string[]; readOnly?: boolean }): string {
  return briefingContents({
    objective: req.objective,
    constraints: req.constraints ?? [],
    doNotTouch: req.doNotTouch ?? [],
    testCommand: req.testCommand,
    seat,
    readOnly: req.readOnly,
  });
}
