import { uid, nowIso } from "../app/id";
import { nodeStorage, knightSecretDelete, knightSecretExists, knightSecretGet, knightSecretSet } from "../host/knight";
import type { SecretStatus } from "./client";
import { GRAPH_SCHEMA_VERSION, type ApprovalRecord, type DlqRecord, type EvolutionCandidateRecord, type ExecutionEventRecord, type ExecutionRecord, type ExecutionStats, type FeedbackRecord, type McpServerEntry, type MemoryRecord, type SkillRecord, type WorkflowGraph, type WorkflowRecord } from "../domain/types";
import { writeFirstThatFits, notePersist, type PersistResult, type PersistRung } from "../persist/quotaSafe";
import { validatePersistedDb, deepFreeze, recordInProcessCapability, type TrustVerdict } from "../persist/trustGuard";

const KEY = "selfimpulse.v3.db";

/**
 * How many event rows a degraded write keeps.
 *
 * Events are execution TELEMETRY (`eventEmit` below already trims the list at 4000 rows and
 * keeps the tail), and they are by far the largest thing in this key. So they are the one
 * thing this module is willing to give up when the origin is full — and it says so, in the
 * durable ledger, with the count. Workflows, memories, skills, approvals, secrets, the DLQ and
 * MCP entries are never sacrificed: quietly losing the owner's work to make room is not a
 * degradation the owner chose.
 */
const EVENT_KEEP = 1000;

interface DbShape {
  workflows: WorkflowRecord[];
  executions: ExecutionRecord[];
  events: ExecutionEventRecord[];
  memories: MemoryRecord[];
  skills: SkillRecord[];
  feedback: FeedbackRecord[];
  evolution: EvolutionCandidateRecord[];
  mcp: McpServerEntry[];
  approvals: ApprovalRecord[];
  dlq: DlqRecord[];
  secrets: Record<string, string>;
  runQueue: string[];
  importedGenomes?: ImportedGenomeRow[];
}

/** 16.10.1 — the skill store's imported capabilities, persisted as real
 * genome rows (a whole CapabilityGenome plus the import stamp). Loose shape
 * here on purpose: the genome type lives in the engine, which imports THIS
 * module — the layering never reverses. */
export interface ImportedGenomeRow {
  genome: Record<string, unknown>;
  missionId: string;
  importedAt: string;
}

function empty(): DbShape {
  return {
    workflows: [],
    executions: [],
    events: [],
    memories: [],
    skills: [],
    feedback: [],
    evolution: [],
    mcp: seedMcp(),
    approvals: [],
    dlq: [],
    secrets: {},
    runQueue: [],
  };
}

function seedMcp(): McpServerEntry[] {
  const now = nowIso();
  const rows: Array<[string, string, string, string[]]> = [
    ["mcp.filesystem", "Filesystem", "npx", ["-y", "tsx", "vendor/mcp-servers-reference/src/filesystem/index.ts"]],
    ["mcp.git", "Git", "python", ["-m", "mcp_server_git"]],
    ["mcp.memory", "Memory", "npx", ["-y", "tsx", "vendor/mcp-servers-reference/src/memory/index.ts"]],
    ["mcp.sequential-thinking", "Sequential Thinking", "npx", ["-y", "tsx", "vendor/mcp-servers-reference/src/sequentialthinking/index.ts"]],
    ["mcp.time", "Time", "python", ["-m", "mcp_server_time"]],
    ["mcp.github", "GitHub", "github-mcp-server", ["stdio"]],
    ["mcp.control", "Control MCP", "selfimpulse-control-mcp", ["stdio"]],
  ];
  return rows.map(([id, name, command, args]) => ({
    id,
    name,
    transport: "stdio" as const,
    config: { transport: "stdio", command, args, enabled: id === "mcp.control", pinned: true },
    state: "AVAILABLE" as const,
    createdAt: now,
    updatedAt: now,
  }));
}

/**
 * The refusal this process recorded at load, kept as a frozen fact.
 *
 * WHY IT IS KEPT IN MEMORY AND NOT ONLY IN THE LEDGER: a refused table is invisible
 * otherwise. The app boots, the grant list reads as empty, and the operator cannot tell
 * "nobody decided anything yet" from "somebody edited the file and this build refused to
 * believe it". Those are different sentences and only one of them is reassuring, so the
 * second one has to be readable — `loadRefusal()` hands it to a screen, and the durable
 * ledger (`vh.persist.notices`) holds it for the audit.
 */
