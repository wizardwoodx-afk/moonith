/**
 * AGENT CAPABILITIES — what each coding CLI can actually be made to do, and how VH knows.
 *
 * WHY THIS EXISTS AS DATA RATHER THAN CODE
 *
 * Nine CLIs, each with its own vocabulary for the same five ideas: take a prompt, emit JSON, refuse to
 * write, pick a model, resume a conversation. Hardcoding that as branches would scatter nine sets of
 * assumptions across the codebase. As a table, the assumptions are visible, comparable and testable —
 * and, crucially, each one carries the evidence behind it.
 *
 * THE LESSON THIS FILE IS BUILT AROUND
 *
 * A doc-shaped capability table looks identical to a tested one until a real binary disagrees.
 * Twice in VH history a flag was shipped because documentation described it, and the shipped
 * executable did not have it at all. Both were found only by running the executable.
 *
 * The standing rule outlived every specific finding: state the evidence for each entry, and
 * keep the registry and the policy layer agreeing — probes pin that agreement.
 *
 * So every entry states its confidence and its source, and `enforcedReadOnly()` is keyed off
 * enforcement rather than off whether a flag merely exists.
 */

import { defaultHarness, type HarnessId } from "../domain/harness";

/**
 * How much weight a claim deserves.
 *
 *   binary     — checked against the shipped executable, by running it. The strongest evidence
 *                available, and the only kind that has ever caught a wrong flag.
 *   docs       — from the vendor's documentation. Usually right, occasionally ahead of the release.
 *   community  — from forum posts, issues and blog reports. Plausible, unconfirmed.
 *   unverified — VH is guessing, or the capability does not exist. Treat as a gap, not a feature.
 */
export type Confidence = "binary" | "docs" | "community" | "unverified";

export interface Capability {
  /** The argv fragment that provides it, or null when the CLI has no such control. */
  argv: string[] | null;
  confidence: Confidence;
  /** Where the claim came from, so it can be re-checked. */
  source: string;
  /**
   * True when the control is the engine's DEFAULT rather than a flag to pass. Read-only can be
   * exactly this: writes require an explicit opt-in, so a plain run cannot modify files. Emitting
   * a flag for it would duplicate the run flag — which is what the plain run already is.
   */
  implicit?: boolean;
}

export interface CostReporting {
  kind: "usd" | "tokens-only";
  /** Where the number appears in the output, as a hint for parsing. */
  path?: string;
  confidence: Confidence;
  source: string;
}

export interface AgentCapabilities {
  id: HarnessId;
  name: string;
  /** Candidate executable names, in preference order. */
  bins: string[];
  install: string;
  /** How the prompt is passed. For several CLIs this carries the subcommand, so it must come first. */
  prompt: Capability;
  /** Structured output. `kind` distinguishes a single JSON object from an NDJSON stream. */
  json: (Capability & { kind?: "json" | "ndjson" | "text" }) | null;
  /** Refuse to modify files. */
  readOnly: Capability | null;
  /** Explicitly permit writes. null means the default agent already writes. */
  write: Capability | null;
  /** The escape hatch that disables all permission checks. VH treats this as requiring a human decision. */
  fullAuto: Capability | null;
  /** Cap the agent's internal turn count. */
  maxTurns: Capability | null;
  /** Cap wall-clock time. null means VH enforces its own deadline instead. */
  timeout: Capability | null;
  /** Constrain output to a schema. */
  outputSchema: Capability | null;
  /** Have the CLI create its own worktree. */
  worktree: Capability | null;
  /** Set the working directory. */
  cwd: Capability | null;
  /** Model selection. */
  model: Capability | null;
  /** Resume a previous session. */
  resume: Capability | null;
  /**
   * Start a session under an id VH chose, rather than one the CLI invents.
   *
   * This distinction is not cosmetic: external engines disagreed on whether a chosen session id
   * CREATES a conversation or LOADS an existing one, and assuming one behaviour hard-failed the
   * other on turn one, before any work was done. Where this is null, the runtime lets the session
   * be created implicitly and captures the id from the output.
   */
  sessionStart: Capability | null;
  /** Suppress background update checks — without this a CI run can stall on a prompt. */
  noAutoUpdate: Capability | null;
  /** Per-rule allow/deny filters, e.g. "Bash(git *)". */
  filters: { allowFlag: string; denyFlag: string; confidence: Confidence; source: string } | null;
  /** How to read real cost out of the output. null means the CLI does not report it. */
  cost: CostReporting | null;
  /** True only when a read-only mode is actually ENFORCED by the CLI, not merely advisory. */
  enforcedReadOnly: boolean;
  /** Traps worth stating out loud, each with the evidence behind it. */
  gotchas: string[];
}

