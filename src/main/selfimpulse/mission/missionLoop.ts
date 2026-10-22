/**
 * §THE MISSION LOOP — VH 12.0: ONE engine — one canonical orchestrator over
 * VH's shared engines of record. (12.0.1 states the model precisely: this
 * module does NOT fuse the specialized stores underneath into one physical
 * store; it orchestrates them — one runtime owns the cycle, one ledger
 * (vh.missionLoop.v1) is the cycle spine, one API is the product surface.)
 *
 * VH 12.0 is the answer to a review that said it best: 11.14.10 organized the
 * product's shelves, but the features on them were still separate productions
 * — TEAMS, team self-evolution, the feedback loop, adaptive learning and
 * agent communication each had its own store, its own page(s), its own
 * vocabulary. This module is the product's spine made executable:
 *
 *   COMPOSE   →  DISPATCH   →  COMMUNICATE   →  EXECUTE   →  GATE   →  ADAPT
 *
 * ONE `runMissionLoopCycle()` drives a real team run through that whole arc
 * and folds the measured outcome back through the SAME engines a human used
 * to drive by hand across four pages:
 *
 *   The engines of record stay engines of record: team evolution, the
 *   autonomy/bandit store, lesson memory, the receipt engine, the inter-agent
 *   bus and crew persistence. What changed in 12.0 is that ONE runtime
 *   orchestrates them and ONE surface talks to that runtime — never to the
 *   fragments underneath.
 *
 *   • COMMUNICATE — every seat gets its dispatch on the inter-agent bus and
 *     the executor's real seat events land on the same channels (global bus).
 *   • EXECUTE     — `executeTeam` with the governance-arena preflight, the
 *     autonomy arms the bandit router picked, a signed budget ledger.
 *   • GATE        — the run's own gate verdict + arena stamp are the
 *     feedback; nothing is "graded" by this loop, it consumes the run's
 *     measured verdicts.
 *   • HUMAN FEEDBACK — (12.0.1) the operator rates any completed cycle
 *     1–5 with a comment through submitHumanFeedback(); the rating queues on
 *     every seat that ran and joins the seat's evidence at the next fold
 *     (1–2 criticism = weight-2 human evidence, 4–5 arms praise suppression,
 *     3 neutral) — the same pipeline the old Teams page drove by hand.
 *   • ADAPT       — the measured report feeds, in one place:
 *       – seat signals → team evolution store (candidates, human-gated),
 *       – bandit + elastic settlement → the autonomy store,
 *       – reflection → lesson memory (what this cycle proved),
 *       – one proof receipt per cycle (signed, verifiable, archived).
 *
 * The product surface (Loop page) talks to THIS module only — never to the
 * engines underneath, including the crew store, the bus and host-deps
 * adapters (12.0.1 rule: those are engine API, not page imports). The
 * engines stay as internal libraries the loop calls; the loop is the only
 * orchestrator. A page that imports
 * autonomyStore/lessons/teamEvolution directly is a fork of the engine, and
 * fork = the pre-12.0 disease this module exists to end.
 *
 * Honesty rules (same as the engines it calls):
 *   - Execution is `executeTeam` with real CLI deps in the app and injected
 *     deps in probes. There is no fallback that fakes a seat run.
 *   - Simulated harness runs stay experience-only for the bandit (the
 *     settlement rule), and signals always carry the seat's real flag.
 *   - Seat/team changes are proposed as CANDIDATES; a human approves them
 *     (SUGGEST) or the team's stored mode says AUTONOMOUS. The run-level mode
 *     passed to a cycle governs settlement; OFF also disables the evolution
 *     fold. Nothing the loop "learns" edits a team silently in SUGGEST.
 */