let loadRefusal: Readonly<{ at: string; refusal: string; refusedTables: readonly string[]; firstProblem: string }> | null = null;

/**
 * localStorage is a file this product did not author.
 *
 * It used to be READ AND BELIEVED: `{ ...empty(), ...JSON.parse(raw) }` handed every table —
 * including the human-approval table and the MCP allow table — straight to the engine. A
 * hand-edited or corrupted grant was honoured at boot (audit A10), which defeats the approval
 * gate its own error text describes ("Requester code cannot decide its own request"). Now the
 * shape is validated before anything is honoured (`src/persist/trustGuard.ts`) and a table that
 * fails is REFUSED WHOLE — no row of a failed table survives, because half-trusting a grant
 * table is precisely the state an editor wants: the rows that pass the checks are the ones they
 * left valid on purpose.
 *
 * The refused content is replaced by this build's own empty/seed state, never by a repaired
 * version of what was on disk. Unknown top-level keys are dropped rather than spread in, so a
 * field this product never writes cannot ride a read-write round trip into permanence.
 */
function load(): DbShape {
  const db = empty();
  let raw: string | null = null;
  try {
    raw = nodeStorage.getItem(KEY);
  } catch {
    // A storage that throws on ACCESS (sandboxed frame, private-mode quota of zero) is a host
    // fact, not a corruption signal: there is no stored state to distrust, so say nothing.
    return db;
  }
  if (!raw) return db;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    refuse({ ok: false, problems: [{ table: "document", code: "unreadable-json", detail: "the stored value is not readable JSON." }], refused: [], documentRejected: true, refusal: "Persisted state was refused at load: the stored value is not readable JSON, so nothing in it is honoured." } as TrustVerdict);
    return db;
  }

  const verdict = validatePersistedDb(parsed);
  if (verdict.ok) return shape(parsed as Record<string, unknown>, [], db);
  refuse(verdict);
  return shape(parsed as Record<string, unknown>, verdict.refused, db);
}

/** Take each declared table from the stored object, skipping the ones the verdict refused. */
function shape(parsed: Record<string, unknown>, refused: readonly string[], db: DbShape): DbShape {
  const kept = (name: string) => !refused.includes(name) && parsed[name] !== undefined;
  if (kept("workflows")) db.workflows = parsed.workflows as DbShape["workflows"];
  if (kept("executions")) db.executions = parsed.executions as DbShape["executions"];
  if (kept("events")) db.events = parsed.events as DbShape["events"];
  if (kept("memories")) db.memories = parsed.memories as DbShape["memories"];
  if (kept("skills")) db.skills = parsed.skills as DbShape["skills"];
  if (kept("feedback")) db.feedback = parsed.feedback as DbShape["feedback"];
  if (kept("evolution")) db.evolution = parsed.evolution as DbShape["evolution"];
  if (kept("dlq")) db.dlq = parsed.dlq as DbShape["dlq"];
  // A refused `mcp` leaves the seeded defaults from `empty()` — this build's own table, not storage.
  if (kept("mcp")) db.mcp = parsed.mcp as DbShape["mcp"];
  if (kept("approvals")) db.approvals = parsed.approvals as DbShape["approvals"];
  if (kept("secrets")) db.secrets = parsed.secrets as DbShape["secrets"];
  if (kept("runQueue")) db.runQueue = parsed.runQueue as DbShape["runQueue"];
  if (kept("importedGenomes")) db.importedGenomes = parsed.importedGenomes as ImportedGenomeRow[];
  return db;
}

/** Record a refusal once per session: in memory for the UI, in the durable ledger for the audit. */
function refuse(verdict: TrustVerdict): void {
  if (loadRefusal) return;
  loadRefusal = deepFreeze({
    at: nowIso(),
    refusal: verdict.refusal ?? "Persisted state was refused at load.",
    refusedTables: verdict.refused.slice(),
    firstProblem: verdict.problems[0]?.detail ?? "see the ledger",
  });
  try {
    notePersist(KEY, "refused", verdict.refusal ?? "Persisted state was refused at load.");
  } catch {
    /* the ledger is best-effort by design — never let it become the failure */
  }
  // Loud on the console too: a build that refuses a forged grant must not look idle.
  console.warn(`[selfimpulse] ${verdict.refusal}`);
}

