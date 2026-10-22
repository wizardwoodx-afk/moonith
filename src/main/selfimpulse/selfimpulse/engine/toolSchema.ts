/**
 * §TOOL-SCHEMA — Zod schemas for built-in tool inputs, plus a retry-on-
 * validation wrapper for LLM-driven tool calls.
 *
 * 17.1.3 introduces schema-validated tool I/O so that malformed arguments
 * from a model (wrong types, missing required fields, sneaky extra props)
 * are caught BEFORE execution and the model is given ONE retry with the
 * validation error fed back as an observation — the Pydantic AI / Instructor
 * pattern that eliminates the "tool misuse / schema drift" failure mode
 * (Metacto 2026 failure #2).
 *
 * Schemas live alongside the tools they describe. The wrapper is generic
 * over any async tool function: given a Zod schema + a tool, it returns a
 * tool that validates args before calling, retries once on failure, and
 * returns a discriminated result.
 */
import { z, type ZodSchema, type ZodSafeParseResult } from "zod";

/* ── Built-in tool schemas ────────────────────────────────────────────── */

export const WorkspaceWriteSchema = z.object({
  name: z.string().min(1).max(255).regex(/^[^/\\<>:"|?*\x00-\x1F]+$/, "filename must be a plain local name, no path separators or control chars"),
  content: z.string().max(1_000_000, "content exceeds 1 MB workspace-file limit"),
});

export const ShellExecSchema = z.object({
  command: z.string().min(1).max(4096),
  cwd: z.string().max(4096).optional(),
});

export const DispatchMissionSchema = z.object({
  objective: z.string().min(1).max(8000),
});

export const SystemInfoSchema = z.object({});

export const WebSearchSchema = z.object({
  query: z.string().min(1).max(500),
  depth: z.enum(["1", "2", "3"]).optional().default("1"),
});

export const toolSchemas: Record<string, ZodSchema> = {
  workspace_write: WorkspaceWriteSchema,
  shell_exec: ShellExecSchema,
  dispatch_mission: DispatchMissionSchema,
  system_info: SystemInfoSchema,
  web_search: WebSearchSchema,
};

/* ── Auditable validation outcome (shared by withSchema() and the engine's
 *    validateWithRetry() — one canonical result shape so tests/runtime agree) */

export type RepairSource = "brain" | "deterministic";

export interface ValidationAudit {
  rawArgs: Record<string, unknown>;
  repairedArgs?: Record<string, unknown>;
  errors: string;
  attempts: number;              // 1 on first-pass success, 2 on retry
  retried: boolean;              // true iff a repair was attempted
  repairSource?: RepairSource;
  repairReason?: string;
}

export type ValidationOutcome<T = unknown> =
  | { ok: true;  args: T; audit: ValidationAudit }
  | { ok: false; args: Record<string, unknown>; audit: ValidationAudit };

/* ── Deterministic repair ──────────────────────────────────────────────
 * Conservative, idempotent fixups for the most common validation failures:
 * trim strings, strip shell "$ " prefix, rewrite path-traversal filenames
 * to basename, cap oversized workspace content at 1 MB. Always safe to run
 * on the first pass as normalization — never fabricates content. */
export function deterministicRepair(tool: string, args: Record<string, unknown>, errors: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(args ?? {}) };
  const errs = errors.toLowerCase();
  // Always trim string fields — safe idempotent normalization.
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === "string") out[k] = v.trim();
  }
  // web_search.query
  if (tool === "web_search" && (errs.includes("query") || errs.includes("too_small"))) {
    const q = typeof out.query === "string" ? out.query.trim() : "";
    if (q) out.query = q;
  }
  // shell_exec.command: trim, strip leading "$ "
  if (tool === "shell_exec" && (errs.includes("command") || errs.includes("too_small"))) {
    let c = typeof out.command === "string" ? out.command.trim() : "";
    if (c.startsWith("$ ")) c = c.slice(2).trim();
    out.command = c;
  }
  // workspace_write
  if (tool === "workspace_write") {
    if (errs.includes("name") || errs.includes("too_small")) {
      const n = typeof out.name === "string" ? out.name.trim() : "";
      if (n.includes("..")) out.name = n.split(/[\\/]/).filter((s) => s && s !== "..").pop() ?? n;
      else if (n) out.name = n;
    }
    if (errs.includes("content") && typeof out.content === "string" && out.content.length > 1_000_000) {
      out.content = out.content.slice(0, 1_000_000);
    }
  }
  // dispatch_mission.objective
  if (tool === "dispatch_mission" && (errs.includes("objective") || errs.includes("too_small")) && typeof out.objective === "string") {
    out.objective = out.objective.trim();
  }
  return out;
}

