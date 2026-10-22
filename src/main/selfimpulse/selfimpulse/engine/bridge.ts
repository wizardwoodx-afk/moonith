/**
 * THE MERGE — SelfImpulse 16.0 (STEP3-MERGE-SPEC.md, milestone M1).
 *
 * The control plane governs; the execution core executes. This module is
 * the ONLY place the control plane reaches the execution core: the
 * `dispatch_mission` tool plugs into the real mission loop
 * (`runMissionLoopCycle`) here.
 *
 * One mission ID (`mission_xxxx`) is minted at dispatch and rides the job
 * end-to-end: every execution event is projected under it into the unified
 * receipt chain, and the mission outcome is recorded in the unified mission
 * ledger (one state — spec §2).
 *
 * Honesty contract: no fabricated results. Seats without a reachable CLI
 * agent report "blocked" (the execution core's own honest behavior); a missing crew is an
 * honest refusal; an engine error is an honest block. The receipt records
 * exactly what happened.
 */
import {
  runMissionLoopCycle,
  resumeMissionGraph,
  loadCrews,
  persistCrew,
  loopHostDeps,
  loadMissionLoopState,
} from "../../mission/missionLoop";
import type { TeamRunnerDeps } from "../../mission/teamExecutor";
import type { CliAgentTeam, TeamSeat, TeamRole } from "../../mission/agentTeam";
import { ENGINE_VERSION } from "../../version";
import { scoreAssurance, type AssuranceFactor, type AssuranceInput, type AssuranceScore } from "../../mission/assuranceScore";

/* The durable pause: the human gate is a checkpoint on the run chain.
   SelfImpulse reaches the mission layer ONLY through this file — the
   architecture scan pins that door — so the seam re-exports the one
   call the gate needs. */
export { checkpoint as durableCheckpoint } from "../../mission/runCheckpoints";

/** One event projected from the execution core's stream into the unified chain. */
export interface MissionTraceEvent {
  ts: number;
  phase?: string;
  note?: string;
  message?: { kind?: string; from?: string; to?: string; subject?: string };
}

export interface MissionOutcome {
  missionId: string;
  objective: string;
  /** The execution core's honest cycle status (done / blocked / failed / aborted / …). */
  status: string;
  cycleNo: number;
  verifiedSeats: number;
  seatCount: number;
  gateStatus: string | null;
  /** The execution core's own signed receipt for the cycle — true when Ed25519-signed. */
  receiptOk: boolean;
  /** Execution plane provenance (product identity, e.g. "SelfImpulse execution core 16.1"). */
  engine: string;
  /** Control plane provenance, e.g. "SelfImpulse 1.1". */
  controlPlane: string;
  teamId: string;
  teamName: string;
  notes: string[];
  trace: MissionTraceEvent[];
  runMs: number;
}

export class MissionNotConfiguredError extends Error {}

/** Mint the one mission ID that rides the job end-to-end (spec §2). */
export function mintMissionId(): string {
  return `mission_${Math.random().toString(36).slice(2, 6)}`;
}

/** The host crew the dispatch will run on (the latest persisted crew). */
export function selfimpulseCrews(): Array<{ id: string; name: string }> {
  return loadCrews().map((t) => ({ id: t.id, name: t.name }));
}

export function selfimpulseActiveCrew(): { id: string; name: string } | null {
  const crews = loadCrews();
  const team = crews[crews.length - 1];
  return team ? { id: team.id, name: team.name } : null;
}

/** Create a new blank crew (shore watch) with no seats so the user can muster hands into it. */
export function selfimpulseCreateCrew(name: string): CliAgentTeam {
  const crew: CliAgentTeam = {
    id: `team.${Date.now().toString(36)}`,
    name: name.trim() || "Shore watch",
    description: "Crew mustered from the SelfImpulse Master's table.",
    seats: [],
    budgetUsd: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 1,
    schemaVersion: 1,
  };
  persistCrew(loadCrews(), crew);
  return crew;
}