import { uid } from "../app/id";
import {
  PREBUILT_TEAMS,
  loadSavedTeams,
  saveTeams,
  upsertTeam,
  type CliAgentTeam,
  type TeamSeat,
} from "./agentTeam";
import {
  loadTeamEvoStore,
  saveTeamEvoStore,
  applyTeamFeedback,
  decideCandidate,
  applyCandidateToTeam,
  type TeamEvolutionCandidate,
  type TeamEvolveMode,
} from "./teamEvolution";
import { loadAutonomy, type AutonomyState } from "./autonomyStore";
import { type TeamRunReport, type TeamRunnerDeps } from "./teamExecutor";
import { globalAgentBus, type InterAgentMessage } from "./interAgentChannel";
import { hostRunnerDeps, noHostDeps } from "./hostDeps";
import { loadLessons } from "./lessons";
import {
  type MissionGraphAsk,
  type MissionGraphEmit,
  type MissionGraphHumanGate,
  type MissionGraphRunArgs,
  type MissionGraphRunResult,
} from "./runGraph";
import { composeAssignments } from "./missionAssignments";

/* The assignment recipe moved to `missionAssignments.ts` when the cycle became
 * a graph: the graph's compose step needs it, and a graph that reached back
 * into the orchestrator driving it would be a cycle in the module graph. It is
 * re-exported here so every existing import path keeps working.
 *
 * The graph's own surface is re-exported too, so a host that wants to run or
 * resume a cycle reaches the loop's front door and nothing else. */
export { composeAssignments, noHostDeps };
export type {
  MissionGraphAsk,
  MissionGraphEmit,
  MissionGraphHumanGate,
  MissionGraphRunArgs,
  MissionGraphRunResult,
};

/**
 * Continue a run that stopped at its gate.
 *
 * The graph runtime is loaded LAZILY, on the first cycle, for the same reason
 * the 3D force-graph library is: it is a large piece of machinery that is not
 * on the first-paint path, and a user who never runs a cycle should not pay
 * for it. The wrapper keeps the loop's front door the only door.
 */
export async function resumeMissionGraph(args: MissionGraphRunArgs, decision: string): Promise<MissionGraphRunResult> {
  const graph = await import("./runGraph");
  return graph.resumeMissionGraph(args, decision);
}

/* ─────────────────────────────────────────────────────────────── state ─── */

export type LoopPhase =
  | "idle"
  | "compose"
  | "dispatch"
  | "communicate"
  | "execute"
  | "gate"
  | "adapt";

export interface LoopSeatOutcome {
  seatId: string;
  role: string;
  harness: string;
  outcome: string;
  verified: boolean;
}

export interface LoopCycleRecord {
  cycleNo: number;
  missionId: string;
  objective: string;
  teamId: string;
  teamName: string;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  status: string;
  gate: { status: string; tier: string } | null;
  arena: { gate: string; digest: string } | null;
  arms: string[];
  seats: LoopSeatOutcome[];
  verifiedSeats: number;
  seatCount: number;
  spentUsd: number;
  /** 14.0 — measured-dollar honesty on the record: seats that reported tokens but no USD. */
  tokensOnlySeats?: number;
  /** 14.0 — the signed budget cap this cycle ran under (null = uncapped). */
  budgetUsd?: number | null;
  messagesOnBus: number;
  lessonsAdded: number;
  banditTrials: number;
  receipt: { hash: string; ok: boolean } | null;
  candidateIds: string[];
  /** What the human answered, when a run stopped at its gate and was
   *  continued. Null for a run that never paused. */
  humanDecision?: string | null;
  note: string;
}

export interface MissionLoopState {
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  running: boolean;
  currentPhase: LoopPhase;
  cycles: LoopCycleRecord[];
  feedbackByCycle: Record<string, CycleHumanFeedback>;
  lastError: string | null;
}

export interface CycleHumanFeedback {
  rating: number;
  comment: string;
  at: string;
}

const LS_KEY = "vh.missionLoop.v1";

function emptyLoopState(): MissionLoopState {
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    running: false,
    currentPhase: "idle",
    cycles: [],
    feedbackByCycle: {},
    lastError: null,
  };
}

