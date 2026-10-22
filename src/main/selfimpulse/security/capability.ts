/**
 * §SCOPED CAPABILITIES — a human approval made portable.
 *
 * Before this file, a human approval at the gate was receipted UI state: a
 * boolean (`humanApproved`) a downstream plane had to take on faith. The
 * 1.2.0 review named the fix and this is it:
 *
 *     an approval  →  a SIGNED, SCOPED capability
 *                     {subject, audience, action, resource, missionId,
 *                      budget, expiry, delegationDepth, signature}
 *
 * THE LAWS THIS FILE ENFORCES
 *  1. AN APPROVAL IS NOT A STANDING POWER. Every capability expires; a
 *     replayed redemption is refused by name; depth is ZERO by construction —
 *     a capability authorizes its holder, never the holder's nominees
 *     (authority may be attenuated downstream, never re-delegated).
 *  2. AUDIENCE-BOUND. A capability minted for one plane is refused by name
 *     (`wrong-audience`) anywhere else. Possession is not authorization.
 *  3. TAMPER-EVIDENT. The signature covers every field; any edit refuses as
 *     `bad-signature`. The mint registry is content-addressed — the same
 *     approval always yields the same capability digest, and every mint is
 *     traceable to the human approval (`approvalId`) that produced it.
 *
 * The signing key IS the sovereign's current root — the same key that
 * signs mandates, whatever root is live (the owner's key once bound, the
 * labelled bootstrap key before that). Keys live in memory; nothing here
 * persists.
 */
import { createHash } from "node:crypto";
import { stableStringify } from "./actionGraph";
import { sovereign } from "./sovereign";

export const CAPABILITY_FORMAT = "si.capability.v1";
export const DEFAULT_CAPABILITY_TTL_MS = 10 * 60_000;

export interface ScopedCapability {
  v: typeof CAPABILITY_FORMAT;
  /** WHO holds it — usually the Captain on the human's behalf. */
  subject: string;
  /** WHICH plane may accept it. Possession by anyone else is refused. */
  audience: string;
  action: string;
  resource: string;
  missionId: string | null;
  /** Authority units granted (0 = within whatever budget already governs). */
  budget: number;
  issuedAt: number;
  expiresAt: number;
  /** Zero by construction: authority may attenuate, never re-delegate. */
  delegationDepth: 0;
  /** The human approval this capability was minted from. */
  approvalId: string;
  signature: string;
}

export type CapabilityCheck =
  | { ok: true; capability: ScopedCapability }
  | { ok: false; reason: "missing" | "bad-signature" | "expired" | "wrong-audience" | "already-redeemed" | "invalidated" | "depth" | "not-minted" | "budget-exceeded" | "wrong-action" | "wrong-resource"; detail: string };

/**
 * WHAT THE CALLER IS ABOUT TO DO.
 *
 * This is the field that makes a capability mean something. A signed
 * capability says "a human approved ACTION on RESOURCE" — and until the
 * execution plane states what it is about to do, nothing ties the two
 * together. A capability verified only for its audience and its signature
 * would redeem for ANY effectful action the engine happened to want next,
 * which turns one human approval into one arbitrary action.
 *
 * So the redemption API REQUIRES the intent. The type is the enforcement:
 * a call site that cannot say what it is about to do does not compile, and a
 * call site that says the wrong thing is refused by name (`wrong-action`,
 * `wrong-resource`).
 */
export interface CapabilityIntent {
  /** The action about to be performed. Must equal the signed `action`. */
  action: string;
  /** The resource about to be touched. Must equal the signed `resource`. */
  resource: string;
}

interface RegistryEntry {
  base: Omit<ScopedCapability, "signature">;
  /** The root key id that signed this capability — capabilities die with
   *  the root that minted them. */
  mintedRootKeyId: string;
  redeemed: { by: string; at: number } | null;
  /** Set when the minting root was locked out or replaced. Invalidation is
   *  PERMANENT — a lock kills outstanding capabilities even after the same
   *  owner key returns, so redeem-once memory can never be replayed. */
  invalidated: boolean;
}

const registry = new Map<string, RegistryEntry>();
const byApproval = new Map<string, string[]>();

/** Capabilities sign with the SOVEREIGN'S CURRENT ROOT — the exact key that
 *  signs mandates. There is no independent capability key: binding the
 *  owner re-roots capabilities automatically, and the bootstrap root is
 *  honestly the same key the runtime already trusts. One root, no sides. */
function theSigner() {
  return sovereign.currentRootSigner();
}

export const capabilityDigest = (base: Omit<ScopedCapability, "signature">): string =>
  createHash("sha256").update(stableStringify(base)).digest("hex");

/** The signed capability reduced back to its canonical base — the registry
 *  is keyed on the BASE digest, so lookups strip the signature first. */
const baseOf = (c: ScopedCapability): Omit<ScopedCapability, "signature"> => ({
  v: c.v, subject: c.subject, audience: c.audience, action: c.action, resource: c.resource,
  missionId: c.missionId, budget: c.budget, issuedAt: c.issuedAt, expiresAt: c.expiresAt,
  delegationDepth: c.delegationDepth, approvalId: c.approvalId,
});

