/**
 * §SOVEREIGN AUTHORITY — signed mandates, not configuration.
 *
 * v1.1.0's review found the honest gap: the runtime derived a seat's
 * AuthorityEnvelope straight from `node.config`, which quietly said "this
 * node's configuration IS its authority." The architecture this product
 * claims is the other thing:
 *
 *     node.config                → a REQUESTED operating profile
 *     the owner's authority      → a SIGNED mandate over that profile
 *     the verified mandate       → the AuthorityEnvelope the seat runs under
 *
 * Nothing here invents a new trust primitive. It composes the ones the
 * product already ships: the mandate shape from `authorityCore.ts`, the
 * stable canonicalisation from `actionGraph.ts`, and the envelope vocabulary
 * the governed loop already speaks. The signature is Ed25519 (the same
 * asymmetric family as the receipt fabric), generated in memory for the
 * session — the same "keys live in memory" promise the provider vault makes.
 *
 * THE THREE LAWS THIS FILE ENFORCES
 *  1. NO MANDATE, NO AUTHORITY. A profile without a signature issues no
 *     envelope. `config alone issues nothing` is the probe that pins it.
 *  2. THE MANDATE BINDS THE PROFILE. A mandate is issued over a digest of
 *     the requested profile. If the config changes mid-run, the mandate no
 *     longer verifies and `read()` returns null — the governed loop then
 *     fail-closes, and `detectDrift` finally sees a live `current` envelope
 *     instead of comparing an object to itself.
 *  3. THE HUMAN PRINCIPAL IS NAMED. Every mandate carries the owner it was
 *     issued for; an anonymous authority is not an authority.
 */
import { createHash, generateKeyPairSync, sign as edSign, verify as edVerify } from "node:crypto";
import { stableStringify, type AuthorityEnvelope, type RiskClass } from "./actionGraph";
import { mandateCanonical as coreMandateCanonical, type Mandate as CoreMandate } from "../engine/authorityCore";

/* ── 0 · the working root, resolved ONCE and safely ───────────────────────
 *
 * 19.7.14 — THE BLANK-UI FIX. This file used a BARE `process.cwd()`, with no
 * import, in two places — one of them a module-level `const`. That is fine
 * under Node and fatal in the WebView: `process` is a Node global, so in a
 * browser the identifier does not exist and evaluating `process.cwd()` raises
 * `ReferenceError: process is not defined`. Because the throw happened at
 * MODULE TOP LEVEL, it happened while the import graph was still being
 * evaluated — before `main.tsx` ever reached `createRoot(...).render(...)`.
 * The whole shell therefore never mounted and the app was a blank page with an
 * empty `#root`, with the real cause visible only as one console line.
 *
 * The `node:process` alias in vite.config.ts could never have saved this: it
 * rewrites the SPECIFIER `node:process`, and a bare global is not an import.
 * This is the same seam as `sandbox.ts` / `a2a.ts` / `brainSeam.ts`, which all
 * read `typeof process !== "undefined"` before touching it.
 *
 * `"/"` is the browser answer, and it is chosen, not defaulted: an envelope
 * whose `root` is empty is rejected outright by `actionGraph.ts` ("no root, no
 * authority"), so a `""` fallback would not degrade gracefully — it would
 * manufacture an invalid envelope and fail the check for the wrong reason. It
 * also matches `src/browser/nodeStubs/process.ts`, which answers `cwd()` with
 * exactly this value, so the browser build states one root rather than two.
 *
 * It is a CONSERVATIVE answer, which is the direction that matters: `"/"` is a
 * sentinel, and `allowWrite`/`allowShell` are false in every envelope derived
 * from it, so nothing is ever authorised against it.
 */
function workingRoot(): string {
  try {
    if (typeof process !== "undefined" && typeof process.cwd === "function") {
      const cwd = process.cwd();
      if (typeof cwd === "string" && cwd.length > 0) return cwd;
    }
  } catch { /* no process, or cwd refused — fall through to the sentinel */ }
  return "/";
}

/* ── 1 · the requested profile (what a node ASKS for) ──────────────────── */

export interface RequestedProfile {
  agentId: string;
  owner: string;
  allowWrite: boolean;
  allowShell: boolean;
  allowNetwork: boolean;
  root: string;
  budgetCeiling: number;
  maxRisk: RiskClass;
}

/** A minimal structural view of a node — the fields the profile reads.
 *  Declared locally so the sovereign layer imports nothing from the
 *  domain model (it must stay runtime-agnostic like authorityCore). */
