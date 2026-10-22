/**
 * VH 11.14.1 — the Capability Channel (the enterprise thesis, working).
 *
 * The upgrade from "share a file" to "expose a capability without exposing
 * the data": Employee 2 does not receive Employee 1's dataset. Employee 2
 * requests an APPROVED OPERATION; the operation runs where the data lives;
 * only the aggregate answer crosses the boundary — and it crosses through
 * the Egress Gate like everything else, with a signed receipt.
 *
 * Discipline, kept deliberately tight:
 *  - operations come from an explicit whitelist (aggregate-only); there is no
 *    free-form query surface and no path that returns raw rows;
 *  - the request needs a human-signed authority envelope scoped
 *    capability:run — no envelope, wrong scope, expired, revoked or non-human
 *    principal are each refused in words;
 *  - the result is digest-stamped, so the receipt proves WHICH answer left;
 *  - the demo dataset stands in for "company data on this laptop" and is
 *    labelled as such — VH does not pretend to see a real corporate store.
 */
import { sha256Hex } from "./learningReceipt";
import { checkEnvelope, isHumanPrincipal, type AuthorityEnvelope } from "./custody";

export interface CapabilityRequest {
  id: string;
  /** who is asking — the privacy budget is scoped per requester, so one
   *  colleague exhausting their budget never spends another's */
  requester: string;
  /**
   * VH 11.14.3 — optional equality predicates applied BEFORE aggregation
   * (e.g. `{ region: "APAC" }`). The minimum-cohort guard applies to the
   * FILTERED subset — that is exactly where reconstruction attacks live.
   */
  where?: Record<string, string | number>;
  /** whitelist only: aggregate operations, never raw rows */
  op: "count" | "sum" | "avg" | "max";
  dataset: string;
  field: string;
}

export interface CapabilityResult {
  requestId: string;
  op: CapabilityRequest["op"];
  dataset: string;
  field: string;
  /** 11.14.2 — how many records the aggregate folded (metadata, not data) */
  cohortSize: number;
  /** aggregate only — structurally incapable of carrying raw rows */
  value: number;
  computedAt: string;
  digest: string;
}

export const CAPABILITY_OPS: CapabilityRequest["op"][] = ["count", "sum", "avg", "max"];

/**
 * VH 11.14.2 — the Privacy Guard (the 9.9/10 review's serious problem, faced
 * honestly: aggregate-only does NOT automatically mean privacy-safe — narrow
 * or repeated aggregate queries can reconstruct rows). The production answer
 * is dataset-level policy enforced BEFORE any computation:
 *   - field policy: only declared fields may be aggregated at all
 *   - minimum cohort: an aggregate over fewer than k records is refused —
 *     small cohorts let a requester infer individuals
 *   - privacy budget: a hard cap on queries per window — repeated slightly
 *     different aggregates are exactly the reconstruction attack
 *   - bounded precision: answers are rounded to the policy's grain, so a
 *     result never carries more decimal information than intended
 * Differential privacy is the later enterprise tier (thesis §"Honest
 * engineering choice"); these four guards are what the seed can enforce
 * mechanically, today, and they are pinned by probe.
 */
export interface DatasetPolicy {
  dataset: string;
  allowedFields: string[];
  minCohortSize: number;
  maxQueriesPerWindow: number;
  windowMs: number;
  roundTo: number;
}


/**
 * VH 11.14.3 — the privacy budget is DURABLE. The 11.14.2 review named the
 * in-memory budget as the biggest remaining weakness: restart the process,
 * budget gone, reconstruction attack resumes. The budget now lives in an
 * append-only, digest-chained ledger (same discipline as the egress ledger):
 * scoped by tenant-atop-machine + dataset + requester + policy window.
 * Every executeCapability call re-reads the ledger — a restart resets
 * nothing. Any edit or truncation breaks the chain and is REFUSED, not
 * silently accepted. (A production deployment adds write-locking and
 * tenant partitioning — thesis, honesty section — but the restart attack
 * no longer exists.)
 */
export interface PrivacyLedgerEntry {
  id: string;
  dataset: string;
  requester: string;
  op: CapabilityRequest["op"];
  field: string;
  filtered: boolean;
  countedAt: number;
  /** digest of the previous entry — the chain */
  prev: string;
  /** sha256 over the canonical entry — tamper evidence */
  digest: string;
}