export interface MintCapabilityInput {
  approvalId: string;
  subject: string;
  audience: string;
  action: string;
  resource: string;
  missionId?: string | null;
  budget?: number;
  ttlMs?: number;
}

/** Mint a capability FROM a human approval. The same input always yields the
 *  same digest (content-addressed); each mint is journaled under its
 *  approval id so an auditor can walk capability → approval → human. */
export function mintCapability(input: MintCapabilityInput): { capability: ScopedCapability; digest: string } {
  const ttl = input.ttlMs ?? DEFAULT_CAPABILITY_TTL_MS;
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error(`capability ttl must be a positive number of ms — got ${input.ttlMs}`);
  /* The budget is signed into the capability, so it must be a well-formed
     authority allowance — a fractional or negative budget is a mistake, not a
     permission. */
  const budget = input.budget ?? 0;
  if (!Number.isSafeInteger(budget) || budget < 0) throw new Error(`capability budget must be a non-negative integer — got ${input.budget}`);
  const issuedAt = Date.now();
  const base: Omit<ScopedCapability, "signature"> = {
    v: CAPABILITY_FORMAT,
    subject: input.subject,
    audience: input.audience,
    action: input.action,
    resource: input.resource,
    missionId: input.missionId ?? null,
    budget,
    issuedAt,
    expiresAt: issuedAt + ttl,
    delegationDepth: 0,
    approvalId: input.approvalId,
  };
  /* THE BOOTSTRAP WINDOW: before the owner's key is bound, the root is the
   * labelled bootstrap — useful for reading, powerless to effect. No
   * effectful capability may mint without the owner root. */
  if (sovereign.root !== "owner" && actionIsEffectful(input.action)) {
    throw new Error(`refused: the authority root is still bootstrap — before the owner's key is bound, no effectful capability may be minted (${input.action})`);
  }
  const capability: ScopedCapability = { ...base, signature: theSigner().sign(stableStringify(base)) };
  const digest = capabilityDigest(base);
  registry.set(digest, { base, mintedRootKeyId: theSigner().id, redeemed: null, invalidated: false });
  const seen = byApproval.get(input.approvalId) ?? [];
  seen.push(digest);
  byApproval.set(input.approvalId, seen);
  return { capability, digest };
}

/** Verify a capability for an audience. Every refusal names itself.
 *
 *  THE REDEEM-ONCE MEMORY IS A REGISTRY, NOT A HINT.  A capability is only
 *  meaningful if THIS process minted it: the registry is where "one approval,
 *  one use" is remembered.  A capability that arrives without a registry
 *  entry was minted by a process that is gone — or was never minted here at
 *  all — and this process cannot know whether it was already spent.  The old
 *  behaviour treated "no record" as "not spent yet", so a capability captured
 *  from a previous session redeemed without limit.  Now it is refused: the
 *  honest answer to "I do not know" is no.
 *
 *  @param opts.maxBudget — the ceiling the presenting plane's own budget
 *  allows.  A capability that asks for MORE authority than the plane can
 *  back is refused; one that asks for none (0) is governed by the plane's
 *  budget, which is what the field has always meant.
 */
export function verifyCapability(
  c: ScopedCapability,
  audience: string,
  opts?: { maxBudget?: number; intent?: CapabilityIntent },
): CapabilityCheck {
  if (!c || typeof c !== "object" || !c.signature || c.v !== CAPABILITY_FORMAT) {
    return { ok: false, reason: "missing", detail: "not a capability" };
  }
  if (c.delegationDepth !== 0) {
    return { ok: false, reason: "depth", detail: `delegation depth ${c.delegationDepth} — capabilities never re-delegate` };
  }
  if (!Number.isSafeInteger(c.budget) || c.budget < 0) {
    return { ok: false, reason: "missing", detail: `the capability carries a malformed authority budget (${String(c.budget)}) — refused` };
  }
  const base = baseOf(c);
  if (!theSigner().verify(stableStringify(base), c.signature)) {
    return { ok: false, reason: "bad-signature", detail: "the capability does not verify against the issuing key — forged or edited" };
  }
  const minted = registry.get(capabilityDigest(base));
  /* NOT-MINTED — fail closed.  See the note above the function. */
  if (!minted) {
    return { ok: false, reason: "not-minted", detail: "this process did not mint that capability, so it cannot know whether it was already spent — refused" };
  }
  if (minted.invalidated) {
    return { ok: false, reason: "invalidated", detail: "the root that minted this capability was locked out or replaced — a lock kills outstanding capabilities" };
  }
  if (Date.now() > c.expiresAt) {
    return { ok: false, reason: "expired", detail: `expired ${new Date(c.expiresAt).toISOString()} — an approval is not a standing power` };
  }
  if (c.audience !== audience) {
    return { ok: false, reason: "wrong-audience", detail: `minted for ${c.audience}, presented to ${audience}` };
  }
  if (opts?.maxBudget !== undefined && c.budget > opts.maxBudget) {
    return { ok: false, reason: "budget-exceeded", detail: `the capability asks for ${c.budget} authority units and this plane can back at most ${opts.maxBudget} — refused` };
  }
  /* THE BINDING. A capability authorizes ONE action on ONE resource. If the
     caller states an intent and it does not match what was signed, the
     capability is refused by name — this is the difference between "a human
     approved something" and "a human approved THIS". Checked AFTER the
     signature, so the comparison is against an authentic value, and AFTER
     the registry lookup, so a capability this process never minted still
     fails closed on `not-minted` first. */
  if (opts?.intent) {
    if (c.action !== opts.intent.action) {
      return { ok: false, reason: "wrong-action", detail: `this capability authorizes "${c.action}", not "${opts.intent.action}" — the approval does not cover the action about to run` };
    }
    if (c.resource !== opts.intent.resource) {
      return { ok: false, reason: "wrong-resource", detail: `this capability authorizes a different resource than the one about to be touched — the approval does not cover it` };
    }
  }
  return { ok: true, capability: c };
}