export interface ProfileSource {
  id?: string;
  title?: string;
  config?: Record<string, unknown>;
}

/** The requested operating profile of a node, read from its configuration.
 *
 *  Absent fields resolve to the CONSERVATIVE value, exactly as the runtime
 *  always parsed them — the difference is what happens next: this is a
 *  REQUEST, and a request is not authority until it is signed. */
export function requestProfileOf(node: ProfileSource): RequestedProfile {
  const cfg = (node.config ?? {}) as Record<string, unknown>;
  const bool = (k: string, dflt: boolean): boolean => (typeof cfg[k] === "boolean" ? (cfg[k] as boolean) : dflt);
  const riskRaw = String(cfg.maxRisk ?? "low").toLowerCase();
  const maxRisk: RiskClass =
    riskRaw === "critical" || riskRaw === "high" || riskRaw === "medium" ? riskRaw : "low";
  return {
    agentId: String(node.id ?? node.title ?? "seat"),
    owner: String(cfg.owner ?? "owner"),
    allowWrite: bool("allowWrite", false),
    allowShell: bool("allowShell", false),
    allowNetwork: bool("allowNetwork", false),
    root: String(cfg.workspaceRoot ?? workingRoot()),
    budgetCeiling: Number(cfg.budgetCeiling ?? 0),
    maxRisk,
  };
}

/** Content digest of a profile — what a mandate is issued OVER. */
export function profileDigest(p: RequestedProfile): string {
  return createHash("sha256").update(`si.profile.v1\n${stableStringify(p)}`).digest("hex");
}

/** Whether a requested profile EFFECTS anything. Write, shell, network, or
 *  any risk above low — any one of them makes the profile effectful. This
 *  is the mandate-side twin of the capability registry's rule: under the
 *  bootstrap root, a read-only profile may be mandated, an effectful one
 *  may not. */
export function profileIsEffectful(p: RequestedProfile): boolean {
  return p.allowWrite || p.allowShell || p.allowNetwork || p.maxRisk !== "low";
}

/* ── 2 · the signed mandate ────────────────────────────────────────────── */

export const MANDATE_FORMAT = "si.mandate.v1";

export interface SovereignMandate {
  v: typeof MANDATE_FORMAT;
  agentId: string;
  owner: string;
  /** Digest of the exact profile this mandate was issued over. */
  profile: string;
  /** The envelope the owner approved — verbatim, so verification can
   *  compare what was signed with what is asked for. */
  env: AuthorityEnvelope;
  issuedAt: number;
  expiresAt: number;
  signature?: string;
}

export type MandateCheck =
  | { ok: true; mandate: SovereignMandate }
  | { ok: false; reason: "missing" | "expired" | "bad-signature" | "no-owner" | "profile-changed"; detail: string };

/** Deterministic mandate bytes. Field order is canonical, not incidental. */
export function mandateCanonical(m: Omit<SovereignMandate, "signature">): string {
  return stableStringify({
    v: m.v, agentId: m.agentId, owner: m.owner, profile: m.profile, env: m.env,
    issuedAt: m.issuedAt, expiresAt: m.expiresAt,
  });
}

/** The signing seam. Session keys live in memory; a hardware or vault-backed
 *  signer satisfies the same interface without this file changing. */
export interface Signer {
  /** key identity — a digest of the public key, named in every receipt. */
  readonly id: string;
  sign(data: string): string;
  verify(data: string, signature: string): boolean;
}

/** Ed25519 session signer. The keypair is generated ONCE per call and held
 *  in memory; it never reaches disk, matching the product's key promise. */
export function sessionSigner(): Signer {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubDer = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const id = createHash("sha256").update(pubDer).digest("hex").slice(0, 16);
  return {
    id,
    sign: (data) => edSign(null, Buffer.from(data, "utf8"), privateKey).toString("base64"),
    verify: (data, sig) => {
      try {
        return edVerify(null, Buffer.from(data, "utf8"), publicKey, Buffer.from(sig, "base64"));
      } catch {
        return false;
      }
    },
  };
}

/** Issue a mandate: the owner's authority signing a requested profile. */
export function issueMandate(profile: RequestedProfile, signer: Signer, ttlMs = 60 * 60_000): SovereignMandate {
  const issuedAt = Date.now();
  const m: Omit<SovereignMandate, "signature"> = {
    v: MANDATE_FORMAT,
    agentId: profile.agentId,
    owner: profile.owner,
    profile: profileDigest(profile),
    env: {
      allowWrite: profile.allowWrite,
      allowShell: profile.allowShell,
      allowNetwork: profile.allowNetwork,
      root: profile.root,
      budgetCeiling: profile.budgetCeiling,
      maxRisk: profile.maxRisk,
    },
    issuedAt,
    expiresAt: issuedAt + Math.max(1, ttlMs),
  };
  return { ...m, signature: signer.sign(mandateCanonical(m)) };
}