export function loadMissionLoopState(): MissionLoopState {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY);
    if (!raw) return emptyLoopState();
    const parsed = JSON.parse(raw) as Partial<MissionLoopState>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.cycles)) return emptyLoopState();
    return {
      schemaVersion: 1,
      createdAt: parsed.createdAt ?? new Date().toISOString(),
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      running: parsed.running ?? false,
      currentPhase: parsed.currentPhase ?? "idle",
      cycles: parsed.cycles as LoopCycleRecord[],
      feedbackByCycle: (parsed as { feedbackByCycle?: Record<string, CycleHumanFeedback> }).feedbackByCycle ?? {},
      lastError: parsed.lastError ?? null,
    };
  } catch {
    return emptyLoopState();
  }
}

export function saveMissionLoopState(next: MissionLoopState): void {
  next.updatedAt = new Date().toISOString();
  try {
    globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    /* memory-only when storage is unavailable */
  }
}

export function subscribeMissionLoop(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === LS_KEY) cb();
  };
  globalThis.addEventListener?.("storage", onStorage);
  return () => globalThis.removeEventListener?.("storage", onStorage);
}

/* ──────────────────────────────────────────────────────────── the cycle ─── */

export interface MissionLoopEmit {
  (ev: { phase?: LoopPhase; note?: string; message?: InterAgentMessage }): void;
}

export interface MissionLoopRunArgs {
  team: CliAgentTeam;
  objective: string;
  /** The deps the loop executes with. The Loop page passes the host's real
   *  CLI deps; probes inject deterministic ones. When omitted the loop uses
   *  `noHostDeps()`, which reports every seat blocked — never faked. */
  deps?: TeamRunnerDeps;
  repoRoot?: string;
  /** The repository's own verification command, e.g. ["node", "test.js"]. */
  testCommand?: string[];
  /** The repository's base branch (default "main" — probes pass the real one). */
  baseBranch?: string;
  budgetCapUsd?: number;
  /** SUGGEST keeps humans in the loop (default when the team has no stored
   *  mode); AUTONOMOUS applies passing candidates immediately (Pro-gated by
   *  the settlement engine itself); OFF disables team evolution entirely. */
  mode?: TeamEvolveMode;
  emit?: MissionLoopEmit;
  now?: number;
  /** When set, the run may STOP at its gate and wait for a human. Off unless
   *  a host asks for it, so the default cycle behaves exactly as it always
   *  has. See `runGraph.ts`. */
  humanGate?: MissionGraphHumanGate | null;
  /** The run a RESUME continues. Set by `resumeMissionLoopCycle`; ignored
   *  by a fresh cycle, which mints its own run id. */
  resumeRunId?: string;
  /** Keep this run's steps in the run chain, so a crash can resume it. On
   *  for a run that may pause; off otherwise, because a run that cannot stop
   *  has nothing to resume. */
  durable?: boolean;
}

/**
 * The cycle's result. It carries the same fields it always did, plus the two
 * that describe a run that is WAITING: `paused` and `ask`. A paused cycle is
 * not a failed cycle and not a finished one, and the record says which.
 */
export type MissionLoopRunResult = MissionGraphRunResult;

/**
 * CONTINUE a cycle that stopped at its gate.
 *
 * The graph resumes from its own checkpoint, so the human's answer lands on
 * the exact run they were asked about — which is the whole point of the
 * pause: the state the human saw IS the state the answer applies to.
 *
 * The decision is a plain string, because the graph's interrupt carries
 * whatever the host put in the ask. "approved" and "refused" are the two the
 * product's gate card produces.
 */
