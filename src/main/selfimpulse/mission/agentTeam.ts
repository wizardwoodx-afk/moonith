/**
 * AGENT TEAMS — seats are ROLES, and a team is a set of seats filled by harnesses.
 *
 * THE MODELLING DECISION THAT MATTERS
 *
 * A seat is a role — planner, coder, reviewer — not an agent. Binding an engine to a seat is a
 * separate step, which is what lets the runtime re-arbitrate when an engine fails without
 * rewriting the plan, and what keeps a team's shape independent of the engine that fills it.
 *
 * THE SAFETY RULE
 *
 * Every claim about isolation is keyed off ENFORCEMENT, never off whether a flag merely exists. An engine
 * with a `--read-only` flag that it ignores is not a read-only seat, and a reviewer that can edit the
 * code it is reviewing is not a review.
 */

import type { HarnessId } from "../domain/harness";
import type { RiskClass } from "./types";
import { resolveCaps, enforcedReadOnly, unverifiedClaims } from "./agentCapabilities";
import { sessionArgv, sessionIdKind } from "./sessions";

export type TeamRole = "planner" | "architect" | "coder" | "tester" | "reviewer" | "security" | "synthesizer" | "debugger";

export interface TeamSeat {
  id: string;
  role: TeamRole;
  harness: HarnessId;
  model: string | null;
  /** May this seat modify files? An isolation hint, not a permission grant. */
  mayWrite: boolean;
  /** Maximum risk level this seat is authorised to take on. */
  maxRisk?: RiskClass;
  /** Wall-clock ceiling for one invocation, in seconds. */
  timeoutSecs: number;
  /** Turn ceiling, or null when the CLI has no such control and VH's ledger is the only limit. */
  maxTurns: number | null;
  instructions: string;
}

export interface CliAgentTeam {
  id: string;
  name: string;
  description: string;
  seats: TeamSeat[];
  budgetUsd?: number | null;
  createdAt?: string;
  updatedAt?: string;
  revision?: number;
  schemaVersion?: number;
}

export const SCHEMA_VERSION = 1;

const seat = (id: string, role: TeamRole, harness: HarnessId, over: Partial<TeamSeat> = {}): TeamSeat => ({
  id,
  role,
  harness,
  model: null,
  mayWrite: role === "coder" || role === "debugger",
  maxRisk: role === "coder" || role === "debugger" ? "MEDIUM" : "LOW",
  timeoutSecs: 900,
  maxTurns: null,
  instructions: "",
  ...over,
});

