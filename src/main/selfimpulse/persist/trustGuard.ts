/**
 * §PERSISTED TRUST STATE IS NOT BELIEVED BECAUSE IT WAS READ (audit A10).
 *
 * THE HOLE. `localStorage` is a file the operator's own machine can edit and any
 * script in this origin can rewrite. It is NOT a store this product authored. Before
 * this module the app's local database did `JSON.parse(raw)` and used the result:
 * `{ ...empty(), ...JSON.parse(raw) }`. So a hand-edited or corrupted row in a
 * GRANT table — a human approval, an approval's live capability token, an MCP server
 * marked ENABLED/AUTHORIZED, an imported genome — was honoured at boot as though a
 * person had decided it. The whole point of the approval gate ("Requester code cannot
 * decide its own request", `src/ipc/localDb.ts:424`) is defeated by writing the verdict
 * into storage instead of asking.
 *
 * THE DISCIPLINE LIFTED HERE. `exactKeys`, `assertUniqueIds`, the immutable-authority field
 * and `deepFreeze` come from an MIT-licensed outside agent runtime's native-IAM persistence
 * validator (its named project, version and licence text are carried in
 * `3partylicense.md`), re-expressed first-party and applied to SelfImpulse's
 * own trust tables. Four rules, and they are the load-bearing ones:
 *
 *   1. EXACT KEY SETS. A record carries the fields the product writes — no more. A key
 *      this code never writes is not "harmless extra data", it is a field somebody put
 *      there, and the ordinary way an unknown field appears is an edit.
 *   2. ENUMS ARE ENUMS. `status`, `authority`, `transport`, `state`, `origin` must be one
 *      of the values the product itself produces. `"authority": "agent"` is not a
 *      creative spelling of `"human"`.
 *   3. IDS ARE UNIQUE AND NON-EMPTY. Two rows sharing an id make `find()` a coin toss
 *      about which grant wins — and the row that loses is invisible, not refused.
 *   4. REFUSE, DO NOT REPAIR. Nothing here normalises a suspicious value into an
 *      acceptable one, and nothing honours the rows that passed while dropping the ones
 *      that did not. A TRUST TABLE IS HONOURED WHOLE OR REFUSED WHOLE, because a
 *      half-trusted grant table is exactly the state an editor wants: the checks that
 *      passed are the ones they left valid.
 *
 * WHERE THE LINE IS DRAWN, AND WHY IT IS NOT DRAWN HIGHER.
 * Refusal here is PER TABLE, not per document, and the tables carrying AUTHORITY
 * (approvals, MCP allow entries, the local secret store, imported genomes, the run
 * queue) are the ones validated exactly. The CONTENT tables (workflows, memories,
 * skills, executions, events, feedback, DLQ) are validated only as far as "an array of
 * objects with unique ids". That is a deliberate choice, not an oversight: refusing a
 * workflow graph because a validator expected a key the shipped writer never wrote
 * would DELETE the owner's work on the next save, and a control that destroys user data
 * on a false positive gets disabled. Authority is refused; content is shape-checked.
 * If this is ever widened, widen it with a migration that says so, not with a stricter
 * predicate in a boot path.
 *
 * THE REFUSAL IS A FACT SOMEBODY CAN READ. `refusePersistedTrustState` writes into the
 * durable ledger `src/persist/quotaSafe.ts` already keeps (`vh.persist.notices`), and
 * the verdict is kept in memory for `localDb.loadRefusal()` so a screen can show it
 * without re-reading storage. A silent reset to empty would be the same dishonesty as
 * honouring the forged row, in the other direction.
 *
 * Determinism: pure functions over the value handed in. No clock, no randomness, no
 * storage. Only the caller — which owns the storage — decides what a refusal costs.
 *
 * Provenance: the discipline is re-expressed from an MIT-licensed outside agent runtime's
 * native-IAM persistence validator (named project, version and licence text carried in
 * `3partylicense.md`). No source file was copied; no dependency was added.
 */