/** Verify a mandate: signature, owner, expiry — the checks, in the order
 *  a refusal should name them. */
export function verifyMandate(m: SovereignMandate | null | undefined, signer: Signer): MandateCheck {
  if (!m || typeof m !== "object" || !m.signature) {
    return { ok: false, reason: "missing", detail: "no mandate: a profile without a signature issues no authority" };
  }
  if (!m.owner || typeof m.owner !== "string") {
    return { ok: false, reason: "no-owner", detail: "the mandate names no human principal; an anonymous authority is not an authority" };
  }
  if (!signer.verify(mandateCanonical(m), m.signature)) {
    return { ok: false, reason: "bad-signature", detail: `the mandate's signature does not verify against the owner key ${signer.id}` };
  }
  if (Date.now() > m.expiresAt) {
    return { ok: false, reason: "expired", detail: `the mandate expired at ${new Date(m.expiresAt).toISOString()}` };
  }
  return { ok: true, mandate: m };
}

/** THE mandate→envelope path — and the ONLY way to obtain an envelope.
 *
 * It verifies before it renders. That is not redundant with `verifyMandate`:
 * this function is exported, and `issueMandate` is exported beside it, so
 * `envelopeFromMandate(issueMandate(effectfulProfile, anyKey))` once produced an
 * allowShell envelope with no signature check anywhere in the path. The
 * bootstrap guard in `mandateFor` could not help, because that composition
 * never went near it.
 *
 * So the check lives HERE, at the seam every envelope must pass through, rather
 * than relying on each caller having verified first. A caller that has already
 * verified pays one Ed25519 verify it did not need to; a caller that did not
 * gets a refusal instead of authority. */
export function envelopeFromMandate(m: SovereignMandate, signer: Signer): AuthorityEnvelope | null {
  if (!verifyMandate(m, signer).ok) return null;
  return {
    allowWrite: m.env.allowWrite === true,
    allowShell: m.env.allowShell === true,
    allowNetwork: m.env.allowNetwork === true,
    root: String(m.env.root),
    budgetCeiling: Number(m.env.budgetCeiling) || 0,
    maxRisk: m.env.maxRisk,
  };
}

/* ── 3 · the sovereign authority (one per session, owned by the human) ─── */

const FRONT_DOOR_AGENT = "si.front-door.captain";
const FRONT_DOOR_TTL_MS = 60 * 60_000;

/** The envelope a refusal produces: no capability, lowest risk, no budget.
 *  Named so the two ways of getting one (no mandate, or an unverified one) read
 *  as the same decision rather than as two slightly different literals. */
const DENY_ALL_ENVELOPE: AuthorityEnvelope = {
  allowWrite: false, allowShell: false, allowNetwork: false,
  root: workingRoot(), budgetCeiling: 0, maxRisk: "low",
};

export class SovereignAuthority {
  private bootstrap: Signer | null;
  private ownerSigner: Signer | null = null;
  private readonly issued = new Map<string, { mandate: SovereignMandate; digest: string }>();
  private readonly revoked = new Set<string>();

  constructor(signer?: Signer) {
    this.bootstrap = signer ?? null;
  }

  /** ONE authority root. The session key bootstraps (labelled honestly as
   *  "bootstrap"); binding the OWNER's key re-roots every issuance. */
  get root(): "owner" | "bootstrap" {
    return this.ownerSigner ? "owner" : "bootstrap";
  }

  /** Bind the owner's signer — the human's key becomes THE root. Idempotent
   *  for the same key; the bootstrap key keeps verifying nothing new. */
  bindOwnerSigner(s: Signer): void {
    this.ownerSigner = s;
  }

  /** DROP the owner binding — the vault-lock act. The root reverts to the
   *  labelled bootstrap, and every owner-signed artifact (mandates AND
   *  capabilities) stops verifying from this moment: a key that is gone
   *  cannot vouch. Re-binding with the same passphrase restores the same
   *  key, and with it the same mandates. */
  unbindOwnerSigner(): void {
    this.ownerSigner = null;
  }

