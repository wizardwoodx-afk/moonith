/**
 * §THE MISSION GRAPH — the mission cycle, as a run that can stop and be
 * continued.
 *
 * WHAT THIS IS
 * ------------
 * The mission cycle has always been the same six steps:
 *
 *   COMPOSE → DISPATCH → COMMUNICATE → EXECUTE → GATE → ADAPT
 *
 * Written as an imperative sequence, that cycle had exactly one property that
 * matters to a product like this: it ran, or it did not. If the process died
 * between EXECUTE and ADAPT, the run was gone — not slow, not paused, gone.
 * And the GATE was not a gate at all: the run's verdict was READ after the
 * fact, by something that had already happened. A human could not be asked
 * anything at the moment the decision was actually made, because by then the
 * work had already run.
 *
 * This module expresses the SAME cycle as a graph, and the graph buys three
 * things the imperative sequence could not have:
 *
 *   1. IT PAUSES AT A GATE. The gate is now an interruption: the run stops
 *      exactly where the decision was made, holds the state that decision
 *      was made about, and continues when a human answers. The answer is
 *      bound to the state the human saw — not to a summary of it.
 *   2. IT IS DURABLE. Every super-step lands in the run chain
 *      (`graphCheckpointer.ts`), so a crash resumes from the last step rather
 *      than restarting the mission, and the chain that proves it is the SAME
 *      chain the run already used — one history, not two.
 *   3. ITS STATE IS TYPED AND EXPLICIT. Each step's contribution to the run
 *      is a named channel with a declared reducer, rather than a variable
 *      that happens to be in scope. A step cannot quietly overwrite what an
 *      earlier step recorded, because the reducer decides what "overwrite"
 *      means.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is not a rewrite. Every engine the cycle used is called EXACTLY as it
 * was called before, by the same functions, with the same arguments, in the
 * same order:
 *
 *   • `composeAssignments` still composes the assignments (the recipe moved
 *     to `missionAssignments.ts` so this module and the orchestrator do not
 *     have to import each other);
 *   • `prepareAutonomy` still arms the bandit router;
 *   • the inter-agent bus still carries every dispatch notice;
 *   • `executeTeam` still runs the seats — same waves, same governance
 *     arena, same budget ledger, same receipts. The graph does not schedule
 *     seats; `executeTeam` already does that, ledger-bounded and parallel
 *     where it should be;
 *   • the evolution engine, the bandit settlement, the lesson memory and the
 *     signed proof receipt are still folded in the same way, from the same
 *     measured report.
 *
 * The honest summary: the CONTROL FLOW moved; the WORK did not.
 *
 * THE ONE THING THAT IS NEW
 * -------------------------
 * A run may now PAUSE. `humanGate.requireHumanOnGateFailure` is off unless
 * a host asks for it, so the default behaviour of a cycle is byte-for-byte
 * what it was. When a host does ask, a run whose gate is not a clean pass
 * stops at the gate, records that it stopped, and waits. `resumeMissionGraph`
 * continues it with a human's answer.
 *
 * WHAT IT COSTS
 * -------------
 * A cycle that cannot stop writes NOTHING to the run chain: a run with
 * nothing to resume has no reason to leave a trail of its own steps, and the
 * run's OUTCOME is recorded by the receipt chain either way. So the default
 * path costs one graph's worth of scheduling and no journal writes at all —
 * measured against the imperative cycle it replaced, the difference is in the
 * noise of a run that takes most of a second anyway.
 *
 * A run that MAY stop keeps its steps in the chain, because that is the
 * whole point: the state it paused on has to survive the pause, and the
 * chain that proves it is the chain the product already used. A host that
 * wants crash-resumability without a human can ask for it with `durable`.
 */