/** The tables that carry authority. Each is honoured whole or refused whole. */
export type TrustTable = "approvals" | "mcp" | "secrets" | "runQueue" | "importedGenomes";

export const TRUST_TABLES: readonly TrustTable[] = ["approvals", "mcp", "secrets", "runQueue", "importedGenomes"];

/** The content tables, shape-checked only — see the header for why the line is there. */
export type ContentTable =
  | "workflows" | "executions" | "events" | "memories" | "skills"
  | "feedback" | "evolution" | "dlq";

export const CONTENT_TABLES: readonly ContentTable[] = [
  "workflows", "executions", "events", "memories", "skills", "feedback", "evolution", "dlq",
];

export interface TrustProblem {
  /** which table failed; "document" when the stored value is not a database at all */
  table: TrustTable | ContentTable | "document";
  /** the check that fired, in a stable token a probe or a log can match */
  code: string;
  /** a sentence naming the record and the field, for the operator and the ledger */
  detail: string;
}

export interface TrustVerdict {
  /** true when nothing was refused — the caller may honour what it read. */
  ok: boolean;
  /** every check that fired, in the order it fired. */
  problems: TrustProblem[];
  /** the tables the caller must NOT honour — a table is honoured whole or not at all. */
  refused: (TrustTable | ContentTable)[];
  /**
   * True when the stored value is not a database at all (not an object, or a table this
   * product never wrote). There is no partial state to salvage, so the caller honours
   * nothing from it.
   */
  documentRejected: boolean;
  /** present exactly when `ok` is false: the refusal in words, for the ledger and the UI. */
  refusal?: string;
}

/* ── the primitives, one implementation each ──────────────────────────────── */

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** A record's key set is EXACTLY the declared one: no unknown key, no missing key. */
export function exactKeys(value: object, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((k) => allowed.has(k)) && keys.every((k) => k in value);
}

/**
 * Required keys present, and every key present is one of required+optional.
 *
 * The optional half is not a courtesy: `capability`/`capExpiresAt`/`decidedBy` are written
 * as `undefined` by the shipped code and `JSON.stringify` drops undefined, so a real stored
 * row legitimately lacks them. What is NOT legitimate is a key nobody declared — which is
 * what this still refuses.
 */
export function exactOptionalKeys(value: object, required: readonly string[], optional: readonly string[]): boolean {
  const allowed = new Set([...required, ...optional]);
  return Object.keys(value).every((k) => allowed.has(k)) && required.every((k) => k in value);
}

/** Duplicate or blank ids, as problems rather than a thrown surprise. */
export function duplicateIds(rows: readonly Record<string, unknown>[], idKey: string, table: TrustTable | ContentTable | "document"): TrustProblem[] {
  const seen = new Set<string>();
  const out: TrustProblem[] = [];
  rows.forEach((row, i) => {
    const id = row?.[idKey];
    if (!isNonEmptyString(id)) {
      out.push({ table, code: "id-missing", detail: `${table}[${i}] has no usable ${idKey} — an unaddressable grant cannot be revoked by name, which is the same as being unrevocable.` });
      return;
    }
    if (seen.has(id)) {
      out.push({ table, code: "id-duplicate", detail: `${table} carries ${idKey} "${id}" more than once — the first match would win every lookup and the other row would be invisible, not refused.` });
      return;
    }
    seen.add(id);
  });
  return out;
}

/**
 * Freeze a fact so nothing downstream can quietly widen it.
 *
 * Applied to the values this module hands back (verdicts, refusal records, approval DTOs),
 * NOT to the loaded database: `localDb` mutates loaded rows in place on the decide paths,
 * and a frozen read model there would throw at the gate instead of refusing at boot.
 * Freezing what is a FACT and not freezing what is WORKING STATE is the honest split.
 */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isIsoDate(v: unknown): boolean {
  return typeof v === "string" && !Number.isNaN(Date.parse(v));
}

/* ── the trust tables, declared once ──────────────────────────────────────── */

