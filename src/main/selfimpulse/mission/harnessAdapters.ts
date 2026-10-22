/**
 * §6 Agent runtime arbitration — the common runtime interface.
 *
 * An earlier version of this file held a table of argv templates and described
 * itself as "the source of truth for how to invoke each CLI". There are no
 * CLIs. There is no external execution tier in SelfImpulse, and
 * every agent now runs in-process on the owner's own provider key. What
 * survived is the part that was never about binaries:
 *
 *     AgentRuntime -> prepare / supports / invoke / parse
 *
 * Runtimes do not decide *which* one runs; `arbitration.ts` does that. Runtimes
 * contain no mission logic; they turn a task into a governed in-process call
 * and a structured outcome. The governance — authority, provenance, the human
 * gate — happens around the call, in `src/security/actionGraph.ts`; this layer
 * does not and must not decide authorization.
 *
 * `local-test` is an explicit, labelled test double. It exists so the mission
 * runtime, the flight recorder and the acceptance test can be exercised without
 * a provider key. It is reported as `simulated: true` everywhere it surfaces,
 * and `MissionRuntime` refuses to mark a mission COMPLETED on simulated results
 * unless the mission explicitly opts in. It never pretends to be a real runtime.
 */


import { type HarnessId } from "../domain/harness";
import type { RiskClass } from "./types";
import type { PlanStepKind } from "./types";

/** A runtime that can be seated: an in-process engine, or the labelled
 *  `local-test` double. Named for what it is rather than for the schema
 *  version it was introduced in — "V6" told a reader nothing actionable. */
export type AgentRuntimeId = HarnessId | "local-test";

export interface HarnessTask {
  taskId: string;
  title: string;
  prompt: string;
  kind: PlanStepKind;
  languages: string[];
  cwd?: string;
  timeoutMs: number;
  /** Capabilities the task needs; adapters report which they actually cover. */
  requiredCapabilities: string[];
  /** §10 Mission classification for this task. Picks the harness sandbox. */
  risk?: RiskClass;
  /** §33 What the mission boundary actually grants this agent, after intersection. */
  mayWriteFiles?: boolean;
  mayRunShell?: boolean;
  mayUseBrowser?: boolean;
  /** Permissions granted, for the stated contract in the prompt. */
  grantedPermissions?: Record<string, boolean>;
}

export interface HarnessOutcome {
  ok: boolean;
  text: string;
  exitCode: number | null;
  latencyMs: number;
  costUsd: number;
  /** True when the result came from the labelled test double rather than a real runtime. */
  simulated: boolean;
  /** What the adapter actually did, for the flight recorder. */
  detail: string;
  error: string | null;
}

export interface CodingAgentHarness {
  id: AgentRuntimeId;
  name: string;
  /** Never true for the test double in a real mission. */
  simulated: boolean;
  installHint: string;
  languages: string[];
  strengths: string[];
  canEditFiles: boolean;
  canRunTests: boolean;
  /** Capabilities this adapter genuinely provides. */
  capabilities: string[];
  supports(task: HarnessTask): boolean;
  /** Build the argv / prompt. Exposed so the UI can show exactly what will be executed. */
  prepare(task: HarnessTask): { program: string; args: string[] };
  invoke(task: HarnessTask): Promise<HarnessOutcome>;
}

/* ------------------------------------------------------------------ real adapters */

/**
 * The shared CLI adapter. Every real harness is the same code path with a different argv
 * template — that is the point of §6 ("do not duplicate orchestration logic for every
 * harness").
 */



/* ------------------------------------------------------------------ §6 test double */

/**
 * The labelled test double. Deterministic, offline, and unmistakably marked.
 *
 * It exists so that the mission runtime's *own* logic — planning, arbitration, failure
 * detection, repair, evaluation, lineage, checkpoints — can be exercised and tested without
 * a coding CLI or an API key. It is not a stand-in for real work and the runtime treats its
 * output as unverified by default.
 */
export class LocalTestHarness implements CodingAgentHarness {
  readonly id = "local-test" as const;
  readonly name = "Local Test Harness (simulated — not a real agent)";
  readonly simulated = true;
  readonly installHint = "Built in. Used only when a mission explicitly allows simulated execution.";
  readonly languages = ["any"];
  readonly strengths = ["deterministic-offline-testing"];
  readonly canEditFiles = false;
  readonly canRunTests = false;
  readonly capabilities = ["simulation"];
  /** Task titles matching this fail on the first attempt, to exercise the repair path. */
  failFirstAttemptFor = /implement|build|code/i;
  private attempts = new Map<string, number>();

  supports(_task: HarnessTask): boolean {
    return true;
  }

  prepare(task: HarnessTask): { program: string; args: string[] } {
    return { program: "(in-process simulation)", args: [task.taskId] };
  }

  async invoke(task: HarnessTask): Promise<HarnessOutcome> {
    const started = Date.now();
    const n = (this.attempts.get(task.taskId) ?? 0) + 1;
    this.attempts.set(task.taskId, n);
    // Deterministic, so tests can rely on it: the first attempt at an implementation task
    // fails, which is what drives the §16 repair ladder.
    const shouldFail = this.failFirstAttemptFor.test(task.title) && n === 1;
    await new Promise((r) => setTimeout(r, 5));
    if (shouldFail) {
      return {
        ok: false,
        text: "",
        exitCode: 1,
        latencyMs: Date.now() - started,
        costUsd: 0,
        simulated: true,
        detail: "simulated-failure",
        error: `[local-test] Simulated failure on first attempt at "${task.title}" so the repair path is exercised. This is not real work.`,
      };
    }
    return {
      ok: true,
      text: [
        `[local-test simulation — attempt ${n}]`,
        `Task: ${task.title}`,
        `Kind: ${task.kind}`,
        `Languages: ${task.languages.join(", ") || "n/a"}`,
        "",
        "This output was produced by the labelled test double, not by a real agent.",
        "It is recorded as simulated and is NOT counted as independently verified.",
      ].join("\n"),
      exitCode: 0,
      latencyMs: Date.now() - started,
      costUsd: 0,
      simulated: true,
      detail: `simulated attempt=${n}`,
      error: null,
    };
  }

  reset(): void {
    this.attempts.clear();
  }
}

/* ------------------------------------------------------------------ registry */

export const localTestHarness = new LocalTestHarness();


const registry = new Map<AgentRuntimeId, CodingAgentHarness>();
registry.set("local-test", localTestHarness);


export function getHarness(id: AgentRuntimeId): CodingAgentHarness | null {
  // There are no external adapters. A seat that
  // names one resolves to null, and callers route to the native runtime.
  return registry.get(id) ?? null;
}

export function allHarnesses(): CodingAgentHarness[] {
  return [...registry.values()];
}

export function realHarnesses(): CodingAgentHarness[] {
  return [...registry.values()].filter((h) => !h.simulated);
}

/** Register or replace an adapter — used by tests. */
export function registerHarness(h: CodingAgentHarness): void {
  registry.set(h.id, h);
}

export function isHarnessId(id: string): id is AgentRuntimeId {
  return registry.has(id as AgentRuntimeId);
}

/** Human-readable list of every known runtime, for the Providers page. */
export function describeHarnesses(): Array<{ id: string; name: string; simulated: boolean; install: string; languages: string[]; strengths: string[] }> {
  return [...registry.values()].map((h) => ({
    id: h.id,
    name: h.name,
    simulated: h.simulated,
    install: h.installHint,
    languages: h.languages,
    strengths: h.strengths,
  }));
}