export async function resumeMissionLoopCycle(
  args: MissionLoopRunArgs,
  decision: string,
): Promise<MissionLoopRunResult> {
  const { resumeMissionGraph } = await import("./runGraph");
  const now = args.now ?? Date.now();
  const cycleNo = loadMissionLoopState().cycles.length + 1;
  const missionId = `loop-${cycleNo}-${uid("cyc").slice(0, 8)}`;
  const emit: MissionLoopEmit = args.emit ?? (() => undefined);
  const result = await resumeMissionGraph(
    {
      team: args.team,
      objective: args.objective,
      deps: args.deps,
      repoRoot: args.repoRoot,
      testCommand: args.testCommand,
      baseBranch: args.baseBranch,
      budgetCapUsd: args.budgetCapUsd,
      mode: args.mode,
      emit,
      now,
      cycleNo,
      missionId,
      runId: args.resumeRunId ?? missionId,
      humanGate: args.humanGate ?? null,
      durable: true,
    },
    decision,
  );
  emit({ note: `cycle ${cycleNo} resumed with "${decision}" (${result.record.status})` });
  return result;
}

/**
 * The run a paused cycle is waiting on, if there is one.
 *
 * A UI asks this to know whether it should offer a gate card, and it asks
 * again after the human answers. Null is the honest answer when nothing is
 * waiting — not an empty list, because "nothing is waiting" and "something
 * is waiting and I have not found it" must not look the same.
 */
export function pendingMissionGate(): { missionId: string; runId: string; tier: string; status: string } | null {
  const state = loadMissionLoopState();
  const paused = state.cycles.find((c) => c.status === "awaiting-human");
  if (!paused) return null;
  return {
    missionId: paused.missionId,
    runId: paused.missionId,
    tier: paused.gate?.tier ?? "unverified",
    status: paused.gate?.status ?? "unknown",
  };
}

/**
 * ONE cycle of the Mission Loop. Runs the arc end to end against the real
 * engines and folds the measured outcome into the shared stores:
 *
 *   compose → dispatch → communicate → execute (arena-gated) → gate → adapt
 *
 * The arc itself is a GRAPH (`runGraph.ts`), which is what lets a run stop at
 * its gate and be continued, and what puts every step it takes into the run
 * chain. This function stays the cycle's front door: it owns the loop ledger
 * — the cycle number, the running flag, the failure record — and hands the
 * work to the graph.
 *
 * Returns everything the UI needs: the cycle record for the loop ledger, the
 * raw run report, the settlement, and any candidates the team's own evolution
 * engine proposed from THIS cycle's measured evidence.
 */
export async function runMissionLoopCycle(args: MissionLoopRunArgs): Promise<MissionLoopRunResult> {
  const { team, objective } = args;
  const now = args.now ?? Date.now();
  const startedAt = new Date(now).toISOString();
  const loopState = loadMissionLoopState();
  loopState.running = true;
  loopState.currentPhase = "compose";
  loopState.lastError = null;
  saveMissionLoopState(loopState);
  const emit: MissionLoopEmit = args.emit ?? (() => undefined);

  const cycleNo = loopState.cycles.length + 1;
  const missionId = `loop-${cycleNo}-${uid("cyc").slice(0, 8)}`;
  const fail = (note: string): LoopCycleRecord => {
    const record: LoopCycleRecord = {
      cycleNo,
      missionId,
      objective,
      teamId: team.id,
      teamName: team.name,
      startedAt,
      finishedAt: new Date().toISOString(),
      elapsedMs: Date.now() - now,
      status: "aborted",
      gate: null,
      arena: null,
      arms: [],
      seats: [],
      verifiedSeats: 0,
      seatCount: team.seats.length,
      spentUsd: 0,
      tokensOnlySeats: 0,
      budgetUsd: null,
      messagesOnBus: globalAgentBus.getMessages().length,
      lessonsAdded: 0,
      banditTrials: 0,
      receipt: null,
      candidateIds: [],
      note,
    };
    const next = loadMissionLoopState();
    next.running = false;
    next.currentPhase = "idle";
    next.lastError = note;
    next.cycles = [...next.cycles, record];
    saveMissionLoopState(next);
    return record;
  };

  try {
    /* The arc runs as a GRAPH now (runGraph.ts): compose → dispatch →
     * communicate → execute → gate → adapt, with every step recorded in the
     * run chain and a gate that can stop the run and wait for a human.
     * This function still owns the loop ledger — the cycle number, the
     * running flag, and the failure record — and hands the work over.
     *
     * The runtime is loaded lazily: it is large, and a user who never runs a
     * cycle should not pay for it on the first paint. */
    const { runMissionGraphCycle } = await import("./runGraph");
    const cycle = await runMissionGraphCycle({
      team,
      objective,
      deps: args.deps,
      repoRoot: args.repoRoot,
      testCommand: args.testCommand,
      baseBranch: args.baseBranch,
      budgetCapUsd: args.budgetCapUsd,
      mode: args.mode,
      emit,
      now,
      cycleNo,
      missionId,
      runId: missionId,
      humanGate: args.humanGate ?? null,
      durable: args.durable,
    });
    const record = cycle.record;

    const next = loadMissionLoopState();
    next.running = false;
    next.currentPhase = "idle";
    next.cycles = [...next.cycles, record];
    saveMissionLoopState(next);
    emit({ note: `cycle ${cycleNo} recorded (${record.status}, ${record.verifiedSeats}/${record.seatCount} verified)` });

    return cycle;
  } catch (err) {
    const note = err instanceof Error ? err.message : String(err);
    const record = fail(note);
    emit({ note: `cycle failed: ${note}` });
    return { record, report: null as unknown as TeamRunReport, updatedTeam: null, settled: null, candidates: [], receipt: null, paused: false, ask: null };
  }
}

