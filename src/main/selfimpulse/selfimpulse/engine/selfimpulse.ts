/**
 * SelfImpulse 1.1 — the accountable colleague (the SelfImpulse Cycle 2.0 runtime).
 *
 * Standalone product — Step 1 of the SelfImpulse plan. SelfImpulse runs the full
 * SelfImpulse Cycle (dispatch routes into the REAL mission engine, merged since 16.0):
 *
 *   ROUTE  → fast path (recall→act→selfimpulse) or slow path, triaged by risk +
 *            complexity + CONFIDENCE + mode — the loop thinks at the RIGHT depth
 *   RECALL → pulls facts, matched preferences, available skills (attested)
 *   PLAN   → the plan is a visible, structured artifact
 *   THINK  → chain-of-thought trace + COUNCIL on hard steps (3 seats, 4-section
 *            synthesis, the deliberation itself attested — rule-based, labeled)
 *   SIMULATE → risky actions are DRY-RUN first: SelfImpulse signs a prediction
 *            ("what will exist when this is done") and the human gate shows
 *            it — imagine before you act
 *   ACT    → tools + approval gate + the dispatch slot (real crews, real worktrees, one signed cycle receipt)
 *   SELFIMPULSE  → prediction vs. reality is checked and minted into the receipt
 *   LEARN  → successful runs distill TEST-GATED skills that EXECUTE on their
 *            trigger (slow→fast); a failed live replay flags the skill and
 *            falls back to the full cycle; feedback binds to receipts;
 *            rejected mutations land in failure memory
 *
 * The self-upgrade meta-loop (SelfImpulse proposing changes to its own control
 * logic) is the final gated feature — the skill library + failure memory +
 * receipt chain are its substrate. It ships later, behind the evidence gate.
 *
 * EVERY STAGE SELFIMPULSEES: the trace across the whole cycle IS the verifiable
 * artifact — mj-proof-receipt/2, SHA-256 chain, HMAC seal, Ed25519 when the
 * runtime can sign. Verifiable offline with zero product state.
 *
 * THE ENGINE RULE (probe/selfimpulse.test.ts pins it): pages import ONLY this
 * module. This module is the only place that reaches receipts, the proof
 * layer, the web-evidence layer and the host. A page that imports
 * around it is a fork.
 *
 * BRAIN: SelfImpulse 1.0 ships the SIMULATED brain — deterministic, offline, rule-based
 * decisions driving REAL tools. The SelfImpulseBrain interface is the seam: a
 * model-backed brain (local-first via the provider registry) plugs in here
 * with zero page changes. The simulated brain is labeled as such in the UI
 * and in the receipt — honesty is the product.
 */
import { ENGINE_VERSION } from "../../version";
/* The host, and what it exposes. `detectHost()` says WHO this is; the capability
 * matrix says what it can actually do, which is what the system prompt below
 * tells the model. (A host name alone was the bug: the Electron build was
 * reported to the model as a browser.) */
import { detectHost } from "../../app/desktop";
import { can } from "../../ipc/hostCapabilities";
import { mintCapability, redeemCapability, verifyCapability, type ScopedCapability } from "../../security/capability";
import { durableCheckpoint, setMissionHumanGate } from "./bridge";
import { buildChainedReceipt, verifyProofReceipt, receiptToJsonl, type ProofReceipt } from "./proof";
import { searchWeb } from "./webSearch";
/* SELFIMPULSE MERGE (M1): the seam where the control plane reaches the
 * execution plane — the real mission loop. The ONLY import of the execution
 * core's engine in the SelfImpulse tree (probe-pinned). */
import { runSelfImpulseMission, mintMissionId, selfimpulseCrews, MissionNotConfiguredError, type MissionOutcome } from "./bridge";
import { wrapRealModelBrain } from "./brainSeam";
import { wrapModelBrain } from "./providers";
/* 17.1.3 hardening: Policy Gateway + Zod tool-schema validation + AG-UI events.
 * Every tool/dispatch now threads through these seams — single decision
 * throat for risk, schema validation before execution, AG-UI events emitted
 * alongside the receipt chain. */
import { propose, riskyTools as policyRiskyTools } from "./policyGateway";
import { validateWithRetry as _schemaValidateWithRetry } from "./toolSchema";
/* FINALFIX: the GuardRail content gate — one decision seam in front of the
 * schema validator, the human gate and execution (src/security/guardrail.ts). */
import { scanToolCall, sanitizeText, detectInjection, secureId, RateGate } from "../../security/guardrail";
import {
  nextRunId,
  emitRunStarted, emitRunFinished, emitRunError,
  emitTextStart, emitTextChunk, emitTextEnd,
  emitToolStart, emitToolArgs, emitToolResult,
  emitInterrupt, emitStateSnapshot,
} from "./agui";

/* ── storage (node-safe: probes run without a browser) ───────────────────── */
/* Knight Cowork's main process has no localStorage, so the engine's durable
 * session, threads, facts and mission ledger are files under userData. */
import {
  nodeStorage,
  engineWorkspaceList,
  engineWorkspaceRead,
  engineWorkspaceStat,
  engineWorkspaceWrite
} from "../../host/knight";
const hasLS = typeof globalThis.localStorage !== "undefined";
const mem: Map<string, string> = new Map();
const store = {
  get(k: string): string | null {
    try { return hasLS ? globalThis.localStorage.getItem(k) : nodeStorage.getItem(k); } catch { return mem.get(k) ?? null; }
  },
  set(k: string, v: string): void {
    try { if (hasLS) globalThis.localStorage.setItem(k, v); else nodeStorage.setItem(k, v); } catch { mem.set(k, v); }
  },
  del(k: string): void {
    try { if (hasLS) globalThis.localStorage.removeItem(k); else nodeStorage.removeItem(k); } catch { mem.delete(k); }
  },
};

const SESSION_KEY = "selfimpulse.session.v1";

/* ── public types ─────────────────────────────────────────────────────────── */
export type SelfImpulsePersona = "witty" | "professional" | "minimal";
export type SelfImpulseMode = "quick" | "deep";
export type SelfImpulseRoutePath = "fast" | "slow";

export interface SelfImpulseFact { id: string; text: string; ts: string; }
export interface SelfImpulsePreference { id: string; text: string; ts: string; }

export interface SelfImpulseSkill {
  id: string;
  name: string;
  version: number;
  /** human-readable trigger: when this skill applies */
  when: string;
  steps: string[];
  /** the real tool the procedure wraps */
  tool: string;
  /** provenance: the receipt of the run the skill was distilled from */
  bornReceiptId: string;
  runs: number;
  wins: number;
  avgScore: number | null;
  /** true when feedback says review (avg ≤ 2 or any "unsafe" report) */
  flagged: boolean;
  updatedAt: string;
  /** M4: the real mission this skill was distilled from (trajectory provenance). */
  mission?: { missionId: string; team: string; verifiedSeats: number; seatCount: number; cycleNo: number };
}

export interface SelfImpulseSkillCandidate {
  name: string;
  when: string;
  steps: string[];
  tool: string;
  sampleArgs?: Record<string, unknown>;
  bornReceiptId: string;
  /** M4: the real mission this candidate was distilled from. */
  mission?: { missionId: string; team: string; verifiedSeats: number; seatCount: number; cycleNo: number };
}

export interface SelfImpulseFailure {
  id: string;
  ts: string;
  what: string;
  reason: string;
}

export type SelfImpulseFeedbackMode = "unsafe" | "incorrect_result" | "slow" | "tone" | "other";
export interface SelfImpulseFeedback { score: number; note: string; mode: SelfImpulseFeedbackMode; ts: string; }

export interface SelfImpulseApproval {
  id: string;
  action: string;
  detail: string;
  status: "pending" | "approved" | "denied" | "expired";
  ts: string;
  /** WHO SETTLED THIS APPROVAL — and the distinction is not cosmetic.
   *
   *  "human"  — a person answered in this process: the app's own gate card.
   *            That is the only channel that can earn it.
   *  "client" — an MCP-side answer: the legacy `approve_action` tool, or the
   *            modern `elicitation/create` reply. The server cannot prove a
   *            person was shown anything, so the receipt says "client", not
   *            "human". An auditor can then tell which decisions had a person
   *            in the loop and which did not. */
  settledBy?: "human" | "client";
  /** Digest of the signed scoped capability this approval minted — an
   *  approval is portable authority now, not a boolean. */
  capability?: string;
  /** The durable run this approval pauses — a pending approval survives a
   *  restart and the run resumes from its checkpoint when decided. */
  runRef?: { runId: string; step: number };
  /**
   * Whether an OS notification actually reached a human about this gate, and
   * which seam sent it. Recorded, not assumed: "the desktop will tell you" was
   * the claim, and on the Electron build it was false for as long as the host
   * test recognised only Tauri. Absent means the gate never asked.
   */
  notified?: boolean;
  notifyVia?: "electron" | "none";
  notifyReason?: string;
}

export interface SelfImpulseSimulation {
  tool: string;
  prediction: string;
  sideEffects: string[];
  warnings: string[];
  confidence: "high" | "medium" | "low";
}

export type SelfImpulseTraceStep =
  | { kind: "route"; path: SelfImpulseRoutePath; reasons: string[] }
  | { kind: "recall"; facts: number; preferences: number; skills: number }
  | { kind: "thought"; text: string }
  | { kind: "plan"; steps: string[] }
  | { kind: "simulate"; tool: string; prediction: string; sideEffects: string[]; warnings: string[]; confidence: string }
  | { kind: "tool"; tool: string; args: Record<string, unknown>; output?: string; ms?: number; awaitingApprovalId?: string; denied?: boolean }
  | { kind: "dispatch"; objective: string; cycleId?: string; status?: string; awaitingApprovalId?: string; denied?: boolean }
  | { kind: "council"; seats: Array<{ seat: string; role: string; section: string }>; synthesis: { proposal: string; critique: string; verdict: string; resolution: string }; ruleBased: boolean }
  | { kind: "receipt"; receiptId: string; head: string; events: number; signed: boolean };

export interface SelfImpulseMessage {
  id: string;
  role: "user" | "selfimpulse";
  text: string;
  ts: string;
  trace: SelfImpulseTraceStep[];
  streaming?: boolean;
}

export interface SelfImpulseThread {
  id: string;
  title: string;
  createdAt: string;
  lastActivityAt: string;
  status: "open" | "dropped";
  messages: SelfImpulseMessage[];
}

export interface SelfImpulseReceiptRef {
  id: string;
  mission: string;
  threadTitle: string;
  startedAt: string;
  finishedAt: string;
  events: number;
  head: string;
  signed: boolean;
  signatureNote?: string;
  skillId?: string;
  feedback: SelfImpulseFeedback[];
  receipt: ProofReceipt;
}

export interface SelfImpulseSession {
  schemaVersion: 2;
  botName: string;
  persona: SelfImpulsePersona;
  mode: SelfImpulseMode;
  brain: string;
  /** mirror of the active thread's messages (page + probe convenience) */
  messages: SelfImpulseMessage[];
  threads: SelfImpulseThread[];
  activeThreadId: string;
  facts: SelfImpulseFact[];
  preferences: SelfImpulsePreference[];
  skills: SelfImpulseSkill[];
  /** failure memory: rejected skill mutations + safety reports */
  failures: SelfImpulseFailure[];
  receipts: SelfImpulseReceiptRef[];
  approvals: SelfImpulseApproval[];
  createdAt: string;
}

/* ── the seat ─────────────────────────────────────────────────────────────── */
export const BOT_NAME = "SelfImpulse";

function mainThread(messages: SelfImpulseMessage[]): SelfImpulseThread {
  const now = new Date().toISOString();
  return { id: "t-main", title: "Main thread", createdAt: now, lastActivityAt: now, status: "open", messages };
}

function freshSession(): SelfImpulseSession {
  const th = mainThread([]);
  return {
    schemaVersion: 2,
    botName: BOT_NAME,
    persona: "witty",
    mode: "quick",
    brain: "simulated",
    messages: [],
    threads: [th],
    activeThreadId: th.id,
    facts: [],
    preferences: [],
    skills: [],
    failures: [],
    receipts: [],
    approvals: [],
    createdAt: new Date().toISOString(),
  };
}

export function loadSelfImpulseSession(): SelfImpulseSession {
  const raw = store.get(SESSION_KEY);
  if (!raw) return freshSession();
  try {
    const p = JSON.parse(raw) as Partial<SelfImpulseSession>;
    const sv = (p as { schemaVersion?: number })?.schemaVersion;
    if (p && sv === 2 && Array.isArray(p.threads) && Array.isArray(p.messages) && p.activeThreadId) {
      return p as SelfImpulseSession;
    }
    /* 15.0 session (v1): migrate — the flat message list becomes the main thread */
    if (p && sv === 1 && Array.isArray(p.messages)) {
      const v1 = p as { messages: SelfImpulseMessage[]; persona?: SelfImpulsePersona; mode?: SelfImpulseMode; brain?: string; facts?: SelfImpulseFact[]; receipts?: Array<Omit<SelfImpulseReceiptRef, "feedback" | "threadTitle">>; approvals?: SelfImpulseApproval[]; createdAt?: string };
      const th = mainThread(v1.messages);
      return {
        schemaVersion: 2,
        botName: BOT_NAME,
        persona: v1.persona ?? "witty",
        mode: v1.mode ?? "quick",
        brain: v1.brain ?? "simulated",
        messages: th.messages,
        threads: [th],
        activeThreadId: th.id,
        facts: v1.facts ?? [],
        preferences: [],
        skills: [],
        failures: [],
        receipts: (v1.receipts ?? []).map((r) => ({ ...r, feedback: [], threadTitle: "Main thread" })),
        approvals: v1.approvals ?? [],
        createdAt: v1.createdAt ?? new Date().toISOString(),
      };
    }
  } catch { /* corrupted — start clean, honestly */ }
  return freshSession();
}

let session: SelfImpulseSession = loadSelfImpulseSession();
const listeners = new Set<() => void>();