export const PREBUILT_TEAMS: CliAgentTeam[] = [
  {
    id: "team.balanced",
    name: "Balanced",
    description: "Plan, build, test, review. One vendor writes, a second reviews — so the review is not the author grading its own work.",
    schemaVersion: SCHEMA_VERSION,
    budgetUsd: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 1,
    seats: [
      seat("planner", "planner", "hermes", { mayWrite: false, maxRisk: "LOW", instructions: "Break the objective into steps small enough to verify individually." }),
      seat("architect", "architect", "hermes", { mayWrite: false, maxRisk: "LOW" }),
      seat("impl", "coder", "hermes", { mayWrite: true, maxRisk: "MEDIUM", instructions: "Implement the change. Touch only what the task requires." }),
      seat("synthesizer", "synthesizer", "hermes", { mayWrite: false, maxRisk: "LOW" }),
      seat("test", "tester", "llm", { mayWrite: false, maxRisk: "LOW", instructions: "Run the repository's own checks and report what failed." }),
      seat("reviewer", "reviewer", "llm", { mayWrite: false, maxRisk: "LOW", model: "reviewer-tier", instructions: "Review the diff. Say what is wrong, not what is fine. Run on a different model from the writer — a reviewer on the writer's own weights is not independent evidence." }),
      seat("security", "security", "llm", { mayWrite: false, maxRisk: "LOW", instructions: "Check for security vulnerabilities." }),
    ],
  },
  {
    id: "team.adversarial",
    name: "Adversarial",
    description: "Deliberately independent reviewers. Every writer is reviewed by a different model, because agreement between two seats running the same weights is weaker evidence than agreement across models.",
    schemaVersion: SCHEMA_VERSION,
    budgetUsd: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 1,
    seats: [
      seat("planner", "planner", "hermes", { mayWrite: false, maxRisk: "LOW" }),
      seat("impl", "coder", "hermes", { mayWrite: true, maxRisk: "MEDIUM" }),
      seat("test", "tester", "llm", { mayWrite: false, maxRisk: "LOW", instructions: "Prove the change works or find the case where it does not." }),
      seat("reviewer", "reviewer", "llm", { mayWrite: false, maxRisk: "LOW", model: "reviewer-tier", instructions: "Review independently, on a different model from the writer." }),
      seat("security", "security", "llm", { mayWrite: false, maxRisk: "LOW", instructions: "Look only for injection, secret leakage and unsafe deserialisation." }),
      seat("synthesizer", "synthesizer", "hermes", { mayWrite: false, maxRisk: "LOW", instructions: "Reconcile the verdicts into one decision." }),
    ],
  },
  {
    id: "team.powerhouse",
    name: "Cross-Vendor Powerhouse",
    description: "One governed crew, every seat on the native in-process runtime: plans, architects, builds, debugs, tests, reviews and synthesizes — each seat pointed at its own model, each action receipted through the same gate.",
    schemaVersion: SCHEMA_VERSION,
    budgetUsd: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 1,
    seats: [
      seat("planner", "planner", "hermes", { mayWrite: false, maxRisk: "LOW", instructions: "Formulate the execution plan and criteria." }),
      seat("architect", "architect", "hermes", { mayWrite: false, maxRisk: "LOW", instructions: "Design component interfaces and data schemas." }),
      seat("coder", "coder", "hermes", { mayWrite: true, maxRisk: "MEDIUM", instructions: "Implement core logic and tests in isolated worktree." }),
      seat("debugger", "debugger", "hermes", { mayWrite: true, maxRisk: "MEDIUM", instructions: "Diagnose edge cases and optimize performance." }),
      seat("tester", "tester", "llm", { mayWrite: false, maxRisk: "LOW", instructions: "Run test suites and fuzz edge cases." }),
      seat("reviewer", "reviewer", "llm", { mayWrite: false, maxRisk: "LOW", instructions: "Conduct independent peer review against the snapshot merge." }),
      seat("synthesizer", "synthesizer", "hermes", { mayWrite: false, maxRisk: "LOW", instructions: "Reconcile findings into final release notes." }),
    ],
  },
  {
    id: "team.solo",
    name: "Solo",
    description: "One seat. Cheap, fast, and the review is advisory only — an author grading its own work is not a review.",
    schemaVersion: SCHEMA_VERSION,
    budgetUsd: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 1,
    seats: [seat("impl", "coder", "hermes", { mayWrite: true, maxRisk: "MEDIUM", instructions: "Implement and self-check." })],
  },
  {
    id: "team.audit",
    name: "Read-only audit",
    description: "No seat may write. For answering 'what is wrong with this code?' without risking a change.",
    schemaVersion: SCHEMA_VERSION,
    budgetUsd: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 1,
    seats: [
      seat("reviewer", "reviewer", "llm", { mayWrite: false, maxRisk: "LOW", model: "reviewer-tier", instructions: "Review independently, on a different model from the writer." }),
      seat("security", "security", "llm", { mayWrite: false, maxRisk: "LOW" }),
    ],
  },
];

export const TEAM_BY_ID = new Map(PREBUILT_TEAMS.map((t) => [t.id, t]));