/* ─────────────────────────────────────────────── the human gate (SUGGEST) ─── */

export interface LoopDecision {
  updatedStore: ReturnType<typeof loadTeamEvoStore>;
  decided: TeamEvolutionCandidate | null;
  updatedTeam: CliAgentTeam | null;
}

/**
 * A human decision on a candidate the loop's adaptation proposed. ACCEPTED
 * applies the candidate to the team (instructions revised) and marks the
 * store; REJECTED records the refusal. The decision lands in the SAME store
 * the next cycle reads — that is how a human correction becomes the next
 * cycle's instruction, with no separate bookkeeping.
 */
export function decideLoopCandidate(args: {
  team: CliAgentTeam;
  candidateId: string;
  decision: "ACCEPTED" | "REJECTED";
  by: string;
}): LoopDecision {
  const store = loadTeamEvoStore();
  const decided = decideCandidate(store, args.candidateId, args.decision, args.by);
  saveTeamEvoStore(decided);
  const candidate = decided.candidates.find((c) => c.id === args.candidateId);
  let updatedTeam: CliAgentTeam | null = null;
  if (candidate && candidate.status === "DECIDED" && candidate.decision === "ACCEPTED") {
    updatedTeam = applyCandidateToTeam(args.team, candidate, args.by);
  }
  return { updatedStore: decided, decided: candidate ?? null, updatedTeam };
}

/* ─────────────────────────────────── 12.0.1: the surface's crew/bus/feedback API ─── */
/* The Loop page imports THIS module only (navAlign pins it). These are the
 * adapters the page used to reach for directly (agentTeam, hostDeps,
 * interAgentChannel) — now they are engine API. */

/** Crew persistence, owned by the engine: saved crews, else the prebuilts. */
export function loadCrews(): CliAgentTeam[] {
  const saved = loadSavedTeams();
  return saved.length ? saved : PREBUILT_TEAMS;
}

/** Upsert + persist one crew; returns the next list for the surface's state. */
export function persistCrew(current: CliAgentTeam[], team: CliAgentTeam): CliAgentTeam[] {
  const next = upsertTeam(current, team);
  saveTeams(next);
  return next;
}

/** The host's real CLI deps (native shell on desktop; honest simulation on
 *  browser hosts). Probes inject deterministic deps instead — never this. */
export function loopHostDeps(opts?: { testCommand?: string }): TeamRunnerDeps {
  return hostRunnerDeps(opts);
}

/** The inter-agent bus, projected through the engine. The page subscribes
 *  here; it never imports the channel module itself. */