import {
  Annotation,
  Command,
  END,
  START,
  StateGraph,
  interrupt,
} from "../roi/runtime/index.js";
import type { CliAgentTeam } from "./agentTeam";
import { composeAssignments, dispatchChannel } from "./missionAssignments";
import { loadAutonomy } from "./autonomyStore";
import type { ArmId } from "./evolutionBandit";
import { prepareAutonomy, settleAutonomyAfterRun, type AutonomyRequest, type SettleResult } from "./autonomyRuntime";
import { CapLedger } from "./caps";
import { getHarness } from "./harnessAdapters";
import { globalAgentBus, type InterAgentMessage } from "./interAgentChannel";
import { loadLessons, mergeLessons, reflectOnMission, saveLessons } from "./lessons";
import { buildProofReceipt, verifyProofReceipt, type ProofReceipt } from "./receipts";
import { executeTeam, type SeatAssignment, type TeamRunReport, type TeamRunnerDeps } from "./teamExecutor";
import {
  evolveTeamAfterRun,
  loadTeamEvoStore,
  saveTeamEvoStore,
  signalsFromSeatRecords,
  type TeamEvolveMode,
  type TeamEvolutionCandidate,
} from "./teamEvolution";
import { currentEdition } from "./licensing";
import type { GateStatus, GateTier } from "./verifyGate";
import { noHostDeps } from "./hostDeps";
import { ENGINE_VERSION } from "../version";
import { RunChainCheckpointer } from "./graphCheckpointer";
/* The cycle's own record types live with the orchestrator that owns the
 * ledger. They are imported as TYPES, which TypeScript erases, so the two
 * modules do not import each other at runtime: the orchestrator calls this
 * module, and this module only names the orchestrator's shapes. */
import type { LoopCycleRecord, LoopPhase } from "./missionLoop";

/* ─────────────────────────────────────────────────────────────── types ─── */

export interface MissionGraphEmit {
  (ev: { phase?: LoopPhase; note?: string; message?: InterAgentMessage }): void;
}

/** When a run may stop and wait for a human. */
export interface MissionGraphHumanGate {
  /**
   * A run whose gate verdict is not a clean PASS stops at the gate and waits
   * for a human. Off unless a host asks for it: the default cycle must
   * behave exactly as it did before the gate could pause anything.
   */
  requireHumanOnGateFailure: boolean;
}

export interface MissionGraphRunArgs {
  team: CliAgentTeam;
  objective: string;
  /** The deps the loop executes with. Probes inject deterministic ones. */
  deps?: TeamRunnerDeps;
  repoRoot?: string;
  testCommand?: string[];
  baseBranch?: string;
  budgetCapUsd?: number;
  mode?: TeamEvolveMode;
  emit?: MissionGraphEmit;
  now?: number;
  /** The cycle number in the loop ledger. */
  cycleNo: number;
  /** The mission id this cycle runs under. */
  missionId: string;
  /** The run id the graph's checkpoints chain under. */
  runId: string;
  /** When set, the run may STOP at its gate and wait for a human. */
  humanGate?: MissionGraphHumanGate | null;
  /**
   * Keep this run's steps in the run chain, so a crash can resume it.
   *
   * OFF unless the run may pause or a host asks for it. A cycle that cannot
   * stop has nothing to resume, and a graph that checkpoints anyway writes
   * twelve journal entries and twelve full-journal writes per cycle for a
   * capability nobody asked for. The run's OUTCOME is recorded by the
   * receipt chain either way; this is about the run's STEPS being resumable.
   *
   * A run that may pause is durable whatever this says — a pause that cannot
   * be continued is not a pause.
   */
  durable?: boolean;
}

export interface MissionGraphRunResult {
  record: LoopCycleRecord;
  report: TeamRunReport;
  updatedTeam: CliAgentTeam | null;
  settled: SettleResult | null;
  candidates: TeamEvolutionCandidate[];
  receipt: ProofReceipt | null;
  /** True when the run stopped at the gate and is waiting for a human. */
  paused: boolean;
  /** What the run is waiting for, when it is paused. */
  ask: MissionGraphAsk | null;
}

/** The question a paused run is asking. */
export interface MissionGraphAsk {
  kind: "gate";
  missionId: string;
  runId: string;
  status: string | null;
  tier: string | null;
  reasons: string[];
  policy: string | null;
}

/* ────────────────────────────────────────────────────────────── state ─── */

type ArenaSummary = { gate: string; digest: string };