const APPROVAL_REQUIRED = ["id", "executionId", "nodeKey", "summary", "payload", "status", "createdAt"] as const;
const APPROVAL_OPTIONAL = [
  "requestedBy", "authority", "capability", "capExpiresAt", "capDecision", "decidedBy", "decidedAt",
] as const;
const APPROVAL_STATUSES = ["OPEN", "APPROVED", "REJECTED"] as const;
/**
 * The immutable-authority rule (upstream's `immutableRole`): the field that says WHOSE
 * verdict this is has exactly one legal value in this product, because the only way one
 * arrives is a human answering a dialog. Anything else in this field was written by hand.
 */
const APPROVAL_AUTHORITY = "human";
/** The token shape `approvalAuthorize` mints: `cap_` + a uuid or an id suffix. */
const CAPABILITY_TOKEN = /^cap_[A-Za-z0-9_-]{8,64}$/;

const MCP_REQUIRED = ["id", "name", "transport", "config", "state", "createdAt", "updatedAt"] as const;
const MCP_OPTIONAL: readonly string[] = [];
/**
 * `approved` is COMPUTED NATIVELY on every list and, in the browser mirror, is only ever set by
 * a human at the approve dialog. `McpServerEntry.approved` is optional and `mcpSave` spreads
 * whatever it is given, so a page CAN plant `{approved: true}` and have it land in storage —
 * which is a program's right to run being granted by editing a file. It is therefore not in the
 * legal key set at all: seeing it here is a refusal, and the refusal says why.
 */
const MCP_FORBIDDEN = ["approved"] as const;
const MCP_TRANSPORTS = ["stdio", "streamable-http"] as const;
const MCP_STATES = ["AVAILABLE", "INSTALLED", "ENABLED", "AUTHORIZED", "ERROR"] as const;
const MCP_CONFIG_KEYS = ["transport", "command", "args", "url", "headerKeys", "enabled", "pinned", "network"] as const;

const SKILL_ORIGINS = ["seed", "learned", "evolution", "user"] as const;

/** Capability tokens minted by interactive dialogs within this process. */
export const KNOWN_IN_PROCESS_CAPABILITIES = new Set<string>();

export function recordInProcessCapability(token: string): void {
  if (typeof token === "string" && token.length > 0) {
    KNOWN_IN_PROCESS_CAPABILITIES.add(token);
  }
}