/**
 * Write the database, quota-safely.
 *
 * THIS IS THE APP'S LARGEST SINGLE localStorage KEY — every workflow, memory row, skill,
 * approval, DLQ entry, MCP server, workspace root and (on the non-native host) every secret.
 * The old one-liner `localStorage.setItem(KEY, JSON.stringify(db))` had no guard, so on quota
 * exhaustion it rejected EVERY `ipc.*` write in the app, and on the call paths that do not wrap
 * the call the operator got an unhandled rejection with no message at all (`ipc/client.ts:706`
 * being the example the audit named).
 *
 * Now the house ladder (`src/persist/quotaSafe.ts`) decides what a full origin costs, and it
 * only ever costs telemetry: rung 1 keeps the newest thousand event rows, rung 2 drops the
 * event list entirely, and both write the degradation or the refusal into the durable ledger
 * with the count. If even the smallest payload does not fit, the write REFUSES IN WORDS — it
 * throws carrying the refusal text, because a save that silently did not happen is the exact
 * failure this module was audited for, and a rejection nobody can read is not a report.
 */
function save(db: DbShape): PersistResult {
  const events = db.events.length;
  const ladder: PersistRung[] = [{ value: JSON.stringify(db), dropped: "" }];
  if (events > EVENT_KEEP) {
    ladder.push({
      value: JSON.stringify({ ...db, events: db.events.slice(-EVENT_KEEP) }),
      dropped: `the ${events - EVENT_KEEP} oldest event row(s) (execution telemetry only — no workflow, memory, skill, approval, DLQ, MCP entry or secret was given up)`,
    });
  }
  if (events > 0) {
    ladder.push({
      value: JSON.stringify({ ...db, events: [] }),
      dropped: `all ${events} event row(s) (execution telemetry; every durable record is intact)`,
    });
  }
  const result = writeFirstThatFits(KEY, ladder, nodeStorage);
  if (!result.ok) {
    throw new Error(
      result.refused ??
        `write to "${KEY}" was refused — nothing was saved. The in-memory copy holds this change for the rest of the session and it is lost on reload.`,
    );
  }
  return result;
}