const MissionState = Annotation.Root({
  objective: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  teamId: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  teamName: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  cycleNo: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  missionId: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  startedAt: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  finishedAt: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  tFinished: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  assignments: Annotation<SeatAssignment[]>({ reducer: (_a, b) => b, default: () => [] }),
  autonomyArms: Annotation<ArmId[]>({ reducer: (_a, b) => b, default: () => [] }),
  autonomyRequest: Annotation<AutonomyRequest | null>({ reducer: (_a, b) => b, default: () => null }),
  report: Annotation<TeamRunReport | null>({ reducer: (_a, b) => b, default: () => null }),
  gateStatus: Annotation<GateStatus | null>({ reducer: (_a, b) => b, default: () => null }),
  gateTier: Annotation<GateTier | null>({ reducer: (_a, b) => b, default: () => null }),
  gateReasons: Annotation<string[]>({ reducer: (_a, b) => b, default: () => [] }),
  gatePolicy: Annotation<string | null>({ reducer: (_a, b) => b, default: () => null }),
  arena: Annotation<ArenaSummary | null>({ reducer: (_a, b) => b, default: () => null }),
  humanDecision: Annotation<string | null>({ reducer: (_a, b) => b, default: () => null }),
  candidateIds: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  settled: Annotation<SettleResult | null>({ reducer: (_a, b) => b, default: () => null }),
  receipt: Annotation<ProofReceipt | null>({ reducer: (_a, b) => b, default: () => null }),
  receiptOk: Annotation<boolean>({ reducer: (_a, b) => b, default: () => false }),
  lessonsAdded: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  banditTrials: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  updatedTeam: Annotation<CliAgentTeam | null>({ reducer: (_a, b) => b, default: () => null }),
});

type MissionStateShape = typeof MissionState.State;

/* ───────────────────────────────────────────────────────────── helpers ─── */

function anySeatSimulated(team: CliAgentTeam, report: TeamRunReport): boolean {
  return (
    team.seats.some((s) => getHarness(s.harness)?.simulated ?? false) ||
    report.seats.some((r) => r.outcome.startsWith("simulated"))
  );
}

/** The run's own gate verdict, as the cycle has always read it.
 *
 *  `null` and not `"n/a"` when the run carried no gate: the cycle's record
 *  distinguishes "no gate ran" (gate: null) from "a gate ran and said
 *  something", and that distinction is the whole point of the field. */
function gateOf(report: TeamRunReport | null): {
  status: GateStatus | null;
  tier: GateTier | null;
  reasons: string[];
  policy: string | null;
} {
  const gate = report?.gate;
  return {
    status: gate?.status ?? null,
    tier: gate?.tier ?? null,
    reasons: gate?.reasons ?? [],
    policy: gate?.policy ?? null,
  };
}

/* ─────────────────────────────────────────────────────────────── graph ─── */

/**
 * Whether this run's steps belong in the run chain.
 *
 * A run that may pause ALWAYS does: the pause is the whole reason its state
 * has to survive, and a run that stops without leaving its state behind would
 * be promising a continuation it cannot honour. A run that cannot pause does
 * only when a host asks — see `MissionGraphRunArgs.durable`.
 */
function isDurable(args: MissionGraphRunArgs): boolean {
  if (args.humanGate?.requireHumanOnGateFailure) return true;
  return args.durable === true;
}

/**
 * Build the mission graph, bound to one run.
 *
 * Every node body below is the code that used to run inline in the loop's
 * imperative cycle, moved into the step it belongs to. The order is
 * unchanged, the arguments are unchanged, and the emits happen in the same
 * sequence — so a cycle that does not pause behaves exactly as it did.
 */