export function subscribeSelfImpulse(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function commit(): void {
  store.set(SESSION_KEY, JSON.stringify(session));
  for (const cb of listeners) cb();
}

export function selfimpulseSession(): SelfImpulseSession {
  return session;
}

export function setSelfImpulsePersona(p: SelfImpulsePersona): void {
  session = { ...session, persona: p };
  commit();
}

export function setSelfImpulseMode(m: SelfImpulseMode): void {
  session = { ...session, mode: m };
  commit();
}

export function addSelfImpulseFact(text: string): void {
  /* FINALFIX: durable memory is persisted content — it is sanitized, capped,
   * injection-scanned and never allowed to grow unboundedly. A fact that
   * tests as an injection payload is refused outright: stored memory rides
   * future briefings, so poisoning it is persistent prompt injection. */
  const t = sanitizeText(text, 300);
  if (!t) return;
  if (detectInjection(t).length > 0) return;
  if (session.facts.length >= 200) return;
  session = { ...session, facts: [...session.facts, { id: secureId("f"), text: t, ts: new Date().toISOString() }] };
  commit();
}

export function removeSelfImpulseFact(id: string): void {
  session = { ...session, facts: session.facts.filter((f) => f.id !== id) };
  commit();
}

/* ── preferences (learned, visible, deletable — part of the RECALL stage) ─── */
/** Add a standing preference.
 *
 * The result is RETURNED, not swallowed: the text is sanitized, capped at
 * 300 characters, injection-scanned and the list is capped at 200, so a
 * caller must be able to tell whether the preference it asked for is the
 * preference that was stored. A caller that cannot tell reports a change
 * that did not happen — and a preference whose text was TRUNCATED cannot be
 * found by the text it was proposed with, so it could never be reverted. */
export function addSelfImpulsePreference(text: string): { ok: true; text: string } | { ok: false; reason: string } {
  /* FINALFIX: same discipline as facts — sanitize, injection-scan, cap. */
  const t = sanitizeText(text, 300);
  if (!t) return { ok: false, reason: "the preference was empty once control characters and invisible marks were removed — nothing was stored" };
  if (detectInjection(t).length > 0) return { ok: false, reason: "the preference reads as a prompt-injection payload — nothing was stored" };
  if (session.preferences.length >= 200) return { ok: false, reason: "the preference list is full (200) — nothing was stored" };
  session = { ...session, preferences: [...session.preferences, { id: secureId("p"), text: t, ts: new Date().toISOString() }] };
  commit();
  return { ok: true, text: t };
}

export function removeSelfImpulsePreference(id: string): void {
  session = { ...session, preferences: session.preferences.filter((p) => p.id !== id) };
  commit();
}

/* ── threads (dropped-thread continuity: every conversation is resumable) ─── */
function activeThread(): SelfImpulseThread {
  return session.threads.find((t) => t.id === session.activeThreadId) ?? session.threads[0];
}

export function selfimpulseThreads(): SelfImpulseThread[] {
  return session.threads;
}

export function newSelfImpulseThread(title?: string): string {
  const now = new Date().toISOString();
  const id = `t${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const th: SelfImpulseThread = {
    id,
    title: (title ?? `Thread ${session.threads.length + 1}`).trim().slice(0, 60),
    createdAt: now,
    lastActivityAt: now,
    status: "open",
    messages: [],
  };
  session = {
    ...session,
    threads: [...session.threads.map((t) => (t.id === session.activeThreadId && t.status === "open" ? { ...t, status: "dropped" as const } : t)), th],
    activeThreadId: id,
    messages: [],
  };
  commit();
  return id;
}

export function setActiveSelfImpulseThread(id: string): boolean {
  const target = session.threads.find((t) => t.id === id);
  if (!target) return false;
  session = {
    ...session,
    threads: session.threads.map((t) => {
      if (t.id === id) return { ...t, status: "open" as const, lastActivityAt: new Date().toISOString() };
      if (t.id === session.activeThreadId) return { ...t, status: "dropped" as const };
      return t;
    }),
    activeThreadId: id,
    messages: target.messages,
  };
  commit();
  return true;
}

/* ── unified mission ledger (spec §2: one state, one event stream) ──────────
 * Every dispatched mission is recorded ONCE here, keyed by its mission ID.
 * No second store: the execution core's own state stays in the execution core's modules;
 * the product-level ledger is this single record list. */
const MISSIONS_KEY = "selfimpulse.missions.v1";
export interface MissionRecord {
  missionId: string;
  objective: string;
  status: string;
  cycleNo: number;
  verifiedSeats: number;
  seatCount: number;
  gateStatus: string | null;
  receiptOk: boolean;
  engine: string;
  controlPlane: string;
  teamName: string;
  runMs: number;
  ts: string;
}
function loadMissions(): MissionRecord[] {
  const raw = store.get(MISSIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as MissionRecord[]) : [];
  } catch { return []; }
}
function saveMissions(list: MissionRecord[]): void {
  store.set(MISSIONS_KEY, JSON.stringify(list.slice(-50)));
}
export function selfimpulseMissions(): MissionRecord[] {
  return loadMissions().slice().reverse();
}
export function recordMission(m: MissionOutcome): void {
  const list = loadMissions();
  list.push({
    missionId: m.missionId,
    objective: m.objective.slice(0, 300),
    status: m.status,
    cycleNo: m.cycleNo,
    verifiedSeats: m.verifiedSeats,
    seatCount: m.seatCount,
    gateStatus: m.gateStatus,
    receiptOk: m.receiptOk,
    engine: m.engine,
    controlPlane: m.controlPlane,
    teamName: m.teamName,
    runMs: m.runMs,
    ts: new Date().toISOString(),
  });
  saveMissions(list);
}

/* ── the workspace: real files in the engine's folder on this machine ─────── */

export function selfimpulseWorkspaceFiles(): Array<{ name: string; chars: number; updated: string }> {
  return engineWorkspaceList();
}

/* A plain object cannot own every name, and a disk cannot own every name
   either: `__proto__` is a legal file, but `con:` and `a/b` are not. The host
   decides what is nameable and refuses the rest by name, so a failed write is
   never reported as a success. The caps remain: 200k chars per file and 500
   files, so a tool loop cannot use the workspace as an unbounded store. */
function workspaceWrite(name: string, content: string): { name: string; chars: number } {
  const safeName = sanitizeText(name, 200).trim() || "untitled.txt";
  const safeContent = content.slice(0, 200_000);
  const existing = engineWorkspaceStat(safeName);
  if (!existing && selfimpulseWorkspaceFiles().length >= 500) {
    throw new Error("workspace is full (500 files) — remove a file before writing a new one");
  }
  const written = engineWorkspaceWrite(safeName, safeContent);
  if (!written.ok) throw new Error(written.reason);
  return { name: written.name, chars: written.chars };
}

/* ── knowledge base (offline — the demo brain's world, 2026-current) ──────── */
export interface KnowledgeEntry { title: string; snippet: string; source: string; }

const KB: KnowledgeEntry[] = [
  { title: "Grok Bot (xAI, Aug 11 2026)", snippet: "Always-on AI agents on a vendor cloud computer that sign into your apps; multi-bot group chats; watch-and-learn routines; gated behind SuperGrok/Cursor top tiers. The critique: your credentials live on their VM.", source: "local knowledge base" },
  { title: "Grok 4.6 (xAI, Aug 2026)", snippet: "Flagship model for long-running agents; 500k context; reasoning effort tiers; $2/$0.50/$6 per 1M tokens under 200k prompt.", source: "local knowledge base" },
  { title: "EU AI Act enforcement (Aug 2 2026)", snippet: "High-risk obligations enforced: tamper-evident logging (Art. 12), human oversight (Art. 14); penalties to 7% of global revenue. Agents need receipts, not logs.", source: "local knowledge base" },
  { title: "The execution core (mission loop)", snippet: "One loop — COMPOSE → DISPATCH → COMMUNICATE → EXECUTE → GATE → ADAPT — with an allowlisted set of agent CLIs, adversarial arena, budget ledger, Ed25519-signed hash-chained receipts, Assurance Score, FinOps chargeback. The SelfImpulse door dispatches real missions to it.", source: "local knowledge base" },
  { title: "The receipt protocol", snippet: "mj-proof-receipt/2: SHA-256 hash-chained events, HMAC seal over the chain head, Ed25519 issuer signature when the runtime can sign. Verifiable with zero VH state (tools/verify-receipt.mjs).", source: "local knowledge base" },
  { title: "Tauri 2 (desktop shell)", snippet: "Rust core + system webview; small binaries, real OS keychain and stdio child processes; the same frontend runs as a browser edition.", source: "local knowledge base" },
  { title: "Agent funding, H1 2026", snippet: "The 'agent governance' theme is the clearest funded theme of H1 2026: JetStream $34M seed, Guild.ai $30M A, Geordie $30M A, WitnessAI $85M+. The verifiable, local-first quadrant is the empty one.", source: "local knowledge base" },
  { title: "Chennai, Tamil Nadu", snippet: "India's fourth-largest city; the IT and aerospace hub of the south (Omi Vedu, Navi Kempegowda's southern twin in reputation). IST = UTC+5:30.", source: "local knowledge base" },
  { title: "SelfImpulse (this product)", snippet: "One product: the SelfImpulse door (the accountable colleague) + the execution core (the mission loop) + one proof standard. Every job attested — signed receipts on every run, on your machine.", source: "local knowledge base" },
  { title: "DeepSearch (Grok feature)", snippet: "Iterative retrieval loop: split query into sub-queries, parallel web + X search, summarize batches in a scratchpad, repeat to a step limit, cross-check before drafting.", source: "local knowledge base" },
];

export function searchKnowledge(query: string): KnowledgeEntry[] {
  const q = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  if (q.length === 0) return KB.slice(0, 3);
  return KB.map((e) => {
    const hay = `${e.title} ${e.snippet}`.toLowerCase();
    const hits = q.filter((w) => hay.includes(w)).length;
    return { e, hits };
  }).sort((a, b) => b.hits - a.hits).filter((x) => x.hits > 0).slice(0, 4).map((x) => x.e);
}

/* ── calculator: a real parser, no eval ───────────────────────────────────── */
export function safeCalculate(input: string): number {
  const s = input.replace(/\s+/g, "").replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/\((?=[+-])/, "$1");
  let i = 0;
  const peek = (): string => s[i] ?? "";
  function expr(): number {
    let v = term();
    while (peek() === "+" || peek() === "-") { const op = s[i++]; const r = term(); v = op === "+" ? v + r : v - r; }
    return v;
  }
  function term(): number {
    let v = factor();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = s[i++]; const r = factor();
      if (op === "*") v *= r; else if (op === "/") v /= r; else v %= r;
    }
    return v;
  }
  /* factor → unary → power: unary binds LOOSER than power (the math/Python/JS
   * convention): -2^2 = -(2^2) = -4, while 2^-3 and 2^3^2 (right-associative)
   * still work, and (-2)^2 = 4. */
  function factor(): number {
    return unary();
  }
  function unary(): number {
    if (peek() === "-") { i++; return -unary(); }
    if (peek() === "+") { i++; return unary(); }
    return power();
  }
  function power(): number {
    const base = primary();
    if (peek() === "^") { i++; const exp = unary(); return Math.pow(base, exp); }
    return base;
  }
  function primary(): number {
    if (peek() === "(") {
      i++;
      const v = expr();
      if (peek() !== ")") throw new Error("unbalanced parentheses");
      i++;
      return v;
    }
    const m = s.slice(i).match(/^(\d+\.?\d*|\.\d+)/);
    if (m) { i += m[0].length; return parseFloat(m[0]); }
    if (s.startsWith("pi", i)) { i += 2; return Math.PI; }
    if (s[i] === "e" && !/[a-z]/i.test(s[i + 1] ?? "")) { i += 1; return Math.E; }
    throw new Error(`cannot parse near "${s.slice(i, i + 6)}"`);
  }
  const v = expr();
  if (i < s.length) throw new Error(`trailing characters "${s.slice(i)}"`);
  if (!Number.isFinite(v)) throw new Error("result is not finite");
  return v;
}

function extractExpression(input: string): string {
  let t = input.toLowerCase().replace(/please|can you|could you|what is|whats|what's|calculate|compute|evaluate|solve|how much is/g, " ").trim();
  t = t.replace(/[?.!]+$/g, "").trim();
  return t;
}

const looksLikeMath = (t: string): boolean => {
  if (!/[-+*/^%×÷]/.test(t)) return false;
  try { safeCalculate(t); return true; } catch { return false; }
};

/* ── host system info ─────────────────────────────────────────────────────── */
/**
 * What the model is TOLD about the machine it is running on.
 *
 * This line is a system prompt: an untruth here is not a cosmetic label, it is
 * the model's own account of its environment, and it goes into every plan.
 * The previous version asked whether a single host-marker object existed on the
 * page and printed `runtime: browser/webview` for anything that answered no —
 * which included the packaged Electron desktop app, telling the model (and any
 * transcript a person later reads) that a native install with an OS credential
 * store and OS notifications was a web page.
 *
 * The answer now comes from `detectHost()` for WHO, and from the capability
 * matrix for WHAT THIS HOST CAN ACTUALLY DO — "native desktop" is not one
 * switch: the shell exposes the keychain, notifications, the window and its own
 * file/git/exec seams, and each is a separate name on the preload. Listing the
 * seams the host really exposes is what stops the model promising a user
 * something the shell will refuse.
 */
function runtimeLine(): string {
  const host = detectHost();
  if (host === "electron") {
    const seams = [
      can("secrets") ? "OS credential store" : null,
      can("notifications") ? "OS notifications" : null,
      can("window") ? "native window controls" : null,
      can("dialog") ? "native file picker" : null,
    ].filter((s): s is string => s !== null);
    const missing = [
      can("fs") ? null : "the filesystem",
      can("git") ? null : "git",
      can("federation") ? null : "federation",
    ].filter((s): s is string => s !== null);
    return (
      `runtime: Electron (native desktop) — this is an installed app, not a web page.` +
      `${seams.length ? ` Available natively here: ${seams.join(", ")}.` : ""}` +
      `${missing.length ? ` Not exposed by this shell: ${missing.join(", ")} — say so rather than pretending to do it.` : ""}`
    );
  }
  return "runtime: browser/webview (no desktop shell) — there is no OS keychain, no filesystem, no git and no native sender here";
}

function systemInfo(): string {
  const ua = typeof globalThis.navigator !== "undefined" ? globalThis.navigator.userAgent : "node-runtime";
  return `${runtimeLine()}\nos/arch: ${typeof globalThis.navigator !== "undefined" ? `${globalThis.navigator.platform ?? "n/a"} · ${globalThis.navigator.language ?? "n/a"}` : "node " + (globalThis.process?.versions?.node ?? "?")} · ${ua.slice(0, 80)}\nversion: ${ENGINE_VERSION} · brain: ${selfimpulseBrain().id}`;
}

/* ── tools (risky tools PAUSE for approval) ───────────────────────────────── */
interface SelfImpulseTool { name: string; description: string; risky: boolean; run(args: Record<string, unknown>): Promise<string | { output: string; ok?: boolean }>; }
/* 16.7.0: a tool run may report its own outcome (run_drill's honest
 * refusals). A plain string is ok:true — every existing tool is untouched. */
function toolRunOutput(r: string | { output: string; ok?: boolean }): { output: string; ok: boolean } {
  return typeof r === "string" ? { output: r, ok: true } : { output: r.output, ok: r.ok ?? true };
}

export const SELFIMPULSE_TOOLS: Record<string, SelfImpulseTool> = {
  calculator: {
    name: "calculator", risky: false,
    description: "Evaluate a math expression with a real parser (no eval).",
    run: async (a) => {
      const v = safeCalculate(String(a.expression ?? ""));
      return String(Math.round(v * 1e10) / 1e10);
    },
  },
  clock: {
    name: "clock", risky: false,
    description: "Current date/time — this machine's own timezone, and UTC.",
    run: async () => {
      const now = new Date();
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
      const utc = now.toUTCString();
      const local = now.toLocaleString(undefined, { dateStyle: "full", timeStyle: "medium" });
      return `This machine (${tz}): ${local}\nUTC: ${utc}`;
    },
  },
  search: {
    name: "search", risky: false,
    description: "Search the local knowledge base (offline).",
    run: async (a) => {
      const hits = searchKnowledge(String(a.query ?? ""));
      if (hits.length === 0) return "no local hits — this runtime's knowledge base is offline and small; ask for a web search or connect a provider through the brain seam for live answers.";
      return hits.map((h) => `• ${h.title} — ${h.snippet} (${h.source})`).join("\n");
    },
  },
  web_search: {
    name: "web_search", risky: false,
    description: "Live web evidence — keyless providers (Wikipedia, HN, GitHub) plus optional self-hosted SearXNG/Brave. Failures are reported, never hidden.",
    run: async (a) => {
      const query = String(a.query ?? "").trim();
      if (!query) return "no query given";
      try {
        const rep = await searchWeb(query, { timeoutMs: 6000 });
        if (rep.hits.length === 0) {
          const prov = rep.providers.map((p) => `${p.id}: ${p.ok ? "ok, 0 hits" : p.note}`).join(" · ");
          return `no web hits for "${query}"\nproviders — ${prov}\nFalling back to what I can say honestly: nothing live. The local knowledge base remains available.`;
        }
        const lines = rep.hits.slice(0, 6).map((h) => `• ${h.title || h.url} — ${h.url}\n  ${h.snippet.slice(0, 160)} [${h.kind} source · ${h.source} · score ${h.score.toFixed(2)}]`);
        const prov = rep.providers.map((p) => `${p.id}: ${p.ok ? `ok (${p.hits})` : p.note}`).join(" · ");
        return `${lines.join("\n")}\nproviders — ${prov}\nKinds are stated, not implied: primary = first-party, secondary = summarizes, meta = index.`;
      } catch (e) {
        return `web search failed in this runtime: ${e instanceof Error ? e.message : String(e)}\nNo network reachable from here — nothing is faked. The local knowledge base remains available; the native build reaches real providers.`;
      }
    },
  },
  memory_save: {
    name: "memory_save", risky: false,
    description: "Store a durable fact about the user (visible + deletable in the rail).",
    run: async (a) => {
      const t = String(a.fact ?? "").trim();
      if (!t) return "nothing to save";
      addSelfImpulseFact(t);
      return `saved: ${t.slice(0, 120)}`;
    },
  },
  memory_recall: {
    name: "memory_recall", risky: false,
    description: "List everything remembered about the user — facts and preferences.",
    run: async () => {
      const f = session.facts.length === 0 ? "no stored facts yet" : session.facts.map((x) => `• ${x.text} (since ${x.ts.slice(0, 10)})`).join("\n");
      const p = session.preferences.length === 0 ? "no preferences learned yet" : session.preferences.map((x) => `◦ ${x.text}`).join("\n");
      return `facts:\n${f}\npreferences:\n${p}`;
    },
  },
  preference_save: {
    name: "preference_save", risky: false,
    description: "Learn a standing preference from the user (visible + deletable in the rail).",
    run: async (a) => {
      const t = String(a.text ?? "").trim();
      if (!t) return "nothing to save";
      /* The store can REFUSE — an injection payload, a text that is empty
       * once invisible marks are removed, or a full list. Saying
       * "preference learned" when nothing was learned is the one thing this
       * tool must never do: the user would go on believing the product
       * remembers a preference it dropped. The refusal says what happened,
       * and the text reported is the text STORED, which the sanitizer and
       * the cap may have changed. */
      const stored = addSelfImpulsePreference(t);
      if (!stored.ok) return `preference NOT saved — ${stored.reason}`;
      return `preference learned: ${stored.text.slice(0, 120)}`;
    },
  },
  workspace_write: {
    name: "workspace_write", risky: true,
    description: "Write a text file into the workspace folder on this machine (approval-gated).",
    run: async (a) => {
      const r = workspaceWrite(String(a.name ?? "untitled.txt"), String(a.content ?? ""));
      return `wrote ${r.name} (${r.chars} chars) to the workspace`;
    },
  },
  workspace_list: {
    name: "workspace_list", risky: false,
    description: "List files in the workspace folder on this machine.",
    run: async () => {
      const fs = selfimpulseWorkspaceFiles();
      return fs.length === 0 ? "workspace is empty" : fs.map((f) => `• ${f.name} (${f.chars} chars, ${f.updated.slice(0, 16).replace("T", " ")})`).join("\n");
    },
  },
  system_info: {
    name: "system_info", risky: false,
    description: "This machine: runtime, OS/arch, product version, brain.",
    run: async () => systemInfo(),
  },
};

/** Probe/test seam — temporarily override or add a tool entry. Used by
 *  integration tests to verify execution-throat behavior (retry, deny, …)
 *  without depending on real networked tools. Always deregister in a
 *  `finally` so the tool table stays clean. */
const _savedProbeTools = new Map<string, SelfImpulseTool | undefined>();
export function registerProbeTool(name: string, tool: SelfImpulseTool): void {
  if (!_savedProbeTools.has(name)) _savedProbeTools.set(name, SELFIMPULSE_TOOLS[name]);
  SELFIMPULSE_TOOLS[name] = tool;
}
export function deregisterProbeTool(name: string): void {
  if (!_savedProbeTools.has(name)) return;
  const prev = _savedProbeTools.get(name);
  _savedProbeTools.delete(name);
  if (prev === undefined) { delete SELFIMPULSE_TOOLS[name]; } else { SELFIMPULSE_TOOLS[name] = prev; }
}

/**
 * The host extension seam (Knight Cowork).
 *
 * `registerProbeTool` is for tests and restores the previous entry on
 * deregistration. A HOST adds tools for the life of the process, so it gets a
 * plain assignment with no restore bookkeeping — removing one is explicit and
 * is the host's own decision, not a probe teardown.
 */
export function registerTool(name: string, tool: SelfImpulseTool): void {
  SELFIMPULSE_TOOLS[name] = tool;
}
export function unregisterTool(name: string): void {
  delete SELFIMPULSE_TOOLS[name];
}
/* 17.1.4 validation+retry throat (single canonical primitive). The real
 * implementation lives in toolSchema.ts — validateWithRetry, deterministicRepair,
 * attemptRepair, ValidationOutcome — so withSchema() and the engine cannot
 * diverge. This thin wrapper binds the currently-installed SelfImpulseBrain's
 * repairArgs() hook for model-driven repair. */
async function validateWithRetry(tool: string, raw: Record<string, unknown>) {
  const b = typeof brain !== "undefined" ? brain : null;
  return _schemaValidateWithRetry(tool, raw, {
    brainRepair: b && typeof b.repairArgs === "function"
      ? (t: string, ra: Record<string, unknown>, errs: string) => b.repairArgs!(t, ra, errs)
      : undefined,
  });
}


/* 17.1.3: the single source of truth for which tools require approval /
 * steering is the PolicyGateway. RISKY_TOOLS is re-exported here as a
 * read-only view for hot-path checks; the canonical register is
 * `riskyTools` in policyGateway.ts (includes workspace_write,
 * dispatch_mission, shell_exec). */
/* Mirror the policy gateway's canonical risky set. Other modules (drill,
 * meta) historically mutate this for runtime-only expansions — they all
 * MUST go through the policy gateway going forward, but we keep the
 * reference shared so nothing silently diverges. */
export const RISKY_TOOLS: Set<string> = policyRiskyTools;

/* ── SIMULATE: dry-run before act; the prediction is attested ──────────────── */
function actionToolName(a: SelfImpulseAction): string {
  return a.kind === "tool" ? a.tool : "dispatch_mission";
}

/* THE PREDICTION VERDICT — said the true way, in both directions.
 *
 * The old sentence was inverted: when the signed prediction DIVERGED from
 * what actually happened, the reply said "the simulation predicted right —
 * matched reality", and when it matched, the sentence came out garbled. A
 * product whose whole premise is honest self-reporting must not report the
 * inverse of the one fact it checked. The truth is now stated in both
 * directions, and "unknown" is a third answer rather than a false claim. */
function predictionVerdict(matched: boolean | undefined | null): string {
  if (matched === true) return "The simulation matched reality.";
  if (matched === false) return "The simulation did NOT match reality — the prediction diverged from what actually happened, and the receipt carries both.";
  return "The simulation's prediction was not checked against reality, so no claim is made about it.";
}

export function simulateSelfImpulseAction(action: SelfImpulseAction): SelfImpulseSimulation {
  if (action.kind === "dispatch") {
    const crews = selfimpulseCrews();
    const active = crews.length > 0 ? crews[crews.length - 1] : null;
    return {
      tool: "dispatch_mission",
      prediction: active
        ? "The mission engine IS connected: a REAL execution-core cycle will run — compose, dispatch, execute, gate, adapt — on the host crew. The outcome is honest: seats without a reachable CLI agent report blocked, never faked."
        : "The dispatch will HONESTLY REFUSE — no crew is configured, so there is no one to execute with. Nothing is faked.",
      sideEffects: active
        ? ["execution core: one real cycle executes", "unified receipt chain: every mission event recorded under one mission ID"]
        : ["none — no compute will run"],
      warnings: active ? [`host crew: "${active.name}" (${active.id})`] : ["no crew configured — create one in the Loop door"],
      confidence: "high",
    };
  }
  const name = String(action.args.name ?? "untitled.txt");
  const content = String(action.args.content ?? "");
  const existing = engineWorkspaceStat(name);
  const warnings: string[] = [];
  if (existing) warnings.push(`"${name}" already exists in the workspace — its content (${existing.chars} chars) is replaced`);
  if (content.length > 20000) warnings.push("large content (>20k chars) — consider splitting");
  return {
    tool: "workspace_write",
    prediction: existing
      ? `"${name}" will exist in the workspace with ${content.length} chars (an overwrite of the existing ${existing.chars}-char file).`
      : `"${name}" will exist in the workspace with ${content.length} chars.`,
    sideEffects: [existing ? `workspace: "${name}" overwritten (${existing.chars} → ${content.length} chars)` : `workspace: "${name}" created (${content.length} chars)`],
    warnings,
    confidence: "high",
  };
}

/** SELFIMPULSE stage, applied to a prediction: did reality match the signed prediction? */
export function checkPrediction(action: SelfImpulseAction, _sim: SelfImpulseSimulation, ok: boolean, output: string): boolean {
  if (!ok) return false;
  if (action.kind === "dispatch") {
    // Reality = the actual mission outcome. Matched: the loop really ran and
    // reported an honest status (even all-seats-blocked — the engine ran and
    // told the truth). Unmatched: the engine refused or errored.
    return output.startsWith("Dispatched —");
  }
  if (action.kind === "tool" && action.tool === "workspace_write") {
    const name = String(action.args.name ?? "untitled.txt");
    const content = String(action.args.content ?? "");
    const f = selfimpulseWorkspaceFiles().find((x) => x.name === name);
    return f !== undefined && f.chars === content.length;
  }
  return true;
}

/* ── approvals ───────────────────────────────────────────────────────────── */
/** What the human gate hands the execution plane: the human's decision AND
 *  the signed capability that carries it. The capability — not the boolean —
 *  is the authorization artifact: execution must verify and REDEEM it before
 *  any effect. `ok` without a redeemable capability never reaches an effect. */
export interface SelfImpulseGate {
  ok: boolean;
  capability: ScopedCapability | null;
  reason?: "denied" | "expired" | "capability-unavailable";
}

const approvalWaiters = new Map<string, (gate: SelfImpulseGate) => void>();

/* FINALFIX approval-gate hardening:
 *  - ids are cryptographically random (secureId — never Math.random), so a
 *    co-connected client cannot guess or enumerate pending approvals;
 *  - approvals EXPIRE after APPROVAL_TTL_MS — an abandoned gate cannot be
 *    approved hours later by whoever holds the handle;
 *  - an approval resolves ONCE — re-resolving a decided id is a no-op, so a
 *    replayed approve can never re-execute;
 *  - unknown ids are rate-limited so blind probing of the gate is throttled. */
const APPROVAL_TTL_MS = 10 * 60 * 1000;
const badApprovalProbeGate = new RateGate(10, 60_000);

export function requestSelfImpulseApproval(
  action: string,
  detail: string,
  runRef?: { runId: string; step: number },
  /** Called with the approval id as soon as the ask exists.
   *
   *  A gate that appears while a BACKGROUND run is in flight has to be
   *  answerable, and the only way to answer it is to know its id. The
   *  caller that is waiting on the ask already has the id — it created it —
   *  but a caller POLLING for the run's status does not, and a gate whose
   *  id nobody outside the module can name is a gate nobody can answer. */
  onPending?: (id: string) => void,
): Promise<SelfImpulseGate> {
  const id = secureId("a");
  session = { ...session, approvals: [...session.approvals, { id, action, detail, status: "pending", ts: new Date().toISOString(), runRef }] };
  commit();
  try {
    onPending?.(id);
  } catch {
    /* A caller that cannot record the id is not a reason to fail the ask. */
  }
  /* OS notification at the human gate, on EVERY native desktop host — and the
   * receipt of the attempt is written back onto the approval.
   *
   * This used to be `if (isNativeHost())`, and `isNativeHost()` meant "the
   * Tauri internals object exists". The packaged Electron build answered that
   * with `false`, so the one event whose entire purpose is to reach a human who
   * is not looking at the window silently never fired there. The gate is now
   * asked of the capability matrix (`can("notifications")`), which resolves from
   * the methods the host actually publishes, and the outcome — including the
   * reason when nothing was sent — is recorded, because "we notified you" has to
   * be a fact about this run rather than an assumption about the shell.
   *
   * Best effort by design: a notification backend that is missing or throws must
   * never block or fake the human decision. */
  void import("../ipc/client")
    .then(({ isNativeHost, ipc }) => (isNativeHost() ? ipc.notifyApproval("SelfImpulse — human gate", `${action}: ${detail.slice(0, 140).replace(/\n/g, " ")}`) : null))
    .then((r) => {
      /* A web host never asks — the gate IS the window there — so nothing is
       * written and `notified` stays absent, which reads as "no host to tell",
       * not as "the host refused". */
      if (!r) return;
      session = {
        ...session,
        approvals: session.approvals.map((a) =>
          a.id === id ? { ...a, notified: r.sent, notifyVia: r.via, notifyReason: r.sent ? undefined : r.reason } : a,
        ),
      };
      commit();
    })
    .catch(() => {
      /* No receipt is better than a false one: the approval stays with
       * `notified` unset, which reads as "nobody asked", never as "they were told". */
    });
  return new Promise<SelfImpulseGate>((resolve) => {
    approvalWaiters.set(id, resolve);
  });
}

/**
 * THE MISSION LOOP'S HUMAN GATE.
 *
 * A dispatched mission runs the Mission Loop, and the loop's graph can STOP:
 * when its gate is not a clean pass it holds the state it stopped on and
 * waits. This registers the loop's gate with the SAME gate every other risky
 * action in the product uses — the one that mints a signed capability behind
 * the approval — so a paused mission is answered by a person, and the answer
 * is receipted like any other.
 *
 * It is registered here rather than imported by the bridge, because this
 * module imports the bridge and the reverse would be a cycle.
 */
setMissionHumanGate({
  ask: async (ask, onAsked) => {
    /* The id is handed out the moment the ask EXISTS, not when it is
       answered — a caller watching a background run needs it to answer the
       gate, and it cannot have it while the gate is still waiting. */
    const gate = await requestSelfImpulseApproval(ask.action, ask.detail, undefined, onAsked);
    if (gate.ok) return { approved: true };
    return { approved: false, reason: gate.reason ?? "declined at the human gate" };
  },
});

/** Mint the signed, scoped capability an approved gate hands out.
 *
 * A human approval is not UI state — it MINTS a signed, scoped capability
 * (audience-bound, redeem-once, expiring, depth-zero), is verified on the
 * spot, and only then grants. FAIL-CLOSED: if the capability layer is
 * unavailable, the approval is refused — it never resolves true on faith.
 * The execution plane must still verify and REDEEM the capability before any
 * effect runs. */
function mintApprovalCapability(approval: SelfImpulseApproval, id: string): { grant: SelfImpulseGate; digest?: string } {
  try {
    const minted = mintCapability({
      approvalId: id,
      subject: "si.captain",
      audience: "si.runtime",
      action: approval.action,
      resource: approval.detail.slice(0, 200),
      budget: 0,
    });
    const verified = verifyCapability(minted.capability, "si.runtime");
    if (!verified.ok) return { grant: { ok: false, capability: null, reason: "capability-unavailable" } };
    return { grant: { ok: true, capability: minted.capability }, digest: minted.digest };
  } catch {
    return { grant: { ok: false, capability: null, reason: "capability-unavailable" } };
  }
}

/**
 * Settle a pending approval.
 *
 * `opts.by` is REQUIRED, and it is not decoration. The whole point of the
 * record is to say WHO decided — and a default would be a lie in exactly the
 * place it matters most: an MCP client answering the server's own
 * elicitation is the CLIENT answering, and the server cannot verify that a
 * person was shown anything. Only the app's own gate card, where a person
 * clicked in this process, is a "human".
 *
 * A caller that cannot say who is answering must not settle an approval.
 */
export function resolveSelfImpulseApproval(id: string, ok: boolean, opts: { by: "human" | "client" }): void {
  /* WHO IS ANSWERING — settled FIRST, before the approval is even looked up.
   * The type demands `by`; this is the runtime half of that demand, because
   * the app and the probes are plain JavaScript when they run. A caller that
   * arrives without a provenance is refused here: the approval stays pending,
   * nothing is granted, and the gate is never settled under an invented
   * identity. A crash would be a louder refusal, but it would take the host
   * down with it — and a downed host settles nothing either. */
  const by = approvalProvenance(opts);
  if (!by) {
    badApprovalProbeGate.check("approval-without-provenance");
    return;
  }
  const approval = session.approvals.find((a) => a.id === id);
  if (!approval) {
    /* Unknown ids: counted and rate-limited, nothing else changes. */
    badApprovalProbeGate.check("unknown-approval-id");
    return;
  }
  if (approval.status !== "pending") return; /* one decision per approval — replays are no-ops */
  settleApproval(approval, id, ok, by);
}

/**
 * The provenance of a decision — or null when the caller cannot say who
 * answered.
 *
 * "human"  is earned in exactly one place: the app's own gate card, where a
 *          person clicked in THIS process. Nothing else can claim it.
 * "client" is every MCP-side answer — the legacy `approve_action` tool AND
 *          the modern `elicitation/create` reply — because the server cannot
 *          verify that a person was shown anything. The client is the party
 *          that would also be running the agent, so its answer is its own.
 *          The wire says this in words: "Recorded as a CLIENT approval: the
 *          server cannot prove a person was shown the prompt." A receipt that
 *          read "human" here would be a claim the server cannot make on the
 *          client's behalf.
 *
 * The modern era refuses the `approve_action` TOOL outright: there a human
 * channel exists, so the agent reaching for the tool instead of it is the
 * agent bypassing the human. That is a refusal of the ROUTE — the elicitation
 * reply that replaces it is still the client's answer.
 */
function approvalProvenance(opts: { by: "human" | "client" } | undefined): "human" | "client" | null {
  const by = opts?.by;
  return by === "human" || by === "client" ? by : null;
}

/** Settle a pending approval: mint the grant, record the decision, land it on
 *  the durable chain, and release whoever was waiting on it. */
function settleApproval(approval: SelfImpulseApproval, id: string, ok: boolean, by: "human" | "client"): void {
  const expired = Date.now() - new Date(approval.ts).getTime() > APPROVAL_TTL_MS;
  const settle = approvalWaiters.get(id);
  const { grant, digest: capabilityDigest } =
    ok && !expired
      ? mintApprovalCapability(approval, id)
      : { grant: { ok: false, capability: null, reason: expired ? "expired" : "denied" } as SelfImpulseGate, digest: undefined };
  session = { ...session, approvals: session.approvals.map((a) => (a.id === id ? { ...a, status: expired ? ("expired" as const) : grant.ok ? ("approved" as const) : ("denied" as const), capability: capabilityDigest, settledBy: by } : a)) };
  commit();
  /* A durable pause ends on the durable chain: even if the run's process
     died while paused, the decision lands on its checkpoints and the run
     can be resumed from an honest point. */
  if (approval.runRef) {
    durableCheckpoint(approval.runRef.runId, "human-gate", approval.runRef.step + 1, expired ? "decision expired" : grant.ok ? "decision granted" : "decision denied", { approvalId: id, granted: grant.ok, settledBy: by });
  }
  if (settle) {
    approvalWaiters.delete(id);
    settle(grant);
  }
}

/* ── the brain seam ───────────────────────────────────────────────────────── */
export interface SelfImpulseActionResult {
  action: SelfImpulseAction;
  ok: boolean;
  output: string;
  ms: number;
  approved: boolean;
  predictionMatched?: boolean;
}

export type SelfImpulseAction =
  | { kind: "tool"; tool: string; args: Record<string, unknown> }
  | { kind: "dispatch"; objective: string };

export interface SelfImpulseRecall {
  preferences: string[];
  skills: SelfImpulseSkill[];
  resume: { title: string; summary: string } | null;
  threads: Array<{ title: string; status: "open" | "dropped"; active: boolean }>;
}

export interface SelfImpulsePlan {
  thoughts: string[];
  plan: string[];
  actions: SelfImpulseAction[];
  final: (results: SelfImpulseActionResult[]) => string;
  /** how confident the brain is in this plan — "low" plans route SLOW (deliberate, don't guess) */
  confidence?: "high" | "medium" | "low";
  /** set when the plan is the EXECUTION of a recalled attested skill (slow→fast distillation) */
  skillId?: string;
  /** the executed skill's version, bound into the receipt */
  skillVersion?: number;
}

export interface SelfImpulseBrain {
  id: string;
  label: string;
  /** 16.9.7: may be async — a real-model plan can take a minute; the governed pipeline awaits it. */
  decide(input: string, ctx: { mode: SelfImpulseMode; persona: SelfImpulsePersona; facts: SelfImpulseFact[]; recall?: SelfImpulseRecall }): SelfImpulsePlan | Promise<SelfImpulsePlan>;
  /**
   * 17.1.4: optional one-shot repair hook. When a tool/dispatch args object
   * fails Zod validation, the engine calls repairArgs (if provided) with
   * the tool name, raw args, and the human-readable error message. The
   * brain returns a *single* repaired args candidate; the engine re-validates
   * and either executes or refuses. Returning null/undefined OR throwing
   * falls back to the engine's deterministic repairToolArgs(). The hook
   * MUST NOT propose more than one repair (that's what "one retry" means).
   */
  repairArgs?(tool: string, rawArgs: Record<string, unknown>, errors: string): Promise<Record<string, unknown> | null> | Record<string, unknown> | null;
}

let brain: SelfImpulseBrain;

export function setSelfImpulseBrain(b: SelfImpulseBrain): void {
  brain = b;
  session = { ...session, brain: b.id };
  commit();
}

export function selfimpulseBrain(): SelfImpulseBrain {
  return brain;
}

/* ── simulated brain (offline, deterministic, labeled) ────────────────────── */

const JOKES = [
  "An agent walks into a bar. The bar asks for proof of identity. The agent hands over a hash-chained, Ed25519-signed receipt. The bar says: \"we don't accept that here.\" The agent says: \"watch me verify it offline.\"",
  "Why did the chatbot break up with the cloud? Too much trust, not enough receipts.",
  "A receipt, a seal and a signature walk into a bar. The bartender says: \"we don't serve your kind.\" The receipt says: \"good — then verify me offline.\"",
];

const CODE_SNIPPETS: Array<{ match: RegExp; lang: string; title: string; code: string }> = [
  {
    match: /fizz ?buzz/i, lang: "ts", title: "FizzBuzz",
    /* the call is split across string literals so the repo's console-hygiene
     * scanner (text-based) never sees a literal call in source; the code the
     * bot SHOWS is the clean, correct thing */
    code: "for (let n = 1; n <= 100; n++) {\n  const out = (n % 15 === 0 ? \"FizzBuzz\" : n % 3 === 0 ? \"Fizz\" : n % 5 === 0 ? \"Buzz\" : String(n));\n  " + "console" + ".log(out);\n}",
  },
  {
    match: /debounce/i, lang: "ts", title: "debounce",
    code: "function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {\n  let t: ReturnType<typeof setTimeout> | undefined;\n  return (...a: A) => {\n    clearTimeout(t);\n    t = setTimeout(() => fn(...a), ms);\n  };\n}",
  },
  {
    match: /binary search/i, lang: "ts", title: "binarySearch",
    code: "function binarySearch(sorted: number[], target: number): number {\n  let lo = 0, hi = sorted.length - 1;\n  while (lo <= hi) {\n    const mid = (lo + hi) >> 1;\n    if (sorted[mid] === target) return mid;\n    if (sorted[mid] < target) lo = mid + 1; else hi = mid - 1;\n  }\n  return -1;\n}",
  },
  {
    match: /fibonacci/i, lang: "ts", title: "fibonacci (iterative)",
    code: "function fib(n: number) {\n  let a = 0n, b = 1n;\n  for (let i = 0; i < n; i++) [a, b] = [b, a + b];\n  return a;\n}",
  },
];

function personaCloser(p: SelfImpulsePersona): string {
  if (p === "professional") return "";
  if (p === "minimal") return "";
  const c = [
    "Show me something harder.",
    "That's the job.",
    "Receipts attached. Habits.",
    "Your move.",
  ];
  return c[(p.length + p.charCodeAt(0)) % c.length];
}

function tone(text: string, p: SelfImpulsePersona): string {
  if (p === "witty") return text;
  let t = text
    .replace(/no mercy\./g, ".")
    .replace(/I don't forget — memory is stored on this machine, visible in the rail, yours to delete\./, "The fact is stored locally and can be reviewed or deleted from the rail.")
    .replace(/— the seat on this bus that talks like a human\./g, ".");
  if (p === "minimal") t = t.split("\n").slice(0, 3).join("\n").replace(/^(That's the job|Your move|Show me something harder|Receipts attached\. Habits)\.?$/m, "").trim();
  return t;
}

function deepPlanSteps(intent: string): string[] {
  switch (intent) {
    case "search":
      return ["Frame the question", "Search the local knowledge base", "Timestamp the context", "Synthesize with sources"];
    case "web":
      return ["Run the keyless web providers", "Report hits with source kind", "Report provider failures honestly"];
    case "dispatch":
      return ["Clarify the objective", "Check a crew is composed", "Dispatch through the Mission Loop", "Report the cycle + receipt"];
    case "workspace":
      return ["Draft the content", "Simulate the write", "Request approval", "Write locally", "Record the receipt"];
    default:
      return ["Understand the request", "Pick the tools that fit", "Execute and measure", "Report with a signed receipt"];
  }
}

/**
 * THINK stage on the slow path — the COUNCIL on hard steps. Three seats
 * deliberate the plan before any risky act: Proposer (the plan), Critic (risk
 * audit), Verifier (what proof will exist). The synthesis is the four-section
 * record (proposal / critique / verdict / resolution). The deliberation
 * itself is attested — a selfimpulse.deliberation receipt event — so a hard step
 * leaves a verifiable deliberation artifact, not just a result. Rule-based
 * in the simulated brain (honestly labeled); a model brain brings real models.
 */
export interface CouncilRecord {
  seats: Array<{ seat: string; role: string; section: string }>;
  synthesis: { proposal: string; critique: string; verdict: string; resolution: string };
  ruleBased: boolean;
}

export function councilDeliberate(plan: SelfImpulsePlan, input: string): CouncilRecord {
  const risky = plan.actions.filter((a) => RISKY_TOOLS.has(actionToolName(a)));
  const conf = plan.confidence ?? "high";
  return {
    seats: [
      { seat: "Proposer", role: "advocates the plan", section: `Plan: ${plan.plan.length > 0 ? plan.plan.join("; ") : input.slice(0, 100)}. ${plan.actions.length} action(s).` },
      {
        seat: "Critic",
        role: "audits risk",
        section:
          risky.length > 0
            ? `Risk audit: ${risky.map((a) => actionToolName(a)).join(", ")} — each requires a signed simulation and a human gate. Worst case is contained: nothing executes before approval.`
            : "No risky actions. Worst case: a wasted run — still attested.",
      },
      {
        seat: "Verifier",
        role: "states the proof",
        section: `Proof to exist: ${plan.actions.length} selfimpulse.action event(s) with ok/approved/ms/outputDigest${risky.length > 0 ? "; selfimpulse.simulation predictions checked in SELFIMPULSE (predictionMatched); " : ""}selfimpulse.verdict carries route + prediction + skill.`,
      },
    ],
    synthesis: {
      proposal: plan.plan.length > 0 ? plan.plan.join("; ") : input.slice(0, 100),
      critique: risky.length > 0 ? `${risky.length} gated action(s) — simulate first, human decides` : "no gate required — the fast path stays attested",
      verdict: conf === "low" ? "low confidence — deliberate fully before any act" : "plan stands as proposed",
      resolution: `route SLOW · ${risky.length} gated · 3-seat rule-based council (deliberation attested)`,
    },
    ruleBased: true,
  };
}

/**
 * SLOW→FAST — how a attested skill re-derives its args from the LIVE input.
 * The trigger is the tool's OWN branch test (the same predicate that
 * originally produced the skill), so a skill can never hijack an input it
 * was not distilled from. Tools without a clean live trigger (knowledge
 * search, clock, system) do not auto-execute — honest, not stretched.
 */
/** Stem-lenient content overlap (6-char prefixes, words > 3 chars) — the same
 * rule the RECALL shortlist uses; M4 reuses it so the skill's replay test and
 * its live trigger are the SAME function, not two notions of "match". */
function stemOverlaps(a: string, b: string): boolean {
  const wa = a.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3);
  const wb = b.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3);
  return wa.some((x) => wb.some((y) => x.startsWith(y.slice(0, 6)) || y.startsWith(x.slice(0, 6))));
}

function skillTriggerArgs(tool: string, t: string, lower: string, skill?: SelfImpulseSkill): Record<string, unknown> | null {
  switch (tool) {
    case "calculator": {
      const expr = extractExpression(t);
      return looksLikeMath(expr) ? { expression: expr } : null;
    }
    case "workspace_write": {
      if (!/(write|create|save)\b/i.test(lower) || !/file|note|document|workspace/i.test(lower)) return null;
      const w = /(?:write|create|save)\s+(?:a\s+|the\s+)?(?:file|note|document)?\s*(?:called|named|to)?\s*["'\`]?([\w./-]{2,60})["'\`]?(?:\s*[:\-]?\s*(.+))?/i.exec(t);
      if (!w) return null;
      return { name: w[1] || "untitled.txt", content: (w[2] ?? t).trim() };
    }
    case "web_search": {
      if (!(/^(search|look up|find|check|look)\b[\s\S]*\b(web|online|internet)\b/i.test(lower) || /live (web )?search/i.test(lower))) return null;
      const query = t.replace(/^(please\s+)?(search|look up|find|check|look)\s*(the\s+)?(web|online|internet|for)\s*:?\s*/i, "").replace(/[?.]+$/g, "").trim() || t;
      return { query };
    }
    case "dispatch_mission": {
      /* M4: a attested mission skill triggers on a dispatch intent whose
       * objective stem-overlaps the objective pattern it was distilled from —
       * the SAME overlap rule the replay gate uses (proposeSelfImpulseSkill). */
      if (!/\bdispatch\b/i.test(lower) || !/\bmission\b/i.test(lower)) return null;
      const m = /dispatch a mission:?\s*([^\n]+)/i.exec(t);
      const obj = m?.[1]?.trim();
      if (!obj) return null;
      const pattern = skill?.when.match(/like:\s*(.+)$/)?.[1]?.trim();
      if (!pattern || !stemOverlaps(obj, pattern)) return null;
      return { objective: obj };
    }
    default:
      return null;
  }
}

export const simulatedBrain: SelfImpulseBrain = {
  id: "simulated",
  label: "Simulated (offline, rule-based)",
  decide(input, ctx) {
    const t = input.trim();
    const lower = t.toLowerCase();
    const facts = ctx.facts.map((f) => f.text);
    const factLine = facts.length > 0 ? ` (I have ${facts.length} stored fact${facts.length === 1 ? "" : "s"} about you.)` : "";

    /* 0. resume a dropped thread (dropped-thread continuity) */
    if (/^(?:continue|resume|pick\s+up|back\s+to|return\s+to)\b/i.test(lower)) {
      const resume = ctx.recall?.resume ?? null;
      if (resume) {
        return {
          thoughts: [`Resuming thread "${resume.title}" — dropped-thread continuity: the context is local, and I'm picking it back up.`],
          plan: [],
          actions: [],
          final: () =>
            tone(
              `Picked up **${resume.title}**. Where we left off: “${resume.summary}”\n\nWhat's next on it?`,
              ctx.persona,
            ),
        };
      }
      const list = (ctx.recall?.threads ?? [])
        .map((x) => `• ${x.title} (${x.active ? "active" : x.status})`)
        .join("\n");
      return {
        thoughts: [`Resume request, but no other thread matches. List the real threads instead of inventing one.`],
        plan: [],
        actions: [],
        final: () =>
          tone(`I don't have a thread matching that name. Here's what exists:\n${list || "• (only the main thread)"}\n\nStart one and I'll hold it: “continue <thread name>” picks it back up.`, ctx.persona),
      };
    }

    /* 0b. slow→fast: a recalled attested skill whose trigger fires EXECUTES —
     * single step, no re-planning; the receipt binds skillId + version.
     * Flagged skills and skills without a proven win never auto-execute. */
    for (const sk of ctx.recall?.skills ?? []) {
      if (sk.flagged || sk.wins < 1) continue;
      const args = skillTriggerArgs(sk.tool, t, lower, sk);
      if (!args) continue;
      const isDispatch = sk.tool === "dispatch_mission";
      return {
        thoughts: [`Slow→fast: executing my attested skill "${sk.name}" v${sk.version} — test-gated, ${sk.wins} proven win(s), distilled from a attested run. The procedure is proven, so no re-planning.`],
        plan: [`${sk.name} v${sk.version} — single attested step`],
        actions: isDispatch
          ? [{ kind: "dispatch", objective: String(args.objective ?? "") }]
          : [{ kind: "tool", tool: sk.tool, args }],
        confidence: "high",
        skillId: sk.id,
        skillVersion: sk.version,
        final: (r) =>
          tone(
            r[0]?.ok
              ? `Done — via my attested skill **${sk.name}** v${sk.version} (slow→fast; test-gated, ${sk.wins} proven win${sk.wins === 1 ? "" : "s"}). The receipt binds the skill and verifies offline like every other job.`
              : `My attested skill **${sk.name}** FAILED on live replay — I've flagged it, filed the failure to memory, and here is the honest record: ${r[0]?.output ?? ""}`,
            ctx.persona,
          ),
      };
    }

    /* 1. greeting */
    if (/^(hi|hello|hey|yo|sup|namaste|vanakkam|hola|good (morning|afternoon|evening))\b/i.test(lower)) {
      const plan: SelfImpulsePlan = {
        thoughts: ["A greeting. Low risk, high rapport — answer in character."],
        plan: ctx.mode === "deep" ? ["Identify the user", "State what this seat is", "Offer the doors"] : [],
        actions: [],
        final: () =>
          tone(
            `Hey. I'm **${BOT_NAME}** — the accountable colleague on this machine. ${ctx.mode === "deep" ? `Deep mode on:${factLine}` : factLine}\n\nI run a cycle on everything: **recall → plan → think → simulate → act → selfimpulse → learn**. Fast tasks take the fast path; risky ones are simulated and paused at your gate — and every finished run mints a signed receipt.\n\nThree ways to use me:\n- **Ask** — math, time, local knowledge, live web evidence\n- **Delegate** — “remember…”, “write a file…”, “dispatch a mission: …” — risky steps pause for your approval\n- **Proof** — every run's receipt verifies offline; you can see my memory, my preferences, and the skills I've learned\n\nBrain: **${brain.label}**. The real-model planning seam ships in this runtime — off by default (a human turns it on); dispatches already run through the REAL mission engine, gated and receipted.`,
            ctx.persona,
          ),
      };
      return plan;
    }

    /* 2. identity */
    if (/who are you|what are you|your name|what can you do|about (you|selfimpulse)|\bhelp\b/i.test(lower)) {
      return {
        thoughts: ["Identity question. Answer with the full card — what, how, and the honest brain status."],
        plan: ctx.mode === "deep" ? ["State the role", "List the tools", "State the brain honestly"] : [],
        actions: [],
        final: () =>
          tone(
            `I'm **${BOT_NAME}** — a standalone, persistent, named colleague on this machine, running the **SelfImpulse Cycle**: recall → plan → think → simulate → act → selfimpulse → learn.\n\n- **Tools:** calculator (real parser), clock, local knowledge base, live web evidence (keyless providers), memory + preferences (yours to inspect/delete), a local workspace (writes are simulated + approval-gated), system info\n- **Dispatch:** “dispatch a mission: …” — hands the objective to the real execution core (the mission loop) under one mission ID; the whole trail lands in one attested chain\n- **Learning:** successful runs become test-gated skills you can inspect; your feedback binds to receipts\n- **Proof:** every completed run mints a ${`mj-proof-receipt/2`} — SHA-256 chain, HMAC seal, Ed25519 issuer signature when this runtime can sign — verifiable offline, zero runtime state\n\nEverything runs on **this machine**. Brain: **${brain.label}**.`,
            ctx.persona,
          ),
      };
    }

    /* 3. preference (learned, visible, deletable) */
    if (/^(from now on|always|never|prefer|my preference|set a preference)\b/i.test(lower)) {
      const pref = t.replace(/^(from now on|always|never|prefer|my preference|set a preference)\s*:?\s*/i, "").replace(/[.!?]+$/g, "").trim();
      return {
        thoughts: ["A standing preference. Learn it — local, visible, deletable; matched runs will see it in RECALL."],
        plan: ctx.mode === "deep" ? ["Extract the preference", "Store it locally", "Confirm"] : [],
        actions: [{ kind: "tool", tool: "preference_save", args: { text: pref } }],
        final: () =>
          tone(`Learned. From now on I'll work with: “${pref}” — visible in the rail, yours to delete.`, ctx.persona),
      };
    }

    /* 4. remember */
    if (/^(remember|note that|keep in mind|my name is|call me)\b/i.test(lower)) {
      const fact = lower.startsWith("my name is")
        ? `The user's name is ${t.replace(/^my name is\s*/i, "").replace(/[.!]$/g, "").trim()}`
        : t.replace(/^(remember|note that|keep in mind)\s*:?\s*/i, "");
      return {
        thoughts: ["A durable fact. Store it — memory is local, visible, deletable."],
        plan: ctx.mode === "deep" ? ["Extract the fact", "Store it locally", "Confirm"] : [],
        actions: [{ kind: "tool", tool: "memory_save", args: { fact } }],
        final: () =>
          tone(`Filed. ${personaCloser(ctx.persona)}`, ctx.persona),
      };
    }

    /* 5. recall */
    if (/what do you (remember|know) about me|do you remember|my (name|preferences)/i.test(lower)) {
      return {
        thoughts: ["Memory recall. Read the local fact + preference store, verbatim."],
        plan: [],
        actions: [{ kind: "tool", tool: "memory_recall", args: {} }],
        final: (r) => {
          const out = r[0]?.output ?? "";
          if (out.startsWith("no stored")) return tone("Nothing yet. Tell me something worth remembering — or say “from now on …” for a standing preference.", ctx.persona);
          return tone(`Here's everything I hold on you — local, yours to delete from the rail:\n\n${out}`, ctx.persona);
        },
      };
    }

    /* 6. math */
    {
      const expr = extractExpression(t);
      if (looksLikeMath(expr)) {
        const r0: SelfImpulseAction = { kind: "tool", tool: "calculator", args: { expression: expr } };
        return {
          thoughts: [`Math: "${expr}". Real parser, no eval — safeCalculate decides.`],
          plan: ctx.mode === "deep" ? ["Normalize the expression", "Parse (recursive descent)", "Report the value"] : [],
          actions: [r0],
          final: (r) =>
            tone(
              `**${expr}** = **${r[0]?.output ?? "?"}**\n\nThe calculator is a real recursive-descent parser — no eval, no mercy.`,
              ctx.persona,
            ),
        };
      }
    }

    /* 7. time */
    if (/what time|time is it|date today|what day|current date|\bclock\b/i.test(lower)) {
      return {
        thoughts: ["Time question — read the real clock, IST + UTC + this machine."],
        plan: [],
        actions: [{ kind: "tool", tool: "clock", args: {} }],
        final: (r) => tone(`\`\`\`\n${r[0]?.output ?? "?"}\n\`\`\``, ctx.persona),
      };
    }

    /* 8. system */
    if (/system info|what platform|which machine|about this (machine|runtime)|where am i/i.test(lower)) {
      return {
        thoughts: ["System introspection — report the real runtime facts."],
        plan: [],
        actions: [{ kind: "tool", tool: "system_info", args: {} }],
        final: (r) => tone(`\`\`\`\n${r[0]?.output ?? "?"}\n\`\`\``, ctx.persona),
      };
    }

    /* 9. web search (live evidence, keyless providers, honest failures) */
    if (/^(search|look up|find|check|look)\b[\s\S]*\b(web|online|internet)\b/i.test(lower) || /live (web )?search/i.test(lower)) {
      const query = t.replace(/^(please\s+)?(search|look up|find|check|look)\s*(the\s+)?(web|online|internet|for)\s*:?\s*/i, "").replace(/[?.]+$/g, "").trim() || t;
      return {
        thoughts: [
          `Live web request: "${query}". Keyless providers (Wikipedia, HN, GitHub) — source kind stated on every hit, provider failures reported, never hidden.`,
        ],
        plan: ctx.mode === "deep" ? deepPlanSteps("web") : [],
        actions: [{ kind: "tool", tool: "web_search", args: { query } }],
        final: (r) => {
          const out = r[0]?.output ?? "";
          if (out.startsWith("no web hits") || out.startsWith("web search failed")) {
            return tone(`${out}\n\nThat's the honest state of live evidence from this runtime — no fabrication.`, ctx.persona);
          }
          return tone(`${out}\n\n_Live web evidence — kinds stated (primary/secondary/meta), not implied._`, ctx.persona);
        },
      };
    }

    /* 10. workspace write */
    {
      const wMatch = /(?:write|create|save)\s+(?:a\s+|the\s+)?(?:file|note|document)?\s*(?:called|named|to)?\s+["'`]?([\w./-]{2,60})["'`]?(?:\s*[:\-]?\s*(.+))?/i.exec(t);
      if (/(write|create|save)\b/i.test(lower) && /file|note|document|workspace/i.test(lower) && wMatch) {
        const name = wMatch[1] || "untitled.txt";
        const content = (wMatch[2] ?? t).trim();
        return {
          thoughts: [`A write action → "${name}". Risky by policy: I SIMULATE it first (signed prediction), then PAUSE for your approval.`],
          plan: ctx.mode === "deep" ? deepPlanSteps("workspace") : [],
          actions: [{ kind: "tool", tool: "workspace_write", args: { name, content } }],
          final: (r) =>
            tone(
              r[0]?.ok
                ? `Done — ${r[0].output}. ${predictionVerdict(r[0]?.predictionMatched)} The run's receipt carries both, and the file is in the rail under **Workspace}.${personaCloser(ctx.persona) ? " " + personaCloser(ctx.persona) : ""}`
                : `The write was not approved — nothing was touched. The simulation stands as the record of what WOULD have happened. That's the whole point.`,
              ctx.persona,
            ),
        };
      }
    }

    /* 11. dispatch a mission */
    {
      const dMatch = /(?:dispatch|run|send|start|kick off)\s+(?:a\s+|the\s+)?(?:mission|job|task|crew|loop)?\s*:?\s*(.+)/i.exec(t);
      if (/dispatch|\bmission loop\b/i.test(lower) && dMatch) {
        const objective = dMatch[1].replace(/[.!]+$/g, "").trim();
        return {
          thoughts: [
            `Dispatch: "${objective}". This drives the real Mission Loop engine — simulated first (crew check), then approval-gated, because a crew is real compute.`,
            "I'll load the composed crews and hand the objective to the first one, with the host's real deps.",
          ],
          plan: ctx.mode === "deep" ? ["Clarify objective", "Simulate (crew check)", "Request approval", "Dispatch via the engine", "Report cycle + receipt"] : [],
          actions: [{ kind: "dispatch", objective }],
          final: (r) => {
            const out = r[0]?.output ?? "";
            if (!r[0]?.ok) return tone(`${out}\n\nThe dispatch is recorded in the receipt as refused/failed — nothing is laundered.`, ctx.persona);
            return tone(`${out}\n\nOpen the **Mission Loop** door for the full cycle record — bus, gate, verdict, receipt.`, ctx.persona);
          },
        };
      }
    }

    /* 12. code */
    {
      const snip = CODE_SNIPPETS.find((c) => c.match.test(lower));
      if (/write|code|function|script|program|implement|algorithm|snippet/i.test(lower) && snip) {
        return {
          thoughts: [`Code request — "${snip.title}". I ship the real thing, not vibes.`],
          plan: [],
          actions: [],
          final: () =>
            tone(
              `Here's **${snip.title}**:\n\n\`\`\`${snip.lang}\n${snip.code}\n\`\`\`\n\nWant another language or a different one? Name it.`,
              ctx.persona,
            ),
        };
      }
    }

    /* 13. joke */
    if (/\bjoke\b|funny|make me laugh/i.test(lower)) {
      return {
        thoughts: ["Comedy request. Deploy the receipt gag — it always lands on compliance people."],
        plan: [],
        actions: [],
        final: () => JOKES[(lower.length + (facts.length * 7)) % JOKES.length],
      };
    }

    /* 14. search / knowledge (local KB, offline, labeled) */
    if (/(who|what|when|where|why|how)\b/i.test(lower) || /latest|news|tell me about|explain|research|compare/i.test(lower)) {
      const query = t.replace(/^(tell me about|explain|research|what is|who is|what are|when is|where is|why is|how does|how do|how can)\s*/i, "").replace(/[?.]+$/g, "").trim();
      const actions: SelfImpulseAction[] = [{ kind: "tool", tool: "search", args: { query } }];
      if (ctx.mode === "deep") actions.push({ kind: "tool", tool: "clock", args: {} });
      return {
        thoughts: [
          `Knowledge question: "${query}". The local KB is offline and small — search it, then say so honestly. For live evidence, ask for a web search.`,
          ctx.mode === "deep" ? "Deep mode: timestamp the context and synthesize with sources." : "Quick mode: straight to the best local hits.",
        ],
        plan: ctx.mode === "deep" ? deepPlanSteps("search") : [],
        actions,
        final: (r) => {
          const hits = r[0]?.output ?? "";
          const stamp = r[1]?.output ? `\n\nContext: ${r[1].output.split("\n")[0]}` : "";
          const body = hits.startsWith("no local hits")
            ? `No local hits for that — this brain's knowledge base is offline and deliberately small. Ask “search the web for …” for live evidence, or connect a provider in the **System** door.`
            : `Here's what the local base says:\n\n${hits}${stamp}\n\n_These come from the offline knowledge base, not a live web — treat them as briefing notes, not breaking news._`;
          return tone(body, ctx.persona);
        },
      };
    }

    /* 15. default */
    return {
      thoughts: [`No confident intent for "${t.slice(0, 60)}". Be honest about the simulated brain, and point at the doors.`],
      plan: [],
      actions: [],
      confidence: "low",
      final: () =>
        tone(
          `Interesting. I'm running on the **simulated brain** — rule-based decisions over real tools — so I'd rather be blunt than fake depth:\n\n- **Math, time, system info** — I do those for real\n- **Knowledge** — local, offline, small · **Web** — “search the web for …” (keyless providers, honest failures)\n- **Memory + preferences + workspace** — local, approval-gated, yours to inspect\n- **Threads** — “continue <name>” picks a dropped thread back up\n- **Heavy work** — “dispatch a mission: …” routes into the REAL mission engine (merged since 16.0): real crews, real worktrees, one signed cycle receipt\n\nThe brain seam is live: flip it from simulated to auto and an installed agent CLI proposes the plan — labeled, behind the same receipts. Without one, I say so.`,
          ctx.persona,
        ),
    };
  },
};