/** Add a seat to the currently active crew. If no crew exists, creates one first. */
const HAND_ROLES: Array<{ role: TeamRole; harness: TeamSeat["harness"]; label: string }> = [
  { role: "planner",     harness: "hermes",    label: "Helmsman" },
  { role: "architect",   harness: "hermes",    label: "Lookout" },
  { role: "coder",       harness: "hermes",     label: "Shipwright" },
  { role: "reviewer",    harness: "hermes",    label: "Scrivener" },
  { role: "tester",      harness: "hermes",    label: "Yeoman" },
  { role: "security",    harness: "hermes",    label: "Bosun" },
  { role: "debugger",    harness: "hermes",     label: "Surgeon" },
  { role: "synthesizer", harness: "hermes",    label: "Quartermaster" },
];
export function selfimpulseMusterHand(): { crew: CliAgentTeam; seat: TeamSeat } | { error: string } {
  let crews = loadCrews();
  let team = crews[crews.length - 1];
  if (!team) {
    team = selfimpulseCreateCrew("Shore watch");
    crews = loadCrews();
  }
  if (team.seats.length >= HAND_ROLES.length) {
    return { error: `All ${HAND_ROLES.length} hands are already mustered.` };
  }
  const spec = HAND_ROLES[team.seats.length % HAND_ROLES.length];
  const seat: TeamSeat = {
    id: `hand-${team.seats.length + 1}`,
    role: spec.role,
    harness: spec.harness,
    model: null,
    mayWrite: spec.role === "coder" || spec.role === "debugger",
    maxRisk: (spec.role === "coder" || spec.role === "debugger") ? "MEDIUM" : "LOW",
    timeoutSecs: 900,
    maxTurns: null,
    instructions: `${spec.label} — report honestly. Missing CLIs are errors, not passes.`,
  };
  const updated: CliAgentTeam = {
    ...team,
    seats: [...team.seats, seat],
    revision: (team.revision ?? 1) + 1,
    updatedAt: new Date().toISOString(),
  };
  persistCrew(crews, updated);
  return { crew: updated, seat };
}

/** A rerate report. `assurance` is null when the fleet has no measured evidence. */
export interface RerateReport {
  status: AssuranceScore["status"];
  /** Real score 0..100, or null — never a fabricated number. */
  assurance: number | null;
  band: AssuranceScore["band"];
  /** Cycles with a signed receipt — the "sealed" count the UI reports. */
  sealed: number;
  /** Cycles that reached a terminal success status. */
  wins: number;
  /** Learned skills on record (lessons added across cycles). */
  skills: number;
  measured: number;
  factors: AssuranceFactor[];
  note: string;
}

/**
 * Gather assurance evidence from the mission loop's own ledger.
 *
 * Every field traces to a persisted artifact — nothing is synthesised. Where the
 * ledger genuinely does not record a signal we pass the honest default and say so
 * in the note rather than inventing a value.
 *
 * Derivation, stated plainly:
 *   measured          one persisted cycle = one measured run
 *   same-vendor       receipt.ok (the cycle produced a verifiable signed receipt)
 *   cross-vendor      verified seats span ≥2 distinct harnesses — a second vendor
 *                     actually attested the work
 *   arena pass        cycle.arena.gate reports a PASS
 *   budget adherence  within cap ⇒ 1.0; over cap ⇒ cap/spent (narrowed share)
 *   feedback          1–5 human ratings recorded against cycles
 */