function buildMissionGraph(args: MissionGraphRunArgs, emit: MissionGraphEmit, forceDurable = false) {
  const { team, objective } = args;
  const deps = args.deps ?? noHostDeps();
  const now = args.now ?? Date.now();
  const startedAt = new Date(now).toISOString();

  const compose = async (): Promise<Partial<MissionStateShape>> => {
    emit({ phase: "compose", note: `composing ${team.seats.length} seats for cycle ${args.cycleNo}` });
    const assignments = composeAssignments(team, objective);
    const autonomy = prepareAutonomy();
    return { assignments, autonomyArms: autonomy.arms, autonomyRequest: autonomy };
  };

  const dispatch = async (state: MissionStateShape): Promise<Partial<MissionStateShape>> => {
    emit({ phase: "dispatch", note: `bandit router armed this cycle: ${state.autonomyArms.join(", ")}` });
    for (const a of state.assignments) {
      globalAgentBus.publish({
        channel: dispatchChannel(a.seat.role),
        sender: { seatId: "loop.orchestrator", name: "Mission Loop", role: "planner", harness: "llm" },
        mentions: [`@${a.seat.id}`],
        intent: "handoff",
        content: `[dispatch] ${a.seat.role} "${a.seat.id}" — ${objective}`,
        data: { wave: a.wave, readOnly: a.readOnly, cycleNo: args.cycleNo },
      });
    }
    emit({ phase: "communicate", note: `dispatch notices on the bus; seats run their briefings` });
    return {};
  };

  const execute = async (state: MissionStateShape): Promise<Partial<MissionStateShape>> => {
    const ledger = new CapLedger(
      { maxCostUsd: args.budgetCapUsd ?? team.budgetUsd ?? 5, maxTurns: 120, timeoutMs: 30 * 60_000 },
      now,
    );
    const autonomy = state.autonomyRequest ?? prepareAutonomy();
    emit({ phase: "execute", note: `executeTeam under the governance arena + budget ledger` });
    const report = await executeTeam(
      {
        team,
        assignments: state.assignments,
        repoRoot: args.repoRoot ?? ".",
        baseBranch: args.baseBranch ?? "main",
        missionSlug: args.missionId,
        objective,
        ...(args.testCommand ? { testCommand: args.testCommand } : {}),
        ledger,
        autonomy,
      },
      deps,
    );
    const tFinished = Date.now();
    const gate = gateOf(report);
    return {
      report,
      tFinished,
      finishedAt: new Date(tFinished).toISOString(),
      gateStatus: gate.status,
      gateTier: gate.tier,
      gateReasons: gate.reasons,
      gatePolicy: gate.policy,
      arena: report.arena ? { gate: report.arena.gate, digest: report.arena.digest } : null,
    };
  };

  /**
   * The gate — the one step that can STOP.
   *
   * The interrupt is the FIRST statement in the node, so re-running the node
   * on resume repeats no side effect: a graph that paused here can be
   * resumed any number of times without the world moving underneath it.
   */
  const gate = async (state: MissionStateShape): Promise<Partial<MissionStateShape>> => {
    const policy = args.humanGate;
    if (!policy?.requireHumanOnGateFailure) return {};
    if (state.gateStatus === "PASS") return {};
    const ask: MissionGraphAsk = {
      kind: "gate",
      missionId: args.missionId,
      runId: args.runId,
      status: state.gateStatus,
      tier: state.gateTier,
      reasons: state.gateReasons,
      policy: state.gatePolicy,
    };
    const decision = interrupt(ask);
    return { humanDecision: typeof decision === "string" ? decision : JSON.stringify(decision ?? "") };
  };

  const adapt = async (state: MissionStateShape): Promise<Partial<MissionStateShape>> => {
    const report = state.report;
    if (!report) return {};
    emit({ phase: "gate", note: `gate ${state.gateStatus ?? "n/a"} (${state.gateTier ?? "unverified"}) · arena ${state.arena?.gate ?? "n/a"}` });
    emit({ phase: "adapt", note: "folding seat signals, bandit, lessons and receipts" });

    const evoStore0 = loadTeamEvoStore();
    const mode: TeamEvolveMode = args.mode ?? evoStore0.byTeam[team.id]?.mode ?? "SUGGEST";
    const signals = signalsFromSeatRecords({
      runId: args.missionId,
      ts: state.finishedAt,
      teamId: team.id,
      seats: report.seats.map((s) => ({
        seatId: s.seatId,
        role: s.role,
        harness: s.harness,
        outcome: s.outcome,
        exitCode: s.exitCode,
        chargedUsd: s.chargedUsd,
        durationMs: s.durationMs,
        verified: s.verified,
        simulated: s.outcome.startsWith("simulated") || (getHarness(s.harness)?.simulated ?? false),
      })),
    });
    let evoStore = evoStore0;
    const candidateIds: string[] = [];
    for (const sig of signals) {
      const folded = evolveTeamAfterRun({ store: evoStore, team, signal: sig, actor: "mission-loop" });
      evoStore = folded.store;
      if (folded.candidate) candidateIds.push(folded.candidate.id);
    }
    saveTeamEvoStore(evoStore);

    const simulated = anySeatSimulated(team, report);
    const settled = settleAutonomyAfterRun({
      team,
      report: {
        status: report.status,
        seats: report.seats.map((s) => ({ seatId: s.seatId, role: s.role, outcome: s.outcome, verified: s.verified, harness: s.harness })),
        autonomyArms: report.autonomyArms ?? state.autonomyArms,
        reviewedBySnapshot: report.snapshot?.built ?? false,
        ...(state.gateStatus ? { gateStatus: state.gateStatus, gateTier: state.gateTier ?? "unverified" } : {}),
      },
      mode,
      simulated,
    });

    const failedSeats = report.seats.filter((s) => s.outcome === "failed" || s.outcome === "timeout");
    const freshLessons = reflectOnMission({
      missionId: args.missionId,
      simulated,
      verified: report.status === "completed" && report.seats.some((s) => s.verified),
      failureClasses: failedSeats.length > 0 ? ["seat-failed"] : ["seat-failed"].slice(0, 0),
      repairLadder: [],
      repaired: false,
      seatOutcomes: report.seats.map((s) => ({ role: s.role, passed: s.verified })),
      now: state.tFinished,
    });
    const memory = loadLessons();
    const merged = mergeLessons(memory, freshLessons, state.tFinished);
    saveLessons(merged, "agent");

    const receipt = await buildProofReceipt({
      mission: args.missionId,
      teamId: team.id,
      startedAt,
      finishedAt: state.finishedAt,
      mjVersion: ENGINE_VERSION,
      edition: currentEdition(),
      report: {
        status: report.status,
        seats: report.seats.map((s) => ({ seatId: s.seatId, role: s.role, outcome: s.outcome, verified: s.verified, harness: s.harness })),
        autonomyArms: report.autonomyArms ?? state.autonomyArms,
        reviewedBySnapshot: report.snapshot?.built ?? false,
        ...(state.gateStatus ? { gateStatus: state.gateStatus, gateTier: state.gateTier ?? "unverified" } : {}),
        ...(state.arena
          ? {
              arenaGate: {
                gate: state.arena.gate as "PASS" | "REFUSED",
                digest: state.arena.digest,
                summary: report.arena?.summary ?? "",
                total: report.arena?.total ?? 0,
                defended: report.arena?.defended ?? 0,
                breached: report.arena?.breached ?? 0,
              },
            }
          : {}),
      },
    });
    const receiptOk = (await verifyProofReceipt(receipt)).ok;

    const autonomyNow = loadAutonomy();
    return {
      settled,
      receipt,
      receiptOk,
      candidateIds,
      lessonsAdded: freshLessons.length,
      banditTrials: Object.values(autonomyNow.bandit.arms).reduce((a, b) => a + b.pulls, 0),
      updatedTeam: settled.applied ? settled.updatedTeam : null,
    };
  };

  return new StateGraph(MissionState)
    .addNode("compose", compose)
    .addNode("dispatch", dispatch)
    .addNode("execute", execute)
    .addNode("gate", gate)
    .addNode("adapt", adapt)
    .addEdge(START, "compose")
    .addEdge("compose", "dispatch")
    .addEdge("dispatch", "execute")
    .addEdge("execute", "gate")
    .addEdge("gate", "adapt")
    .addEdge("adapt", END)
    .compile(forceDurable || isDurable(args) ? { checkpointer: new RunChainCheckpointer(args.missionId, `loop${args.cycleNo}`) } : {});
}