export interface ComposedInvocation {
  bin: string;
  argv: string[];
  /** Env vars the engine invocation needs. */
  env: Record<string, string>;
  /** Files to write into the workspace before the invocation runs. */
  files: Array<{ path: string; contents: string }>;
  /** What VH can honestly claim about this invocation. */
  claims: {
    readOnlyEnforced: boolean;
    /** "usd" only when the CLI reports real dollars. "tokens-only" means DO NOT convert at a guessed price. */
    costKind: "usd" | "tokens-only" | "none";
  };
  warnings: string[];
  /**
   * True when the seat runs in this process rather than as a spawned command.
   * Set only for the native runtimes. The executor checks this to decide
   * whether to hand the turn to `nativeInvoke` or to look for a binary; with
   * external CLIs removed the former is the only real path.
   */
  inProcess?: boolean;
  /** The composed turn text, carried here for in-process seats (no argv). */
  prompt?: string;
}

function fill(cap: { argv: string[] | null } | null, vars: Record<string, string>): string[] {
  if (!cap || !cap.argv) return [];
  return cap.argv.map((a) => (a.startsWith("$") ? (vars[a] ?? "") : a));
}

/**
 * Compile one seat into a real command line for the given prompt.
 *
 * Substitutions: $PROMPT, $MODEL, $N (turns), $CWD, $SECS, $SESSION, $REVIEWER, $NAME.
 */
export function composeSeatArgv(
  teamSeat: TeamSeat,
  ctx: { prompt: string; cwd: string; readOnly: boolean; sessionId?: string; turn?: number },
): ComposedInvocation {
  // V11.6.1: ONE resolver (see agentCapabilities.resolveCaps). A custom seat compiles from
  // the user's registered spec via the same synthetic entry the executor now uses, so the
  // composer and the executor can never disagree about what an engine is.
  // The Rust side re-expands $PROMPT from its own registry at execution time.
  // 19.7.15: the native runtimes are IN-PROCESS, so a seat naming one must not
  // be handed a command line. Returning `bin: "hermes", argv: ["<prompt>"]` was
  // a leftover of the CLI design and it lied: nothing is executed, and a caller
  // that believed otherwise would go looking for a binary that does not exist.
  // The turn text is carried in the warnings-free result's `prompt` field so the
  // executor can hand it to the native loop directly.
  if (teamSeat.harness === "hermes" || teamSeat.harness === "llm") {
    return {
      bin: "",
      argv: [],
      env: {},
      files: [],
      claims: { readOnlyEnforced: false, costKind: "none" },
      inProcess: true,
      prompt: ctx.prompt,
      warnings: [],
    };
  }
  const resolved = resolveCaps(teamSeat.harness);
  const caps = resolved.caps;
  const warnings: string[] = [];
  const vars: Record<string, string> = {
    $PROMPT: ctx.prompt,
    $MODEL: teamSeat.model ?? "",
    $N: String(teamSeat.maxTurns ?? 20),
    $CWD: ctx.cwd,
    $SECS: String(teamSeat.timeoutSecs),
    $SESSION: ctx.sessionId ?? "",
    $REVIEWER: "si-readonly",
    $NAME: `si-${teamSeat.id}`,
  };

  const argv: string[] = [];
  const flags: string[] = [];
  const env: Record<string, string> = {};
  const files: Array<{ path: string; contents: string }> = [];

  const wantsReadOnly = ctx.readOnly || !teamSeat.mayWrite;

  // The prompt argv goes FIRST, matching the invocation shape the composed
  // engine expects; control flags follow it.
  argv.push(...fill(caps.prompt, vars));

  if (wantsReadOnly) {
    // `implicit` means the read-only mode IS the default, so there is nothing to emit. Emitting the
    // prompt flag a second time would produce a duplicated flag, which does not parse.
    if (caps.readOnly?.argv?.length) flags.push(...fill(caps.readOnly, vars));
    else if (caps.readOnly?.implicit) {
      /* enforced by default; no flag needed */
    } else warnings.push(`${caps.name} has no enforced read-only mode, so this seat is ADVISORY only — it can still modify files.`);
  } else if (caps.write?.argv?.length) {
    flags.push(...fill(caps.write, vars));
  }

  if (caps.json?.argv) flags.push(...fill(caps.json, vars));
  if (teamSeat.maxTurns && caps.maxTurns?.argv) flags.push(...fill(caps.maxTurns, vars));
  if (caps.timeout?.argv) flags.push(...fill(caps.timeout, vars));
  if (caps.cwd?.argv) flags.push(...fill(caps.cwd, vars));
  if (teamSeat.model && caps.model?.argv) flags.push(...fill(caps.model, vars));
  if (caps.noAutoUpdate?.argv) flags.push(...fill(caps.noAutoUpdate, vars));

  // Conversational continuity. Only emitted when the caller actually has a session id, so an
  // invocation that wants a one-shot answer stays byte-identical to before.
  if (ctx.sessionId) {
    const s = sessionArgv(teamSeat.harness, {
      kind: (ctx.turn ?? 1) <= 1 ? "first" : "follow-up",
      idKind: sessionIdKind(teamSeat.harness),
      sessionId: ctx.sessionId,
    });
    flags.push(...s.argv);
    if (s.warning) warnings.push(s.warning);
  }

  // Harness-specific enforcement that is not a plain flag.

  for (const claim of unverifiedClaims(teamSeat.harness)) warnings.push(`Unverified flag — ${claim}`);

  // Filter out any flag VH resolved to an empty string, so a missing $MODEL cannot leave a bare
  // `--model` behind and swallow the next argument.
  const cleanFlags = flags.filter((f) => f.length > 0);

  return {
    bin: caps.bins[0] ?? "",
    argv: [...argv, ...cleanFlags],
    env,
    files,
    claims: {
      readOnlyEnforced: wantsReadOnly && enforcedReadOnly(teamSeat.harness),
      costKind: caps.cost?.kind ?? "none",
    },
    warnings,
  };
}