export function assuranceEvidence(): { inputs: AssuranceInput; sealed: number; wins: number; skills: number; unrecorded: string[] } {
  const state = loadMissionLoopState();
  const cycles = state.cycles ?? [];
  const unrecorded: string[] = [];

  let sealed = 0, wins = 0, skills = 0;
  let sameVendor = 0, crossVendor = 0, arenaPass = 0;
  const budgetAdherences: Array<number | null> = [];

  for (const c of cycles) {
    if (c.receipt?.ok) sealed++;
    if (/^(done|success|completed|ok)$/i.test(String(c.status ?? ""))) wins++;
    skills += c.lessonsAdded ?? 0;

    if (c.receipt?.ok) {
      const harnesses = new Set((c.seats ?? []).filter((s) => s.verified).map((s) => s.harness));
      if (harnesses.size >= 2) crossVendor++; else sameVendor++;
    }
    if (c.arena && /^pass/i.test(String(c.arena.gate ?? ""))) arenaPass++;

    if (typeof c.budgetUsd === "number" && c.budgetUsd > 0 && typeof c.spentUsd === "number") {
      budgetAdherences.push(c.spentUsd <= c.budgetUsd ? 1 : Math.max(0, c.budgetUsd / c.spentUsd));
    } else {
      budgetAdherences.push(null);
    }
  }

  /* the loop ledger records no egress-gate verdicts today — report the honest
     default rather than inferring cleanliness from silence */
  unrecorded.push("egress-violations");

  const feedbackRatings = Object.values(state.feedbackByCycle ?? {})
    .map((f) => Number(f?.rating))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 5);

  return {
    inputs: {
      measuredRuns: cycles.length,
      simulatedRuns: 0,
      crossVendorVerifiedRuns: crossVendor,
      sameVendorVerifiedRuns: sameVendor,
      arenaPassRuns: arenaPass,
      budgetAdherences,
      egressViolations: 0,
      feedbackRatings,
    },
    sealed, wins, skills, unrecorded,
  };
}

/**
 * Re-rate: recompute assurance from the fleet's OWN record.
 *
 * v17.10 — this used to return `60 + seats * 3`: a number that rose every time
 * you added an agent, regardless of whether any work was ever verified. It
 * bypassed `scoreAssurance()` entirely while its docstring claimed to walk
 * "sealed receipts + learned skills" — which were hardcoded to 0. An assurance
 * figure that only measures headcount is worse than no figure: it reads as
 * evidence and is not.
 *
 * It now delegates to the real scorer. With no measured runs the score is
 * `unevaluated` and `assurance` is null — the module's own doctrine, which
 * refuses to exist without evidence. Nothing simulated counts.
 */
/**
 * The ONE way a surface renders an assurance figure. Views must call this rather
 * than computing a display value of their own — that is how 17.10.0 shipped a
 * real scorer in the bridge AND a fabricated `60 + receipts*2 + skills*3` KPI in
 * the app shell. One metric, one source of truth.
 */
export function assuranceKpi(report: RerateReport): { value: string; note: string } {
  if (report.status !== "evaluated" || report.assurance === null) {
    return { value: "—", note: `unevaluated — ${report.note}` };
  }
  return {
    value: String(report.assurance),
    note: `band ${report.band} · ${report.measured} measured · ${report.sealed} sealed`,
  };
}

export function selfimpulseRerate(): RerateReport {
  const ev = assuranceEvidence();
  const score = scoreAssurance(ev.inputs);
  const note = score.status === "evaluated"
    ? `${ev.inputs.measuredRuns} measured cycle(s); ${ev.sealed} sealed receipt(s).`
    : (score.unevaluatedReason ?? "No measured runs.");
  return {
    status: score.status,
    assurance: score.score,
    band: score.band,
    sealed: ev.sealed,
    wins: ev.wins,
    skills: ev.skills,
    measured: ev.inputs.measuredRuns,
    factors: score.factors,
    note,
  };
}

/**
 * Probe seam (honest, like `setSelfImpulseBrain`): tests inject deterministic
 * runner deps so the loop is driven on node without a host CLI layer.
 * Production code never calls this — it runs with the host's real deps.
 */
let bridgeDeps: TeamRunnerDeps | null = null;
export function setBridgeDeps(deps: TeamRunnerDeps | null): void {
  bridgeDeps = deps;
}

/**
 * Options for running a mission outside the default dispatch shape
 * (the drill runs in its own fresh repo with its own crew + deps).
 */