/**
 * Validate `rawArgs` against the schema registered for `tool`. Returns a
 * SafeParseResult with helpful error messages.
 */
export function validateArgs(tool: string, rawArgs: unknown): ZodSafeParseResult<unknown> {
  const schema = toolSchemas[tool];
  if (!schema) {
    return { success: true, data: rawArgs ?? {} } as ZodSafeParseResult<unknown>;
  }
  return schema.safeParse(rawArgs) as ZodSafeParseResult<unknown>;
}

/**
 * Format Zod issues into a single-line "you messed up X, please fix" message
 * suitable for feeding back to the model on retry.
 */
export function formatParseErrors(result: ZodSafeParseResult<unknown>): string {
  if (result.success) return "";
  return result.error.issues.map((i: { path: PropertyKey[]; message: string }) => `${i.path.filter((p): p is string | number => typeof p === "string" || typeof p === "number").join(".") || "<args>"}: ${i.message}`).join("; ");
}

export type ValidatedResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[]; retried: boolean };

export interface RepairAttempt {
  repaired: Record<string, unknown>;
  source: RepairSource;
  reason: string;
}

/**
 * Try ONE repair. Calls the `brainRepair` hook first (if provided); if it
 * returns null/throws, falls back to deterministic repair. Returns the
 * repaired args together with provenance metadata for the audit trail.
 */
export async function attemptRepair(
  tool: string,
  args: Record<string, unknown>,
  errors: string,
  brainRepair?: (tool: string, raw: Record<string, unknown>, errors: string) => unknown | Promise<unknown>,
): Promise<RepairAttempt> {
  if (brainRepair) {
    try {
      const fixed = await brainRepair(tool, args, errors);
      if (fixed !== null && fixed !== undefined && typeof fixed === "object") {
        return { repaired: fixed as Record<string, unknown>, source: "brain", reason: "brain.repairArgs proposed corrected args" };
      }
    } catch {
      /* fall through */
    }
  }
  return {
    repaired: deterministicRepair(tool, args, errors),
    source: "deterministic",
    reason: "deterministic normalization (trim, shell $-strip, basename, 1MB cap)",
  };
}

/**
 * Canonical validate-with-at-most-one-retry primitive used by BOTH the
 * `withSchema()` wrapper and the engine's `validateWithRetry()` throat.
 * Returns an auditable outcome carrying rawArgs, repairedArgs, errors,
 * attempts, repairSource, repairReason so receipts can prove exactly what
 * happened.
 */