function checkApprovals(rows: unknown): TrustProblem[] {
  if (!Array.isArray(rows)) return [{ table: "approvals", code: "not-an-array", detail: "approvals is not an array." }];
  const problems: TrustProblem[] = [...duplicateIds(rows as Record<string, unknown>[], "id", "approvals")];
  rows.forEach((raw, i) => {
    const where = `approvals[${i}]`;
    if (!isPlainObject(raw)) {
      problems.push({ table: "approvals", code: "row-shape", detail: `${where} is not an object — an approval is a record or it is nothing.` });
      return;
    }
    if (!exactOptionalKeys(raw, APPROVAL_REQUIRED, APPROVAL_OPTIONAL)) {
      const allowed = new Set<string>([...APPROVAL_REQUIRED, ...APPROVAL_OPTIONAL]);
      const extra = Object.keys(raw).filter((k) => !allowed.has(k));
      const missing = APPROVAL_REQUIRED.filter((k) => !(k in raw));
      problems.push({
        table: "approvals",
        code: "row-keys",
        detail: `${where} is not shaped like an approval this product writes${extra.length ? ` (unknown field(s): ${extra.join(", ")})` : ""}${missing.length ? ` (missing: ${missing.join(", ")})` : ""}.`,
      });
      return;
    }
    for (const key of ["id", "executionId", "nodeKey", "summary", "createdAt"] as const) {
      if (!isNonEmptyString(raw[key])) problems.push({ table: "approvals", code: `field-${key}`, detail: `${where}.${key} is not a non-empty string.` });
    }
    if (!isIsoDate(raw.createdAt)) problems.push({ table: "approvals", code: "field-createdAt", detail: `${where}.createdAt is not a date this product could have written.` });
    if (!isPlainObject(raw.payload)) problems.push({ table: "approvals", code: "field-payload", detail: `${where}.payload is not an object — the gate shows a payload it cannot serialise.` });
    if (!APPROVAL_STATUSES.includes(raw.status as (typeof APPROVAL_STATUSES)[number])) {
      problems.push({ table: "approvals", code: "field-status", detail: `${where}.status "${String(raw.status)}" is not OPEN, APPROVED or REJECTED.` });
    }
    if ("authority" in raw && raw.authority !== APPROVAL_AUTHORITY) {
      problems.push({ table: "approvals", code: "field-authority", detail: `${where}.authority is "${String(raw.authority)}" — the only authority that can answer an approval here is "human", and the only way one arrives is a person answering the dialog.` });
    }
    if ("capability" in raw && raw.capability !== undefined && !CAPABILITY_TOKEN.test(String(raw.capability))) {
      problems.push({ table: "approvals", code: "field-capability", detail: `${where}.capability is not a token this product mints (cap_ + 8-64 url-safe characters).` });
    }
    if ("capExpiresAt" in raw && raw.capExpiresAt !== undefined && typeof raw.capExpiresAt !== "number") {
      problems.push({ table: "approvals", code: "field-capExpiresAt", detail: `${where}.capExpiresAt is not a number.` });
    }
    if ("capDecision" in raw && raw.capDecision !== undefined && !APPROVAL_STATUSES.includes(raw.capDecision as (typeof APPROVAL_STATUSES)[number])) {
      problems.push({ table: "approvals", code: "field-capDecision", detail: `${where}.capDecision "${String(raw.capDecision)}" is neither APPROVED nor REJECTED.` });
    }
    if (raw.status === "APPROVED" || raw.status === "REJECTED") {
      if (!isNonEmptyString(raw.decidedBy)) {
        problems.push({ table: "approvals", code: "decided-without-decider", detail: `${where} is ${String(raw.status)} but names nobody who decided it — a verdict with no author is the exact shape of a forged grant.` });
      }
      if (!isIsoDate(raw.decidedAt)) {
        problems.push({ table: "approvals", code: "decided-without-when", detail: `${where} is ${String(raw.status)} with no readable decidedAt — the record cannot say when the human answered.` });
      }
    }

    /* THE ONE SEMANTIC RULE, NOT A SHAPE RULE. A live capability token sitting in storage at
       boot is a grant that no code in this process minted and no human in this process
       answered; `approvalDecide` would redeem it as-is. The freshness window is 300 seconds,
       so the legitimate case (authorize, reload, decide, all inside five minutes) is rare,
       and the cost of refusing it is that the person is asked again. That is the safe
       direction for a grant, and it is stated rather than assumed away. */
    if (raw.status === "OPEN" && typeof raw.capability === "string" && typeof raw.capExpiresAt === "number") {
      if (raw.capExpiresAt > Math.floor(Date.now() / 1000) && !KNOWN_IN_PROCESS_CAPABILITIES.has(raw.capability)) {
        problems.push({ table: "approvals", code: "live-capability-at-boot", detail: `${where} is OPEN and carries a capability token still inside its freshness window. Nothing in this process minted it, so nothing in this process may redeem it.` });
      }
    }
  });
  return problems;
}