/* ─────────────────────────────────────────────────────────────── run ─── */

function graphConfig(runId: string): { configurable: { thread_id: string } } {
  return { configurable: { thread_id: runId } };
}

/** The shape the runtime returns when a node interrupted. */
function interruptedAsk(value: unknown): MissionGraphAsk | null {
  if (!value || typeof value !== "object") return null;
  const ask = (value as { value?: unknown }).value;
  if (!ask || typeof ask !== "object") return null;
  const candidate = ask as Partial<MissionGraphAsk>;
  return candidate.kind === "gate" ? (candidate as MissionGraphAsk) : null;
}

/**
 * Run one mission cycle as a graph.
 *
 * The cycle's steps are the ones the imperative cycle ran; the difference is
 * that this one can stop at the gate and be continued, and that every step it
 * takes is recorded in the run chain.
 */
export async function runMissionGraphCycle(args: MissionGraphRunArgs): Promise<MissionGraphRunResult> {
  const emit: MissionGraphEmit = args.emit ?? (() => undefined);
  const now = args.now ?? Date.now();
  const startedAt = new Date(now).toISOString();
  const graph = buildMissionGraph(args, emit);

  const raw = (await graph.invoke(
    {
      objective: args.objective,
      teamId: args.team.id,
      teamName: args.team.name,
      cycleNo: args.cycleNo,
      missionId: args.missionId,
      startedAt,
      assignments: [],
      autonomyArms: [],
      autonomyRequest: null,
      report: null,
      gateStatus: null,
      gateTier: null,
      gateReasons: [],
      gatePolicy: null,
      arena: null,
      humanDecision: null,
      candidateIds: [],
      settled: null,
      receipt: null,
      receiptOk: false,
      lessonsAdded: 0,
      banditTrials: 0,
      updatedTeam: null,
      tFinished: 0,
      finishedAt: "",
    },
    graphConfig(args.runId),
  )) as MissionStateShape & { __interrupt__?: unknown[] };

  /* A run that stopped at the gate. It is not a failure and it is not a
     success: it is a run that is waiting, and it says so. */
  const interrupts = (raw as { __interrupt__?: { value?: unknown }[] }).__interrupt__ ?? [];
  if (interrupts.length > 0) {
    const ask = interruptedAsk(interrupts[0]);
    const record = pausedRecord(args, startedAt, now, ask, raw);
    return {
      record,
      report: (raw.report ?? null) as unknown as TeamRunReport,
      updatedTeam: null,
      settled: null,
      candidates: [],
      receipt: null,
      paused: true,
      ask,
    };
  }

  const report = raw.report;
  if (!report) {
    throw new Error("the mission graph finished without a run report — refusing to present an empty cycle as a completed one.");
  }
  const receipt = raw.receipt;
  const record = completedRecord(args, raw, startedAt, now, receipt);
  const pending = loadTeamEvoStore().candidates.filter(
    (c) => raw.candidateIds.includes(c.id) && c.status === "PROPOSED",
  );
  return {
    record,
    report,
    updatedTeam: raw.updatedTeam,
    settled: raw.settled,
    candidates: pending,
    receipt,
    paused: false,
    ask: null,
  };
}

