/**
 * VH 16.10.0 — FEATURE 2: DURABLE MISSIONS (crash-safe execution).
 *
 * `MissionRuntime.persist()` (state v6) and `restore()` (fails loudly) were
 * written in 12.x and — until now — called by NOBODY: a 40-minute mission
 * died with the window. This module is the wire:
 *
 *   - `durableSave(runtime)`  → digest-stamped envelope of the runtime's own
 *     persist() output (never a re-implemented snapshot), stored locally;
 *   - `durableResume(runtime)`→ verify digest → runtime.restore() → the
 *     runtime's own completedNodeIds semantics mean finished work is NOT
 *     repeated; a corrupt/incompatible snapshot refuses in words;
 *   - `DoneLedger`            → per-action completion markers (hash of
 *     mission+node+task): a half-finished step cannot fire twice.
 *
 * Storage: a uniform KV adapter (16.10.1 fix — the 16.9.x-era default cast
 * localStorage to a Map and called .get/.set, which a real Storage does not
 * have; the default browser path was structurally broken). Today the adapter
 * wraps whatever the host offers — localStorage getItem/setItem, an injected
 * Map (probes), or an ephemeral Map when the host has neither. The Tauri FS
 * seat (the same envelope on disk) is the next storage. Nothing phones home.
 *
 * 19.7.13 — THE WEBVIEW CRYPTO FIX. Until this build the module hashed with
 * `node:crypto`, which the browser bundle aliases to a stub that THROWS
 * (src/browser/nodeStubs/crypto.ts). Every browser-edition call therefore ended
 * in that throw — and the one live call site wraps `durableSave` in a try/catch
 * that swallows the error, so the failure was INVISIBLE: in the web edition
 * durable missions never saved at all. The digest is now `pureSha256`
 * (src/engine/pureHash.ts), a from-scratch FIPS 180-4 implementation that is
 * byte-identical to node:crypto — probe/meshRuntime already pins that
 * equivalence on fixed vectors. Receipt and envelope digests are unchanged, so
 * every previously issued snapshot still verifies; this module no longer
 * imports a builtin, so the same code runs on Node, Tauri and the WebView.
 */
import { pureSha256 } from "../engine/pureHash";
import type { MissionRuntime } from "./missionRuntime";
import type { PersistedMissionState } from "./checkpoints";

export interface DurableEnvelope {
  format: "si-durable-mission/1";
  missionId: string;
  savedAt: string;
  digest: string; // sha256 over the canonical persisted state JSON
  state: PersistedMissionState;
}

/* ── the storage adapter: one KV shape, three hosts ──────────────────────── */

export interface DurableKV { get(k: string): string | null; set(k: string, v: string): void }

/** Anything callers may hand us: an injected Map (probes), a real Storage
 * (browser/webview), or an already-adapted DurableKV. */
export type DurableKVLike = DurableKV | Storage | Map<string, string>;

/** Normalize any accepted store into the one KV shape. */
export function asKV(store: DurableKVLike): DurableKV {
  if (typeof (store as DurableKV).get === "function" && typeof (store as DurableKV).set === "function" && typeof (store as Storage).getItem !== "function") {
    return store as DurableKV;
  }
  if (typeof (store as Storage).getItem === "function") {
    const ls = store as Storage;
    return { get: (k) => ls.getItem(k), set: (k, v) => ls.setItem(k, v) };
  }
  const m = store as Map<string, string>;
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
}

/** The host default: localStorage when it really exists (with getItem — the
 * 16.10.1 structural fix), else an ephemeral Map (probes, non-persistent
 *  hosts — honest, nothing pretends to persist).
 *
 *  MEMOIZED per module instance on purpose (19.7.16). It used to hand back a
 *  brand-new ephemeral Map on every call, so two callers that both said
 *  "the host default" got two different stores: `durableSave` wrote to one
 *  and the DoneLedger read from another, and the run journal's write seat
 *  was not the seat its resume read. The host default is the host default —
 *  one seat, resolved on first use (not at module load, so a host that
 *  installs a `localStorage` shim in its own body still gets it). */