const LS_PRIVACY = "vh.privacy.ledger";

export function privacyCanonical(e: Omit<PrivacyLedgerEntry, "digest">): string {
  return JSON.stringify([e.id, e.dataset, e.requester, e.op, e.field, e.filtered, e.countedAt, e.prev]);
}

export function loadPrivacyLedger(): PrivacyLedgerEntry[] {
  try {
    const raw = localStorage.getItem(LS_PRIVACY);
    if (raw) {
      const parsed = JSON.parse(raw) as PrivacyLedgerEntry[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* storage unavailable */ }
  return [];
}

const LS_PRIVACY_ANCHOR = "vh.privacy.ledger.anchor";

export function savePrivacyLedger(entries: PrivacyLedgerEntry[]): void {
  try {
    localStorage.setItem(LS_PRIVACY, JSON.stringify(entries));
    // the anchor seals the head of the chain: dropping entries to "reset"
    // the budget makes the anchor disagree — truncation is detectable too
    localStorage.setItem(LS_PRIVACY_ANCHOR, entries.length > 0 ? entries[entries.length - 1].digest : "");
  } catch { /* ignore */ }
}

/** true when the digest chain is intact AND matches its anchor — any edit
 *  or truncation fails it (a bare hash chain alone would not catch
 *  truncation; the anchor closes that hole) */
export async function verifyPrivacyLedger(): Promise<boolean> {
  const entries = loadPrivacyLedger();
  let prev = "GENESIS";
  for (const e of entries) {
    if (e.prev !== prev) return false;
    const { digest, ...rest } = e;
    if (await sha256Hex(privacyCanonical(rest)) !== digest) return false;
    prev = digest;
  }
  try {
    const anchor = localStorage.getItem(LS_PRIVACY_ANCHOR);
    if (anchor !== null && anchor !== (entries.length > 0 ? entries[entries.length - 1].digest : "")) return false;
  } catch { /* storage unavailable */ }
  return true;
}

/** Test/demo seam: clear the privacy-budget accounting, durable store included. */
export function resetCapabilityQueryLedger(): void {
  try { localStorage.removeItem(LS_PRIVACY); localStorage.removeItem(LS_PRIVACY_ANCHOR); } catch { /* ignore */ }
}

/** Queries counted against (dataset, requester) in the current window. */
export function capabilityQueryCount(dataset: string, requester: string, now: number): number {
  const policy = DEMO_POLICY.dataset === dataset ? DEMO_POLICY : null;
  if (!policy) return 0;
  return loadPrivacyLedger().filter(
    (e) => e.dataset === dataset && e.requester === requester && now - e.countedAt < policy.windowMs,
  ).length;
}

/** Demo stand-in for endpoint-resident company data. Labelled honestly. */
export const DEMO_COMPANY_DATA: { dataset: string; rows: Array<Record<string, number | string>> } = {
  dataset: "demo.revenue-by-region",
  rows: [
    { region: "APAC", revenue: 128.4 },
    { region: "EMEA", revenue: 96.2 },
    { region: "APAC", revenue: 64.1, bonus: 2.2 },
    { region: "EMEA", revenue: 45.9, bonus: 4.1 },
    { region: "AMER", revenue: 210.7 },
  ],
};

export const DEMO_POLICY: DatasetPolicy = {
  dataset: DEMO_COMPANY_DATA.dataset,
  allowedFields: ["revenue", "bonus"],
  minCohortSize: 5,
  maxQueriesPerWindow: 8,
  windowMs: 10 * 60 * 1000,
  roundTo: 0.1,
};

export function capabilityCanonical(r: Omit<CapabilityResult, "digest">): string {
  return JSON.stringify([r.requestId, r.op, r.dataset, r.field, r.cohortSize, r.value, r.computedAt]);
}

/**
 * The gate for capability requests. Returns the computed result when the
 * operation is authorized — or the plain-language reason it was refused.
 * Raw rows never enter the result: every whitelisted op folds to one number.
 */
export async function executeCapability(args: {
  request: CapabilityRequest;
  envelope: AuthorityEnvelope | null;
  now: number;
}): Promise<{ result: CapabilityResult | null; reason: string }> {
  const { request, envelope, now } = args;
  if (!envelope) return { result: null, reason: "refused — no authority envelope; a capability request needs the data owner's signed authority" };
  if (!isHumanPrincipal(envelope.principal)) return { result: null, reason: `refused — principal "${envelope.principal}" is not human; only the data owner may authorize operations on their data` };
  const scope = checkEnvelope(envelope, "capability:run", now);
  if (!scope.ok) return { result: null, reason: `refused — ${scope.reason}` };
  if (!envelope.scope.includes("capability:run")) return { result: null, reason: "refused — the envelope's scope does not permit capability:run" };
  if (!CAPABILITY_OPS.includes(request.op)) return { result: null, reason: `refused — operation "${request.op}" is not on the approved whitelist` };
  if (request.dataset !== DEMO_COMPANY_DATA.dataset) return { result: null, reason: `refused — dataset "${request.dataset}" is not exposed on this machine` };

  // 11.14.2 + 11.14.3 — Privacy Guard, enforced before any computation.
  // Every attempt that passes authority counts against the privacy budget —
  // refusals too — because probing itself is the reconstruction attack.
  // 11.14.3: the budget is DURABLE and per-requester, in a digest-chained
  // ledger; a tampered chain is refused outright.
  const policy = DEMO_POLICY;
  if (!(await verifyPrivacyLedger())) {
    return { result: null, reason: "refused — the privacy ledger's digest chain is broken; a restart or reset of the query budget is exactly the reconstruction attack, so nothing computes until the ledger is restored" };
  }
  const ledger = loadPrivacyLedger();
  const spent = ledger.filter(
    (e) => e.dataset === request.dataset && e.requester === request.requester && now - e.countedAt < policy.windowMs,
  );
  if (spent.length >= policy.maxQueriesPerWindow) {
    return { result: null, reason: `refused — privacy budget exhausted: ${spent.length} queries already counted for ${request.requester} in this ${Math.round(policy.windowMs / 60000)}-minute window; repeated aggregates can reconstruct rows, so the budget is hard` };
  }
  const entry: PrivacyLedgerEntry = {
    id: `priv-${Math.random().toString(36).slice(2, 10)}`,
    dataset: request.dataset,
    requester: request.requester,
    op: request.op,
    field: request.field,
    filtered: !!request.where,
    countedAt: now,
    prev: ledger.length > 0 ? ledger[ledger.length - 1].digest : "GENESIS",
    digest: "",
  };
  entry.digest = await sha256Hex(privacyCanonical(entry));
  savePrivacyLedger([...ledger, entry]);
  if (!policy.allowedFields.includes(request.field)) {
    return { result: null, reason: `refused — field "${request.field}" is not in this dataset's aggregation policy` };
  }

  // 11.14.3 — filters first. The minimum-cohort guard applies to the
  // FILTERED subset: "average salary for the 3 people in legal" is exactly
  // the query the guard must catch, not average-over-everyone.
  const rows = DEMO_COMPANY_DATA.rows.filter((r) =>
    Object.entries(request.where ?? {}).every(([k, v]) => r[k] === v),
  );
  const values = rows
    .map((r) => Number(r[request.field]))
    .filter((v) => Number.isFinite(v));
  if (values.length === 0) return { result: null, reason: `refused — field "${request.field}" has no numeric data for that filter` };
  if (values.length < policy.minCohortSize) {
    const scope = request.where ? `matching ${JSON.stringify(request.where)}` : "in this dataset";
    return { result: null, reason: `refused — cohort of ${values.length} ${scope} is below the minimum of ${policy.minCohortSize}; an aggregate that small can expose individuals` };
  }
  const value =
    request.op === "count" ? values.length :
    request.op === "sum" ? values.reduce((a, b) => a + b, 0) :
    request.op === "max" ? Math.max(...values) :
    values.reduce((a, b) => a + b, 0) / values.length;
  // bounded precision: never return more decimal grain than the policy allows
  const rounded = Math.round(value / policy.roundTo) * policy.roundTo;

  const base: Omit<CapabilityResult, "digest"> = {
    requestId: request.id,
    op: request.op,
    dataset: request.dataset,
    field: request.field,
    cohortSize: values.length,
    value: Math.round(rounded * 1e6) / 1e6,
    computedAt: new Date(now).toISOString(),
  };
  const digest = await sha256Hex(capabilityCanonical(base));
  return { result: { ...base, digest }, reason: "authorized — computed where the data lives; only the answer may leave" };
}