export interface LoopBusProjection {
  messages: InterAgentMessage[];
  subscribe(listener: (msg: InterAgentMessage) => void): () => void;
}
export function loopBusFeed(): LoopBusProjection {
  // 16.9.0-windows-fix: the closure keeps the bus instance. The previous
  // `subscribe: globalAgentBus.subscribe` detached the method, so a mount
  // effect calling it ran with `this` = the projection literal and
  // `this.listeners.add` threw "Cannot read properties of undefined
  // (reading 'add')" — every LoopPage mount crashed into the error boundary
  // (proven with stack trace in a real browser on 14.1.1).
  return {
    messages: globalAgentBus.getMessages(),
    subscribe: (listener: (msg: InterAgentMessage) => void): (() => void) => globalAgentBus.subscribe(listener),
  };
}

export interface HumanFeedbackResult {
  ok: boolean;
  error?: string;
}

/**
 * The explicit human feedback API (12.0.1): rate a completed cycle 1-5 with a
 * comment. The rating is attached to every seat that ran that cycle through
 * the SAME applyTeamFeedback pipeline the pre-12.0 Teams page drove by hand,
 * so it lands in the shared team-evolution store and is folded at the next
 * ADAPT: 1-2 becomes weight-2 human evidence, 4-5 arms praise suppression,
 * 3 is neutral. The loop state keeps one current entry per cycle. Returns
 * { ok: false, error } without touching any store when the rating or the
 * cycle is invalid.
 *
 * 12.0.2 integrity rules: (a) the submitted teamId MUST equal the team that
 * actually ran the cycle — mismatched-team feedback is refused before any
 * store is touched; (b) re-rating the same cycle before the fold supersedes
 * the unconsumed queued entry (one current human input per run), it does not
 * accumulate — the verbatim submission history still records every rating.
 *
 * 12.0.3 rating-scope rule: only cycles that produced measured seat outcomes
 * can be rated. An ABORTED cycle (nothing executed) is refused with an
 * explicit error; a gate-FAIL/blocked cycle whose seats ran stays ratable.
 */
export function submitHumanFeedback(args: {
  cycleId: string;
  teamId: string;
  rating: number;
  comment: string;
  nowIso?: string;
}): HumanFeedbackResult {
  if (!Number.isInteger(args.rating) || args.rating < 1 || args.rating > 5) {
    return { ok: false, error: "rating must be an integer 1..5" };
  }
  const state = loadMissionLoopState();
  const cycle =
    state.cycles.find((c) => c.missionId === args.cycleId) ??
    state.cycles.find((c) => String(c.cycleNo) === args.cycleId);
  if (!cycle) return { ok: false, error: `no recorded cycle matches ${args.cycleId}` };
  // 12.0.2 — team binding: a rating may only attach to the team that actually ran the cycle.
  // Without this, a caller could file feedback for Team A's cycle under Team B's id and the
  // rating would land on Team B's seat records.
  if (cycle.teamId !== args.teamId) {
    return { ok: false, error: `cycle ${cycle.missionId} ran team ${cycle.teamId}, not ${args.teamId}` };
  }
  // 12.0.3 — only cycles that RAN can be rated. An aborted cycle executed
  // nothing (no seats, no verdict), so feedback on it would be pretend.
  // Gate-FAIL / blocked cycles DID run their seats and stay ratable: humans
  // rate exactly the runs that went wrong.
  if (cycle.status === "aborted") {
    return { ok: false, error: `cycle ${cycle.missionId} aborted before any seat ran — nothing to rate` };
  }
  if (cycle.seats.length === 0) return { ok: false, error: "the cycle has no seat records to attach feedback to" };
  const now = args.nowIso ?? new Date().toISOString();
  let store = loadTeamEvoStore();
  for (const seat of cycle.seats) {
    store = applyTeamFeedback(store, {
      teamId: args.teamId,
      seatId: seat.seatId,
      runId: cycle.missionId,
      rating: args.rating,
      comment: args.comment,
      nowIso: now,
    });
  }
  saveTeamEvoStore(store);
  state.feedbackByCycle = {
    ...state.feedbackByCycle,
    [cycle.missionId]: { rating: args.rating, comment: args.comment, at: now },
  };
  saveMissionLoopState(state);
  return { ok: true };
}