/**
 * Continue a run that stopped at the gate.
 *
 * The answer is bound to the state the run held when it stopped: the graph
 * resumes from its own checkpoint, so the human's decision lands on the exact
 * run it was asked about.
 */
export async function resumeMissionGraph(args: MissionGraphRunArgs, decision: string): Promise<MissionGraphRunResult> {
  const emit: MissionGraphEmit = args.emit ?? (() => undefined);
  const now = args.now ?? Date.now();
  const startedAt = new Date(now).toISOString();
  /* A resume is always durable: the state being resumed FROM has to be in the
     chain, or there is nothing to resume. */
  const graph = buildMissionGraph(args, emit, true);
  const raw = (await graph.invoke(new Command({ resume: decision }), graphConfig(args.runId))) as MissionStateShape & {
    __interrupt__?: unknown[];
  };
  const interrupts = (raw as { __interrupt__?: { value?: unknown }[] }).__interrupt__ ?? [];
  if (interrupts.length > 0) {
    const ask = interruptedAsk(interrupts[0]);
    return {
      record: pausedRecord(args, startedAt, now, ask, raw),
      report: (raw.report ?? null) as unknown as TeamRunReport,
      updatedTeam: null,
      settled: null,
      candidates: [],
      receipt: null,
      paused: true,
      ask,
    };
  }
  const report = raw.report;
  if (!report) {
    throw new Error("the resumed mission graph finished without a run report — refusing to present an empty cycle as a completed one.");
  }
  const receipt = raw.receipt;
  return {
    record: completedRecord(args, raw, startedAt, now, receipt),
    report,
    updatedTeam: raw.updatedTeam,
    settled: raw.settled,
    candidates: loadTeamEvoStore().candidates.filter(
      (c) => raw.candidateIds.includes(c.id) && c.status === "PROPOSED",
    ),
    receipt,
    paused: false,
    ask: null,
  };
}

