/**
 * §RUN CHECKPOINTS — a crash resumes instead of restarting.
 *
 * The enterprise bar for agent runtimes in one sentence: if step 14 of 20
 * fails at 3 a.m., the run resumes from step 13 — it does not start over.
 * The mission runtime already persists its task state (`checkpoints.ts`)
 * and can save/resume a whole runtime (`durable.ts`); THIS file is the
 * tamper-evident chain under the run-level story: every meaningful step of
 * a live run — a settled wave, a human gate opening, a decision landing —
 * appends to a chain any auditor can recompute.
 *
 * THE LAWS THIS FILE ENFORCES
 *  1. THE CHAIN IS THE EVIDENCE. Each checkpoint carries the digest of the
 *     state it saved AND the digest of the checkpoint before it. Recompute
 *     the chain and any edit — a lost step, a rewritten verdict — refuses.
 *  2. RESUME IS EARNED. `resumeRunFrom` returns the resume point only for
 *     a chain that verifies. A tampered journal refuses in words.
 *  3. A RESTART IS NOT A LOSS. The whole journal — chains AND the state
 *     snapshots they point at — is written to the host's storage through
 *     the project's ONE storage adapter (`durable.ts`: localStorage when
 *     the host really has it, an injected Map in Node, an ephemeral Map
 *     where neither exists). A crash wipes the module-level maps below;
 *     the journal on disk is what a restart reloads, so
 *     `loadRunJournal()` + `resumeRunFrom()` is a genuine resume rather
 *     than a fresh run wearing a resume's name.
 *  4. FAIL CLOSED. A journal that is corrupt, or whose `schemaVersion` is
 *     not one this build understands, is NEVER quietly dropped in favour
 *     of an empty chain. It refuses, in words, and the caller is told a
 *     journal existed. Starting fresh over a journal that was there is
 *     exactly the dishonesty this module exists to prevent.
 *
 * STATE OWNERSHIP (the 19.7.16 collision fix): a state snapshot is stored
 * under `runId` → `stateDigest`, never under a bare digest. Two different
 * runs that happen to settle on byte-identical state used to share ONE
 * slot, so `resumeRunFrom` could hand a run the other run's snapshot.
 * The chain links on the digest; the SNAPSHOT lives in the run's own
 * table, and the two are checked against each other on resume.
 */
import { pureSha256 } from "../engine/pureHash";
import { stableStringify } from "../security/actionGraph";
import { asKV, defaultDurableKV, type DurableKVLike } from "./durable";
import {
  advanceRetryAccounting,
  EMPTY_RETRY_ACCOUNTING,
  historicalFailureRetries,
  laneOfLabel,
  savedRetryAccounting,
  stateWithRetryAccounting,
  type RetryLane,
  type RunRetryAccounting,
} from "./retryLanes";

export interface RunCheckpoint {
  runId: string;
  missionId: string;
  step: number;
  label: string;
  /** digest of the saved state — what the run can be rebuilt from */
  stateDigest: string;
  /** digest of the ENTIRE previous checkpoint — empty for the first */
  prevDigest: string;
  /** digest over every field of THIS checkpoint — the chain links on it,
   *  so editing a label, a step, a mission id, or a timestamp breaks the
   *  chain just as surely as swapping the state. */
  entryDigest: string;
  at: number;
}

/** The persisted document. Bump `schemaVersion` on any shape change — an
 *  unknown version is refused, never guessed at. */
export const RUN_JOURNAL_VERSION = 2;
export const RUN_JOURNAL_KEY = "vh.run.journal.v2";

export interface RunJournal {
  schemaVersion: number;
  savedAt: string;
  /** runId → its chain, in order */
  runs: Record<string, RunCheckpoint[]>;
  /** runId → stateDigest → canonical state JSON (the resume payload) */
  states: Record<string, Record<string, string>>;
}

/* In-memory working set. A crash loses exactly this and nothing else. */
const chainOf = new Map<string, RunCheckpoint[]>();
const states = new Map<string, Map<string, string>>(); // runId → stateDigest → canonical state

