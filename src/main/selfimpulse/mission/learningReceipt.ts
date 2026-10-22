/**
 * VH 11.11 SELF-EVOLVING — learning receipts.
 *
 * VH's differentiator applied to self-improvement: the organization does not
 * merely learn, it signs for what it learned. A learning receipt freezes the
 * lessons a mission produced (text, kind, evidence) plus any strategy-version
 * change, digests them with SHA-256 over key-sorted JSON, and carries the
 * issuer's Ed25519 signature when the runtime supports it — otherwise a
 * written signatureNote, never a silent fake. Anyone can re-canonicalize and
 * re-verify with zero VH state.
 */
import { signHexDigest, verifyIssuerSignature, signingSupported } from "./signing";
import type { IssuerSignature } from "./signing";

export interface LearningReceiptLesson {
  id: string;
  kind: string;
  text: string;
  evidence: string[];
}

export interface LearningReceipt {
  format: "si-learning-receipt/1";
  id: string;
  mjVersion: string;
  at: string;
  missionId: string;
  lessons: LearningReceiptLesson[];
  strategyChange: string | null;
  evidenceDigest: string;
  signature?: IssuerSignature;
  signatureNote?: string;
}

export const LEARNING_RECEIPT_CAP = 50;
const LS_KEY = "vh.learningReceipts.v1";

export function canonicalDigestInput(r: {
  missionId: string;
  lessons: LearningReceiptLesson[];
  strategyChange: string | null;
}): string {
  return JSON.stringify({
    lessons: r.lessons
      .map((l) => ({ evidence: [...l.evidence].sort(), id: l.id, kind: l.kind, text: l.text }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    missionId: r.missionId,
    strategyChange: r.strategyChange,
  }, (_k, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.keys(v as Record<string, unknown>).sort()
        .reduce<Record<string, unknown>>((a, k) => { a[k] = (v as Record<string, unknown>)[k]; return a; }, {});
    }
    return v;
  });
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let seq = 0;

export async function issueLearningReceipt(args: {
  mjVersion: string;
  missionId: string;
  lessons: LearningReceiptLesson[];
  strategyChange: string | null;
  now?: number;
}): Promise<LearningReceipt> {
  const now = args.now ?? Date.now();
  seq += 1;
  const digest = await sha256Hex(canonicalDigestInput(args));
  const receipt: LearningReceipt = {
    format: "si-learning-receipt/1",
    id: `learn-${now.toString(36)}-${seq}`,
    mjVersion: args.mjVersion,
    at: new Date(now).toISOString(),
    missionId: args.missionId,
    lessons: args.lessons,
    strategyChange: args.strategyChange,
    evidenceDigest: digest,
  };
  if (signingSupported()) {
    const sig = await signHexDigest(digest);
    if (sig) receipt.signature = sig;
    else receipt.signatureNote = "Ed25519 unavailable in this runtime; receipt unsigned.";
  } else {
    receipt.signatureNote = "Ed25519 unavailable in this runtime; receipt unsigned.";
  }
  return receipt;
}

export async function verifyLearningReceipt(r: LearningReceipt): Promise<{ ok: boolean; reason?: string }> {
  const recomputed = await sha256Hex(canonicalDigestInput(r));
  if (recomputed !== r.evidenceDigest) return { ok: false, reason: "digest mismatch — lessons were altered" };
  if (r.signature) {
    const good = await verifyIssuerSignature(r.evidenceDigest, r.signature.sigHex, r.signature.publicKeyHex);
    if (!good) return { ok: false, reason: "signature does not verify" };
  }
  return { ok: true };
}

export function loadLearningReceipts(): LearningReceipt[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as LearningReceipt[];
      if (Array.isArray(p)) return p;
    }
  } catch { /* storage unavailable */ }
  return [];
}

export function saveLearningReceipts(list: LearningReceipt[]): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list.slice(-LEARNING_RECEIPT_CAP))); } catch { /* ignore */ }
}