/** Redeem = verify + mark, atomically. ONE approval, ONE use.
 *
 *  THE INTENT IS REQUIRED, NOT OPTIONAL. The execution plane must state the
 *  action and resource it is about to perform, and the capability must have
 *  been signed for exactly those. A redemption that cannot name what it is
 *  doing is not a redemption — it is a wish. */
export function redeemCapability(
  c: ScopedCapability,
  audience: string,
  intent: CapabilityIntent,
  opts?: { maxBudget?: number },
): CapabilityCheck {
  const v = verifyCapability(c, audience, { ...(opts ?? {}), intent });
  if (!v.ok) return v;
  const digest = capabilityDigest(baseOf(c));
  const entry = registry.get(digest);
  /* `verifyCapability` already refused a capability with no registry entry,
     so `entry` is present here — the redemption is always RECORDED, never
     silently skipped. */
  if (entry?.redeemed) {
    return { ok: false, reason: "already-redeemed", detail: `redeemed by ${entry.redeemed.by} at ${new Date(entry.redeemed.at).toISOString()} — one approval, one use` };
  }
  if (entry) entry.redeemed = { by: audience, at: Date.now() };
  return v;
}

/** The redemption record of a capability, if it was redeemed. */
export function redemptionOf(c: ScopedCapability): { by: string; at: number } | null {
  return registry.get(capabilityDigest(baseOf(c)))?.redeemed ?? null;
}

/** Capabilities minted from one approval — the audit walk. */
export function capabilitiesForApproval(approvalId: string): string[] {
  return byApproval.get(approvalId) ?? [];
}

/** Mark every capability minted under `rootKeyId` as invalidated — the
 *  lock/re-root act. They are NOT deleted: the redeem-once record survives,
 *  so nothing dead can ever be redeemed again (while the key is gone they
 *  also fail verification outright; when the same key returns, they stay
 *  dead — a lock kills outstanding capabilities for good). */
export function invalidateCapabilitiesForRoot(rootKeyId: string): number {
  let killed = 0;
  for (const entry of registry.values()) {
    if (entry.mintedRootKeyId === rootKeyId && !entry.invalidated) {
      entry.invalidated = true;
      killed += 1;
    }
  }
  return killed;
}

/** THE BOOTSTRAP WINDOW — the read-only operation REGISTRY.
 *
 * Closed by construction: an action is non-effectful only if its EXACT
 * name is registered. There is no prefix inference — `read_delete`,
 * `list_and_delete` and `get_shell` are effectful precisely because the
 * old prefix rules would have trusted them. Anything unregistered,
 * including anything unknown, is effectful: the honest default is
 * refusal, not hope. A dotted sub-action joins the registry only by an
 * explicit `registerReadOnlyOperation` call from the plane that owns it. */
const READ_ONLY_OPERATIONS = new Set<string>([
  "read", "list", "get", "status", "search", "describe", "poll",
  "simulate", "call_status", "export", "help",
]);

let registrySealed = false;

/** Register a read-only operation BY NAME — the seam a tool plane uses to
 *  declare "this exact operation reads and never effects". Never a prefix.
 *  TRUSTED STARTUP ONLY: once the registry is sealed, registration refuses
 *  forever — a worker or plugin loaded later cannot redefine what "read"
 *  means. */
export function registerReadOnlyOperation(name: string): void {
  if (registrySealed) {
    throw new Error("the read-only registry is sealed — operations are registered at trusted startup only, never by loaded code");
  }
  READ_ONLY_OPERATIONS.add(String(name).trim().toLowerCase());
}

/** Freeze the registry — the last step of trusted startup. Immutable after
 *  this call; the classification of every action is load-time fact, not
 *  runtime opinion. */
export function sealReadOnlyRegistry(): void {
  registrySealed = true;
}

export function actionIsEffectful(action: string): boolean {
  return !READ_ONLY_OPERATIONS.has(String(action).trim().toLowerCase());
}

/** Probe seam — clears the registry (keys stay). Never called by the product. */
export function _resetCapabilitiesForProbe(): void {
  registry.clear();
  byApproval.clear();
}