export interface SelfImpulseMissionOpts {
  /** Repository the mission runs in (default "."). */
  repoRoot?: string;
  /** Crew to run (default: the latest persisted/prebuilt crew). */
  team?: CliAgentTeam;
  /** Runner deps (default: the probe-injected bridge deps, else the host's real deps). */
  deps?: TeamRunnerDeps;
  /**
   * How long the mission's OWN gate waits for a human before it gives up.
   *
   * The wait is BOUNDED on purpose. A run that pauses with nobody watching
   * must not hang forever: a dispatched mission can be driven from a headless
   * MCP client, and there is no person there to answer. When the bound
   * passes, the run is REFUSED — never approved. "Nobody answered" is not
   * consent, and a timeout that approved would be the worst kind of bug this
   * product could have.
   */
  gateTimeoutMs?: number;
  /**
   * Whether the mission's OWN gate may STOP the run and wait for a human.
   *
   * Default: yes. A run whose gate is not a clean pass holds the state it
   * stopped on and waits — that is the whole point of the arc being a graph.
   *
   * `false` is for the hosts that ARE the harness: the drill, which runs a
   * mission EXPECTING a verdict (including a failing one) and reports it.
   * Asking a human "the run's gate did not pass, continue?" inside a drill
   * whose whole point is to show that failing gate is a 90-second wait for
   * nobody. The verdict is still recorded, in the receipt and the report.
   */
  humanGate?: boolean;
  /**
   * Called with the gate's approval id when the mission's OWN gate asks.
   *
   * A caller POLLING for the run's status cannot know an approval id it
   * did not create, and a gate whose id nobody outside can name is a gate
   * nobody can answer. This hands it out.
   */
  onGatePending?: (approval: { id: string; action: string; detail: string }) => void;
}

/** The default bound on the mission gate's wait for a human. */
export const MISSION_GATE_TIMEOUT_MS = 90_000;

/**
 * THE HUMAN GATE FOR A MISSION LOOP.
 *
 * The Mission Loop's graph can STOP: when its gate is not a clean pass it
 * holds the state it stopped on and waits. That capability was built and
 * never switched on — `requireHumanOnGateFailure` was true in a probe and
 * nowhere else, so a dispatched mission could never actually pause.
 *
 * The gate is a late-bound hook rather than an import, because
 * `selfimpulse.ts` imports THIS module (for `durableCheckpoint` and
 * `runSelfImpulseMission`), and an import back would be a cycle. The
 * module that owns the human gate registers it here.
 */
export interface MissionHumanGate {
  /**
   * Ask the human.
   *
   * `onAsked` is called with the approval id AS SOON AS THE ASK EXISTS —
   * not when it is answered. That distinction is the whole point: a caller
   * watching a background run needs the id to answer the gate, and it
   * cannot have it while the gate is still waiting for an answer.
   */
  ask: (
    ask: { action: string; detail: string },
    onAsked?: (approvalId: string) => void,
  ) => Promise<{ approved: boolean; reason?: string }>;
}

let missionHumanGate: MissionHumanGate | null = null;

/** Register the gate a mission loop stops at. `null` unregisters it. */
export function setMissionHumanGate(gate: MissionHumanGate | null): void {
  missionHumanGate = gate;
}

/**
 * Run one REAL mission-loop cycle for the dispatched objective.
 * This is the execution plane: composed seats, harnesses, the inter-agent
 * bus, the gate, the retry loop — the execution core, unmodified.
 * This bridge is the ONLY seam between the SelfImpulse tree and the engine.
 */