/** The host storage the journal is written to — the project's ONE adapter
 *  (localStorage / injected Map / ephemeral Map), overridable so a probe or
 *  a future Tauri file seat can hand in its own.
 *
 *  Resolved LAZILY, not at module load: a probe (or a host) that installs a
 *  `localStorage` shim in its own body has not done so yet while the module
 *  graph is still being evaluated, so a load-time capture would bind the
 *  ephemeral Map and quietly stop persisting. */
let journalStore: DurableKVLike | null = null;
function activeStore(): DurableKVLike {
  journalStore ??= defaultDurableKV();
  return journalStore;
}

/** Why the last automatic journal write did not land ("" when it did), so a
 *  host that refuses writes can receipt the degradation instead of losing
 *  a resume silently. */
let lastWriteRefusal = "";

/** Read (and clear) the last refused journal write. "" when every write
 *  landed. */
export function lastJournalWriteRefusal(): string {
  return lastWriteRefusal;
}

/** Point the journal at a specific store (probes, the Tauri file seat).
 *  Returns the previous store so a caller can put it back; `null` means the
 *  host default had not been resolved yet. */
export function setRunJournalStore(store: DurableKVLike): DurableKVLike | null {
  const previous = journalStore;
  journalStore = store;
  return previous;
}

const digestOf = (s: unknown): string => pureSha256(stableStringify(s ?? null));

/** The chain digest: byte-identical to the node:crypto form it replaced, so
 *  every previously issued chain still verifies (pureSha256 is pinned
 *  against the builtin in probe/meshRuntime). This also removes the last
 *  `node:crypto` import from the run path, so the chain works in the
 *  WebView where that alias throws by design. */
const entryDigestOf = (missionId: string, step: number, label: string, stateDigest: string, prevDigest: string, at: number): string =>
  pureSha256(`${missionId}|${step}|${label}|${stateDigest}|${prevDigest}|${at}`);

function stateTable(runId: string): Map<string, string> {
  let table = states.get(runId);
  if (!table) {
    table = new Map<string, string>();
    states.set(runId, table);
  }
  return table;
}

export function checkpoint(
  runId: string,
  missionId: string,
  step: number,
  label: string,
  state: unknown,
): RunCheckpoint {
  const chain = chainOf.get(runId) ?? [];
  const prev = chain[chain.length - 1];
  const at = Date.now();
  const stateDigest = digestOf(state);
  const prevDigest = prev ? prev.entryDigest : "";
  const entryDigest = entryDigestOf(missionId, step, label, stateDigest, prevDigest, at);
  const cp: RunCheckpoint = {
    runId,
    missionId,
    step,
    label,
    stateDigest,
    prevDigest,
    entryDigest,
    at,
  };
  chain.push(cp);
  chainOf.set(runId, chain);
  // The snapshot belongs to THIS run's table. Keyed by a bare digest it
  // could be claimed by any other run that settled on the same state.
  stateTable(runId).set(stateDigest, stableStringify(state ?? null));
  // Law 3: the chain reaches storage HERE, not when some host thinks to
  // remember. A checkpoint that is not on disk is a checkpoint a crash
  // loses, which is the whole thing this module exists to prevent. A host
  // that refuses the write leaves its refusal in `lastJournalWriteRefusal`
  // for the runtime to receipt — never swallowed here.
  persistRunJournal();
  return cp;
}

/* ── RETRY LANES — a wait is not a failure ────────────────────────────────
 * §RETRY LANES (MIT upstream — see `src/mission/retryLanes.ts` for the full
 * provenance and for why this is the seam the defect lives at).
 *
 * The chain already records every meaningful moment of a run: the repair ladder
 * takes a checkpoint, the human gate takes one, each settled wave takes one.
 * What it could not record was WHICH of those it was. So the only durable count
 * a resuming run had was one that read a three-hour wait at the gate exactly the
 * way it read three genuine failures — and the run's repair budget was the thing
 * measured against it.
 *
 * `recordLaneCheckpoint` fixes that WITHOUT touching the journal's schema:
 * the accounting is written into the checkpoint's own `state` payload, which the
 * chain already digests. That is deliberate twice over — no `schemaVersion` bump
 * means no run refuses to load a journal it wrote yesterday, and because the
 * state is digested, the accounting is tamper-evident for free: editing a run's
 * retry count breaks its chain link exactly like editing its label does. */