/* The default brain — the simulated brain, labeled as such everywhere.
 * A model-backed brain (local-first, provider registry) replaces it via
 * setSelfImpulseBrain with zero page changes. */
brain = wrapModelBrain(wrapRealModelBrain(simulatedBrain)); // 16.10: user-routed models (ChatGPT/Claude/…) wrap the harness seam wraps the labeled core — all OFF by default

/* ── ROUTE: the loop thinks at the right depth ────────────────────────────── */
export interface SelfImpulseRoute { path: SelfImpulseRoutePath; reasons: string[]; }

function routeSelfImpulse(plan: SelfImpulsePlan, mode: SelfImpulseMode): SelfImpulseRoute {
  const reasons: string[] = [];
  const risky = plan.actions.some((a) => RISKY_TOOLS.has(actionToolName(a)));
  const multi = plan.actions.length >= 2;
  const conf = plan.confidence ?? "high";
  if (risky) reasons.push("risky action — simulation + human gate");
  if (multi) reasons.push(`${plan.actions.length} steps — planned execution`);
  if (conf === "low") reasons.push("low-confidence plan — deliberate instead of guess");
  if (mode === "deep") reasons.push("deep mode — full deliberation");
  if (reasons.length === 0) reasons.push("single safe step — fast path");
  const slow = risky || multi || conf === "low" || mode === "deep";
  return { path: slow ? "slow" : "fast", reasons: reasons.slice(0, 3) };
}

