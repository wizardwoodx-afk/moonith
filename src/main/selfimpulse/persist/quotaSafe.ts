/**
 * QUOTA-SAFE PERSISTENCE (19.7.13) — degradation you can read.
 *
 * The problem this exists for: VH's live stores write JSON into localStorage
 * through `setItem`, and localStorage is a ~5 MB PER-ORIGIN budget shared by
 * every key the app owns (the memory graph, checkpoints, prefs, ~30 engine
 * keys). When the budget runs out `setItem` throws `QuotaExceededError`. Before
 * this module, three live call sites answered that throw differently and all of
 * them badly:
 *
 *   • graph/checkpoints.ts  → `catch { /* memory copy already holds it *\/ }` —
 *     the write VANISHED. The user's named checkpoint was gone after reload and
 *     nothing said so.
 *   • graph/store.ts        → no guard at all: the throw escaped into the UI.
 *   • engine/memoryGraph.ts   → `catch { /* quota — keep memory copy *\/ }` — the
 *     graph lived only for the session; on reload the whole memory was gone.
 *
 * Silent loss is the one failure VH refuses everywhere else, so it is refused
 * here too. `writeFirstThatFits` takes a LADDER: the caller declares what it is
 * willing to give up, in order, and the ladder is walked until a payload fits.
 * The chosen rung is reported — with the count of what was dropped — and a
 * notice lands in a durable ledger the UI can surface. If even the last rung
 * does not fit, the call REFUSES IN WORDS rather than pretending to save.
 *
 * Honesty rules, same as the rest of the stack:
 *   • a successful write at a degraded rung is a SUCCESS, reported as degraded;
 *   • a refusal is never a silent no-op;
 *   • no notice is ever invented for a write that went in whole.
 *
 * The storage is injectable so the probes (and Node, which has no localStorage)
 * drive the real functions rather than a double.
 */

export interface PersistRung {
  /** the payload to attempt at this rung — must be smaller than the one before */
  value: string;
  /** what this rung costs, in words, for the notice ledger */
  dropped: string;
}

export interface PersistResult {
  ok: boolean;
  /** which rung was written (0 = the full payload) */
  rung: number;
  /** how many rungs were offered, for context in a notice */
  rungs: number;
  /** what was given up at the winning rung — "" when nothing was */
  dropped: string;
  /** present exactly when ok === false: the refusal, in words */
  refused?: string;
}

type Writable = Pick<Storage, "setItem" | "removeItem">;

const NOTICE_KEY = "vh.persist.notices";
const NOTICE_CAP = 40;

export interface PersistNotice {
  at: string;
  key: string;
  kind: "degraded" | "refused";
  detail: string;
}

function resolveStorage(store?: Writable | null): Writable | null {
  if (store !== undefined) return store;
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls && typeof ls.setItem === "function" ? ls : null;
  } catch {
    // a sandboxed frame can throw on ACCESS, not just on write
    return null;
  }
}

function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const name = (e as { name?: unknown }).name;
  const code = (e as { code?: unknown }).code;
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22 || code === 1014;
}

/** The durable notice ledger — every degradation and refusal, newest last. */
export function persistNotices(store?: Writable | null): PersistNotice[] {
  const s = resolveStorage(store);
  if (!s) return [];
  try {
    const raw = (s as Storage).getItem?.(NOTICE_KEY) ?? null;
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PersistNotice[]) : [];
  } catch {
    return [];
  }
}

/**
 * Record a notice. Deliberately best-effort and deliberately SEPARATE from the
 * write it describes: if the origin is so full that even the ledger will not
 * fit, we must not let the ledger's own failure mask the real one.
 */
export function notePersist(key: string, kind: PersistNotice["kind"], detail: string, store?: Writable | null): void {
  const s = resolveStorage(store);
  if (!s) return;
  try {
    const list = persistNotices(s);
    list.push({ at: new Date().toISOString(), key, kind, detail });
    const trimmed = list.slice(-NOTICE_CAP);
    (s as Storage).setItem?.(NOTICE_KEY, JSON.stringify(trimmed));
  } catch {
    /* the ledger is best-effort by design — never let it become the failure */
  }
}

export function clearPersistNotices(store?: Writable | null): void {
  const s = resolveStorage(store);
  if (!s) return;
  try {
    (s as Storage).removeItem?.(NOTICE_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Write the first rung of the ladder that fits.
 *
 * The ladder MUST be ordered largest-first; rung 0 is the caller's ideal
 * payload. Each rung is tried in turn. Quota failures advance the ladder;
 * any OTHER failure (a hostile Storage, a serialization edge) stops the walk
 * immediately and is reported as a refusal, because it is not a size problem
 * and shrinking the payload would not fix it.
 */
export function writeFirstThatFits(
  key: string,
  ladder: PersistRung[],
  store?: Writable | null,
): PersistResult {
  const rungs = ladder.length;
  const s = resolveStorage(store);
  if (rungs === 0) {
    const refused = "no payload was offered (empty write ladder) — nothing was written.";
    notePersist(key, "refused", refused, store);
    return { ok: false, rung: -1, rungs, dropped: "", refused };
  }
  if (!s) {
    // No storage at all is a HOST FACT, not a failure of this write: the
    // caller's in-memory copy is the whole story and it already says so.
    return { ok: false, rung: -1, rungs, dropped: "", refused: "no storage on this host — the caller's in-memory copy is the session's only record." };
  }

  for (let i = 0; i < rungs; i++) {
    const rung = ladder[i] as PersistRung;
    try {
      s.setItem(key, rung.value);
      if (i > 0) {
        notePersist(key, "degraded", `rung ${i}/${rungs - 1}: ${rung.dropped}`, s);
      }
      return { ok: true, rung: i, rungs, dropped: i > 0 ? rung.dropped : "" };
    } catch (e) {
      if (!isQuotaError(e)) {
        const refused = `write to "${key}" failed for a non-quota reason (${String(e)}) — refused rather than shrinking the payload, which would not have helped.`;
        notePersist(key, "refused", refused, s);
        return { ok: false, rung: -1, rungs, dropped: "", refused };
      }
      // a quota failure is the ladder's reason to exist — advance and retry
    }
  }

  const refused =
    `every rung of the ladder failed on quota — even the smallest payload does not fit this origin. ` +
    `Nothing was written; the caller keeps its in-memory copy.`;
  notePersist(key, "refused", refused, s);
  return { ok: false, rung: -1, rungs, dropped: "", refused };
}

/** Bytes a string occupies in localStorage (UTF-16 code units → ~2 bytes each). */
export function approxBytes(value: string): number {
  return value.length * 2;
}
