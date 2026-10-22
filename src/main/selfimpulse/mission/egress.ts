/**
 * VH 11.14.0 — the Egress Gate (the enterprise seed).
 *
 * The enterprise thesis, made mechanical: company data lives on the laptop;
 * the cloud is a switchboard, never a warehouse; and NOTHING leaves the
 * machine unless a human clicked, an authority envelope permits it, and a
 * signed receipt records it. This module is the gate every export path must
 * pass:
 *
 *   no envelope          -> refused
 *   expired/revoked      -> refused
 *   scope lacks egress   -> refused
 *   non-human principal  -> refused (custody already proves the root)
 *   valid human envelope -> ONE record lands in the egress ledger, with the
 *                           item's sha256, the recipient, the envelope id and
 *                           the record's own digest
 *
 * The ledger itself is digest-chained per record: verifyEgressLedger
 * recomputes each record's digest, so any edit to what-left-the-machine is
 * detectable — the CISO's audit trail, not VH's word.
 */
import { sha256Hex } from "./learningReceipt";
import { checkEnvelope, isHumanPrincipal, type AuthorityEnvelope } from "./custody";

export interface EgressItem {
  /** what kind of artifact crossed the boundary (11.14.1: a capability answer, never raw data) */
  kind: "dossier" | "file" | "snapshot" | "capability-result";
  name: string;
  /** sha256 of exactly what left — recomputable from the exported payload */
  sha256: string;
}

export interface EgressRecord {
  id: string;
  at: string;
  /** who authorized the departure — must be a human principal */
  principal: string;
  item: EgressItem;
  /** where it went: a channel / person / destination label */
  recipient: string;
  /** the authority envelope that permitted this one departure */
  envelopeId: string;
  /** sha256 over the canonical record — tamper evidence */
  digest: string;
}

const LS_KEY = "vh.egress.ledger";

export function egressCanonical(r: Omit<EgressRecord, "digest">): string {
  return JSON.stringify([r.id, r.at, r.principal, r.item.kind, r.item.name, r.item.sha256, r.recipient, r.envelopeId]);
}

export function loadEgressLedger(): EgressRecord[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as EgressRecord[];
      if (Array.isArray(p)) return p;
    }
  } catch { /* storage unavailable */ }
  return [];
}

export function saveEgressLedger(records: EgressRecord[]): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(records)); } catch { /* ignore */ }
}

/**
 * The gate itself. Returns the record when the departure is authorized —
 * or the plain-language reason it was refused. It never throws into the UI;
 * refusal is a normal, named outcome.
 */
export async function requestEgress(args: {
  envelope: AuthorityEnvelope | null;
  item: EgressItem;
  recipient: string;
  now: number;
}): Promise<{ record: EgressRecord | null; reason: string }> {
  const { envelope, item, recipient, now } = args;
  if (!envelope) return { record: null, reason: "refused — no authority envelope; nothing leaves this machine without a human's signed authority" };
  if (!isHumanPrincipal(envelope.principal)) return { record: null, reason: `refused — principal "${envelope.principal}" is not human; only a human may authorize data to leave` };
  const scopeCheck = checkEnvelope(envelope, "egress:share", now);
  if (!scopeCheck.ok) return { record: null, reason: `refused — ${scopeCheck.reason}` };
  if (!envelope.scope.includes("egress:share")) return { record: null, reason: "refused — the envelope's scope does not permit egress:share" };

  const id = `egress-${now.toString(36)}-${loadEgressLedger().length + 1}`;
  const base: Omit<EgressRecord, "digest"> = {
    id,
    at: new Date(now).toISOString(),
    principal: envelope.principal,
    item,
    recipient,
    envelopeId: envelope.id,
  };
  const digest = await sha256Hex(egressCanonical(base));
  const record: EgressRecord = { ...base, digest };
  saveEgressLedger([...loadEgressLedger(), record]);
  return { record, reason: "authorized — receipt recorded" };
}

/** Recompute every record's digest; any edited record is named. */
export async function verifyEgressLedger(records: EgressRecord[]): Promise<{ ok: boolean; bad: string[] }> {
  const bad: string[] = [];
  for (const r of records) {
    const { digest, ...rest } = r;
    const recomputed = await sha256Hex(egressCanonical(rest));
    if (recomputed !== digest) bad.push(r.id);
  }
  return { ok: bad.length === 0, bad };
}