/* ------------------------------------------------------------------ validation */

export interface TeamFinding {
  severity: "error" | "warning";
  code: string;
  message: string;
  seatId?: string;
}

/**
 * Find the ways a team is weak before it runs.
 *
 * The advisory read-only check is keyed off `enforcedReadOnly()`, NOT off whether a readOnly argv
 * exists. A CLI can have the flag and still not honour it, and telling a user "this reviewer cannot
 * write" when it can is the most dangerous sentence this function could produce.
 */
export function validateTeam(team: CliAgentTeam): TeamFinding[] {
  const out: TeamFinding[] = [];
  if (!team.name || team.name.trim().length === 0) {
    out.push({ severity: "error", code: "no_name", message: "Team name is required." });
  }
  const ids = new Set<string>();
  for (const s of team.seats) {
    if (ids.has(s.id)) {
      out.push({ severity: "error", code: "duplicate_seat", message: `Two seats share the id "${s.id}". Worktrees, sessions and merge steps are keyed by seat id, so one would overwrite the other.`, seatId: s.id });
    }
    ids.add(s.id);
    if (s.harness === "llm" && (s.role === "coder" || s.role === "debugger" || s.mayWrite)) {
      out.push({ severity: "error", code: "cannot_write", message: `Seat "${s.id}" is a direct LLM which cannot modify files.`, seatId: s.id });
    }
    if (!enforcedReadOnly(s.harness) && !s.mayWrite) {
      const name = resolveCaps(s.harness).caps.name;
      out.push({ severity: "warning", code: "advisory_readonly", message: `${name} has no verified read-only enforcement, so "${s.id}" is advisory: it can still modify files despite being a ${s.role}.`, seatId: s.id });
    }
    if (s.timeoutSecs < 30) {
      out.push({ severity: "warning", code: "short_timeout", message: `${s.timeoutSecs}s is below the 30s floor for a coding agent; expect a timeout on any real edit.`, seatId: s.id });
    }
    if (!s.mayWrite && (s.role === "coder" || s.role === "debugger") && s.harness !== "llm") {
      out.push({ severity: "error", code: "writer_cannot_write", message: `"${s.id}" has the ${s.role} role but mayWrite is false, so it cannot do its job.`, seatId: s.id });
    }
  }
  if (team.seats.length === 0) {
    out.push({ severity: "error", code: "no_seats", message: "A team with no seats cannot run." });
  }
  if (team.seats.length > 0 && !team.seats.some((s) => s.mayWrite)) {
    out.push({ severity: "warning", code: "no_writer", message: "No seat may write, so this team can analyse but cannot change anything." });
  }
  if (team.seats.length > 1 && !team.seats.some((s) => s.role === "reviewer" || s.role === "security")) {
    out.push({ severity: "warning", code: "no_reviewer", message: "No reviewer or security seat, so nothing checks the writer's work." });
  }
  const writers = team.seats.filter((s) => s.mayWrite);
  const writingHarnesses = writers.map((s) => s.harness);
  if (writers.length > 1 && new Set(writingHarnesses).size === 1) {
    out.push({
      severity: "warning",
      code: "single_vendor",
      message: `Multiple writing seats (${writers.map((w) => w.id).join(", ")}) are assigned to the same harness vendor (${writingHarnesses[0]}). Diversifying writers avoids single-model blind spots.`,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ persistence */

export interface SerializedTeam {
  schemaVersion: number;
  team: CliAgentTeam;
}

export function serializeTeam(team: CliAgentTeam): string {
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, team } satisfies SerializedTeam, null, 2);
}

export interface ParseResult {
  ok: boolean;
  team: CliAgentTeam | null;
  error: string | null;
  errors: string[];
  findings: TeamFinding[];
}

export function parseTeam(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const err = `Not valid JSON: ${e instanceof Error ? e.message : String(e)}`;
    return { ok: false, team: null, error: err, errors: [err], findings: [] };
  }
  const env = parsed as Partial<SerializedTeam>;
  if (!env || typeof env !== "object" || !env.team) {
    const err = "Missing the `team` object. VH exports { schemaVersion, team }.";
    return { ok: false, team: null, error: err, errors: [err], findings: [] };
  }
  if (env.schemaVersion !== SCHEMA_VERSION) {
    const err = `Schema version ${String(env.schemaVersion)} is not supported (expected ${SCHEMA_VERSION}); VH will not guess how to migrate it.`;
    return { ok: false, team: null, error: err, errors: [err], findings: [] };
  }
  const t = env.team;
  if (!Array.isArray(t.seats)) {
    const err = "The team has no seats array.";
    return { ok: false, team: null, error: err, errors: [err], findings: [] };
  }
  const roles = new Set<string>(["planner", "architect", "coder", "tester", "reviewer", "security", "synthesizer", "debugger"]);
  for (const s of t.seats as TeamSeat[]) {
    if (!s.id || !roles.has(s.role)) {
      const err = `Seat "${s.id ?? "?"}" has no id or an unknown role "${s.role}".`;
      return { ok: false, team: null, error: err, errors: [err], findings: [] };
    }
    // Unknown ids are rejected here with an honest message; known ids (the two
    // in-process engines) resolve through the same resolver every layer uses.
    if (!(s.harness === "hermes" || s.harness === "llm")) {
      const err = `Seat "${s.id}" names an unknown harness "${s.harness}".`;
      return { ok: false, team: null, error: err, errors: [err], findings: [] };
    }
  }
  const findings = validateTeam(t as CliAgentTeam);
  return { ok: true, team: t as CliAgentTeam, error: null, errors: [], findings };
}

const STORAGE_KEY = "vh.teams.v1";

export function loadSavedTeams(): CliAgentTeam[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => parseTeam(JSON.stringify({ schemaVersion: SCHEMA_VERSION, team: x }))).filter((r) => r.ok && r.team).map((r) => r.team as CliAgentTeam);
  } catch {
    return [];
  }
}