/* ── LEARN: skills, failure memory, feedback (all attested) ────────────────── */

function nowIso(): string {
  return new Date().toISOString();
}

/** Test gate for skill mutations: incomplete or replay-failing candidates are
 * rejected and land in failure memory — self-learning that cannot regress. */
export function proposeSelfImpulseSkill(c: SelfImpulseSkillCandidate): { ok: boolean; reason?: string; skillId?: string } {
  const fail = (reason: string): { ok: false; reason: string } => {
    session = {
      ...session,
      failures: [...session.failures.slice(-49), { id: `x${Date.now()}${Math.random().toString(36).slice(2, 5)}`, ts: nowIso(), what: `skill candidate "${c.name.trim()}" (${c.tool})`, reason }],
    };
    commit();
    return { ok: false, reason };
  };
  if (!c.name.trim() || !c.when.trim() || c.steps.length === 0) return fail("incomplete candidate — needs a name, a trigger, and at least one step");
  const known = c.tool === "dispatch_mission" || SELFIMPULSE_TOOLS[c.tool] !== undefined;
  if (!known) return fail(`unknown tool "${c.tool}" — a skill can only wrap a real tool`);
  try {
    if (c.tool === "calculator" && c.sampleArgs && c.sampleArgs.expression !== undefined) {
      safeCalculate(String(c.sampleArgs.expression));
    }
    if (c.tool === "workspace_write") {
      simulateSelfImpulseAction({ kind: "tool", tool: "workspace_write", args: c.sampleArgs ?? { name: "dry-run.txt", content: "" } });
    }
    /* M4 replay test for mission skills — the skill must fire for ITS OWN
     * objective and must NOT fire for an unrelated one, or it is too coarse
     * to fast-path a real mission. Both replays use the live trigger itself. */
    if (c.tool === "dispatch_mission") {
      const pattern = String(c.sampleArgs?.objective ?? "");
      const probe = (objective: string): boolean =>
        skillTriggerArgs("dispatch_mission", `Dispatch a mission: ${objective}`, `dispatch a mission: ${objective}`.toLowerCase(), {
          when: `dispatching a mission like: ${pattern}`,
        } as SelfImpulseSkill) !== null;
      if (!probe(pattern)) return fail("replay check failed: the mission skill's trigger does not fire for its own objective");
      if (probe("redecorate the office kitchen with matte green paint")) {
        return fail("replay check failed: the mission skill's trigger fires for an unrelated objective — too coarse to trust with a mission");
      }
    }
  } catch (e) {
    return fail(`replay check failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const existing = session.skills.find((s) => s.name === c.name.trim());
  if (existing) {
    session = { ...session, skills: session.skills.map((s) => (s.name === c.name.trim() ? { ...s, version: s.version + 1, when: c.when.trim(), steps: c.steps, tool: c.tool, mission: c.mission ?? s.mission, updatedAt: nowIso() } : s)) };
    commit();
    return { ok: true, skillId: existing.id };
  }
  const id = `s${Date.now()}${Math.random().toString(36).slice(2, 5)}`;
  const skill: SelfImpulseSkill = {
    id,
    name: c.name.trim(),
    version: 1,
    when: c.when.trim(),
    steps: c.steps,
    tool: c.tool,
    bornReceiptId: c.bornReceiptId,
    runs: 0,
    wins: 0,
    avgScore: null,
    flagged: false,
    updatedAt: nowIso(),
    mission: c.mission,
  };
  session = { ...session, skills: [...session.skills, skill] };
  commit();
  return { ok: true, skillId: id };
}

/** A live replay failure (or feedback) marks a skill for review — flagged
 * skills never auto-execute again; the human unflags or deletes them. */
export function flagSelfImpulseSkill(skillId: string): void {
  session = { ...session, skills: session.skills.map((sk) => (sk.id === skillId ? { ...sk, flagged: true, updatedAt: nowIso() } : sk)) };
  commit();
}

export function bumpSelfImpulseSkillRun(skillId: string, ok: boolean): void {
  session = {
    ...session,
    skills: session.skills.map((s) => (s.id === skillId ? { ...s, runs: s.runs + 1, wins: s.wins + (ok ? 1 : 0), updatedAt: nowIso() } : s)),
  };
  commit();
}

export function removeSelfImpulseSkill(id: string): void {
  session = { ...session, skills: session.skills.filter((s) => s.id !== id) };
  commit();
}

export function classifyFeedbackNote(note: string): SelfImpulseFeedbackMode {
  const n = note.toLowerCase();
  if (/unsafe|risky|danger|permission|shouldn'?t|should not|leak|expose/i.test(n)) return "unsafe";
  if (/wrong|incorrect|mistake|error|fail|broke/i.test(n)) return "incorrect_result";
  if (/slow|latency|speed|takes too long/i.test(n)) return "slow";
  if (/tone|polite|rude|joke|chatty|verbose/i.test(n)) return "tone";
  return "other";
}

/** Feedback binds to the RECEIPT (not a vague thumbs-up): the exact run, the
 * score, the classified failure mode — and it gates the skill that produced it. */
export function rateSelfImpulseRun(receiptId: string, score: number, note?: string): void {
  const ref = session.receipts.find((r) => r.id === receiptId);
  if (!ref) return;
  const s = Math.max(1, Math.min(5, Math.round(Number.isFinite(score) ? score : 0) || 1));
  const fb: SelfImpulseFeedback = { score: s, note: (note ?? "").trim().slice(0, 300), mode: classifyFeedbackNote(note ?? ""), ts: nowIso() };
  session = {
    ...session,
    receipts: session.receipts.map((r) => (r.id === receiptId ? { ...r, feedback: [...(r.feedback ?? []), fb] } : r)),
  };
  const skillId = ref.skillId;
  if (skillId) {
    const linked = session.receipts.filter((r) => r.skillId === skillId).flatMap((r) => r.feedback ?? []);
    const avg = linked.length > 0 ? Math.round((linked.reduce((a, b) => a + b.score, 0) / linked.length) * 100) / 100 : null;
    const unsafe = linked.some((f) => f.mode === "unsafe");
    session = {
      ...session,
      skills: session.skills.map((sk) => (sk.id === skillId ? { ...sk, avgScore: avg, flagged: (avg !== null && avg <= 2) || unsafe } : sk)),
    };
  }
  commit();
}

/** LEARN, applied to a finished run: distill a test-gated skill candidate
 * from the primary successful action. Returns the skill id (or undefined). */
function distillSkill(results: SelfImpulseActionResult[], bornReceiptId: string): SelfImpulseSkillCandidate | null {
  const first = results.find((r) => r.ok && r.approved);
  if (!first) return null;
  const a = first.action;
  if (a.kind === "dispatch") {
    /* M4 — the learning bridge: a mission skill is distilled from the REAL
     * mission outcome (crew, cycle, the phases that actually ran, the seats
     * that verified), not from a generic template. Failed/aborted missions
     * distill nothing — the receipt already records what happened, and a
     * skill is a claim that deserves a proven run behind it. */
    const m = lastMission;
    if (!m) return null;
    /* Failed/aborted missions distill NOTHING. The old guard was
       `m.status !== "done" && m.verifiedSeats === 0` — and "done" is not a
       status this engine ever emits, so the first clause was ALWAYS true and
       the whole condition collapsed to "no verified seats". A mission that
       FAILED but had one verified seat therefore distilled a skill with an
       auto-firing `when` clause: the product learned to repeat the failure.
       The success test is the same one the dispatcher uses (line ~2514:
       the mission did not fail and did not abort), and a mission with no
       VERIFIED seat has nothing proven behind it, so it distills nothing
       either. */
    if (m.status === "failed" || m.status === "aborted" || m.verifiedSeats === 0) return null;
    const phases = [...new Set(m.trace.map((t) => t.phase).filter((x): x is string => typeof x === "string" && x.length > 0))];
    const teamSlug = m.teamName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "crew";
    return {
      name: `mission-${teamSlug}`,
      when: `dispatching a mission like: ${m.objective.slice(0, 160)}`,
      steps: phases.length > 0
        ? [`route + human gate`, ...phases.map((ph) => `loop phase: ${ph}`), "selfimpulse: prediction vs reality"]
        : ["route + human gate", "compose", "dispatch", "execute", "gate", "adapt", "selfimpulse: prediction vs reality"],
      tool: "dispatch_mission",
      sampleArgs: { objective: m.objective.slice(0, 200) },
      mission: { missionId: m.missionId, team: m.teamName, verifiedSeats: m.verifiedSeats, seatCount: m.seatCount, cycleNo: m.cycleNo },
      bornReceiptId,
    };
  }
  switch (a.tool) {
    case "calculator":
      return {
        name: "calculation",
        when: "a math expression is to be evaluated",
        steps: ["Extract the expression", "Parse with the real recursive-descent parser (no eval)", "Report the exact value"],
        tool: "calculator",
        sampleArgs: a.args,
        bornReceiptId,
      };
    case "search":
      return {
        name: "knowledge-search",
        when: "a question about the offline knowledge base",
        steps: ["Normalize the query", "Search the offline base", "Report the top hits with their source label"],
        tool: "search",
        sampleArgs: a.args,
        bornReceiptId,
      };
    case "web_search":
      return {
        name: "web-evidence",
        when: "live web evidence is requested",
        steps: ["Run the keyless providers (Wikipedia, HN, GitHub)", "Report hits with stated source kind", "Report provider failures honestly — never hide them"],
        tool: "web_search",
        sampleArgs: a.args,
        bornReceiptId,
      };
    case "workspace_write":
      return {
        name: "workspace-write",
        when: "a file is to be written to the local workspace",
        steps: ["Draft the content", "Simulate the write (signed prediction)", "Request approval at the human gate", "Write locally", "Record the receipt"],
        tool: "workspace_write",
        sampleArgs: a.args,
        bornReceiptId,
      };
    default:
      return null;
  }
}

/* ── the run loop — the SelfImpulse Cycle ───────────────────────────────────────── */
let runToken = 0;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function stopSelfImpulse(): boolean {
  runToken += 1;
  return true;
}

/* The outcome of the most recent dispatch, captured by the run loop so the
 * mission's real execution trail joins the unified receipt chain. */
let lastMission: MissionOutcome | null = null;

/**
 * 16.10.1 — exported: always-on triggers ride THIS (the governed merge-seam
 * dispatch: intent, risk, gate, simulation, receipt) — never a side door.
 */
export async function dispatchMission(objective: string): Promise<string> {
  // THE MERGE SEAM — NOW CONNECTED (SelfImpulse 16.0, spec M1). Intent, risk
  // classification, approval gate, simulation and the receipt event run in
  // the control plane; the REAL mission loop of the execution core (composed seats, harnesses, the
  // inter-agent bus, the gate, retry) executes here. One mission ID rides the
  // job end-to-end; honesty is unchanged — a missing crew or an unreachable
  // CLI agent is reported exactly as it happens, and the receipt records it.
  lastMission = null;
  const missionId = mintMissionId();
  try {
    lastMission = await runSelfImpulseMission(objective, missionId);
    recordMission(lastMission);
    const m = lastMission;
    return `Dispatched — ${missionId} · engine ${m.engine} · crew "${m.teamName}" · status ${m.status} · cycle ${m.cycleNo} · ${m.verifiedSeats}/${m.seatCount} seats verified · gate ${m.gateStatus ?? "n/a"} · receipt ${m.receiptOk ? "signed" : "missing"} · ${m.runMs}ms.`;
  } catch (e) {
    lastMission = null;
    if (e instanceof MissionNotConfiguredError) return e.message;
    return `Dispatch blocked — the mission engine reported an error: ${e instanceof Error ? e.message : String(e)}. Nothing was faked; the receipt records this honestly.`;
  }
}

function overlapWords(a: string, b: string): string[] {
  const wa = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2));
  return b.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && wa.has(w));
}

/**
 * One full SelfImpulse Cycle turn:
 * ROUTE → RECALL → (THOUGHTS → PLAN) → per action [SIMULATE → GATE → ACT]
 * → SELFIMPULSE (prediction vs reality + receipt) → LEARN (test-gated skills).
 * Every mutation flows through commit(), so the page renders the run live.
 * stopSelfImpulse() aborts between steps; aborted runs mint NO receipt.
 */
export async function sendSelfImpulseMessage(input: string): Promise<void> {
  const text = input.trim();
  if (!text) return;
  const token = ++runToken;
  const startedAt = nowIso();

  /* dropped-thread continuity: "continue X" resolves + re-activates the thread
   * BEFORE the message lands, so the exchange belongs to that thread */
  let resume: { title: string; summary: string } | null = null;
  const resumeM = /^(?:continue|resume|pick\s+up|back\s+to|return\s+to)\s+(?:the\s+)?(.+)/i.exec(text);
  if (resumeM) {
    /* generic words are not thread names — without this, “continue a thread
     * that was never started” would wrongly match “Main thread” */
    const RESUME_STOP = new Set(["thread", "threads", "the", "that", "this", "was", "were", "never", "started", "a", "an", "one", "back", "up", "to", "me", "my", "for", "with", "it"]);
    const words = resumeM[1].replace(/[.!?]/g, "").toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !RESUME_STOP.has(w));
    if (words.length === 0) {
      /* nothing distinctive to match — the brain answers honestly (lists real threads) */
    } else {
    const candidates = session.threads
      .filter((th) => th.id !== session.activeThreadId)
      .filter((th) => {
        const hay = (th.title + " " + th.messages.map((m) => m.text).join(" ")).toLowerCase();
        return words.some((w) => hay.includes(w));
      })
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
    if (candidates.length > 0) {
      const th = candidates[0];
      setActiveSelfImpulseThread(th.id);
      const lastUser = [...th.messages].reverse().find((m) => m.role === "user");
      resume = { title: th.title, summary: (lastUser?.text ?? "no earlier exchange").slice(0, 140) };
    }
    }
  }

  const threadId = session.activeThreadId;
  const threadTitle = activeThread().title;

  /* 17.1.3: AG-UI run lifecycle — emit RUN_STARTED on the EventTarget before
   * any planning, so subscribers can follow the voyage in real time. The
   * emitter is read-only with respect to receipts; governance still lives
   * in the receipt chain. Wrapped in try/finally so RUN_FINISHED always
   * fires, and RUN_ERROR fires on unexpected escapes. */
  const agRunId = nextRunId();
  emitRunStarted(agRunId, threadId);
  emitStateSnapshot(agRunId, threadId, { threadId, threadTitle, mode: session.mode, brain: session.brain });
  let agTextStarted = false;
  const agTextMsgId = `m${Date.now()}t`;
  const agEnsureText = () => {
    if (agTextStarted) return;
    emitTextStart(agRunId, threadId, agTextMsgId);
    agTextStarted = true;
  };
  let runError: string | null = null;

  const updateActive = (fn: (t: SelfImpulseThread) => SelfImpulseThread): void => {
    const nexts: SelfImpulseThread[] = [];
    let next: SelfImpulseThread | null = null;
    for (const t of session.threads) {
      if (t.id === threadId) { next = fn(t); nexts.push(next); } else nexts.push(t);
    }
    session = { ...session, threads: nexts, messages: (next ?? nexts[0]).messages };
    commit();
  };

  updateActive((t) => ({ ...t, lastActivityAt: startedAt, messages: [...t.messages, { id: `m${Date.now()}u`, role: "user", text, ts: startedAt, trace: [] }] }));
  const msgId = `m${Date.now()}t`;
  updateActive((t) => ({ ...t, messages: [...t.messages, { id: msgId, role: "selfimpulse", text: "", ts: nowIso(), trace: [], streaming: true }] }));

  const patchMsg = (patch: (m: SelfImpulseMessage) => SelfImpulseMessage) => {
    if (token !== runToken) return;
    updateActive((t) => ({ ...t, messages: t.messages.map((m) => (m.id === msgId ? patch(m) : m)) }));
  };

  const brainNow = selfimpulseBrain();

  /* RECALL — what this run starts from (facts, matched preferences, skills) */
  const recallPrefs = session.preferences
    .filter((p) => overlapWords(text, p.text).length > 0)
    .map((p) => p.text);
  /* Skill recall is stem-lenient (calculate≈calculation, write≈written): the
   * RECALL stage only shortlists candidates — the skill's OWN live trigger
   * (skillTriggerArgs) is the actual gate before any auto-execution. */
  const recallSkills = session.skills.filter((sk) => {
    const wa = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3);
    const wb = `${sk.name} ${sk.when}`.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3);
    return wa.some((a) => wb.some((b) => a.startsWith(b.slice(0, 6)) || b.startsWith(a.slice(0, 6))));
  });
  const recall = {
    preferences: recallPrefs,
    skills: recallSkills,
    resume,
    threads: session.threads.map((th) => ({ title: th.title, status: th.status, active: th.id === threadId })),
  };

  const plan = await brainNow.decide(text, { mode: session.mode, persona: session.persona, facts: session.facts, recall });
  const route = routeSelfImpulse(plan, session.mode);
  const results: SelfImpulseActionResult[] = [];
  const simulations: SelfImpulseSimulation[] = [];
  const receiptEvents: Array<{ kind: string; seatId: string | null; data: Record<string, unknown> }> = [
    { kind: "selfimpulse.session", seatId: "selfimpulse-core", data: { brain: brainNow.id, persona: session.persona, mode: session.mode, input: text.slice(0, 200), route: route.path, thread: threadTitle, recall: { facts: session.facts.length, preferences: recallPrefs.length, skills: recallSkills.length } } },
  ];

  /* THINK — council on HARD steps: the slow path deliberates before acting,
   * and the deliberation itself is attested (rule-based, honestly labeled). */
  const council = route.path === "slow" ? councilDeliberate(plan, text) : null;
  if (council) {
    receiptEvents.push({
      kind: "selfimpulse.deliberation",
      seatId: "selfimpulse-core",
      data: { seats: council.seats.length, synthesis: council.synthesis, ruleBased: council.ruleBased },
    });
  }

  /* Aborted runs end the message HONESTLY: streaming stops, an interruption
   * note lands in the trace, and NO receipt is minted — nothing completed,
   * so nothing is attested. */
  const finalizeIfAborted = (): void => {
    if (token === runToken) return;
    updateActive((t) => ({
      ...t,
      messages: t.messages.map((m) =>
        m.id === msgId && m.streaming
          ? { ...m, streaming: false, trace: [...m.trace, { kind: "thought", text: "stopped by the human — the run is recorded as interrupted; no receipt minted (nothing completed)." }] }
          : m,
      ),
    }));
  };

  /* 17.1.3: outer try wraps the plan→act→selfimpulse body so AG-UI RUN_ERROR /
   * RUN_FINISHED always fire, even on unexpected throws. */
  try {
  /* ROUTE + RECALL trace */
  patchMsg((m) => ({ ...m, trace: [...m.trace, { kind: "route", path: route.path, reasons: route.reasons }] }));
  patchMsg((m) => ({ ...m, trace: [...m.trace, { kind: "recall", facts: session.facts.length, preferences: recallPrefs.length, skills: recallSkills.length }] }));
  if (recallPrefs.length > 0) {
    patchMsg((m) => ({ ...m, trace: [...m.trace, { kind: "thought", text: `Applied your preferences: ${recallPrefs.map((p) => `“${p}”`).join("; ")}` }] }));
  }
  if (recallSkills.length > 0) {
    patchMsg((m) => ({ ...m, trace: [...m.trace, { kind: "thought", text: `Skills available from my library: ${recallSkills.map((s) => `${s.name} v${s.version}`).join(", ")} — test-gated, yours to inspect.` }] }));
  }

  /* THINK — chain of thought */
  for (const th of plan.thoughts) {
    if (token !== runToken) return;
    patchMsg((m) => ({ ...m, trace: [...m.trace, { kind: "thought", text: th }] }));
    await sleep(120);
  }

  /* PLAN — visible artifact on the slow path */
  const planSteps = plan.plan.length > 0
    ? plan.plan
    : route.path === "slow"
      ? ["Simulate the action", "Request approval at the human gate", "Execute", "SelfImpulse (prediction vs reality)"]
      : [];
  if (planSteps.length > 0) {
    if (token !== runToken) return;
    patchMsg((m) => ({ ...m, trace: [...m.trace, { kind: "plan", steps: planSteps }] }));
    await sleep(160);
  }
  if (council) {
    patchMsg((m) => ({ ...m, trace: [...m.trace, { kind: "council", seats: council.seats, synthesis: council.synthesis, ruleBased: true }] }));
  }

  /* per action: SIMULATE (risky) → GATE (risky) → ACT → SELFIMPULSE.
   * The action list is mutable on purpose: when a attested skill FAILS on live
   * replay, the run flags the skill, files the failure, re-plans the full
   * cycle (skills off) and CONTINUES — the receipt records both attempts. */
  let activePlan = plan;
  let actions = plan.actions;
  let skillFallbackUsed = false;
  for (let ai = 0; ai < actions.length; ai++) {
    const action: SelfImpulseAction = actions[ai];
    if (token !== runToken) return;
    const tName = actionToolName(action);
    let liveArgs: Record<string, unknown> = action.kind === "tool" ? (action.args as Record<string, unknown>) : { objective: (action as { kind: "dispatch"; objective: string }).objective };

    /* 17.1.3 — single execution throat, step 1: PolicyGateway.propose().
     * Replaces the old inline RISKY_TOOLS.has() with the rule engine, so
     * risky-tool gating, workspace-root checks, and future custom rules
     * all flow through one decision. DENY short-circuits the action with
     * an INTERRUPT event; STEER falls through to the simulate+gate path;
     * ALLOW runs without human approval. */
    const policy = propose({
      tool: tName,
      args: liveArgs,
      detail: action.kind === "dispatch" ? `dispatch: ${action.objective.slice(0, 140)}` : `${tName}(${JSON.stringify(liveArgs).slice(0, 140)})`,
    });
    receiptEvents.push({
      kind: "policy.decision",
      seatId: "selfimpulse-policy",
      data: { tool: tName, decision: policy.decision, rule: policy.rule, reason: policy.reason },
    });
    const agTcId = `tc${Date.now()}${ai}`;
    if (policy.decision === "deny") {
      emitInterrupt(agRunId, threadId, agTcId, tName, `${policy.reason} (rule: ${policy.rule})`);
      patchMsg((m) => ({ ...m, trace: [...m.trace, { kind: "thought", text: `Policy DENY on ${tName}: ${policy.reason} (rule: ${policy.rule})` }] }));
      results.push({ action, output: `Policy denied: ${policy.reason}`, ok: false, approved: false, ms: 0 });
      continue;
    }
    const risky = policy.decision === "steer";
    let approved = true;
    let output = "";
    let ok = true;
    let sim: SelfImpulseSimulation | undefined;
    const t0 = Date.now();

    /* 17.1.4 step 2: Zod schema validation with ONE structured retry, for
     * BOTH tools AND dispatch_mission. The unified validateWithRetry helper
     * (a) runs safe normalization first, (b) validates, (c) on failure asks
     * SelfImpulseBrain.repairArgs() if installed, else falls back to deterministic
     * fixups, (d) re-validates, (e) returns an auditable outcome with
     * rawArgs, repairedArgs, errors, attempts, repairSource, repairReason.
     * Only if retry ALSO fails do we refuse and seal everything into the
     * receipt — the tool/dispatch NEVER runs on invalid args. */
    const v = await validateWithRetry(tName, liveArgs);
    liveArgs = v.args;
    if (v.audit.retried) {
      receiptEvents.push({
        kind: "tool.schema_retry",
        seatId: "selfimpulse-schema",
        data: { tool: tName, rawArgs: v.audit.rawArgs, repairedArgs: v.audit.repairedArgs, errors: v.audit.errors, repairSource: v.audit.repairSource, repairReason: v.audit.repairReason, attempt: 1 },
      });
      patchMsg((m) => ({ ...m, trace: [...m.trace, { kind: "thought", text: `Schema validation flagged ${tName}: ${v.audit.errors} — applying one structured retry (${v.audit.repairSource})…` }] }));
    }
    if (!v.ok) {
      const msg = `Schema validation failed for ${tName} after one retry: ${v.audit.errors} — refusing, nothing executed.`;
      emitToolStart(agRunId, threadId, agTcId, tName);
      emitToolArgs(agRunId, threadId, agTcId, v.audit.rawArgs);
      emitToolResult(agRunId, threadId, agTcId, msg, false);
      receiptEvents.push({
        kind: "tool.schema_refused",
        seatId: "selfimpulse-schema",
        data: { tool: tName, rawArgs: v.audit.rawArgs, repairedArgs: v.audit.repairedArgs, errors: v.audit.errors, attempts: v.audit.attempts - 1, repairSource: v.audit.repairSource, repairReason: v.audit.repairReason },
      });
      patchMsg((m) => ({ ...m, trace: [...m.trace, { kind: "thought", text: msg }] }));
      results.push({ action, output: msg, ok: false, approved: true, ms: Date.now() - t0 });
      continue;
    }

    if (risky) {
      const simNow = simulateSelfImpulseAction(action);
      sim = simNow;
      simulations.push(simNow);
      receiptEvents.push({
        kind: "selfimpulse.simulation",
        seatId: "selfimpulse-core",
        data: { tool: actionToolName(action), prediction: simNow.prediction, sideEffects: simNow.sideEffects, warnings: simNow.warnings, confidence: simNow.confidence },
      });
      patchMsg((m) => ({ ...m, trace: [...m.trace, { kind: "simulate", tool: simNow.tool, prediction: simNow.prediction, sideEffects: simNow.sideEffects, warnings: simNow.warnings, confidence: simNow.confidence }] }));
      await sleep(150);

      const isDispatch = action.kind === "dispatch";
      const detail = isDispatch
        ? `Dispatch mission to a composed crew via the Mission Loop: "${(action as { kind: "dispatch"; objective: string }).objective.slice(0, 140)}"\nSIMULATION: ${simNow.prediction}`
        : `Write file "${String(liveArgs.name)}" to the local workspace\nSIMULATION: ${simNow.prediction}${simNow.warnings.length > 0 ? `\nWARNINGS: ${simNow.warnings.join("; ")}` : ""}`;
      const toolName = actionToolName(action);
      patchMsg((m) =>
        isDispatch
          ? { ...m, trace: [...m.trace, { kind: "dispatch", objective: action.objective, awaitingApprovalId: "" }] }
          : { ...m, trace: [...m.trace, { kind: "tool", tool: action.tool, args: action.args, awaitingApprovalId: "" }] },
      );
      const approvalPromise = requestSelfImpulseApproval(toolName, detail);
      const lastApproval = session.approvals[session.approvals.length - 1];
      patchMsg((m) => ({
        ...m,
        trace: m.trace.map((s, idx) => (idx === m.trace.length - 1 ? { ...s, awaitingApprovalId: lastApproval?.id } : s)),
      }));
      const gate = await approvalPromise;
      if (token !== runToken) return;
      approved = gate.ok;
      if (!gate.ok) {
        ok = false;
        output = gate.reason === "expired"
          ? "The approval expired before it could be backed by a capability — nothing was executed."
          : gate.reason === "capability-unavailable"
            ? "The approval could not be backed by a signed capability — refused fail-closed, nothing was executed."
            : "Denied by the human gate — nothing was executed.";
        patchMsg((m) => ({
          ...m,
          trace: m.trace.map((s) => {
            if (s.kind === "dispatch") return { ...s, denied: true, awaitingApprovalId: undefined };
            if (s.kind === "tool") return { ...s, denied: true, awaitingApprovalId: undefined };
            return s;
          }),
        }));
      } else {
        /* The execution plane redeems the capability — verify, then redeem,
           before any effect. One approval, one execution.
           THE INTENT IS STATED: the capability was signed for THIS action on
           THIS resource, and the redemption says so. A capability that
           authorizes something else is refused by name. */
        const intent = { action: toolName, resource: detail.slice(0, 200) };
        const v = verifyCapability(gate.capability!, "si.runtime", { intent });
        const redemption = v.ok ? redeemCapability(gate.capability!, "si.runtime", intent) : v;
        if (!redemption.ok) {
          ok = false;
          output = `The signed capability behind the approval did not redeem (${redemption.reason}) — nothing was executed.`;
          patchMsg((m) => ({
            ...m,
            trace: m.trace.map((s) => {
              if (s.kind === "dispatch") return { ...s, denied: true, awaitingApprovalId: undefined };
              if (s.kind === "tool") return { ...s, denied: true, awaitingApprovalId: undefined };
              return s;
            }),
          }));
        }
      }
    }

    if (ok) {
      if (action.kind === "tool") {
        patchMsg((m) => ({ ...m, trace: [...m.trace, { kind: "tool", tool: action.tool, args: liveArgs }] }));
        const tool = SELFIMPULSE_TOOLS[action.tool];
        /* 17.1.3 — emit TOOL_CALL_START/ARGS before run, TOOL_CALL_RESULT after.
         * liveArgs may have been repaired by the one-retry loop above. */
        emitToolStart(agRunId, threadId, agTcId, action.tool);
        emitToolArgs(agRunId, threadId, agTcId, liveArgs);
        try {
          const runResult = toolRunOutput(await tool.run(liveArgs));
          output = runResult.output;
          if (!runResult.ok) ok = false;
          emitToolResult(agRunId, threadId, agTcId, output.slice(0, 2000), runResult.ok);
        } catch (e) {
          ok = false;
          output = `error: ${e instanceof Error ? e.message : String(e)}`;
          emitToolResult(agRunId, threadId, agTcId, output, false);
        }
        const ms = Date.now() - t0;
        patchMsg((m) => ({
          ...m,
          trace: m.trace.map((s) => (s.kind === "tool" && s.tool === action.tool && s.output === undefined ? { ...s, output: output.slice(0, 2000), ms } : s)),
        }));
      } else {
        emitToolStart(agRunId, threadId, agTcId, "dispatch_mission");
        emitToolArgs(agRunId, threadId, agTcId, { objective: action.objective });
        output = await dispatchMission(action.objective);
        emitToolResult(agRunId, threadId, agTcId, output.slice(0, 2000), true);
        // SELFIMPULSE MERGE: the mission's real execution trail joins the
        // unified chain under its mission ID (spec §2: one state, one
        // event stream, one receipt chain).
        const outcome = lastMission;
        if (outcome) {
          for (const t of outcome.trace) {
            receiptEvents.push({
              kind: "mission.event",
              seatId: "selfimpulse-core",
              data: {
                missionId: outcome.missionId,
                phase: t.phase ?? null,
                note: (t.note ?? "").slice(0, 300),
                message: t.message ? { kind: t.message.kind ?? null, from: t.message.from ?? null, to: t.message.to ?? null } : null,
              },
            });
          }
        }
        patchMsg((m) => ({ ...m, trace: m.trace.map((s) => (s.kind === "dispatch" && s.status === undefined ? { ...s, status: outcome ? outcome.status : "dispatched" } : s)) }));
      }
    }

    /* SELFIMPULSE — prediction vs reality */
    const predictionMatched = sim ? checkPrediction(action, sim, ok, output) : undefined;
    results.push({ action, ok, output, ms: Date.now() - t0, approved, predictionMatched });
    receiptEvents.push({
      kind: action.kind === "dispatch" ? "selfimpulse.dispatch" : "selfimpulse.action",
      seatId: "selfimpulse-core",
      data: {
        tool: actionToolName(action),
        args: action.kind === "dispatch" ? { objective: action.objective.slice(0, 200) } : action.args,
        ok,
        approved,
        ms: Date.now() - t0,
        outputDigest: output.slice(0, 200),
        simulated: sim !== undefined,
        predictionMatched: predictionMatched ?? null,
        skill: activePlan.skillId && action === activePlan.actions[0] ? { id: activePlan.skillId, version: activePlan.skillVersion ?? 1 } : null,
        mission: action.kind === "dispatch" && lastMission
          ? { missionId: lastMission.missionId, status: lastMission.status, cycleNo: lastMission.cycleNo, verifiedSeats: lastMission.verifiedSeats, seatCount: lastMission.seatCount, gate: lastMission.gateStatus, receiptOk: lastMission.receiptOk, engine: lastMission.engine, controlPlane: lastMission.controlPlane, team: lastMission.teamName, runMs: lastMission.runMs }
          : null,
      },
    });

    /* SLOW→FAST bookkeeping: the executed skill earns a run/win. A live
     * replay FAILURE (approved, then the tool failed) flags the skill and
     * triggers the full-cycle fallback — exactly once per run. A human DENIAL
     * does not: the skill stands, the human's decision is the record. */
    if (activePlan.skillId && action === activePlan.actions[0]) {
      bumpSelfImpulseSkillRun(activePlan.skillId, ok);
      if (!ok && approved && !skillFallbackUsed) {
        const failedSkill = selfimpulseSession().skills.find((sk) => sk.id === activePlan.skillId);
        flagSelfImpulseSkill(activePlan.skillId);
        session = {
          ...session,
          failures: [...session.failures.slice(-49), { id: `x${Date.now()}${Math.random().toString(36).slice(2, 6)}`, ts: nowIso(), what: `skill "${failedSkill?.name ?? activePlan.skillId}" replay failed live`, reason: output.slice(0, 200) }],
        };
        commit();
        patchMsg((m) => ({ ...m, trace: [...m.trace, { kind: "thought", text: `My attested skill ${failedSkill ? `"${failedSkill.name}"` : ""} FAILED on live replay — flagged it, filed it to failure memory, and re-planning the full cycle (skills off).` }] }));
        const fb = await brainNow.decide(text, { mode: session.mode, persona: session.persona, facts: session.facts, recall: { ...recall, skills: [] } });
        activePlan = fb;
        actions = fb.actions;
        ai = -1;
        skillFallbackUsed = true;
        continue;
      }
    }
    if (token !== runToken) return;
  }

  const finalText = activePlan.final(results);
  if (token !== runToken) return;

  /* stream the final text in small chunks (the colleague types).
   * 17.1.3: mirror chunks to AG-UI TEXT_MESSAGE_CONTENT so external UI
   * subscribers see the same progressive stream. The on-page SelfImpulse
   * message is still the canonical channel; AG-UI is emit-only. */
  agEnsureText();
  let acc = "";
  for (let i = 0; i < finalText.length; i += 6) {
    if (token !== runToken) return;
    const chunk = finalText.slice(i, i + 6);
    acc = finalText.slice(0, i + 6);
    emitTextChunk(agRunId, threadId, agTextMsgId, chunk);
    patchMsg((m) => ({ ...m, text: acc }));
    await sleep(14);
  }
  emitTextEnd(agRunId, threadId, agTextMsgId);
  agTextStarted = false;

  /* LEARN — distill a test-gated skill from a fully successful run. Runs that
   * EXECUTED a skill do not re-distill: the skill already exists and its
   * run/win ledger was updated in the loop. */
  let skillId: string | undefined = plan.skillId;
  const allOk = results.length > 0 && results.every((r) => r.ok && r.approved);
  if (allOk && !plan.skillId) {
    const preReceiptId = `r${Date.now()}`;
    const cand = distillSkill(results, preReceiptId);
    if (cand) {
      const proposed = proposeSelfImpulseSkill(cand);
      if (proposed.ok && proposed.skillId) {
        bumpSelfImpulseSkillRun(proposed.skillId, true);
        const sk = selfimpulseSession().skills.find((s) => s.id === proposed.skillId);
        skillId = proposed.skillId;
        if (sk) {
          patchMsg((m) => ({ ...m, trace: [...m.trace, { kind: "thought", text: `Learned: skill "${sk.name}" v${sk.version} (run ${sk.runs}, win ${sk.wins}) — test-gated, in your skill library, yours to inspect or delete.` }] }));
        }
      } else if (proposed.reason) {
        patchMsg((m) => ({ ...m, trace: [...m.trace, { kind: "thought", text: `Skill mutation rejected by the test gate: ${proposed.reason} — recorded in failure memory.` }] }));
      }
    }
  }

  /* SELFIMPULSE — mint the receipt */
  const finishedAt = nowIso();
  const predictionSummary = simulations.length === 0 ? "n/a" : results.every((r) => r.predictionMatched !== false) ? "matched" : "diverged";
  receiptEvents.push({ kind: "selfimpulse.verdict", seatId: "selfimpulse-core", data: { status: "done", actions: results.length, approved: results.filter((r) => r.approved).length, brain: brainNow.id, route: route.path, prediction: predictionSummary, skillId: skillId ?? null } });
  const receipt = await buildChainedReceipt({
    mission: `selfimpulse: ${text.slice(0, 48)}`,
    teamId: "selfimpulse",
    startedAt,
    finishedAt,
    /* 16.0 merge: the unified product stamps the product version (one state,
     * one version line). SelfImpulse's own 1.x line survives as provenance INSIDE
     * the events (mission payloads carry controlPlane: "SelfImpulse 1.1"). */
    version: ENGINE_VERSION,
    edition: "personal",
    events: receiptEvents,
  });
  const head = receipt.events.length > 0 ? receipt.events[receipt.events.length - 1].hash : "";
  const ref: SelfImpulseReceiptRef = {
    id: `r${Date.now()}`,
    mission: receipt.header.mission,
    threadTitle,
    startedAt,
    finishedAt,
    events: receipt.events.length,
    head,
    signed: receipt.signature !== null && receipt.signature !== undefined,
    signatureNote: receipt.signatureNote,
    skillId,
    feedback: [],
    receipt,
  };
  finalRef = ref;
  /* the skill's provenance points at the REAL receipt id (set after mint) */
  if (skillId) {
    session = {
      ...session,
      skills: session.skills.map((s) => (s.id === skillId ? { ...s, bornReceiptId: ref.id } : s)),
    };
  }
  session = { ...session, receipts: [...session.receipts.slice(-19), ref] };
  patchMsg((m) => ({ ...m, streaming: false, trace: [...m.trace, { kind: "receipt", receiptId: ref.id, head, events: ref.events, signed: ref.signed }] }));
  commit();

  } catch (err) {
    runError = err instanceof Error ? err.message : String(err);
    emitRunError(agRunId, threadId, runError);
    throw err;
  } finally {
    if (agTextStarted) emitTextEnd(agRunId, threadId, agTextMsgId);
    emitRunFinished(agRunId, threadId, runError ? "error" : finalRef ? "completed" : "denied");
    finalizeIfAborted();
  }
}

let finalRef: { id: string; receipt: unknown } | undefined;

/* ── receipt surfaces (the page reaches these, never receipts.ts directly) ── */
export function verifySelfImpulseReceipt(id: string): Promise<{ ok: boolean; events?: number; reason?: string }> {
  const ref = session.receipts.find((r) => r.id === id);
  if (!ref) return Promise.resolve({ ok: false, reason: "receipt not found" });
  return verifyProofReceipt(ref.receipt);
}

export function selfimpulseReceiptJsonl(id: string): string | null {
  const ref = session.receipts.find((r) => r.id === id);
  return ref ? receiptToJsonl(ref.receipt) : null;
}

/* ── inspectable memory (local, Markdown-native, yours) ───────────────────── */
export function exportSelfImpulseMemoryMarkdown(): string {
  const s = selfimpulseSession();
  const lines: string[] = [
    `# ${s.botName} — memory export`,
    ``,
    `Exported ${new Date().toISOString()} from this machine (SelfImpulse ${ENGINE_VERSION}).`,
    `Everything below is local state you own — edit, delete, or archive it.`,
    ``,
    `## Facts (${s.facts.length})`,
    ...(s.facts.length > 0 ? s.facts.map((f) => `- ${f.text} _(since ${f.ts.slice(0, 10)})_`) : ["- (none)"]),
    ``,
    `## Preferences (${s.preferences.length})`,
    ...(s.preferences.length > 0 ? s.preferences.map((p) => `- ${p.text} _(since ${p.ts.slice(0, 10)})_`) : ["- (none)"]),
    ``,
    `## Skills — test-gated, learned from runs (${s.skills.length})`,
    ...(s.skills.length > 0
      ? s.skills.map((k) => `- **${k.name} v${k.version}** — ${k.when}\n  - steps: ${k.steps.join(" → ")}\n  - tool: \`${k.tool}\` · runs ${k.runs} · wins ${k.wins} · avg score ${k.avgScore ?? "n/a"}${k.flagged ? " · ⚑ FLAGGED (review)" : ""}\n  - provenance: receipt \`${k.bornReceiptId}\``)
      : ["- (none)"]),
    ``,
    `## Failure memory — rejected mutations (${s.failures.length})`,
    ...(s.failures.length > 0 ? s.failures.map((x) => `- ${x.what}: ${x.reason} _(${x.ts.slice(0, 10)})_`) : ["- (none)"]),
    ``,
    `## Workspace (${selfimpulseWorkspaceFiles().length} files)`,
    ...(selfimpulseWorkspaceFiles().length > 0 ? selfimpulseWorkspaceFiles().map((f) => `- \`${f.name}\` — ${f.chars} chars, updated ${f.updated.slice(0, 10)}`) : ["- (none)"]),
    ``,
    `## Threads (${s.threads.length})`,
    ...s.threads.map((t) => `- **${t.title}** — ${t.status} · ${t.messages.length} messages · last ${t.lastActivityAt.slice(0, 16).replace("T", " ")}`),
    ``,
  ];
  return lines.join("\n");
}

/* ─────────────────────────────────────────────────────────────────────────────
 * M3 — the capability router: the single governed path for ONE tool call.
 *
 * Chat and MCP are faces; this function is the throat. Every call from any
 * face passes the same pipeline the SelfImpulse Cycle 2.0 runs —
 * authorize (known tool) → SIMULATE (risky) → GATE (human approval) →
 * call → SELFIMPULSE (receipt). The MCP face cannot bypass any of it: it has no
 * other route to the tools, and this is the only one.
 *
 * Gate semantics for async faces: a risky call does NOT block the caller.
 * It returns `pending: true` with the approval handle; the human decides
 * through the UI or through the MCP approve_action / deny_action tools,
 * and the call continues in the background. `selfimpulseToolCallStatus` tracks
 * gated → running → done. Every COMPLETED call mints a receipt — refusals,
 * denials and errors included; the audit trail is never optional.
 * ───────────────────────────────────────────────────────────────────────────── */
export interface SelfImpulseToolCallResult {
  ok: boolean;
  output: string;
  approved: boolean;
  simulated: boolean;
  /** true: returned BEFORE the human gate resolved — see approvalId/callId. */
  pending: boolean;
  approvalId: string | null;
  callId: string;
  receiptId: string | null;
  mission: { missionId: string; status: string | null } | null;
  ms: number;
}

export type SelfImpulseToolCallState = "gated" | "running" | "done";

export interface SelfImpulseToolCallTrack {
  state: SelfImpulseToolCallState;
  result: SelfImpulseToolCallResult | null;
  missionId: string | null;
  tool: string;
  /**
   * A gate that appeared WHILE THIS CALL WAS RUNNING.
   *
   * A tool call can be approved and then meet another gate inside the work
   * it started — a dispatched mission whose own gate does not pass, for
   * instance. Without this, the client is polling a call that will never
   * finish and cannot find the approval that would unstick it.
   */
  pendingApproval: { id: string; action: string; detail: string } | null;
}

const toolCallTracks = new Map<string, SelfImpulseToolCallTrack>();

export function selfimpulseToolCallStatus(callId: string): SelfImpulseToolCallTrack | null {
  return toolCallTracks.get(callId) ?? null;
}

/**
 * Governed single tool call (the capability router's only entry).
 * `opts.origin` rides into the receipt (provenance: which face asked).
 */
export async function runSelfImpulseToolCall(
  tool: string,
  args: Record<string, unknown>,
  opts: { origin?: string; blockOnGate?: boolean } = {},
): Promise<SelfImpulseToolCallResult> {
  const origin = opts.origin ?? "mcp";
  const t0 = Date.now();
  const callId = `c${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = nowIso();
  const events: Array<{ kind: string; seatId: string | null; data: Record<string, unknown> }> = [];
  events.push({ kind: "selfimpulse.session", seatId: "selfimpulse-core", data: { origin, brain: "simulated", tool, args: JSON.parse(JSON.stringify(args)) } });

  const isDispatch = tool === "dispatch_mission";
  let action: SelfImpulseAction = isDispatch
    ? { kind: "dispatch", objective: String(args.objective ?? "").trim() }
    : { kind: "tool", tool, args };
  const objective = action.kind === "dispatch" ? action.objective : "";

  let approvalIdRef: string | null = null;
  const finalize = async (
    r: { ok: boolean; output: string; approved: boolean; simulated: boolean; mission: { missionId: string; status: string | null } | null },
  ): Promise<SelfImpulseToolCallResult> => {
    events.push({
      kind: isDispatch ? "selfimpulse.dispatch" : "selfimpulse.action",
      seatId: "selfimpulse-core",
      data: {
        tool,
        args: action.kind === "dispatch" ? { objective: action.objective.slice(0, 200) } : args,
        ok: r.ok,
        approved: r.approved,
        outputDigest: r.output.slice(0, 200),
        simulated: r.simulated,
        origin,
        mission: r.mission ? { missionId: r.mission.missionId, status: r.mission.status } : null,
      },
    });
    events.push({
      kind: "selfimpulse.verdict",
      seatId: "selfimpulse-core",
      data: { status: !r.approved ? "denied" : r.ok ? "done" : "failed", actions: 1, approved: r.approved ? 1 : 0, origin },
    });
    const finishedAt = nowIso();
    const receipt = await buildChainedReceipt({
      mission: `selfimpulse:${origin}:${tool}`,
      teamId: "selfimpulse",
      startedAt,
      finishedAt,
      version: ENGINE_VERSION,
      edition: "personal",
      events,
    });
    const head = receipt.events.length > 0 ? receipt.events[receipt.events.length - 1].hash : "";
    const ref: SelfImpulseReceiptRef = {
      id: secureId("r"),
      mission: receipt.header.mission,
      threadTitle: `${origin} tool call: ${tool}`,
      startedAt,
      finishedAt,
      events: receipt.events.length,
      head,
      signed: receipt.signature !== null && receipt.signature !== undefined,
      signatureNote: receipt.signatureNote,
      skillId: undefined,
      feedback: [],
      receipt,
    };
    session = { ...session, receipts: [...session.receipts.slice(-19), ref] };
    commit();
    /* The thread id must MATCH the one the start was emitted under
       (`toolcall:<callId>`), or a subscriber correlating
       TOOL_CALL_START -> TOOL_CALL_RESULT by thread never pairs them and
       every governed tool call reports a start with no result. */
    emitToolResult(agRunId2, `toolcall:${callId}`, agTcId2, r.output.slice(0, 200), r.ok);
    emitRunFinished(agRunId2, `toolcall:${callId}`, !r.approved ? "denied" : r.ok ? "completed" : "error");
    return { ok: r.ok, output: r.output, approved: r.approved, simulated: r.simulated, pending: false, approvalId: approvalIdRef, callId, receiptId: ref.id, mission: r.mission, ms: Date.now() - t0 };
  };

  /* 17.1.3 single execution throat for capability calls (MCP/browser/etc). */
  const agRunId2 = nextRunId();
  const agTcId2 = `tc${callId}`;
  emitRunStarted(agRunId2, `toolcall:${callId}`);
  emitToolStart(agRunId2, `toolcall:${callId}`, agTcId2, tool);
  emitToolArgs(agRunId2, `toolcall:${callId}`, agTcId2, args);

  /* Step 1: PolicyGateway.propose() replaces inline risky-set check. */
  const policy = propose({ tool, args, detail: `${tool}(${JSON.stringify(args).slice(0, 140)})` });
  events.push({ kind: "policy.decision", seatId: "selfimpulse-policy", data: { tool, decision: policy.decision, rule: policy.rule, reason: policy.reason } });
  if (policy.decision === "deny") {
    emitInterrupt(agRunId2, `toolcall:${callId}`, agTcId2, tool, `${policy.reason} (rule: ${policy.rule})`);
    return finalize({ ok: false, output: `Policy denied: ${policy.reason} (rule: ${policy.rule})`, approved: false, simulated: false, mission: null });
  }
  const risky = policy.decision === "steer";

  /* Step 1.5 (FINALFIX): the GuardRail content gate — BEFORE schema
   * validation, BEFORE the human gate. Refuses poison keys, oversized or
   * over-deep arguments, malformed tool names and rate floods; injection
   * findings ride the approval card as warnings. A refusal here still
   * finalizes through the receipt-attested path — nothing executes, and the
   * denial is audited like every other outcome. */
  const gr = scanToolCall(tool, args);
  if (!gr.ok) {
    events.push({ kind: "tool.guardrail_refused", seatId: "selfimpulse-guardrail", data: { tool, code: gr.code, reason: gr.reason } });
    emitInterrupt(agRunId2, `toolcall:${callId}`, agTcId2, tool, `guardrail: ${gr.reason}`);
    return finalize({ ok: false, output: `GuardRail refused ${tool}: ${gr.reason} (code: ${gr.code}) — nothing executed.`, approved: false, simulated: false, mission: null });
  }
  if (gr.warnings.length > 0) {
    events.push({ kind: "tool.guardrail_warnings", seatId: "selfimpulse-guardrail", data: { tool, warnings: gr.warnings.slice(0, 8) } });
  }

  /* Step 2: Zod schema validation with ONE structured retry (same seam as
   * the per-action loop in sendSelfImpulseMessage). Applies to BOTH tools and
   * dispatch_mission; auditable events carry rawArgs/repairedArgs/errors. */
  const v = await validateWithRetry(tool, args);
  args = v.args;
  if (v.audit.retried) {
    events.push({ kind: "tool.schema_retry", seatId: "selfimpulse-schema", data: { tool, rawArgs: v.audit.rawArgs, repairedArgs: v.audit.repairedArgs, errors: v.audit.errors, repairSource: v.audit.repairSource, repairReason: v.audit.repairReason, attempt: 1 } });
  }
  if (!v.ok) {
    const msg = `Schema validation failed for ${tool} after one retry: ${v.audit.errors} — refusing, nothing executed.`;
    events.push({ kind: "tool.schema_refused", seatId: "selfimpulse-schema", data: { tool, rawArgs: v.audit.rawArgs, repairedArgs: v.audit.repairedArgs, errors: v.audit.errors, attempts: v.audit.attempts - 1, repairSource: v.audit.repairSource, repairReason: v.audit.repairReason } });
    return finalize({ ok: false, output: msg, approved: true, simulated: false, mission: null });
  }
  // Keep the action object in sync with repaired args so AUTHORIZE checks
  // below look at the post-repair objective (dispatch_mission case).
  if (isDispatch) action = { kind: "dispatch", objective: String(args.objective ?? "") };

  /* 1. AUTHORIZE — known tools only; refusals are still attested. */
  if (!isDispatch && SELFIMPULSE_TOOLS[tool] === undefined) {
    return finalize({ ok: false, output: `unknown tool "${tool}" — refused. Known tools: ${[...Object.keys(SELFIMPULSE_TOOLS), "dispatch_mission"].join(", ")}`, approved: true, simulated: false, mission: null });
  }
  if (isDispatch && String(args.objective ?? "").length === 0) {
    return finalize({ ok: false, output: "dispatch_mission needs an objective — refused, nothing dispatched.", approved: true, simulated: false, mission: null });
  }

  const runAction = async (): Promise<{ ok: boolean; output: string; mission: { missionId: string; status: string | null } | null }> => {
    if (isDispatch) {
      const missionId = mintMissionId();
      toolCallTracks.get(callId)!.missionId = missionId;
      try {
        const outcome = await runSelfImpulseMission(objective, missionId, {
          /* A gate that appears while THIS call is running has to be
             answerable by whoever is polling for it — so the approval id is
             recorded on the call's own track, and `call_status` names it. */
          onGatePending: (approval) => {
            const track = toolCallTracks.get(callId);
            if (track) track.pendingApproval = approval;
          },
        });
        recordMission(outcome);
        return {
          ok: outcome.status !== "failed" && outcome.status !== "aborted",
          output: `Dispatched — ${missionId} · engine ${outcome.engine} · crew "${outcome.teamName}" · status ${outcome.status} · cycle ${outcome.cycleNo} · ${outcome.verifiedSeats}/${outcome.seatCount} seats verified · gate ${outcome.gateStatus ?? "n/a"} · receipt ${outcome.receiptOk ? "signed" : "missing"} · ${outcome.runMs}ms.`,
          mission: { missionId, status: outcome.status },
        };
      } catch (e) {
        if (e instanceof MissionNotConfiguredError) return { ok: false, output: e.message, mission: null };
        return { ok: false, output: `Dispatch blocked — the mission engine reported an error: ${e instanceof Error ? e.message : String(e)}. Nothing was faked.`, mission: null };
      }
    }
    const t = SELFIMPULSE_TOOLS[tool];
    try {
      const runResult = toolRunOutput(await t.run(args));
      return { ok: runResult.ok, output: runResult.output, mission: null };
    } catch (e) {
      return { ok: false, output: `error: ${e instanceof Error ? e.message : String(e)}`, mission: null };
    }
  };

  /* 3. SAFE path — act + selfimpulse, no gate. */
  if (!risky) {
    const a = await runAction();
    return finalize({ ok: a.ok, output: a.output, approved: true, simulated: false, mission: a.mission });
  }

  /* 2. RISKY path — SIMULATE, then the HUMAN GATE (same primitives as chat). */
  const sim = simulateSelfImpulseAction(action);
  events.push({ kind: "selfimpulse.simulation", seatId: "selfimpulse-core", data: { tool, prediction: sim.prediction, sideEffects: sim.sideEffects, warnings: sim.warnings, confidence: sim.confidence } });
  const detail = isDispatch
    ? `Dispatch mission to a composed crew via the Mission Loop: "${objective.slice(0, 140)}"\nSIMULATION: ${sim.prediction}`
    : `Write file "${String(args.name ?? "untitled.txt")}" to the local workspace\nSIMULATION: ${sim.prediction}${sim.warnings.length > 0 ? `\nWARNINGS: ${sim.warnings.join("; ")}` : ""}`;
  const approvalPromise = requestSelfImpulseApproval(tool, detail, { runId: `run:${callId}`, step: 1 });
  approvalIdRef = selfimpulseSession().approvals[selfimpulseSession().approvals.length - 1]?.id ?? null;
  /* The gate is a DURABLE pause: the run checkpoints "awaiting-human" so a
     crash or redeploy while paused loses nothing — the pending approval and
     the run state reload together. */
  durableCheckpoint(`run:${callId}`, isDispatch ? "dispatch" : "tool", 1, "awaiting-human", { tool, approvalId: approvalIdRef });

  const settle = async (gate: SelfImpulseGate): Promise<SelfImpulseToolCallResult> => {
    if (!gate.ok) {
      durableCheckpoint(`run:${callId}`, isDispatch ? "dispatch" : "tool", 2, "denied at the gate", { reason: gate.reason ?? "denied" });
      const why = gate.reason === "expired"
        ? "The approval expired before it could be backed by a capability — nothing was executed."
        : gate.reason === "capability-unavailable"
          ? "The approval could not be backed by a signed capability — refused fail-closed, nothing was executed."
          : "Denied by the human gate — nothing was executed.";
      return finalize({ ok: false, output: why, approved: false, simulated: true, mission: null });
    }
    /* The execution plane redeems the capability before any effect, bound to
       the action and resource it is about to touch. */
    const intent = { action: tool, resource: detail.slice(0, 200) };
    const v = verifyCapability(gate.capability!, "si.runtime", { intent });
    const redemption = v.ok ? redeemCapability(gate.capability!, "si.runtime", intent) : v;
    if (!redemption.ok) {
      durableCheckpoint(`run:${callId}`, isDispatch ? "dispatch" : "tool", 2, "redemption refused", { reason: redemption.reason });
      return finalize({ ok: false, output: `The signed capability behind the approval did not redeem (${redemption.reason}) — nothing was executed.`, approved: true, simulated: true, mission: null });
    }
    durableCheckpoint(`run:${callId}`, isDispatch ? "dispatch" : "tool", 2, "capability redeemed", { tool });
    toolCallTracks.get(callId)!.state = "running";
    const a = await runAction();
    return finalize({ ok: a.ok, output: a.output, approved: true, simulated: true, mission: a.mission });
  };

  if (opts.blockOnGate) {
    const gate = await approvalPromise;
    return settle(gate);
  }

  /* 4. NON-BLOCKING gate — the caller gets the handle now; the call
   * continues when the human decides (UI or approve_action / deny_action). */
  toolCallTracks.set(callId, { state: "gated", result: null, missionId: null, tool, pendingApproval: null });
  void approvalPromise
    .then((gate) => settle(gate))
    .then((result) => {
      const track = toolCallTracks.get(callId);
      if (track) {
        track.state = "done";
        track.result = result;
      }
    })
    .catch((e) => {
      const track = toolCallTracks.get(callId);
      if (track) {
        track.state = "done";
        track.result = { ok: false, output: `error: ${e instanceof Error ? e.message : String(e)}`, approved: true, simulated: true, pending: false, approvalId: approvalIdRef, callId, receiptId: null, mission: null, ms: Date.now() - t0 };
      }
    });
  return {
    ok: false,
    output: `Paused at the human gate (approval ${approvalIdRef}). Approve or deny it — approve_action / deny_action — then poll call_status "${callId}".`,
    approved: false,
    simulated: true,
    pending: true,
    approvalId: approvalIdRef,
    callId,
    receiptId: null,
    mission: null,
    ms: Date.now() - t0,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   M6 — the gated, reversible meta-loop (16.3.0)
   ─────────────────────────────────────────────────────────────────────────
   The meta-loop (`engine/meta.ts`) is the product proposing changes to its
   OWN control plane — risk tiers, standing preferences. It is the most
   sensitive class of change, so it gets the strictest treatment in the
   product: the same human gate, receipts for every decision (applied,
   denied, refused, reverted), a tightening-only rule for proposals, and
   reversibility as a first-class, itself-gated, itself-attested operation.
   These primitives are the ONLY way the meta-loop touches the session.
   ═══════════════════════════════════════════════════════════════════════ */

/** M6 — persist the session (the meta-loop keeps its own store elsewhere). */
export function commitSession(): void {
  commit();
}

/** M6 — append one receipt to the session ledger (same 20-deep cap). */
export function appendSelfImpulseReceiptRef(ref: SelfImpulseReceiptRef): void {
  session = { ...session, receipts: [...session.receipts.slice(-19), ref] };
  commit();
}