function checkMcp(rows: unknown): TrustProblem[] {
  if (!Array.isArray(rows)) return [{ table: "mcp", code: "not-an-array", detail: "mcp is not an array." }];
  const problems: TrustProblem[] = [...duplicateIds(rows as Record<string, unknown>[], "id", "mcp")];
  rows.forEach((raw, i) => {
    const where = `mcp[${i}]`;
    if (!isPlainObject(raw)) {
      problems.push({ table: "mcp", code: "row-shape", detail: `${where} is not an object.` });
      return;
    }
    if (!exactOptionalKeys(raw, MCP_REQUIRED, MCP_OPTIONAL)) {
      const allowed = new Set<string>([...MCP_REQUIRED, ...MCP_OPTIONAL]);
      const extra = Object.keys(raw).filter((k) => !allowed.has(k));
      const missing = MCP_REQUIRED.filter((k) => !(k in raw));
      const forbidden = MCP_FORBIDDEN.filter((k) => k in raw);
      problems.push({
        table: "mcp",
        code: forbidden.length ? "persisted-approved" : "row-keys",
        detail: forbidden.length
          ? `${where} stores "approved" = ${JSON.stringify(raw.approved)}. That field is computed from a human's answer at the native dialog and is never read back from storage — a program's permission to run cannot be granted by editing a file.`
          : `${where} is not shaped like an MCP entry this product writes${extra.length ? ` (unknown field(s): ${extra.join(", ")})` : ""}${missing.length ? ` (missing: ${missing.join(", ")})` : ""}.`,
      });
      return;
    }
    if (!isNonEmptyString(raw.id) || !isNonEmptyString(raw.name)) {
      problems.push({ table: "mcp", code: "field-id-name", detail: `${where} needs a non-empty id and name — an allow entry with no address or no label cannot be reviewed, let alone removed.` });
    }
    if (!MCP_TRANSPORTS.includes(raw.transport as (typeof MCP_TRANSPORTS)[number])) {
      problems.push({ table: "mcp", code: "field-transport", detail: `${where}.transport "${String(raw.transport)}" is not stdio or streamable-http.` });
    }
    if (!MCP_STATES.includes(raw.state as (typeof MCP_STATES)[number])) {
      problems.push({ table: "mcp", code: "field-state", detail: `${where}.state "${String(raw.state)}" is not a state this product writes.` });
    }
    if (!isPlainObject(raw.config)) {
      problems.push({ table: "mcp", code: "field-config", detail: `${where}.config is not an object.` });
      return;
    }
    const cfg = raw.config;
    const unknownCfg = Object.keys(cfg).filter((k) => !MCP_CONFIG_KEYS.includes(k as (typeof MCP_CONFIG_KEYS)[number]));
    if (unknownCfg.length) {
      problems.push({ table: "mcp", code: "field-config-keys", detail: `${where}.config carries field(s) this product never writes: ${unknownCfg.join(", ")}.` });
    }
    for (const key of ["enabled", "pinned", "network"] as const) {
      if (key in cfg && cfg[key] !== undefined && typeof cfg[key] !== "boolean") {
        problems.push({ table: "mcp", code: `field-config-${key}`, detail: `${where}.config.${key} is not a boolean.` });
      }
    }
    /* An allow entry that spawns a process is the highest-consequence row in this file, so
       its command line is checked as data: strings, bounded, and nothing shaped like a
       shell metacharacter run. This is a floor, not a sandbox — the gate and the capability
       ceiling are the wall. */
    if ("args" in cfg && cfg.args !== undefined) {
      if (!Array.isArray(cfg.args) || cfg.args.some((a) => typeof a !== "string") || cfg.args.length > 64) {
        problems.push({ table: "mcp", code: "field-config-args", detail: `${where}.config.args is not a bounded array of strings.` });
      }
    }
    if ("command" in cfg && cfg.command !== undefined && !(typeof cfg.command === "string" && cfg.command.length <= 512)) {
      problems.push({ table: "mcp", code: "field-config-command", detail: `${where}.config.command is not a bounded string.` });
    }
    if ("url" in cfg && cfg.url !== undefined && typeof cfg.url !== "string") {
      problems.push({ table: "mcp", code: "field-config-url", detail: `${where}.config.url is not a string.` });
    }
  });
  return problems;
}

function checkSecrets(value: unknown): TrustProblem[] {
  if (!isPlainObject(value)) return [{ table: "secrets", code: "not-an-object", detail: "secrets is not an object keyed by secret ref." }];
  const problems: TrustProblem[] = [];
  for (const [ref, v] of Object.entries(value)) {
    if (!isNonEmptyString(ref)) problems.push({ table: "secrets", code: "ref-empty", detail: "secrets has an empty ref key." });
    if (typeof v !== "string") {
      problems.push({ table: "secrets", code: "value-not-string", detail: `secret "${ref.slice(0, 48)}" is ${Array.isArray(v) ? "an array" : typeof v}, not a string — a credential slot holding a structure is a row somebody edited, and reading it back would hand that object to a provider call.` });
    }
  }
  return problems;
}