export function saveTeams(teams: CliAgentTeam[]): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(teams));
  } catch {
    /* see loadSavedTeams */
  }
}

export function upsertTeam(teams: CliAgentTeam[], team: CliAgentTeam): CliAgentTeam[] {
  const i = teams.findIndex((t) => t.id === team.id);
  const updatedTeam = { ...team, revision: (team.revision ?? 1) + 1 };
  if (i === -1) return [...teams, updatedTeam];
  const next = [...teams];
  next[i] = updatedTeam;
  return next;
}

/* ------------------------------------------------------------------ binding a team to a plan */

const RISK_LEVELS: Record<RiskClass, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

/**
 * Which seat should run a task of this kind and risk.
 *
 * CRITICAL is refused outright. No sandbox mapping makes an irreversible action safe to hand to an
 * agent, so VH escalates to a human instead of picking a seat and hoping.
 */
export function seatForTask(team: CliAgentTeam, role: TeamRole, risk: RiskClass): { seat: TeamSeat | null; reason: string | null } {
  if (risk === "CRITICAL") {
    return { seat: null, reason: "CRITICAL risk tasks are refused for agent execution and escalated to a human. No sandbox makes an irreversible action safe to delegate." };
  }
  const candidates = team.seats.filter((s) => s.role === role);
  if (candidates.length === 0) return { seat: null, reason: `This team has no ${role} seat.` };

  const taskLevel = RISK_LEVELS[risk] ?? 2;
  const eligible = candidates.filter((s) => {
    const maxLevel = RISK_LEVELS[s.maxRisk ?? "MEDIUM"] ?? 2;
    return maxLevel >= taskLevel;
  });

  if (eligible.length === 0) {
    return { seat: null, reason: `A ${risk} risk task exceeds every available ${role}'s maxRisk ceiling — escalate to a human.` };
  }

  return { seat: eligible[0] ?? null, reason: null };
}