/** The run's durable, lane-separated retry accounting.
 *
 *  Two readings, in priority order, and both are conservative:
 *   - a saved block on the newest checkpoint is the authoritative one, because
 *     `recordLaneCheckpoint` advanced it from the previous one;
 *   - when there is none — a journal from before this module, or a host that
 *     only ever calls the plain `checkpoint()` — the chain's LABELS are folded
 *     instead, which is `historicalFailureRetries`'s deliberate posture: never
 *     reset a count nobody can prove, never inflate a wait into a failure.
 *
 *  `Math.max` of the two, so a tampered or stale saved block can only ever be
 *  harder on the run than the labels, never softer. */
export function retryAccounting(runId: string): RunRetryAccounting {
  const chain = chainOf.get(runId);
  if (!chain || chain.length === 0) return { ...EMPTY_RETRY_ACCOUNTING };
  const last = chain[chain.length - 1];
  const raw = states.get(runId)?.get(last.stateDigest);
  let saved: RunRetryAccounting | null = null;
  if (raw) {
    try {
      saved = savedRetryAccounting(JSON.parse(raw));
    } catch {
      saved = null;
    }
  }
  const historical = historicalFailureRetries(chain);
  if (!saved) {
    const labels = chain.map((cp) => ({ label: cp.label }));
    return {
      format: "si-retry-accounting/1",
      failureRetries: historical,
      continuations: labels.reduce((n, e) => (laneOfLabel(e.label) === "continuation" ? n + 1 : n), 0),
      humanWaits: labels.reduce((n, e) => (laneOfLabel(e.label) === "awaiting-human" ? n + 1 : n), 0),
      busyWaits: labels.reduce((n, e) => (laneOfLabel(e.label) === "busy" ? n + 1 : n), 0),
      lastLane: laneOfLabel(last.label),
    };
  }
  return { ...saved, failureRetries: Math.max(saved.failureRetries, historical) };
}

/**
 * Append a checkpoint that KNOWS which lane it belongs to.
 *
 * Same storage path, same digest, same persistence as `checkpoint()` — it is
 * that function with a lane attached, not a second journal. The accounting is
 * derived from the run's own previous entry, so a chain cannot be handed a
 * number it did not earn, and the lane decides what moves: only `failure`
 * charges `failureRetries`. A run that parks at the human gate for three hours
 * grows `humanWaits` and spends nothing.
 */
export function recordLaneCheckpoint(
  runId: string,
  missionId: string,
  step: number,
  lane: RetryLane,
  label: string,
  state: unknown,
): RunCheckpoint {
  const accounting = advanceRetryAccounting(retryAccounting(runId), lane);
  return checkpoint(runId, missionId, step, label, stateWithRetryAccounting(state, accounting));
}

/** Write the journal to the host's storage. Called automatically after
 *  every checkpoint; exposed so a host can force a save (a run pausing at
 *  a gate, a window closing) without inventing a second persistence path. */
export function persistRunJournal(): { ok: true; runs: number; bytes: number } | { ok: false; refused: string } {
  try {
    const raw = runJournal();
    asKV(activeStore()).set(RUN_JOURNAL_KEY, raw);
    const parsed = JSON.parse(raw) as RunJournal;
    lastWriteRefusal = "";
    return { ok: true, runs: Object.keys(parsed.runs).length, bytes: raw.length };
  } catch (e) {
    // Degradation is reported, never hidden: a refused write means the next
    // restart has nothing to resume from, and the caller must be able to
    // say so out loud.
    lastWriteRefusal = `the run journal could not be written (${e instanceof Error ? e.message : String(e)}) — a restart would have nothing to resume from.`;
    return { ok: false, refused: lastWriteRefusal };
  }
}

