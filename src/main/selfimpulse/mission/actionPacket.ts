/**
 * VH 11.12 MOSAIC-Ω alignment — proof-carrying actions.
 *
 * Every meaningful run travels with a signed Action Packet stating intent, the
 * world-belief it rests on, the plan step, the prediction, the risk, the
 * permission, the rollback and the verification condition — BEFORE anything
 * executes. The receipt pipeline already proves outcomes; 11.12 proves
 * intentions the same way (SHA-256 canonical digest + Ed25519 where available).
 *
 * 11.12.1 — the execution boundary is now fully cryptographic: the executor
 * FIRST verifies digest + signature (verifyActionPacket), THEN checks the
 * permission rule (packetAllowsExecution), THEN executes. The runtime proves
 * "this exact signed packet says this action is allowed", not merely "the
 * packet says so".
 *
 * The mechanical execution rule:
 *   - packet fails integrity/signature → abort, nothing runs;
 *   - permission "refused"             → abort;
 *   - irreversible without "allowed"   → abort;
 *   - otherwise the run proceeds and the report carries the packet digest and
 *     the verified flag so settlement and receipts bind outcome to intention.
 *
 * Predictions inside a packet are explicitly NOT evidence: they are displayed
 * and digested, but no verifier, lesson, or arm score may consume them as
 * measured fact (pinned by probe/mosaicAlign.test.ts).
 */
import { sha256Hex } from "./learningReceipt";
import { signHexDigest, verifyIssuerSignature, signingSupported } from "./signing";

export interface ActionPacket {
  format: "si-action-packet/1";
  id: string;
  mjVersion: string;
  issuedAt: string;
  intent: string;
  /** canonical digest of the belief store the action rests on */
  beliefDigest: string;
  planStep: string;
  /** what should happen — a prediction, NEVER evidence */
  prediction: string;
  risk: string;
  permission: "allowed" | "requires-human" | "refused";
  /** how to undo it; null = irreversible */
  rollback: string | null;
  /** how we will know it worked (the pre-declared verification condition) */
  verification: string;
  reversible: boolean;
  digest: string;
  signature?: { sigHex: string; publicKeyHex: string };
  signatureNote?: string;
}

export function canonicalPacketInput(p: Omit<ActionPacket, "digest" | "signature" | "signatureNote">): string {
  return JSON.stringify([
    p.format, p.id, p.mjVersion, p.issuedAt, p.intent, p.beliefDigest, p.planStep,
    p.prediction, p.risk, p.permission, p.rollback, p.verification, p.reversible,
  ]);
}

let seq = 0;

export async function issueActionPacket(args: {
  mjVersion: string;
  intent: string;
  beliefDigest: string;
  planStep: string;
  prediction: string;
  risk: string;
  permission: "allowed" | "requires-human" | "refused";
  rollback: string | null;
  verification: string;
  reversible: boolean;
  now?: number;
}): Promise<ActionPacket> {
  const now = args.now ?? Date.now();
  seq += 1;
  const base = {
    format: "si-action-packet/1" as const,
    id: `packet-${now.toString(36)}-${seq}`,
    mjVersion: args.mjVersion,
    issuedAt: new Date(now).toISOString(),
    intent: args.intent,
    beliefDigest: args.beliefDigest,
    planStep: args.planStep,
    prediction: args.prediction,
    risk: args.risk,
    permission: args.permission,
    rollback: args.rollback,
    verification: args.verification,
    reversible: args.reversible,
  };
  const digest = await sha256Hex(canonicalPacketInput(base));
  const packet: ActionPacket = { ...base, digest };
  if (signingSupported()) {
    const sig = await signHexDigest(digest);
    if (sig) packet.signature = sig;
    else packet.signatureNote = "Ed25519 unavailable in this runtime; packet unsigned.";
  } else {
    packet.signatureNote = "Ed25519 unavailable in this runtime; packet unsigned.";
  }
  return packet;
}

export async function verifyActionPacket(p: ActionPacket): Promise<{ ok: boolean; reason?: string }> {
  const { digest, signature, signatureNote, ...rest } = p;
  void signatureNote;
  const recomputed = await sha256Hex(canonicalPacketInput(rest));
  if (recomputed !== digest) return { ok: false, reason: "digest mismatch — packet was altered" };
  if (p.signature) {
    const good = await verifyIssuerSignature(digest, p.signature.sigHex, p.signature.publicKeyHex);
    if (!good) return { ok: false, reason: "signature does not verify" };
  }
  return { ok: true };
}

/** The mechanical permission rule (run AFTER cryptographic verification). */
export function packetAllowsExecution(p: ActionPacket | null | undefined): { ok: boolean; reason: string } {
  if (!p) return { ok: true, reason: "no packet — run proceeds under gate policy alone (pre-11.12 caller)" };
  if (p.permission === "refused") return { ok: false, reason: `action packet ${p.id} is refused: ${p.risk}` };
  if (!p.reversible && p.permission !== "allowed") {
    return { ok: false, reason: `irreversible action requires explicit "allowed" permission; packet ${p.id} says "${p.permission}"` };
  }
  return { ok: true, reason: `packet ${p.id} permits execution (${p.permission}${p.reversible ? ", reversible" : ", irreversible+allowed"})` };
}