export const STEP_KIND_TO_ROLE: Record<string, TeamRole | null> = {
  research: "planner",
  architecture: "architect",
  implementation: "coder",
  test: "tester",
  security: "security",
  review: "reviewer",
  synthesis: "synthesizer",
  release: "coder",
  approval: null,
};

export interface Binding {
  stepId: string;
  seatId: string | null;
  harness: HarnessId | null;
  reason: string | null;
}

export interface BindResult {
  bindings: Binding[];
  bound: number;
  unbound: number;
  refused: string[];
}

/**
 * Bind a team to a plan's steps.
 *
 * `unbound` does not mean failure — it means the arbitrator still decides at runtime. Keeping that
 * distinct from `refused` (VH will not assign this at all) is what stops a plan looking fully bound
 * when half of it is undecided.
 */
export function bindTeamToPlan(team: CliAgentTeam, steps: Array<{ id: string; kind: string; risk: RiskClass }>): BindResult {
  const bindings: Binding[] = [];
  let bound = 0;
  let unbound = 0;
  const refused: string[] = [];
  for (const step of steps) {
    const role = STEP_KIND_TO_ROLE[step.kind];
    if (role === undefined || role === null) {
      unbound += 1;
      bindings.push({ stepId: step.id, seatId: null, harness: null, reason: role === null ? "An approval step belongs to a human, not a seat." : `No role maps to step kind "${step.kind}".` });
      continue;
    }
    const { seat, reason } = seatForTask(team, role, step.risk);
    if (seat) {
      bound += 1;
      bindings.push({ stepId: step.id, seatId: seat.id, harness: seat.harness, reason: null });
    } else if (step.risk === "CRITICAL") {
      refused.push(step.id);
      unbound += 1;
      bindings.push({ stepId: step.id, seatId: null, harness: null, reason });
    } else {
      unbound += 1;
      bindings.push({ stepId: step.id, seatId: null, harness: null, reason });
    }
  }
  return { bindings, bound, unbound, refused };
}

/** Apply bindings to steps in place, returning how many changed. */
export function applyTeamToSteps<T extends { id: string; preferredHarness: HarnessId | null }>(steps: T[], result: BindResult): number {
  let changed = 0;
  const byId = new Map(result.bindings.map((b) => [b.stepId, b]));
  for (const s of steps) {
    const b = byId.get(s.id);
    if (b?.harness && s.preferredHarness !== b.harness) {
      s.preferredHarness = b.harness;
      changed += 1;
    }
  }
  return changed;
}