/** The cycle's current human rating entry, or null. Pure read for the surface. */
export function humanFeedbackFor(state: MissionLoopState, cycleId: string): CycleHumanFeedback | null {
  return state.feedbackByCycle[cycleId] ?? null;
}

/* ─────────────────────────────────────────────── multi-cycle loop runner ─── */

export interface MissionLoopBatchArgs extends MissionLoopRunArgs {
  cycles: number;
  /** One workspace (repo + base branch) per mission. The executor keeps each
   *  seat's worktree on disk as evidence (probes read it after the run), so
   *  every mission needs its own checkout. Optional: falls back to repoRoot. */
  workspaces?: Array<{ repoRoot: string; baseBranch: string }>;
  /** Between cycles: after a human approved a candidate, the batch uses the
   *  UPDATED team so improvement is actually carried into the next run. */
  applyApproved?: (candidate: TeamEvolutionCandidate, team: CliAgentTeam) => CliAgentTeam;
  onCycle?: (result: MissionLoopRunResult, index: number) => void;
}

export async function runMissionLoopBatch(args: MissionLoopBatchArgs): Promise<MissionLoopRunResult[]> {
  const out: MissionLoopRunResult[] = [];
  let team = args.team;
  const ws = args.workspaces ?? [];
  for (let i = 0; i < args.cycles; i++) {
    const w = ws[i % ws.length];

    const result = await runMissionLoopCycle({
      ...args,
      team,
      ...(w ? { repoRoot: w.repoRoot, baseBranch: w.baseBranch } : {}),
    });
    out.push(result);
    if (args.onCycle) args.onCycle(result, i);
    // Autonomous mode may have grown the team (elastic seats): carry it forward.
    if (result.updatedTeam) team = result.updatedTeam;
    // SUGGEST: if the caller approved candidates between cycles, carry the
    // updated team forward too.
    if (args.applyApproved) {
      const store = loadTeamEvoStore();
      const pending = store.candidates.filter((c) => c.teamId === team.id && c.status === "PROPOSED");
      for (const c of pending) {
        const decision = decideLoopCandidate({ team, candidateId: c.id, decision: "ACCEPTED", by: "mission-loop-batch" });
        if (decision.updatedTeam) team = decision.updatedTeam;
      }
    }
  }
  return out;
}

/** Convenience: full loop state with the candidates the human gate still owes
 *  a decision on, for the current team. */
export function pendingCandidates(teamId: string): TeamEvolutionCandidate[] {
  return loadTeamEvoStore().candidates.filter((c) => c.teamId === teamId && c.status === "PROPOSED");
}

export function autonomySnapshot(): AutonomyState {
  return loadAutonomy();
}

export interface LessonDigestEntry {
  id: string;
  kind: string;
  text: string;
  createdAt: number;
}

/** Recent lesson memory, newest first — the engine's view of what cycles
 *  taught. The page reads THIS, never the lessons store directly. */
export function lessonDigest(count = 4): LessonDigestEntry[] {
  return loadLessons()
    .slice(-count)
    .reverse()
    .map((l) => ({ id: l.id, kind: l.kind, text: l.text, createdAt: l.createdAt }));
}

/* 12.1.0 — KNOWLEDGE FORGE: books → human-approved skills (engine API). The
 * Loop page imports this module only (navAlign pins it), so the forge's
 * functions are engine API. */
export {
  proposeKnowledgeSkill,
  decideKnowledgeProposal,
  loadKnowledgeProposals,
  extractStructure,
  type KnowledgeProposal,
  type KnowledgeProvenance,
  type Distiller,
  type ForgeDeps,
} from "./knowledgeSkills";

/* keep types referenced for tsc consumers */
export type {
  TeamEvolutionCandidate,
  TeamEvolveMode,
  InterAgentMessage,
  CliAgentTeam,
  TeamSeat,
};