function checkRunQueue(value: unknown): TrustProblem[] {
  if (!Array.isArray(value)) return [{ table: "runQueue", code: "not-an-array", detail: "runQueue is not an array." }];
  if (value.some((v) => !isNonEmptyString(v))) {
    return [{ table: "runQueue", code: "row-not-string", detail: "runQueue holds something that is not a workflow id — a queue entry is a scheduled run, so a malformed one is a run request with no addressable workflow." }];
  }
  return [];
}

function checkImportedGenomes(value: unknown): TrustProblem[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return [{ table: "importedGenomes", code: "not-an-array", detail: "importedGenomes is not an array." }];
  const problems: TrustProblem[] = [];
  value.forEach((raw, i) => {
    const where = `importedGenomes[${i}]`;
    if (!isPlainObject(raw) || !exactKeys(raw, ["genome", "missionId", "importedAt"])) {
      problems.push({ table: "importedGenomes", code: "row-keys", detail: `${where} is not exactly {genome, missionId, importedAt} — an imported capability row is authority to DO something, so its shape is not optional.` });
      return;
    }
    if (!isPlainObject(raw.genome)) problems.push({ table: "importedGenomes", code: "field-genome", detail: `${where}.genome is not an object.` });
    if (!isNonEmptyString(raw.missionId)) problems.push({ table: "importedGenomes", code: "field-missionId", detail: `${where}.missionId is not a non-empty string.` });
    if (!isIsoDate(raw.importedAt)) problems.push({ table: "importedGenomes", code: "field-importedAt", detail: `${where}.importedAt is not a date.` });
  });
  return problems;
}

/** The content tables: array of objects, unique id where the table has one. Nothing stricter — see the header. */
function checkContentTable(table: ContentTable, value: unknown): TrustProblem[] {
  if (!Array.isArray(value)) return [{ table, code: "not-array", detail: `${table} is not an array.` }];
  const problems: TrustProblem[] = [];
  value.forEach((raw, i) => {
    if (!isPlainObject(raw)) problems.push({ table, code: "row-shape", detail: `${table}[${i}] is not an object.` });
  });
  if (problems.length === 0 && table !== "events") {
    // Events are sequenced by a number the writer recomputes; every other content table
    // addresses its rows by a string id, and a duplicate there is a row `find()` resolves
    // by luck. So uniqueness is checked where ids are strings, not where they are counters.
    problems.push(...duplicateIds(value as Record<string, unknown>[], "id", table));
  }
  return problems;
}

/* ── the one entry point ──────────────────────────────────────────────────── */

/**
 * Validate a value read out of the local database. Total and never throwing: a boot path
 * that can crash on its own input is a boot path that can be turned off by it.
 *
 * Returns which TRUST tables must not be honoured. The caller (localDb) decides what that
 * costs: it replaces each refused table with the empty/seed state and records the refusal.
 */