export async function validateWithRetry(
  tool: string,
  raw: Record<string, unknown>,
  opts?: { brainRepair?: (tool: string, raw: Record<string, unknown>, errors: string) => unknown | Promise<unknown> },
): Promise<ValidationOutcome<Record<string, unknown>>> {
  const normalized = deterministicRepair(tool, raw, "");
  let res = validateArgs(tool, normalized);
  if (res.success) {
    return {
      ok: true,
      args: (res.data as Record<string, unknown>) ?? normalized,
      audit: { rawArgs: raw, errors: "", attempts: 1, retried: false },
    };
  }
  const errors0 = formatParseErrors(res);
  const fix = await attemptRepair(tool, normalized, errors0, opts?.brainRepair);
  const res2 = validateArgs(tool, fix.repaired);
  if (res2.success) {
    return {
      ok: true,
      args: (res2.data as Record<string, unknown>) ?? fix.repaired,
      audit: {
        rawArgs: raw,
        repairedArgs: fix.repaired,
        errors: errors0,
        attempts: 2,
        retried: true,
        repairSource: fix.source,
        repairReason: fix.reason,
      },
    };
  }
  return {
    ok: false,
    args: fix.repaired,
    audit: {
      rawArgs: raw,
      repairedArgs: fix.repaired,
      errors: `${errors0} → retry: ${formatParseErrors(res2)}`,
      attempts: 2,
      retried: true,
      repairSource: fix.source,
      repairReason: fix.reason,
    },
  };
}

/**
 * Wrap a tool implementation so it validates arguments with Zod and performs
 * exactly ONE structured retry on validation failure.
 *
 *   • Without `opts.repair` this is a plain validated wrapper (retried:false
 *     on validation failure).
 *   • With `opts.repair` (the model-feedback seam) the repair is called on
 *     failure with (rawArgs, errorString) and must return a SINGLE repaired
 *     candidate or null. A null/throw falls through to refusal.
 *   • If validation still fails after repair, returns `{ok:false, retried:true}`
 *     and NEVER invokes `fn`.
 *   • Runtime errors from `fn` come back as `{ok:false, errors:[…], retried:false}`
 *     (execution failures, not schema failures).
 */
export function withSchema<I, O>(
  schema: ZodSchema<I>,
  fn: (args: I) => Promise<O> | O,
  opts?: { repair?: (raw: unknown, errors: string) => unknown | Promise<unknown> },
): (rawArgs: unknown) => Promise<ValidatedResult<O>> {
  return async (rawArgs) => {
    const toolSchemasEntry = Object.entries(toolSchemas).find(([, s]) => s === schema);
    const pseudoTool = toolSchemasEntry?.[0] ?? "__ad_hoc__";
    // If this schema is a registered tool, use the canonical validateWithRetry
    // so behavior never diverges from the engine's throat.
    if (toolSchemasEntry) {
      const out = await validateWithRetry(pseudoTool, (rawArgs ?? {}) as Record<string, unknown>, {
        brainRepair: async (_t, raw, errs) => (opts?.repair ? opts.repair(raw, errs) : null),
      });
      if (!out.ok) {
        return { ok: false, errors: out.audit.errors.split("; ").filter(Boolean), retried: out.audit.retried };
      }
      try {
        const v = await fn(out.args as I);
        return { ok: true, value: v };
      } catch (e) {
        return { ok: false, errors: [(e as Error).message ?? String(e)], retried: out.audit.retried };
      }
    }
    // Ad-hoc schema (not in the tool registry): run a local validate+retry
    // loop with the same semantics but against the passed schema directly.
    let parsed = schema.safeParse(rawArgs) as ZodSafeParseResult<I>;
    if (!parsed.success) {
      if (opts?.repair) {
        let fixed: unknown;
        try {
          fixed = await opts.repair(rawArgs, formatParseErrors(parsed));
        } catch {
          fixed = null;
        }
        if (fixed !== null && fixed !== undefined) {
          parsed = schema.safeParse(fixed) as ZodSafeParseResult<I>;
          if (parsed.success) {
            try {
              const v = await fn(parsed.data as I);
              return { ok: true, value: v };
            } catch (e) {
              return { ok: false, errors: [(e as Error).message ?? String(e)], retried: true };
            }
          }
        }
      }
      return { ok: false, errors: formatParseErrors(parsed).split("; ").filter(Boolean), retried: Boolean(opts?.repair) };
    }
    try {
      const v = await fn(parsed.data as I);
      return { ok: true, value: v };
    } catch (e) {
      return { ok: false, errors: [(e as Error).message ?? String(e)], retried: false };
    }
  };
}