export const AGENT_CAPABILITIES: Record<HarnessId, AgentCapabilities> = {
  hermes: {
    id: "hermes",
    name: "Hermes Runtime",
    // 19.7.15: hermes is IN-PROCESS. It has no binary, is not a stdio child,
    // and takes no argv. These two lines used to describe a subprocess that
    // does not exist; every caller that read them was reasoning about a seat
    // that could not run.
    bins: [],
    install: "bundled with SelfImpulse; runs in-process (src/engine/hermesRuntime.ts) — no binary, no argv",
    prompt: { argv: [], confidence: "docs", source: "in-process runtime: no argv exists by construction" },
    json: null,
    readOnly: null,
    write: null,
    fullAuto: null,
    maxTurns: null,
    timeout: null,
    outputSchema: null,
    worktree: null,
    cwd: null,
    model: null,
    resume: null,
    sessionStart: null,
    noAutoUpdate: null,
    filters: null,
    cost: null,
    enforcedReadOnly: false,
    gotchas: ["No enforced sandbox, so a hermes seat must never be assigned HIGH or CRITICAL risk."],
  },

  llm: {
    id: "llm",
    name: "Direct LLM",
    bins: [],
    install: "no binary; SelfImpulse calls the provider API directly",
    // In-process API call: there is no command line, and the empty argv says so
    // rather than a fake ["$PROMPT"] that would read as a spawnable command.
    prompt: { argv: [], confidence: "docs", source: "in-process API call: no argv exists by construction" },
    json: null,
    readOnly: null,
    write: null,
    fullAuto: null,
    maxTurns: null,
    timeout: null,
    outputSchema: null,
    worktree: null,
    cwd: null,
    model: null,
    resume: null,
    sessionStart: null,
    noAutoUpdate: null,
    filters: null,
    cost: null,
    enforcedReadOnly: false,
    gotchas: ["No filesystem access and no enforced sandbox. Useful for reasoning, useless for edits."],
  },
};

/* ─────────────────────────────────────────────────────────────────────────────
 * §V11.6.1 — ONE RESOLVER FOR EVERY HARNESS REFERENCE.
 *
 * The 11.6.0 review found the hole this closes: custom ids (`custom:<slug>`) were smuggled
 * through `as HarnessId` casts, and `teamExecutor` looked them up directly in
 * AGENT_CAPABILITIES — which is undefined for them, and the executor dereferenced it.
 * Every consumer now goes through resolveCaps(), which is TOTAL: a builtin entry, a
 * registered custom's synthetic entry, or an honest unregistered-custom entry. It never
 * returns undefined caps, so no execution path can crash on a custom seat again.
 * ───────────────────────────────────────────────────────────────────────────── */

export interface ResolvedHarness {
  /** The engine the seat actually runs on. Unknown ids resolve to the native default. */
  harness: HarnessId;
  caps: AgentCapabilities;
}

/** TOTAL harness resolver — the two in-process engines, with unknown ids
 *  (e.g. a stale id in a saved graph) resolving to the native default.
 *  Never undefined, so no execution path can crash on an engine id. */
export function resolveCaps(harness: string): ResolvedHarness {
  const caps = AGENT_CAPABILITIES[harness as HarnessId];
  if (caps) return { harness: harness as HarnessId, caps };
  const fallback = defaultHarness();
  return { harness: fallback, caps: AGENT_CAPABILITIES[fallback] };
}

/** Is read-only actually enforced by the CLI, or only requested?
 */
export function enforcedReadOnly(id: HarnessId | string): boolean {
  const caps = AGENT_CAPABILITIES[id as HarnessId];
  return caps ? caps.enforcedReadOnly : false;
}

/**
 * Claims VH could not verify, surfaced as warnings rather than hidden.
 *
 * A flag that came from a forum post is not the same as one that came from `--help`, and the UI has
 * to be able to say which is which.
 */
export function unverifiedClaims(id: HarnessId | string): string[] {
  const caps = AGENT_CAPABILITIES[id as HarnessId];
  if (!caps) {
    return ["Unknown engine id: no verified capability claims exist for it."];
  }
  const out: string[] = [];
  const check = (name: string, cap: Capability | null) => {
    if (cap?.argv && cap.confidence === "community") {
      out.push(`${name}: ${cap.source}`);
    }
  };
  check("cwd", caps.cwd);
  check("model", caps.model);
  check("resume", caps.resume);
  check("json", caps.json);
  if (!caps.enforcedReadOnly && caps.readOnly?.argv) {
    out.push("read-only is advisory: no enforcement was verified, so this seat can still modify files.");
  }
  return out;
}

/** Which harnesses have had their behaviour checked against a real executable. */
export function binaryVerifiedHarnesses(): HarnessId[] {
  return (Object.keys(AGENT_CAPABILITIES) as HarnessId[]).filter((id) =>
    Object.values(AGENT_CAPABILITIES[id]).some((v) => v && typeof v === "object" && "confidence" in v && (v as { confidence?: Confidence }).confidence === "binary"),
  );
}

/** Harnesses that correspond to an executable CLI binary on disk. */
export const EXECUTABLE_HARNESSES: HarnessId[] = (Object.keys(AGENT_CAPABILITIES) as HarnessId[]).filter(
  (id) => AGENT_CAPABILITIES[id].bins.length > 0,
);

/** True when all claims about this harness come from binary verification or vendor docs with no unverified community claims. */
export function fullyDocumented(id: HarnessId): boolean {
  return unverifiedClaims(id).length === 0;
}