export const localDb = {
  load,
  save,
  /** The persisted-state refusal this process recorded at load, or null. A frozen fact. */
  loadRefusal: () => loadRefusal,
  reset() {
    nodeStorage.removeItem(KEY);
    loadRefusal = null;
  },

  workflowList(): WorkflowRecord[] {
    return load().workflows.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  workflowGet(id: string): WorkflowRecord {
    const w = load().workflows.find((x) => x.id === id);
    if (!w) throw new Error(`workflow not found: ${id}`);
    return w;
  },
  workflowCreate(name: string, description: string): { id: string } {
    const db = load();
    const id = uid("wf");
    const now = nowIso();
    const graph: WorkflowGraph = {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      id,
      name,
      nodes: [],
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      groups: [],
      notes: [],
    };
    db.workflows.unshift({ id, name, description, graph, createdAt: now, updatedAt: now, tags: [] });
    save(db);
    return { id };
  },
  workflowSave(id: string, name: string, description: string, graph: WorkflowGraph) {
    const db = load();
    const w = db.workflows.find((x) => x.id === id);
    if (!w) throw new Error("workflow not found");
    w.name = name;
    w.description = description;
    w.graph = graph;
    w.updatedAt = nowIso();
    save(db);
  },
  workflowDelete(id: string) {
    const db = load();
    db.workflows = db.workflows.filter((w) => w.id !== id);
    save(db);
  },

  executionCreate(workflowId: string, workflowVersion: number): { id: string } {
    const db = load();
    const id = uid("exec");
    db.executions.unshift({
      id,
      workflowId,
      workflowVersion,
      status: "RUNNING",
      startedAt: nowIso(),
      endedAt: null,
      error: null,
      stats: { nodesRun: 0, nodesFailed: 0, retries: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, costUsd: 0, evaluationScores: [] },
    });
    save(db);
    return { id };
  },
  executionFinish(id: string, status: string, error: string | null, stats: ExecutionStats) {
    const db = load();
    const e = db.executions.find((x) => x.id === id);
    if (!e) return;
    e.status = status as ExecutionRecord["status"];
    e.error = error;
    e.stats = stats;
    e.endedAt = nowIso();
    save(db);
  },
  executionList(): ExecutionRecord[] {
    return load().executions;
  },
  eventEmit(executionId: string, kind: string, level: string, nodeId: string | null, data: Record<string, unknown>) {
    const db = load();
    const rec: ExecutionEventRecord = {
      seq: db.events.length + 1,
      ts: nowIso(),
      kind,
      level: level as ExecutionEventRecord["level"],
      nodeId,
      executionId,
      data,
    };
    db.events.push(rec);
    if (db.events.length > 4000) db.events = db.events.slice(-3000);
    save(db);
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("vh://event", { detail: rec }));
    return rec;
  },
  executionEvents(executionId: string) {
    return load().events.filter((e) => e.executionId === executionId);
  },

  importedGenomesSave(rows: ImportedGenomeRow[]) {
    const db = load();
    db.importedGenomes = rows;
    save(db);
  },

  importedGenomesList(): ImportedGenomeRow[] {
    return load().importedGenomes ?? [];
  },

  secretSet(ref: string, value: string) {
    knightSecretSet(ref, value);
  },
  secretDelete(ref: string) {
    knightSecretDelete(ref);
  },
  secretExists(refs: string[]): Record<string, SecretStatus> {
    return knightSecretExists(refs) as Record<string, SecretStatus>;
  },
  secretGet(ref: string): string | null {
    return knightSecretGet(ref);
  },

  mcpList() {
    return load().mcp;
  },
  mcpSave(cfg: Partial<McpServerEntry> & { name: string }): { id: string } {
    const db = load();
    const id = cfg.id || uid("mcp");
    const now = nowIso();
    const existing = db.mcp.find((m) => m.id === id);
    if (existing) {
      Object.assign(existing, cfg, { updatedAt: now });
    } else {
      db.mcp.push({
        id,
        name: cfg.name,
        transport: cfg.transport ?? "stdio",
        config: cfg.config ?? { transport: "stdio", enabled: true },
        state: "AVAILABLE",
        createdAt: now,
        updatedAt: now,
      });
    }
    save(db);
    return { id };
  },
  mcpRemove(id: string) {
    const db = load();
    db.mcp = db.mcp.filter((m) => m.id !== id);
    save(db);
  },

  memoryAdd(nodeKey: string, kind: string, content: string, tags: string[], importance: number) {
    const db = load();
    const rec: MemoryRecord = { id: uid("mem"), nodeKey, kind: kind as MemoryRecord["kind"], content, tags, importance, createdAt: nowIso() };
    db.memories.unshift(rec);
    save(db);
    return { id: rec.id };
  },
  memorySearch(nodeKey: string, query: string, limit = 12) {
    const q = query.toLowerCase();
    return load()
      .memories.filter((m) => m.nodeKey === nodeKey && (!q || m.content.toLowerCase().includes(q)))
      .slice(0, limit);
  },
  memoryDelete(id: string) {
    const db = load();
    db.memories = db.memories.filter((m) => m.id !== id);
    save(db);
  },

  skillsList(nodeKey: string) {
    const all = load().skills.filter((s) => s.nodeKey === nodeKey);
    return { skills: all.filter((s) => s.active), all };
  },
  skillUpsert(args: { nodeKey: string; name: string; description: string; procedure: string; origin: string }) {
    const db = load();
    const rec: SkillRecord = {
      id: uid("skill"),
      nodeKey: args.nodeKey,
      name: args.name,
      description: args.description,
      procedure: args.procedure,
      preconditions: "",
      toolStrategy: "",
      verificationStrategy: "",
      knownFailureModes: "",
      version: 1,
      score: null,
      origin: args.origin as SkillRecord["origin"],
      active: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      applications: 0,
    };
    db.skills.push(rec);
    save(db);
    return { id: rec.id, version: 1 };
  },

  feedbackAdd(executionId: string, nodeKey: string, rating: number, comment: string) {
    const db = load();
    const rec: FeedbackRecord = { id: uid("fb"), executionId, nodeKey, rating, comment, createdAt: nowIso() };
    db.feedback.unshift(rec);
    save(db);
    return { id: rec.id };
  },
  feedbackList() {
    return load().feedback;
  },

  evolutionList() {
    return load().evolution;
  },
  evolutionPropose(cand: Partial<EvolutionCandidateRecord>) {
    const db = load();
    const rec: EvolutionCandidateRecord = {
      id: uid("evo"),
      nodeKey: cand.nodeKey ?? "",
      parentVersion: cand.parentVersion ?? 1,
      candidateVersion: cand.candidateVersion ?? 2,
      trigger: cand.trigger ?? "manual",
      evidence: cand.evidence ?? [],
      changes: cand.changes ?? {},
      baselineScore: cand.baselineScore ?? null,
      candidateScore: cand.candidateScore ?? null,
      holdoutPassed: cand.holdoutPassed ?? null,
      regressionPassed: cand.regressionPassed ?? null,
      status: "PROPOSED",
      decision: "PENDING",
      createdAt: nowIso(),
      decidedAt: null,
    };
    db.evolution.unshift(rec);
    save(db);
    return { id: rec.id };
  },
  evolutionDecide(id: string, decision: "ACCEPTED" | "REJECTED") {
    // C-2 mirror of db.rs: DECIDED exactly once, only from PROPOSED, unknown
    // ids error instead of silently reporting success.
    const db = load();
    const c = db.evolution.find((x) => x.id === id);
    if (!c) throw new Error(`evolution candidate ${id} does not exist — nothing was changed.`);
    if (c.status !== "PROPOSED")
      throw new Error(
        `evolution candidate ${id} is not PROPOSED (current status ${c.status}) — it moves exactly once, from PROPOSED to DECIDED.`,
      );
    c.decision = decision;
    c.status = "DECIDED";
    c.decidedAt = nowIso();
    save(db);
    return { ok: true };
  },

  approvalList() {
    // Capabilities never ride a list — only the authorize return hands one out.
    return load()
      .approvals.filter((a) => a.status === "OPEN")
      .map(({ capability: _capability, ...rest }) => rest);
  },
  approvalRequest(executionId: string, nodeKey: string, summary: string, payload: Record<string, unknown>, requestedBy?: string) {
    const db = load();
    const rec: ApprovalRecord = {
      id: uid("appr"),
      executionId,
      nodeKey,
      summary,
      payload,
      status: "OPEN",
      createdAt: nowIso(),
      // C-2 (archive 4): the request binds who asked and what authority answers.
      requestedBy: requestedBy && requestedBy.trim() ? requestedBy : `execution:${executionId}`,
      authority: "human",
    };
    db.approvals.unshift(rec);
    save(db);
    window.dispatchEvent(new CustomEvent("vh://approval", { detail: rec }));
    return { id: rec.id, requestedBy: rec.requestedBy, authority: rec.authority };
  },
  /** C-2 (archive 4) — the web mirror's native-equivalent capability mint.
   *
   *  Desktop mints through an OS dialog; the browser's equivalent of a window
   *  WebView scripts cannot answer is `window.confirm` — synchronous, modal,
   *  and not programmatically dismissible. Declined confirm ⇒ no token, no
   *  decision. The token is scoped to one verdict and expires in five minutes,
   *  exactly like the native capability. */
  approvalAuthorize(id: string, decision: "APPROVED" | "REJECTED") {
    if (decision !== "APPROVED" && decision !== "REJECTED") {
      throw new Error(`approval_authorize: decision must be APPROVED or REJECTED (got ${JSON.stringify(decision)})`);
    }
    const db = load();
    const a = db.approvals.find((x) => x.id === id);
    if (!a) throw new Error(`approval ${id} does not exist — nothing to authorize.`);
    if (a.status !== "OPEN") throw new Error(`approval ${id} is not OPEN (current status ${a.status}) — nothing to authorize.`);
    if (typeof window === "undefined" || typeof window.confirm !== "function") {
      throw new Error("approval_authorize requires an interactive confirm dialog — refusing to mint a capability non-interactively.");
    }
    const word = decision === "APPROVED" ? "approve" : "refuse";
    const ok = window.confirm(
      `SelfImpulse — human approval gate\n\n${a.summary}\n\nRequester: ${a.requestedBy ?? `execution:${a.executionId}`}\nRequired authority: ${a.authority ?? "human"}\nVerdict if you confirm: ${decision}\n\n${word.toUpperCase()} this? Cancel mints nothing and decides nothing.`,
    );
    if (!ok) {
      throw new Error(`approval ${id}: declined at the confirm dialog — no capability was minted and no decision was recorded.`);
    }
    const token = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? `cap_${crypto.randomUUID()}` : uid("cap");
    recordInProcessCapability(token);
    a.capability = token;
    a.capExpiresAt = Math.floor(Date.now() / 1000) + 300;
    a.capDecision = decision;
    save(db);
    return { capability: token, expiresAt: a.capExpiresAt, approvalId: id, decision };
  },
  approvalDecide(id: string, decision: "APPROVED" | "REJECTED", capability: string) {
    // C-2 mirror of db.rs (archive 4): state machine AND actor. A decision
    // presents the capability minted at the interactive dialog for THIS
    // approval, still fresh, for THIS verdict — then it lands exactly once.
    const db = load();
    const a = db.approvals.find((x) => x.id === id);
    if (!a) throw new Error(`approval ${id} does not exist — nothing was changed.`);
    if (a.status !== "OPEN")
      throw new Error(
        `approval ${id} is not OPEN (current status ${a.status}) — a decision is final; an approval moves exactly once, from OPEN to APPROVED or REJECTED.`,
      );
    if (!capability || !capability.trim())
      throw new Error(
        `approval ${id}: no capability presented — a decision must first pass approval_authorize, where a human answers the dialog. Requester code cannot decide its own request.`,
      );
    if (!a.capability)
      throw new Error(`approval ${id} has no live capability — call approval_authorize first; the human's answer is what makes a decision legitimate.`);
    if (a.capability !== capability)
      throw new Error(`capability does not belong to approval ${id} — it was minted for a different request (confused-approver refused).`);
    if (typeof a.capExpiresAt === "number" && Math.floor(Date.now() / 1000) > a.capExpiresAt)
      throw new Error(`capability for approval ${id} expired (freshness window closed) — return to approval_authorize for a fresh answer.`);
    if (a.capDecision !== decision)
      throw new Error(
        `capability for approval ${id} was minted for ${a.capDecision ?? "no verdict"}; it cannot cast ${decision}. Re-open approval_authorize and let the human pick this verdict explicitly.`,
      );
    a.status = decision;
    a.decidedBy = "human:confirm";
    a.decidedAt = nowIso();
    a.capability = undefined;
    a.capExpiresAt = undefined;
    a.capDecision = undefined;
    save(db);
  },
  approvalGet(executionId: string, nodeKey: string) {
    const a = load().approvals.find((x) => x.executionId === executionId && x.nodeKey === nodeKey && x.status !== "OPEN");
    return a
      ? { decided: true, status: a.status, id: a.id, decidedBy: a.decidedBy ?? "", decidedAt: a.decidedAt ?? null, requestedBy: a.requestedBy ?? "", payload: a.payload ?? {} }
      : { decided: false };
  },

  dlqList() {
    return load().dlq.filter((d) => d.status === "OPEN");
  },
  dlqAdd(executionId: string, nodeKey: string, error: string, payload: Record<string, unknown>, suggestedCause: string, candidateFix: string) {
    const db = load();
    const rec: DlqRecord = {
      id: uid("dlq"),
      executionId,
      nodeKey,
      error,
      payload,
      status: "OPEN",
      suggestedCause,
      candidateFix,
      createdAt: nowIso(),
    };
    db.dlq.unshift(rec);
    save(db);
    return { id: rec.id };
  },
  dlqResolve(id: string) {
    const db = load();
    const d = db.dlq.find((x) => x.id === id);
    if (d) d.status = "RESOLVED";
    save(db);
  },

  runEnqueue(workflowId: string) {
    const db = load();
    db.runQueue.push(workflowId);
    save(db);
  },
  runTake(): string[] {
    const db = load();
    const items = db.runQueue.splice(0);
    save(db);
    return items;
  },
};
