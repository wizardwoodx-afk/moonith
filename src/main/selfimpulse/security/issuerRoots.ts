/**
 * §ISSUER ROOTS — the single source of truth for the product's Ed25519 issuer
 * signing roots and how a `keyId` maps back to the root that produced it.
 *
 * WHY THIS EXISTS
 * The product ships TWO independent issuer signing roots for the same concept —
 * one minted by `src/mission/signing.ts` (the "mission" root) and one minted by
 * `src/selfimpulse/engine/signing.ts` (the "engine" root). Each generates and
 * persists its OWN key material under its OWN keychain reference, and each stamps
 * the receipts it signs with a `keyId` whose leading prefix declares which root
 * created it:
 *   - mission root  ->  keyId prefix "si-issuer-"
 *   - engine root   ->  keyId prefix "selfimpulse-issuer-"
 * Before this module the prefix was a string literal buried inside each signing
 * module, so a verifier could only GUESS which root a chain belonged to — and the
 * two `verifyIssuerSignature` implementations are byte-identical, so a verifier
 * that loaded the engine root would happily "verify" a chain actually signed under
 * the mission root against whatever public key the chain carried. That is the
 * silent-wrong-key failure: a receipt that verifies green while being attributed to
 * a root that never issued it.
 *
 * WHAT THIS FIXES
 * The keyId prefix becomes a declared, single-source fact (here, and only here).
 * Every signing module imports its prefix from this registry, and every verifier
 * resolves the ROOT from the keyId before trusting the embedded key. A chain signed
 * under root A is therefore REJECTED by a verifier scoped to root B rather than
 * accidentally passing.
 *
 * WHAT THIS DOES NOT DO
 * It does NOT merge the two roots into one key. Both roots have LIVE signers (see
 * `signers` below and the pinned probe), so collapsing either would invalidate
 * every receipt already issued under the dropped root — a receipt that no longer
 * verifies is worse than a messy but honest system. Instead each verifier resolves
 * the root its chain was ACTUALLY signed under.
 *
 * Node-import-safe and dependency-free: this is pure string logic over the keyId
 * prefix. It imports nothing, so neither signing module's tree becomes coupled to
 * the other through it, and it can never create an import cycle.
 */

/** The two issuer signing roots the product holds. */
export type IssuerRootId = "mission" | "engine";

export interface IssuerRootDescriptor {
  /** Machine-readable root id. */
  readonly id: IssuerRootId;
  /** The declared, single-source keyId prefix for this root. A keyId is attributable
   *  to exactly this root when it starts with this prefix. */
  readonly keyIdPrefix: string;
  /** Human-readable label for evidence surfaces. */
  readonly label: string;
  /** Source modules that SIGN under this root — the live-signer evidence. */
  readonly signers: readonly string[];
}

/** The mission root — minted by `src/mission/signing.ts` (keychain ref "vh.issuerkey.v1"). */
export const MISSION_ISSUER_ROOT: IssuerRootDescriptor = {
  id: "mission",
  keyIdPrefix: "si-issuer-",
  label: "Mission-loop issuer root (src/mission/signing.ts)",
  signers: [
    "src/mission/receipts.ts",
    "src/mission/missionRecord.ts",
    "src/mission/custody.ts",
    "src/mission/actionPacket.ts",
    "src/mission/learningReceipt.ts",
    "src/mission/provenance.ts",
    "src/mission/mergeExecutor.ts",
    "src/mission/evidencePack.ts",
    "src/security/decisionReceipt.ts",
    "src/security/approvalEvidence.ts",
  ],
};

/** The engine root — minted by `src/selfimpulse/engine/signing.ts` (keychain ref "selfimpulse.issuerkey.v1"). */
export const ENGINE_ISSUER_ROOT: IssuerRootDescriptor = {
  id: "engine",
  keyIdPrefix: "selfimpulse-issuer-",
  label: "SelfImpulse engine issuer root (src/selfimpulse/engine/signing.ts)",
  signers: [
    "src/selfimpulse/engine/proof.ts",
    "src/selfimpulse/engine/genome.ts",
    "src/selfimpulse/engine/skillStore.ts",
    "src/mission/securityReview.ts",
  ],
};

/** Every root, in declaration order. */
export const ISSUER_ROOTS: readonly IssuerRootDescriptor[] = [MISSION_ISSUER_ROOT, ENGINE_ISSUER_ROOT];

/** The prefix a keyId must start with to be attributable to `id`. */
export function keyIdPrefixForRoot(id: IssuerRootId): string {
  return id === "mission" ? MISSION_ISSUER_ROOT.keyIdPrefix : ENGINE_ISSUER_ROOT.keyIdPrefix;
}

/**
 * Resolve which root a keyId declares. TOTAL over the space this product emits:
 * any keyId minted by either signing module resolves to exactly one root. Returns
 * `null` when the keyId declares no known root (unattributable) or when it is
 * ambiguous — both prefixes would have to match, which disjoint prefixes make
 * impossible, but the guard keeps a hand-forged double-prefix id from silently
 * resolving.
 */
export function rootForKeyId(keyId: string | null | undefined): IssuerRootId | null {
  if (typeof keyId !== "string") return null;
  let found: IssuerRootId | null = null;
  for (const root of ISSUER_ROOTS) {
    if (keyId.startsWith(root.keyIdPrefix)) {
      if (found !== null) return null; // ambiguous — refuse to guess
      found = root.id;
    }
  }
  return found;
}

/** The exact keyId this root stamps a given 64-hex public key into. */
export function keyIdForPublicKey(id: IssuerRootId, publicKeyHex: string): string {
  return `${keyIdPrefixForRoot(id)}${publicKeyHex.slice(0, 12)}`;
}

/**
 * True when `keyId` is BOTH attributable to a known root AND derived from exactly
 * this `publicKeyHex` (the root prefix + the first 12 hex chars of the key). This
 * binds the key material to its claimed root label so a chain cannot relabel a
 * foreign key as this root's key.
 */
export function isKeyIdConsistentWithPublicKey(keyId: string | null | undefined, publicKeyHex: string): boolean {
  const root = rootForKeyId(keyId);
  if (root === null || typeof keyId !== "string") return false;
  return keyId === keyIdForPublicKey(root, publicKeyHex);
}

/** True when `keyId` resolves to exactly `expectedId` — the verifier's root gate. */
export function isKeyIdAttributableToRoot(keyId: string | null | undefined, expectedId: IssuerRootId): boolean {
  return rootForKeyId(keyId) === expectedId;
}