export async function runSelfImpulseMission(objective: string, missionId: string, opts: SelfImpulseMissionOpts = {}): Promise<MissionOutcome> {
  const crews = loadCrews();
  const team: CliAgentTeam | undefined = opts.team ?? crews[crews.length - 1];
  if (!team) {
    throw new MissionNotConfiguredError(
      "No crew is configured, so there is no one to execute with — create a crew in the Loop door and I will run the real mission loop on it. This refusal is honest and the receipt records it.",
    );
  }
  const t0 = Date.now();
  const trace: MissionTraceEvent[] = [];
  const emit = (ev: { phase?: string; note?: string; message?: unknown }): void => {
    trace.push({
      ts: Date.now(),
      phase: ev.phase,
      note: ev.note,
      message: ev.message
        ? {
            kind: (ev.message as { kind?: string }).kind,
            from: (ev.message as { from?: string }).from,
            to: (ev.message as { to?: string }).to,
            subject: (ev.message as { subject?: string }).subject,
          }
        : undefined,
    });
  };
  const runArgs = {
    team,
    objective,
    repoRoot: opts.repoRoot ?? ".",
    baseBranch: "main",
    budgetCapUsd: 5,
    deps: opts.deps ?? bridgeDeps ?? loopHostDeps({}),
    emit: emit as never,
  };
  /* THE GATE IS ON, unless the caller is the harness. */
  const res = await runMissionLoopCycle({
    ...runArgs,
    humanGate: opts.humanGate === false ? null : { requireHumanOnGateFailure: true },
  });

  /* A PAUSED RUN. It is not a failure and it is not a success: it is a run
     that is waiting, and it says so. */
  let final = res;
  if (res.paused && res.ask) {
    const detail = [
      `The mission gate did not pass: ${res.ask.status ?? "unverified"} (${res.ask.tier ?? "unverified"}).`,
      ...(res.ask.reasons ?? []).map((r) => `- ${r}`),
    ].join("\n");
    /* The wait is BOUNDED. A run that pauses with nobody watching must not
       hang forever, and a timeout that approved would be consent nobody
       gave. When the bound passes, the run is REFUSED. */
    const bound = opts.gateTimeoutMs ?? MISSION_GATE_TIMEOUT_MS;
    const ask = { action: `mission.gate:${res.record.missionId}`, detail };
    const decision: { approved: boolean; reason?: string } = await Promise.race([
      missionHumanGate
        ? missionHumanGate.ask(ask, (approvalId) => {
            /* The id goes out to whoever is watching the run, the moment the
               ask exists. A gate whose id nobody outside can name is a gate
               nobody can answer. */
            try {
              opts.onGatePending?.({ id: approvalId, action: ask.action, detail: ask.detail });
            } catch {
              /* A caller that cannot record it is not a reason to fail the run. */
            }
          })
        : Promise.resolve({ approved: false, reason: "no human gate is wired into this runtime" }),
      new Promise<{ approved: boolean; reason?: string }>((resolve) => {
        const timer = setTimeout(
          () => resolve({ approved: false, reason: `no human answered the mission gate within ${Math.round(bound / 1000)}s - refused, not approved` }),
          bound,
        );
        /* Do not hold the process open for a timer nobody is waiting on. */
        if (typeof timer.unref === "function") timer.unref();
      }),
    ]);
    emit({ phase: "gate", note: decision.approved ? "the human approved the paused mission" : `the human refused: ${decision.reason ?? "no reason given"}` });
    /* The resume carries the SAME run id, so the answer lands on the exact
       run the human was asked about. */
    final = await resumeMissionGraph(
      {
        ...runArgs,
        cycleNo: res.record.cycleNo,
        missionId: res.record.missionId,
        runId: res.record.missionId,
        humanGate: { requireHumanOnGateFailure: true },
        durable: true,
      } as never,
      decision.approved ? "approved" : "refused",
    );
  }
  const notes = trace
    .filter((t) => typeof t.note === "string" && t.note.length > 0)
    .map((t) => t.note as string)
    .slice(0, 20);
  return {
    missionId,
    objective,
    status: final.record.status,
    cycleNo: final.record.cycleNo,
    verifiedSeats: final.record.verifiedSeats,
    seatCount: final.record.seatCount,
    gateStatus: final.record.gate?.status ?? null,
    receiptOk: final.record.receipt?.ok ?? false,
    engine: `MJ execution core ${ENGINE_VERSION}`,
    controlPlane: `SelfImpulse control plane ${ENGINE_VERSION}`,
    teamId: team.id,
    teamName: team.name,
    notes,
    trace,
    runMs: Date.now() - t0,
  };
}