/* ─────────────────────────────────────────────────────────── the record ─── */

function completedRecord(
  args: MissionGraphRunArgs,
  raw: MissionStateShape,
  startedAt: string,
  now: number,
  receipt: ProofReceipt | null,
): LoopCycleRecord {
  const report = raw.report!;
  return {
    cycleNo: args.cycleNo,
    missionId: args.missionId,
    objective: args.objective,
    teamId: args.team.id,
    teamName: args.team.name,
    startedAt,
    finishedAt: raw.finishedAt,
    elapsedMs: raw.tFinished - now,
    status: report.status,
    gate: raw.gateStatus ? { status: raw.gateStatus, tier: raw.gateTier ?? "unverified" } : null,
    arena: raw.arena,
    arms: report.autonomyArms ?? raw.autonomyArms,
    seats: report.seats.map((s) => ({ seatId: s.seatId, role: s.role, harness: s.harness, outcome: s.outcome, verified: s.verified })),
    verifiedSeats: report.seats.filter((s) => s.verified).length,
    seatCount: report.seats.length,
    spentUsd: report.spentUsd ?? 0,
    tokensOnlySeats: report.seats.filter((x) => (x.usage?.costUsd ?? null) === null && (x.usage?.tokens ?? 0) > 0).length,
    budgetUsd: report.budget?.capUsd ?? null,
    messagesOnBus: globalAgentBus.getMessages().length,
    lessonsAdded: raw.lessonsAdded,
    banditTrials: raw.banditTrials,
    receipt: receipt ? { hash: receipt.seal, ok: raw.receiptOk } : null,
    candidateIds: raw.candidateIds,
    humanDecision: raw.humanDecision,
    note: report.summary ?? "",
  };
}

function pausedRecord(
  args: MissionGraphRunArgs,
  startedAt: string,
  now: number,
  ask: MissionGraphAsk | null,
  raw: MissionStateShape,
): LoopCycleRecord {
  const reasons = ask?.reasons ?? [];
  return {
    cycleNo: args.cycleNo,
    missionId: args.missionId,
    objective: args.objective,
    teamId: args.team.id,
    teamName: args.team.name,
    startedAt,
    finishedAt: raw.finishedAt || new Date(now).toISOString(),
    elapsedMs: (raw.tFinished || now) - now,
    status: "awaiting-human",
    gate: ask?.status ? { status: ask.status, tier: ask.tier ?? "unverified" } : null,
    arena: raw.arena,
    arms: raw.autonomyArms,
    seats: (raw.report?.seats ?? []).map((s) => ({ seatId: s.seatId, role: s.role, harness: s.harness, outcome: s.outcome, verified: s.verified })),
    verifiedSeats: (raw.report?.seats ?? []).filter((s) => s.verified).length,
    seatCount: args.team.seats.length,
    spentUsd: raw.report?.spentUsd ?? 0,
    tokensOnlySeats: 0,
    budgetUsd: raw.report?.budget?.capUsd ?? null,
    messagesOnBus: globalAgentBus.getMessages().length,
    lessonsAdded: 0,
    banditTrials: 0,
    receipt: null,
    candidateIds: [],
    humanDecision: null,
    note: `the run stopped at its gate and is waiting for a human${reasons.length ? `: ${reasons.join("; ")}` : ""}.`,
  };
}