export function latestCheckpoint(runId: string): RunCheckpoint | null {
  const chain = chainOf.get(runId);
  return chain && chain.length > 0 ? chain[chain.length - 1] : null;
}

export function chainFor(runId: string): RunCheckpoint[] {
  return [...(chainOf.get(runId) ?? [])];
}

/** Recompute the whole chain. Any broken link — an edited label, a dropped
 *  step, a swapped state — names itself and refuses. */
export function verifyRunChain(runId: string): { ok: true; length: number } | { ok: false; reason: string; detail: string } {
  const chain = chainOf.get(runId);
  if (!chain || chain.length === 0) return { ok: false, reason: "unknown-run", detail: `no checkpoints recorded for ${runId}` };
  let prev: RunCheckpoint | null = null;
  for (let i = 0; i < chain.length; i++) {
    const cp = chain[i];
    const expectedPrev = prev ? prev.entryDigest : "";
    if (cp.prevDigest !== expectedPrev) {
      return { ok: false, reason: "broken-link", detail: `checkpoint ${i} (${cp.label}) points at ${cp.prevDigest.slice(0, 12)} but the previous entry digest is ${expectedPrev.slice(0, 12)}` };
    }
    const recompute = entryDigestOf(cp.missionId, cp.step, cp.label, cp.stateDigest, cp.prevDigest, cp.at);
    if (cp.entryDigest !== recompute) {
      return { ok: false, reason: "edited-entry", detail: `checkpoint ${i} (${cp.label}) does not match its own digest — a field was edited` };
    }
    if (cp.step < 0 || !cp.label) {
      return { ok: false, reason: "malformed", detail: `checkpoint ${i} is malformed` };
    }
    prev = cp;
  }
  return { ok: true, length: chain.length };
}

/** The resume verdict: WHERE this run picks up, or why it may not.
 *
 *  It also carries the run's durable retry accounting, and that is not a
 *  convenience — it is the fix. A resuming runtime otherwise has two numbers
 *  available to it: `fromStep`, which counts gate pauses and settled waves
 *  alongside real failures, and its own memory, which a crash wiped. Neither is
 *  the repair budget. `failureRetries` is, and it is the third thing the chain
 *  can prove rather than guess. */
export function resumeRunFrom(runId: string):
  | { ok: true; runId: string; missionId: string; fromStep: number; label: string; state: unknown; checkpoints: number; failureRetries: number; retryAccounting: RunRetryAccounting }
  | { ok: false; reason: string; detail: string } {
  const verdict = verifyRunChain(runId);
  if (!verdict.ok) return verdict;
  const chain = chainOf.get(runId)!;
  const last = chain[chain.length - 1];
  // The snapshot is read from THIS run's table and re-digested before it is
  // handed back: a snapshot that does not hash to the digest the chain
  // committed to is refused, not returned.
  const snapshot = states.get(runId)?.get(last.stateDigest);
  if (snapshot === undefined) {
    return {
      ok: false,
      reason: "state-missing",
      detail: `the chain for ${runId} verifies, but the state snapshot for step ${last.step} ("${last.label}") is not in the journal — refusing to resume into a state nobody can prove.`,
    };
  }
  let parsedState: unknown;
  try {
    parsedState = JSON.parse(snapshot);
  } catch {
    return { ok: false, reason: "state-unreadable", detail: `the state snapshot for ${runId} step ${last.step} is not readable JSON — refused rather than resumed.` };
  }
  if (digestOf(parsedState) !== last.stateDigest) {
    return {
      ok: false,
      reason: "state-swapped",
      detail: `the state snapshot for ${runId} step ${last.step} does not match the digest the chain committed to — it was swapped after the fact; refused.`,
    };
  }
  return {
    ok: true,
    runId,
    missionId: last.missionId,
    fromStep: last.step,
    label: last.label,
    state: parsedState,
    checkpoints: chain.length,
    failureRetries: retryAccounting(runId).failureRetries,
    retryAccounting: retryAccounting(runId),
  };
}

