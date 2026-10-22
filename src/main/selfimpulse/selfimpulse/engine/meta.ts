/**
 * M6 — the gated, reversible meta-loop (16.3.0).
 *
 * The meta-loop is the product proposing changes to its OWN control plane:
 *
 *   PROPOSE ──► SIMULATE ──► HUMAN GATE ──► APPLY ──► SELFIMPULSE (receipt)
 *                                   │
 *                                   └──► DENY ──► SELFIMPULSE (nothing changed)
 *
 * and, equally first-class:
 *
 *   REVERT ──► HUMAN GATE ──► RESTORE ──► SELFIMPULSE (its own receipt)
 *
 * Why this is the last and most sensitive milestone of the roadmap:
 * a self-improving agent that can edit its own governance rules is either
 * a loop or a feature, depending on whether EVERY edit is (a) proposed in
 * words, (b) dry-run simulated, (c) human-gated, (d) receipt-attested, and
 * (e) reversible. M6 is all five, pinned by probe/metaLoop.
 *
 * The targets (deliberately small and honest):
 *   - risk.tier        — move a capability from safe → risky, i.e. TIGHTEN
 *                        the gate. The meta-loop may never LOOSEN: a
 *                        risky→safe demotion is refused in words. Loosening
 *                        happens only by reverting a change that tightened
 *                        (and the revert is itself gated + attested).
 *   - preference.set   — add a standing preference (applied by RECALL to
 *                        future runs); revert removes it.
 *
 * What it deliberately does NOT touch: the receipt protocol, the gate
 * primitive itself, the brain, the code. Those are changed by humans
 * writing code, with git — not by the product at runtime.
 *
 * Non-blocking like M3: proposals return a pending handle immediately;
 * the human decides from the SelfImpulse face's gate or via MCP
 * (approve_action / deny_action); `meta_status` reports the change.
 */
import {
  RISKY_TOOLS,
  SELFIMPULSE_TOOLS,
  requestSelfImpulseApproval,
  selfimpulseSession,
  appendSelfImpulseReceiptRef,
  addSelfImpulsePreference,
  removeSelfImpulsePreference,
  type SelfImpulseReceiptRef,
} from "./selfimpulse";
import { redeemCapability, verifyCapability } from "../../security/capability";
import { buildChainedReceipt, type ProofReceipt } from "./proof";
import { ENGINE_VERSION } from "../../version";

/* ── the record ─────────────────────────────────────────────────────────── */
export type MetaKind = "risk.tier" | "preference.set";
export type MetaStatus = "refused" | "denied" | "proposed" | "applied" | "reverted";

export interface MetaChange {
  id: string; // mc<ts><rand>
  /** MetaKind for real entries; a raw label when a refusal has no valid kind */
  kind: string;
  target: string; // tool name (risk.tier) or the preference text
  reason: string; // why the product is proposing this, in words
  from: string; // human-readable before-state
  to: string; // human-readable after-state (if applied)
  status: MetaStatus;
  createdAt: string;
  decidedAt: string | null; // when the human decided (null until then)
  decision: "approved" | "denied" | null;
  /** receipt of the decision for THIS change (applied / denied / refused) */
  receiptId: string | null;
  /** set on revert entries: the change this entry reverts */
  revertOf: string | null;
  /** set on the ORIGINAL change when its revert is applied */
  revertedAt: string | null;
  revertReceiptId: string | null;
}

/* ── the store (node-safe: in-memory fallback, same discipline as selfimpulse) ── */
const HAS_LS = typeof localStorage !== "undefined" && localStorage !== null;
const META_KEY = "selfimpulse.meta.changes.v1";
const CAP = 50;

