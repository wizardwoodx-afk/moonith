/**
 * §AUTONOMY STORE — one persisted state for the autonomy engines (VH 11.9.4-Major+).
 *
 * Before Major+, the bandit and elastic policy lived as page-local useState in
 * the Evolution page, so real runs could not update them (the 11.9.4(Major)
 * review's central finding). Now the runtime settles runs INTO this store and
 * every surface reads FROM it; a `storage` event subscription lets open pages
 * refresh live when a run lands in another view.
 *
 * Storage is localStorage (webview-local, same trust level as editor prefs).
 * Every accessor degrades to memory-only when storage is unavailable.
 */
import { DEFAULT_ELASTIC_POLICY, type ElasticPolicy, type ScaleAction } from "./elasticSeats";
import { emptyBandit, type ArmId, type BanditState } from "./evolutionBandit";

export interface AutonomyLogEntry {
  ts: string;
  teamId: string;
  arms: ArmId[];
  verified: boolean;
  simulated: boolean;
  action: ScaleAction;
  applied: boolean;
}

export interface AutonomyState {
  bandit: BanditState;
  elastic: ElasticPolicy;
  log: AutonomyLogEntry[];
  /** Trailing idle-run count and trailing failed seat ids, for the elastic signal. */
  idleRuns: number;
  recentFailed: string[];
}

const KEY = "vh.autonomy.v1";
let memory: AutonomyState | null = null;

export function loadAutonomy(): AutonomyState {
  if (memory) return memory;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null") as Partial<AutonomyState> | null;
    memory = {
      bandit: raw?.bandit && raw.bandit.arms ? raw.bandit : emptyBandit(),
      elastic: { ...DEFAULT_ELASTIC_POLICY, ...(raw?.elastic ?? {}) },
      log: Array.isArray(raw?.log) ? raw.log.slice(-20) : [],
      idleRuns: typeof raw?.idleRuns === "number" ? raw.idleRuns : 0,
      recentFailed: Array.isArray(raw?.recentFailed) ? raw.recentFailed.slice(-4) : [],
    };
    return memory;
  } catch {
    memory = { bandit: emptyBandit(), elastic: { ...DEFAULT_ELASTIC_POLICY }, log: [], idleRuns: 0, recentFailed: [] };
    return memory;
  }
}

export function saveAutonomy(next: AutonomyState): void {
  memory = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode — in-memory only, still consistent within the session */
  }
}

/** Open pages refresh when a run settles in another view. */
export function subscribeAutonomy(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      memory = null;
      cb();
    }
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