  private get rootSigner(): Signer {
    // The session key is generated on FIRST USE, not in the constructor. The
    // module-scope `sovereign` below is imported by browser-reachable code, and
    // `generateKeyPairSync` is a throwing stub in the WebView bundle — building
    // the key eagerly made the whole app throw while the module was still being
    // evaluated. Deferring it means an authority nobody has asked anything yet
    // costs nothing, and the refusal still happens at the first real use.
    this.bootstrap ??= sessionSigner();
    return this.ownerSigner ?? this.bootstrap;
  }

  get signerId(): string {
    const bound = this.ownerSigner ?? this.bootstrap;
    if (bound) return bound.id;
    // Nothing has asked for authority yet, so nothing has minted a key. Report
    // the state honestly instead of generating a key to describe it.
    return "unbound";
  }

  /** The signing root every other authority artifact MUST share —
   *  capabilities sign with exactly this key. One root, no side keys. */
  currentRootSigner(): Signer {
    return this.rootSigner;
  }

  /** The OWNER act — an explicit re-grant. The ONLY path that lifts a
   *  revocation; mandateFor refuses revoked seats and never un-revokes. */
  regrant(node: ProfileSource, ttlMs = 60 * 60_000):
    | { ok: true; mandate: SovereignMandate; issued: boolean; signerId: string }
    | { ok: false; reason: string; detail: string } {
    /* An OWNER act, enforced: only the bound owner root may re-grant a
       revoked seat. Under bootstrap there is no owner in the room to
       vouch, so the revocation stands. */
    if (this.root !== "owner") {
      return { ok: false, reason: "owner-required", detail: "only the bound owner root may re-grant a revoked seat" };
    }
    const profile = requestProfileOf(node);
    this.revoked.delete(profile.agentId);
    return this.mandateFor(node, ttlMs);
  }

  /** Revoke a seat — the roster's revocation flows through here, so the
   *  very next governed read fail-closes. Only an owner act (a fresh
   *  mandate) re-arms the seat. */
  revoke(agentId: string): void {
    this.revoked.add(agentId);
  }

  isRevoked(agentId: string): boolean {
    return this.revoked.has(agentId);
  }

  /** The seats under mandate — the IAM roster's source of truth. */
  enrolledAgents(): string[] {
    return [...this.issued.keys()];
  }

  enrolledMandateOf(agentId: string): SovereignMandate | null {
    return this.issued.get(agentId)?.mandate ?? null;
  }

  /** The mandate for a node's CURRENT profile — issuing one if the profile
   *  is new or changed, re-verifying the cached one if it is not. Issuance
   *  here is the owner's standing act (the app owner IS the human principal
   *  for local seats); every issuance is returned with its signing key id so
   *  the caller can journal it. */
  mandateFor(node: ProfileSource, ttlMs = 60 * 60_000):
    | { ok: true; mandate: SovereignMandate; issued: boolean; signerId: string }
    | { ok: false; reason: string; detail: string } {
    const profile = requestProfileOf(node);
    const digest = profileDigest(profile);
    /* THE BOOTSTRAP WINDOW, at the issuance throat: without the owner's
       key, a read-only profile may be mandated — an effectful one may NOT.
       The capability registry already refuses to mint effectful authority
       under bootstrap; this closes the other road (a base mandate whose
       envelope would let a seat write, shell, or reach the network with no
       owner anywhere in the room). */
    if (this.root === "bootstrap" && profileIsEffectful(profile)) {
      return { ok: false, reason: "bootstrap-effectful-mandate", detail: "bootstrap authority is read-only until the owner root is bound" };
    }
    /* Revocation is STICKY: this method is also the runtime's automatic
       path (authorityFor → mandateFor), so it can NEVER lift a revocation —
       it refuses one. Only the owner's explicit regrant() un-revokes. */
    if (this.revoked.has(profile.agentId)) {
      return { ok: false, reason: "revoked", detail: "this seat is revoked — authority stays off until the owner re-grants it" };
    }
    const cached = this.issued.get(profile.agentId);
    if (cached && cached.digest === digest) {
      const check = verifyMandate(cached.mandate, this.rootSigner);
      if (check.ok) return { ok: true, mandate: check.mandate, issued: false, signerId: this.rootSigner.id };
      if (check.reason === "expired") {
        const fresh = issueMandate(profile, this.rootSigner, ttlMs);
        this.issued.set(profile.agentId, { mandate: fresh, digest });
        return { ok: true, mandate: fresh, issued: true, signerId: this.rootSigner.id };
      }
      return { ok: false, reason: check.reason, detail: check.detail };
    }
    const fresh = issueMandate(profile, this.rootSigner, ttlMs);
    this.issued.set(profile.agentId, { mandate: fresh, digest });
    return { ok: true, mandate: fresh, issued: true, signerId: this.rootSigner.id };
  }