/** Serialize one run's chain (or all runs) — chains AND the state snapshots
 *  they point at, so the serialized copy is enough to resume. */
export function runJournal(runId?: string): string {
  const runs: Record<string, RunCheckpoint[]> = {};
  const stateDoc: Record<string, Record<string, string>> = {};
  if (runId) {
    runs[runId] = chainOf.get(runId) ?? [];
    stateDoc[runId] = Object.fromEntries(states.get(runId) ?? new Map<string, string>());
  } else {
    for (const [rid, chain] of chainOf) {
      runs[rid] = chain;
      stateDoc[rid] = Object.fromEntries(states.get(rid) ?? new Map<string, string>());
    }
  }
  const doc: RunJournal = { schemaVersion: RUN_JOURNAL_VERSION, savedAt: new Date().toISOString(), runs, states: stateDoc };
  return JSON.stringify(doc);
}

/** Reload a journal after a restart. Refuses anything that is not a well-
 *  formed journal; loaded runs re-verify on the next resume attempt.
 *
 *  A `v: 1` document (the shape this module shipped before the journal was
 *  persisted) carried chains but NO state snapshots, so it can be read as a
 *  chain and never resumed from: `resumeRunFrom` on such a run refuses with
 *  `state-missing` rather than handing back `null` and calling it a resume. */
export function restoreRunJournal(snapshot: string): { ok: true; runs: number } | { ok: false; reason: string; detail: string } {
  let parsed: Partial<RunJournal> & { v?: number; runs?: unknown; states?: unknown };
  try {
    parsed = JSON.parse(snapshot);
  } catch {
    return { ok: false, reason: "malformed", detail: "the journal is not valid JSON" };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, reason: "malformed", detail: "not a SelfImpulse run journal" };
  }
  // v1 predates the schemaVersion field; it is READ (chains verify) but it
  // holds no state, so nothing loaded from it can resume.
  const version = typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : parsed.v === 1 ? 1 : undefined;
  if (version === undefined) {
    return { ok: false, reason: "unknown-version", detail: "the journal carries no schema version — refused rather than guessed at." };
  }
  if (version !== 1 && version !== RUN_JOURNAL_VERSION) {
    return { ok: false, reason: "unknown-version", detail: `journal schema version ${version} is not one this build understands (it reads 1 and ${RUN_JOURNAL_VERSION}) — refused rather than guessed at.` };
  }
  if (typeof parsed.runs !== "object" || parsed.runs === null) {
    return { ok: false, reason: "malformed", detail: "not a SelfImpulse run journal" };
  }
  const rawStates = (typeof parsed.states === "object" && parsed.states !== null ? parsed.states : {}) as Record<string, unknown>;
  let runs = 0;
  for (const [rid, chain] of Object.entries(parsed.runs as Record<string, unknown>)) {
    if (!Array.isArray(chain)) continue;
    const entries: RunCheckpoint[] = [];
    for (const entry of chain) {
      // A non-object entry would make the digest recomputation below read
      // undefined fields; refuse the document rather than half-load it.
      if (!entry || typeof entry !== "object") {
        return { ok: false, reason: "malformed", detail: `checkpoint ${entries.length} of run ${rid} is not an object — the journal is corrupt.` };
      }
      entries.push(entry as RunCheckpoint);
    }
    chainOf.set(rid, entries);
    const table = new Map<string, string>();
    const perRun = rawStates[rid];
    if (perRun && typeof perRun === "object") {
      for (const [digest, value] of Object.entries(perRun as Record<string, unknown>)) {
        if (typeof value === "string") table.set(digest, value);
      }
    }
    states.set(rid, table);
    runs += 1;
  }
  return { ok: true, runs };
}

