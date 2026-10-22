/**
 * Moonwright agent — the stop gates.
 *
 * When the model stops with a text answer, four gates may instead hold the answer
 * back, append it as an interim row plus a user-role nudge, and continue the turn:
 *
 *   1. late language-server verdicts on this turn's edits
 *   2. verify-on-stop — the edited files must check out
 *   3. the pre_verify plugin hook — after code edits a hook may keep the turn going
 *   4. the kanban terminal-tool guard — workers must end with a board tool
 *
 * Each gate keeps the candidate answer as a budget-exhaustion fallback and
 * clears `finalResponse`, so the finaliser can tell a gate from an error exit.
 */
import type { LoopState, ModelMessage } from "./types";

export interface StopGateContext {
  /** Paths this turn mutated. */
  mutatedPaths: string[];
  /** The answer the model produced. */
  finalResponse: string | null;
  /** The messages of the turn so far. */
  messages: ModelMessage[];
  /** How many times a gate has already nudged this turn. */
  nudges: number;
  /** Checks whether the mutated files verify. Resolves true when they do. */
  verifyChangedPaths?(paths: string[]): Promise<boolean>;
  /** The pre-verify hook. Returns a continue message, or null to let the turn end. */
  preVerifyContinue?(ctx: { paths: string[]; attempt: number; finalResponse: string | null }): Promise<string | null>;
  /** The kanban guard. Returns a nudge, or null when the worker ended correctly. */
  kanbanTerminalTool?(ctx: { messages: ModelMessage[]; attempts: number }): Promise<string | null>;
  /** Late language-server verdicts. Returns a nudge, or null when there is nothing to report. */
  lateLspVerdicts?(ctx: { paths: string[] }): Promise<string | null>;
}

export interface GateOutcome {
  /** True when a gate fired and the turn must continue. */
  continueTurn: boolean;
  /** The nudge to append as the next user row. */
  nudge: string | null;
  /** The answer held back, kept as the budget-exhaustion fallback. */
  pendingVerificationResponse: string | null;
}

/** A gate may only nudge a bounded number of times, or the turn never ends. */
const MAX_GATE_NUDGES = 3;

export async function evaluateStopGates(ctx: StopGateContext): Promise<GateOutcome> {
  const held = ctx.finalResponse;
  const base: GateOutcome = {
    continueTurn: false,
    nudge: null,
    pendingVerificationResponse: held,
  };

  if (ctx.nudges >= MAX_GATE_NUDGES) return base;
  if (!ctx.mutatedPaths.length) return base;

  // 1. late language-server verdicts
  if (ctx.lateLspVerdicts) {
    const nudge = await safe(() => ctx.lateLspVerdicts!({ paths: ctx.mutatedPaths }));
    if (nudge) return { continueTurn: true, nudge, pendingVerificationResponse: held };
  }

  // 2. verify-on-stop
  if (ctx.verifyChangedPaths) {
    const ok = await safeAsync(async () => (await ctx.verifyChangedPaths!(ctx.mutatedPaths)) !== false);
    if (ok === false) {
      return {
        continueTurn: true,
        nudge:
          "The files you changed did not verify. Re-check them, fix the problem, and only then give the final answer.",
        pendingVerificationResponse: held,
      };
    }
  }

  // 3. the pre_verify hook
  if (ctx.preVerifyContinue) {
    const nudge = await safe(() =>
      ctx.preVerifyContinue!({ paths: ctx.mutatedPaths, attempt: ctx.nudges, finalResponse: ctx.finalResponse }),
    );
    if (nudge) return { continueTurn: true, nudge, pendingVerificationResponse: held };
  }

  // 4. the kanban terminal-tool guard
  if (ctx.kanbanTerminalTool) {
    const nudge = await safe(() => ctx.kanbanTerminalTool!({ messages: ctx.messages, attempts: ctx.nudges }));
    if (nudge) return { continueTurn: true, nudge, pendingVerificationResponse: held };
  }

  return base;
}

/** The turn ends with the held answer when the budget runs out mid-gate. */
export function finalizeHeldAnswer(state: LoopState): string | null {
  return state.pendingVerificationResponse ?? state.finalResponse;
}

async function safe<T>(fn: () => T | Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

async function safeAsync<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}