let hostDefault: DurableKV | null = null;
export function defaultDurableKV(): DurableKV {
  if (hostDefault) return hostDefault;
  const ls = (globalThis as { localStorage?: Storage }).localStorage;
  if (ls && typeof ls.getItem === "function") hostDefault = asKV(ls);
  else {
    // ephemeral: probes and non-persistent hosts — works, persists nothing, says so
    const mem = new Map<string, string>();
    hostDefault = { get: (k) => mem.get(k) ?? null, set: (k, v) => void mem.set(k, v) };
  }
  return hostDefault;
}

/** Drop the memoized host default. A probe that swaps the host's storage
 *  (installs a `localStorage` shim mid-process) calls this so the next
 *  `defaultDurableKV()` sees the new host instead of the old seat. */
export function resetDurableKVDefault(): void {
  hostDefault = null;
}

/**
 * The envelope digest. Runs on every host (WebView included) because it never
 * touches a builtin — see the 19.7.13 note in the header. Byte-identical to the
 * node:crypto form this replaced, so old snapshots keep verifying.
 */
export const digestOf = (s: string): string => pureSha256(s);
const key = (missionId: string) => `vh.durable.${missionId}`;

export function durableSave(runtime: MissionRuntime, store: DurableKVLike = defaultDurableKV()): DurableEnvelope {
  const state = runtime.persist();
  const envelope: DurableEnvelope = {
    format: "si-durable-mission/1",
    missionId: state.missionId,
    savedAt: new Date().toISOString(),
    digest: digestOf(JSON.stringify(state)),
    state,
  };
  asKV(store).set(key(state.missionId), JSON.stringify(envelope));
  return envelope;
}

export type DurableResume =
  | { ok: true; missionId: string; completedNodeIds: string[]; savedAt: string }
  | { ok: false; refused: string };

/** Load the envelope, verify its digest, then let the runtime restore itself. */
export function durableResume(runtime: MissionRuntime, store: DurableKVLike = defaultDurableKV()): DurableResume {
  const raw = asKV(store).get(key(runtime.persist().missionId));
  if (!raw) return { ok: false, refused: `no durable snapshot for this mission — starting fresh is the honest path, not a silent resume.` };
  let env: DurableEnvelope;
  try {
    env = JSON.parse(raw) as DurableEnvelope;
  } catch {
    return { ok: false, refused: "durable snapshot is corrupt (unparseable) — refused in words; work is NOT resumed into half-state." };
  }
  if (env.format !== "si-durable-mission/1") return { ok: false, refused: `unknown durable format "${env.format}" — refused.` };
  if (digestOf(JSON.stringify(env.state)) !== env.digest) return { ok: false, refused: "durable snapshot failed its digest — it was modified after save; refused rather than resumed." };
  const r = runtime.restore(env.state);
  if (!r.ok) return { ok: false, refused: `runtime restore refused: ${r.errors.join("; ")}` };
  return { ok: true, missionId: env.missionId, completedNodeIds: env.state.completedNodeIds, savedAt: env.savedAt };
}

/* ── the Done ledger: an action fires once — never twice ─────────────────── */

export class DoneLedger {
  private done = new Set<string>();
  constructor(private readonly store: DurableKVLike = defaultDurableKV(), private readonly storeKey = "vh.done.ledger") {
    try {
      const raw = asKV(this.store).get(storeKey);
      if (raw) for (const id of JSON.parse(raw) as string[]) this.done.add(id);
    } catch {
      /* fresh ledger */
    }
  }
  static actionId(missionId: string, nodeId: string, taskTitle: string): string {
    return pureSha256(`${missionId}::${nodeId}::${taskTitle}`).slice(0, 32);
  }
  isDone(actionId: string): boolean { return this.done.has(actionId); }
  /** Mark done ONLY after verified completion — callers pass the verification evidence. */
  markDone(actionId: string, verified: boolean): { ok: boolean; refused?: string } {
    if (!verified) return { ok: false, refused: `refused to mark "${actionId}" done without verification evidence — never-give-up means never FAKE done.` };
    this.done.add(actionId);
    try { asKV(this.store).set(this.storeKey, JSON.stringify([...this.done])); } catch { /* non-persistent host */ }
    return { ok: true };
  }
  get size(): number { return this.done.size; }
}