  /** The LIVE authority read — called before every governed step.
   *
   *  Returns the envelope ONLY if a mandate exists for this node, verifies
   *  against the owner key, is unexpired, AND was issued over the profile
   *  the node's configuration carries RIGHT NOW. Anything else returns null
   *  and the governed loop fail-closes; that null is what makes drift
   *  detection real instead of decorative. */
  read(node: ProfileSource): AuthorityEnvelope | null {
    const profile = requestProfileOf(node);
    const cached = this.issued.get(profile.agentId);
    if (!cached) return null;
    if (this.revoked.has(profile.agentId)) return null; // revoked — fail-closed at the next governed step
    if (cached.digest !== profileDigest(profile)) return null; // profile changed under the mandate
    const check = verifyMandate(cached.mandate, this.rootSigner);
    if (!check.ok) return null;
    return envelopeFromMandate(check.mandate, this.rootSigner);
  }

  /** The verified mandate for a node, if one is live. */
  mandateOf(node: ProfileSource): SovereignMandate | null {
    const profile = requestProfileOf(node);
    const cached = this.issued.get(profile.agentId);
    if (!cached || this.revoked.has(profile.agentId) || cached.digest !== profileDigest(profile)) return null;
    const check = verifyMandate(cached.mandate, this.rootSigner);
    return check.ok ? check.mandate : null;
  }

  /** The front-door envelope — the Captain's own seat, judged by the same
   *  authority as every other seat. Conservative by construction: the front
   *  door steers anything risky and refuses anything critical on its own
   *  authority, exactly like the governed loop. */
  frontDoorEnvelope(): AuthorityEnvelope {
    const claim = this.mandateFor({ id: FRONT_DOOR_AGENT, config: { owner: "owner" } }, FRONT_DOOR_TTL_MS);
    if (!claim.ok) return DENY_ALL_ENVELOPE;
    // `??` rather than `||`: the render can legitimately be an all-false
    // envelope, and that must not be confused with a refusal.
    return envelopeFromMandate(claim.mandate, this.rootSigner) ?? DENY_ALL_ENVELOPE;
  }
}

/* ── the canonical bridge — ONE mandate format across the fabric ──────────
 *
 * v1.2.0's review named the last ambiguity: the sovereign spoke
 * `si.mandate.v1` while the portable fabric speaks `vh.mandate.v1`. Both
 * formats describe the same grant, so this file now renders one as the
 * other, mechanically and signed by the SAME key — a mandate issued here
 * verifies anywhere the canonical format is spoken, with no second root
 * and no hand-copied fields.
 */

/** The canonical scope vocabulary, derived mechanically from the envelope:
 *  what the mandate allows, sorted — never hand-listed. */
export function canonicalScopeOf(env: AuthorityEnvelope): string[] {
  const scope: string[] = [];
  if (env.allowWrite) scope.push("fs.write");
  if (env.allowShell) scope.push("shell.exec");
  if (env.allowNetwork) scope.push("net.fetch");
  scope.push(`risk:${env.maxRisk}`);
  return scope.sort();
}

/** Render a sovereign mandate as the canonical `vh.mandate.v1` mandate,
 *  signed by the same key that signed the sovereign mandate. */
export function toCanonicalMandate(m: SovereignMandate, signer: Signer): CoreMandate {
  const base = {
    agentId: m.agentId,
    owner: m.owner,
    scope: canonicalScopeOf(m.env),
    budgetCap: m.env.budgetCeiling,
    maxDepth: 0, // local seats attenuate only — never re-delegate
    issuedAt: m.issuedAt,
    expiresAt: m.expiresAt,
  };
  return { ...base, signature: `ed25519:${signer.sign(coreMandateCanonical(base))}` };
}

/** Verify a canonical mandate against a key. The foreign-key check is the
 *  one-root check: only the issuing key verifies. */
export function verifyCanonicalMandate(c: CoreMandate, signer: Signer): boolean {
  if (!c.signature || typeof c.signature !== "string") return false;
  const raw = c.signature.startsWith("ed25519:") ? c.signature.slice("ed25519:".length) : c.signature;
  const { signature, ...base } = c;
  return signer.verify(coreMandateCanonical(base as Omit<CoreMandate, "signature">), raw);
}

/** The session sovereign. In-memory keys, one per app session. */
export const sovereign = new SovereignAuthority();