function loadChanges(): MetaChange[] {
  if (!HAS_LS) return [];
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as MetaChange[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
let changes: MetaChange[] = loadChanges();

const metaListeners = new Set<() => void>();

/** M6 — UI subscription (same pattern as the selfimpulse session store). */
export function subscribeMeta(fn: () => void): () => void {
  metaListeners.add(fn);
  return () => {
    metaListeners.delete(fn);
  };
}

function persist(): void {
  if (HAS_LS) {
    try {
      localStorage.setItem(META_KEY, JSON.stringify(changes.slice(-CAP)));
    } catch {
      /* a full/unavailable store must never break the loop; in-memory holds */
    }
  }
  metaListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a broken listener must never break the loop */
    }
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

/* ── the public read surface ────────────────────────────────────────────── */
export function metaChanges(): MetaChange[] {
  return [...changes];
}
export function metaChange(id: string): MetaChange | null {
  return changes.find((c) => c.id === id) ?? null;
}
/** The current gate surface — who is gated right now (live, after applies). */
export function currentGatedTools(): string[] {
  return [...RISKY_TOOLS].sort();
}

/* ── receipts: every decision is attested ────────────────────────────────── */
interface MetaReceiptEvents {
  origin: "meta";
  changeId: string;
  verdict: "applied" | "denied" | "refused" | "reverted";
  detail: Record<string, unknown>;
  simulation: { prediction: string; sideEffects: string[]; warnings: string[] };
}

async function mintMetaReceipt(ev: MetaReceiptEvents): Promise<SelfImpulseReceiptRef | null> {
  try {
    const startedAt = ev.detail.createdAt as string;
    const finishedAt = nowIso();
    const events = [
      { kind: "selfimpulse.session", seatId: "selfimpulse-core", data: { origin: "meta", tool: `meta.${ev.changeId}`, args: { ...ev.detail } } },
      { kind: "selfimpulse.simulation", seatId: "selfimpulse-core", data: { prediction: ev.simulation.prediction, sideEffects: ev.simulation.sideEffects, warnings: ev.simulation.warnings, confidence: 1 } },
      { kind: "selfimpulse.meta", seatId: "selfimpulse-core", data: { changeId: ev.changeId, ...ev.detail, decision: ev.verdict } },
      { kind: "selfimpulse.verdict", seatId: "selfimpulse-core", data: { status: ev.verdict, actions: 1, origin: "meta", changeId: ev.changeId } },
    ];
    const receipt: ProofReceipt = await buildChainedReceipt({
      mission: `selfimpulse:meta:${ev.changeId}`,
      teamId: "selfimpulse",
      startedAt,
      finishedAt,
      version: ENGINE_VERSION,
      edition: "personal",
      events,
    });
    const head = receipt.events.length > 0 ? receipt.events[receipt.events.length - 1].hash : "";
    const ref: SelfImpulseReceiptRef = {
      id: `r${Date.now()}${Math.random().toString(36).slice(2, 4)}`,
      mission: receipt.header.mission,
      threadTitle: `meta change: ${ev.detail.kind ?? ""} ${ev.detail.target ?? ""}`,
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
    appendSelfImpulseReceiptRef(ref);
    return ref;
  } catch (e) {
    if (process.env.SI_MINT_DEBUG) console.error("[mintMetaReceipt] failed:", e);
    return null;
  }
}

/* ── validation + the tightening-only rule ───────────────────────────────── */
interface MetaProposal {
  ok: boolean;
  refusal?: string;
  kind: MetaKind;
  target: string;
  from: string;
  to: string;
  simulation: { prediction: string; sideEffects: string[]; warnings: string[] };
}

function validateProposal(kindRaw: string, targetRaw: string, reasonRaw: string, isRevert: boolean): MetaProposal {
  const kind = kindRaw as MetaKind;
  const target = String(targetRaw ?? "").trim();
  const reason = String(reasonRaw ?? "").trim();
  const base: MetaProposal = { ok: false, kind, target, from: "", to: "", simulation: { prediction: "", sideEffects: [], warnings: [] } };
  if (kind !== "risk.tier" && kind !== "preference.set") {
    return { ...base, refusal: `unknown meta kind "${kind}" — known kinds: risk.tier, preference.set. Refused, nothing proposed.` };
  }
  if (reason.length === 0) {
    return { ...base, refusal: "a meta proposal needs a reason — the human gate decides on words. Refused, nothing proposed." };
  }
  if (kind === "risk.tier") {
    /* OWN-PROPERTY LOOKUP, NOT A MEMBER LOOKUP. `SELFIMPULSE_TOOLS` is a
     * plain object, so `SELFIMPULSE_TOOLS["constructor"]` is `Object` — not
     * undefined — and the "unknown tool" check passed for names that are not
     * tools at all. The meta-loop may only re-tier REAL capabilities: a
     * phantom entry would put a name that will never be called into the
     * gate set, and record a change to a capability that does not exist. */
    if (!Object.prototype.hasOwnProperty.call(SELFIMPULSE_TOOLS, target)) {
      return { ...base, refusal: `unknown tool "${target}" — the meta-loop may only re-tier real capabilities. Refused, nothing proposed.` };
    }
    const isRisky = RISKY_TOOLS.has(target);
    if (!isRevert) {
      if (isRisky) {
        return { ...base, refusal: `"${target}" is already at the maximum gate (risky) — there is nothing to tighten. Refused, nothing proposed.` };
      }
      /* THE TIGHTENING-ONLY RULE — the meta-loop may add gates, never remove them. */
    } else {
      if (!isRisky) {
        return { ...base, refusal: `"${target}" is not currently gated — there is no tightening to revert. Refused, nothing proposed.` };
      }
    }
    const from = isRisky ? "risky (pauses at the human gate)" : "safe (runs freely)";
    const to = isRevert ? "safe (runs freely)" : "risky (pauses at the human gate)";
    const prediction = isRevert
      ? `Reverts the tightening of "${target}": it will run freely again (itself gated — this revert must be approved).`
      : `Tightens the gate on "${target}": every future call to it will SIMULATE first and pause at the HUMAN GATE before executing.`;
    return {
      ok: true,
      kind,
      target,
      from,
      to,
      simulation: {
        prediction,
        sideEffects: [isRevert ? `risk.tier(${target}) restored to safe` : `risk.tier(${target}) moved to risky`],
        warnings: isRevert ? ["this LOOSENS the gate — it is itself human-gated and attested"] : ["future calls to this tool will pause for approval"],
      },
    };
  }
  /* preference.set */
  if (target.length === 0) {
    return { ...base, refusal: "preference.set needs the preference text. Refused, nothing proposed." };
  }
  if (isRevert) {
    const exists = selfimpulseSession().preferences.some((x) => x.text === target);
    if (!exists) {
      return { ...base, refusal: `no standing preference "${target}" to remove — nothing to revert. Refused, nothing proposed.` };
    }
    return {
      ok: true,
      kind,
      target,
      from: `preference: "${target}"`,
      to: "(no such preference)",
      simulation: {
        prediction: `Reverts the preference: "${target}" is removed from RECALL — future runs no longer apply it (itself gated — this revert must be approved).`,
        sideEffects: [`preference removed: "${target}"`],
        warnings: ["this removes a standing preference from future runs"],
      },
    };
  }
  const prediction = `Adds a standing preference — RECALL will apply it to future runs until it is reverted or deleted:`;
  return {
    ok: true,
    kind,
    target,
    from: `(no such preference)`,
    to: `preference: "${target}"`,
    simulation: {
      prediction: `${prediction} "${target}"`,
      sideEffects: [`preference added: "${target}"`],
      warnings: ["the preference shapes future runs and is visible + deletable in the product"],
    },
  };
}

/* ── apply / restore (the only mutations this module performs) ──────────── */
function applyChange(c: MetaChange): void {
  if (c.kind === "risk.tier") {
    if (c.revertOf !== null) RISKY_TOOLS.delete(c.target);
    else RISKY_TOOLS.add(c.target);
  } else if (c.kind === "preference.set") {
    if (c.revertOf !== null) {
      /* find the preference by its text (revert entries carry the text as target) */
      const pref = selfimpulseSession().preferences.find((x) => x.text === c.target);
      if (pref) removeSelfImpulsePreference(pref.id);
    } else {
      /* THE STORED TEXT, NOT THE PROPOSED TEXT. The preference is sanitized
       * and capped on the way in, so the text that was proposed and the text
       * that was stored can differ. Recording the proposed one would leave a
       * preference nobody can find by the text it was proposed with — and
       * therefore one the meta-loop can never revert. */
      const stored = addSelfImpulsePreference(c.target);
      if (stored.ok) c.target = stored.text;
    }
  }
}

/* ── the loop ───────────────────────────────────────────────────────────── */
export interface MetaResult {
  ok: boolean;
  pending: boolean;
  output: string;
  changeId: string | null;
  approvalId: string | null;
  receiptId: string | null;
}

/**
 * Propose a change to the control plane. Non-blocking: returns pending with
 * handles; the human decides (SelfImpulse face gate or MCP approve/deny); the
 * continuation applies + attests. Refusals are immediate and still attested.
 */
export async function proposeMetaChange(kind: string, target: string, reason: string): Promise<MetaResult> {
  return runMetaFlow(kind, target, reason, false);
}

/**
 * Revert an applied, non-revert change. The revert is ITSELF gated and
 * attested; reverts are terminal (a revert cannot be reverted — propose a
 * new change instead).
 */
export async function revertMetaChange(changeId: string): Promise<MetaResult> {
  const orig = metaChange(changeId);
  if (!orig) {
    return refuseImmediate("revert", changeId, `unknown meta change "${changeId}" — nothing to revert.`, reason0());
  }
  if (orig.status !== "applied") {
    return refuseImmediate(orig.kind, orig.target, `change ${changeId} is "${orig.status}", not "applied" — only applied changes can be reverted.`, orig.reason || "revert attempt");
  }
  if (orig.revertOf !== null) {
    return refuseImmediate(orig.kind, orig.target, `change ${changeId} IS a revert — reverts are terminal. To change course, propose a new change.`, orig.reason || "revert attempt");
  }
  if (orig.kind === "preference.set") {
    return runMetaFlow("preference.set", orig.target, `Revert of ${changeId} — remove the preference the human approved.`, true);
  }
  return runMetaFlow("risk.tier", orig.target, `Revert of ${changeId} — restore the previous gate tier the human is now explicitly approving.`, true);
}

function reason0(): string {
  return "revert attempt";
}

/** A refusal that never reaches the gate is still attested. */
async function refuseImmediate(kind: string, target: string, words: string, reason: string): Promise<MetaResult> {
  const c: MetaChange = {
    id: newId("mc"),
    kind,
    target,
    reason,
    from: "(unchanged)",
    to: "(unchanged)",
    status: "refused",
    createdAt: nowIso(),
    decidedAt: null,
    decision: null,
    receiptId: null,
    revertOf: null,
    revertedAt: null,
    revertReceiptId: null,
  };
  changes = [...changes.slice(-(CAP - 1)), c];
  persist();
  const ref = await mintMetaReceipt({
    origin: "meta",
    changeId: c.id,
    verdict: "refused",
    detail: { kind: c.kind, target: c.target, reason, refusal: words, createdAt: c.createdAt },
    simulation: { prediction: "no change — the proposal was refused before the gate", sideEffects: [], warnings: [] },
  });
  c.receiptId = ref?.id ?? null;
  persist();
  return { ok: false, pending: false, output: words, changeId: c.id, approvalId: null, receiptId: c.receiptId };
}

async function runMetaFlow(kind: string, targetRaw: string, reason: string, isRevert: boolean): Promise<MetaResult> {
  const v = validateProposal(kind, targetRaw, reason, isRevert);
  if (!v.ok) {
    return refuseImmediate(v.kind, v.target, v.refusal!, reason);
  }
  const c: MetaChange = {
    id: newId("mc"),
    kind: v.kind,
    target: v.target,
    reason,
    from: v.from,
    to: v.to,
    status: "proposed",
    createdAt: nowIso(),
    decidedAt: null,
    decision: null,
    receiptId: null,
    revertOf: null,
    revertedAt: null,
    revertReceiptId: null,
  };
  /* revert entries carry the id of the change they revert (threaded in the reason) */
  if (isRevert) {
    const m = reason.match(/^Revert of (mc[0-9a-z]+)/);
    c.revertOf = m ? m[1] : null;
  }
  changes = [...changes.slice(-(CAP - 1)), c];
  persist();

  /* the HUMAN GATE — same primitive as every risky action in the product */
  const label = isRevert ? `meta.revert:${c.kind}` : `meta.propose:${c.kind}`;
  const detail = `${isRevert ? "REVERT" : "PROPOSE"} meta change ${c.id} (${c.kind} on "${c.target}")\nBEFORE: ${c.from}\nAFTER: ${c.to}\nREASON: ${reason.slice(0, 200)}\nSIMULATION: ${v.simulation.prediction}${v.simulation.warnings.length > 0 ? `\nWARNINGS: ${v.simulation.warnings.join("; ")}` : ""}`;
  const approvalPromise = requestSelfImpulseApproval(label, detail);
  const approvalId = selfimpulseSession().approvals[selfimpulseSession().approvals.length - 1]?.id ?? null;

  void approvalPromise
    .then((g) => {
      /* The capability is redeemed for THIS change — one approval, one apply.
         The intent is stated: the capability must have been signed for this
         exact label and this exact change detail. */
      let approved = g.ok;
      if (g.ok && g.capability) {
        const intent = { action: label, resource: detail.slice(0, 200) };
        const gv = verifyCapability(g.capability, "si.runtime", { intent });
        const r = gv.ok ? redeemCapability(g.capability, "si.runtime", intent) : gv;
        approved = r.ok;
      }
      return settle(c, approved, v.simulation);
    })
    .catch((e) => {
      c.status = "denied";
      c.decidedAt = nowIso();
      c.decision = "denied";
      void mintMetaReceipt({
        origin: "meta",
        changeId: c.id,
        verdict: "denied",
        detail: { kind: c.kind, target: c.target, reason, error: e instanceof Error ? e.message : String(e), createdAt: c.createdAt },
        simulation: v.simulation,
      }).then((ref) => {
        c.receiptId = ref?.id ?? null;
        persist();
      }).catch(() => {
        persist();
      });
    });

  return {
    ok: false,
    pending: true,
    output: `Meta change ${c.id} (${c.kind} on "${c.target}") is PAUSED at the human gate (approval ${approvalId}). ${isRevert ? "This revert" : "This proposal"} changes how the product governs itself — approve or deny it (SelfImpulse face, or approve_action / deny_action over MCP), then poll meta_status "${c.id}".`,
    changeId: c.id,
    approvalId,
    receiptId: null,
  };
}

async function settle(c: MetaChange, approved: boolean, sim: { prediction: string; sideEffects: string[]; warnings: string[] }): Promise<void> {
  c.decidedAt = nowIso();
  if (!approved) {
    /* The denial is published after its receipt, for the same reason the
     * approval is: a reader must never see a settled change without the
     * attestation that settled it. */
    const ref = await mintMetaReceipt({
      origin: "meta",
      changeId: c.id,
      verdict: "denied",
      detail: { kind: c.kind, target: c.target, reason: c.reason, decision: "denied", createdAt: c.createdAt },
      simulation: sim,
    });
    c.receiptId = ref?.id ?? null;
    c.status = "denied";
    c.decision = "denied";
    persist();
    return;
  }
  /* APPROVED — apply, then selfimpulse. The status turns visible only after
     its receipt is minted and attached: one persist, so no poller — and no
     crash-restart — ever observes an applied control change without its
     attestation. A crash after applyChange() but before the mint loses an
     in-memory application; the control plane stays un-changed on disk, which
     is the fail-closed direction for a governance tightening.
   *
     The IN-MEMORY status is set after the mint too, and that is the half
     that was missing. The persisted status was always published after the
     receipt, so a poller reading the store never saw an applied change
     without its attestation — but a poller reading the in-memory entry (which
     is what a same-process caller does, and what the M6 probe does) could
     see "applied" in the window between the two statements, and read a
     receipt id that had not been minted yet. The window is as wide as the
     mint, so it is a race whose outcome depends on how busy the machine is:
     a change that attested on a quiet desk could read as unattested on a
     loaded one. The status now moves when the attestation is attached, so
     both readers see the same thing. */
  applyChange(c);
  const ref = await mintMetaReceipt({
    origin: "meta",
    changeId: c.id,
    verdict: c.revertOf !== null ? "reverted" : "applied",
    detail: { kind: c.kind, target: c.target, reason: c.reason, from: c.from, to: c.to, decision: "approved", revertOf: c.revertOf, createdAt: c.createdAt },
    simulation: sim,
  });
  c.receiptId = ref?.id ?? null;
  c.status = "applied";
  c.decision = "approved";
  if (c.revertOf !== null) {
    const orig = metaChange(c.revertOf);
    if (orig) {
      orig.status = "reverted";
      orig.revertedAt = nowIso();
      orig.revertReceiptId = ref?.id ?? null;
    }
  }
  persist();
}

export { ENGINE_VERSION as META_ENGINE_VERSION };