/**
 * THE RESTART PATH. Reload whatever the host's storage holds, then report
 * the resume verdict for one run.
 *
 * Signature (what `src/ui/store.ts` calls on startup / when the user asks
 * to resume):
 *
 *   resumeRun(runId: string, store?: DurableKVLike):
 *     | { ok: true; runId: string; missionId: string; fromStep: number;
 *         label: string; state: unknown; checkpoints: number;
 *         failureRetries: number; retryAccounting: RunRetryAccounting;
 *         source: "journal" | "memory" }
 *     | { ok: false; reason: string; detail: string }
 *
 * `failureRetries` is the run's durable failure-retry count — retries charged
 * to a genuine failure, and nothing else. Gate pauses and settled waves are
 * counted in `retryAccounting` beside it, under `humanWaits` and
 * `continuations`, precisely so a runtime can decide its repair budget on the
 * first number without having to reinterpret the other two.
 *
 * `store` defaults to the module's store (localStorage where the host has
 * it, an injected Map in Node, an ephemeral Map where neither exists).
 *
 * Fail-closed semantics, in order:
 *   ”¢ nothing stored AT ALL → `{ ok: false, reason: "no-journal" }`. A run
 *     that never journalled has nothing to resume; that is a fresh start and
 *     the caller is told so.
 *   ”¢ stored but corrupt / unknown version → `{ ok: false, reason }` with
 *     the refusal in words. The caller MUST NOT treat this as "no journal".
 *   ”¢ loaded, chain verifies, snapshot proves out → the resume point.
 */
export function resumeRun(runId: string, store?: DurableKVLike):
  | { ok: true; runId: string; missionId: string; fromStep: number; label: string; state: unknown; checkpoints: number; source: "journal" | "memory"; failureRetries: number; retryAccounting: RunRetryAccounting }
  | { ok: false; reason: string; detail: string } {
  const kv = asKV(store ?? activeStore());
  const raw = kv.get(RUN_JOURNAL_KEY);
  if (raw === null) {
    // No journal on this host. If the chain is still in memory (a first run,
    // not a restart) that is still an honest answer — from memory, not a
    // resume across a crash.
    const memory = chainOf.get(runId);
    if (!memory || memory.length === 0) {
      return { ok: false, reason: "no-journal", detail: `no run journal is stored on this host, so ${runId} has nothing to resume — this is a fresh run, not a resume.` };
    }
    const verdict = resumeRunFrom(runId);
    return verdict.ok ? { ...verdict, source: "memory" } : verdict;
  }
  const loaded = restoreRunJournal(raw);
  if (!loaded.ok) {
    // The journal EXISTS and is unusable. Say exactly that, and say that it
    // existed — a caller that reads this as "no journal" would silently
    // restart a run over evidence that is sitting right there.
    return {
      ok: false,
      reason: loaded.reason,
      detail: `a run journal is stored for this host but could not be read: ${loaded.detail} Refusing to start ${runId} fresh over a journal that existed.`,
    };
  }
  const verdict = resumeRunFrom(runId);
  return verdict.ok ? { ...verdict, source: "journal" } : verdict;
}

/** Read the journal out of storage into memory without asking for a
 *  verdict — the "reload after a restart" step on its own. */
export function loadRunJournal(store?: DurableKVLike): { ok: true; runs: number } | { ok: false; reason: string; detail: string } {
  const raw = asKV(store ?? activeStore()).get(RUN_JOURNAL_KEY);
  if (raw === null) return { ok: false, reason: "no-journal", detail: "no run journal is stored on this host" };
  return restoreRunJournal(raw);
}

/** Probe seam — clears all run journals, in memory AND in the host's store,
 *  so a probe that simulates a crash starts from the same emptiness a real
 *  one would. Never called by the product. */
export function resetRunCheckpointsForProbe(): void {
  chainOf.clear();
  states.clear();
  try {
    asKV(activeStore()).set(RUN_JOURNAL_KEY, runJournal());
  } catch {
    /* nothing to clear on a host that refuses writes */
  }
}