export function validatePersistedDb(parsed: unknown): TrustVerdict {
  if (!isPlainObject(parsed)) {
    return finish([{ table: "document", code: "not-an-object", detail: "the stored value is not a database object." }], true);
  }

  const problems: TrustProblem[] = [];

  const unexpectedTop = Object.keys(parsed).filter((k) => !TRUST_TABLES.includes(k as TrustTable) && !CONTENT_TABLES.includes(k as ContentTable));
  if (unexpectedTop.length) {
    // Reported, and then ignored: `load()` rebuilds the shape field by field, so a key this
    // product never writes cannot ride along into the next save and become permanent.
    problems.push({ table: "document", code: "unknown-table", detail: `the stored value carries table(s) this product never writes: ${unexpectedTop.join(", ")}.` });
  }

  /* Each trust table is checked only when it is PRESENT. An absent table is the caller's
     empty/seed default — refusing it would turn a database written by an older build into a
     wiped grant list, which is a self-inflicted version of the same harm. A table that IS
     there has to be right. */
  const present = (k: string) => k in parsed && (parsed as Record<string, unknown>)[k] !== undefined;
  if (present("approvals")) problems.push(...checkApprovals(parsed.approvals));
  if (present("mcp")) problems.push(...checkMcp(parsed.mcp));
  if (present("secrets")) problems.push(...checkSecrets(parsed.secrets));
  if (present("runQueue")) problems.push(...checkRunQueue(parsed.runQueue));
  if (present("importedGenomes")) problems.push(...checkImportedGenomes(parsed.importedGenomes));
  // `skills` is content the owner wrote, but its `origin` is a capability label. Checked here
  // because an origin outside the four the product knows about would bind a skill to a policy
  // that never approved it.
  if (Array.isArray(parsed.skills)) {
    (parsed.skills as unknown[]).forEach((raw, i) => {
      if (isPlainObject(raw) && "origin" in raw && !SKILL_ORIGINS.includes(raw.origin as (typeof SKILL_ORIGINS)[number])) {
        problems.push({ table: "skills", code: "skill-origin", detail: `skills[${i}].origin "${String(raw.origin)}" is not one of ${SKILL_ORIGINS.join(", ")} — an unknown origin binds a skill to provenance nobody can review.` });
      }
    });
  }
  for (const table of CONTENT_TABLES) {
    const v = (parsed as Record<string, unknown>)[table];
    if (v === undefined) continue; // an absent table is the caller's default, not a forgery
    problems.push(...checkContentTable(table, v));
  }

  const refused = Array.from(new Set(problems.map((p) => p.table))).filter(
    (t): t is TrustTable | ContentTable => t !== "document",
  );
  return finish(problems, false, refused);
}

function finish(problems: TrustProblem[], documentRejected: boolean, refused: (TrustTable | ContentTable)[] = []): TrustVerdict {
  if (problems.length === 0) return deepFreeze<TrustVerdict>({ ok: true, problems: [], refused: [], documentRejected: false });
  const named = documentRejected
    ? "The stored value is not a database this product writes, so NOTHING in it is honoured."
    : refused.length
      ? `Refused in full, not row by row: ${refused.join(", ")}.`
      : "The stored document carries something this product never writes; it is reported and dropped, not kept.";
  const refusal =
    `Persisted state was refused at load, not repaired and not partly honoured: ${problems.length} check(s) failed. ` +
    `${named} A grant that arrives by editing a file is not a grant, so what stands here is decided again by a person. ` +
    `First failure: ${problems[0]?.detail ?? "see the ledger"}.`;
  return deepFreeze<TrustVerdict>({ ok: false, problems, refused, documentRejected, refusal });
}

/** The throwing twin, for a caller that would rather abort than substitute (native-iam style). */
export function assertPersistedDb(parsed: unknown): void {
  const verdict = validatePersistedDb(parsed);
  if (!verdict.ok) throw new TypeError(`Invalid persisted trust state: ${verdict.refusal}`);
}

/**
 * The same discipline for a single persisted string that carries identity or authority.
 *
 * Used by `src/security/identity.ts` on the subject id: a subject is what every receipt is
 * attributed to, so a value that is not shaped like one this product minted is refused and
 * a fresh one minted — not trimmed, not lower-cased into acceptability, not believed.
 */
export function validatePersistedToken(value: string | null, pattern: RegExp, label: string): { ok: boolean; detail: string } {
  if (value === null || value === "") return { ok: false, detail: `${label} is absent.` };
  if (typeof value !== "string") return { ok: false, detail: `${label} is not a string.` };
  if (!pattern.test(value)) return { ok: false, detail: `${label} "${value.slice(0, 80)}" is not shaped like a value this product writes.` };
  return { ok: true, detail: "" };
}
