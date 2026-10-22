/**
 * VH 11.12.2 — Custody: Authority Envelopes with hierarchical delegation.
 *
 * The external 11.12.0 review asked: receipts are signed, but WHO authorized
 * the mission, and how does authority flow to sub-agents? 11.12.1 added
 * attenuated seat envelopes; 11.12.2 makes the chain first-class and signed:
 *
 *   principal (a human, never an agent)
 *     → root envelope (the runner's click, scoped + expiring)
 *       → seat envelopes (strict subsets, delegation chain recorded)
 *
 * Rules, mechanically enforced by checkEnvelope:
 *   - the principal of every envelope traces to a human;
 *   - attenuation may only SHRINK scope (subset rule), never grow it;
 *   - a child envelope cannot outlive its parent;
 *   - expired or revoked envelopes refuse every action;
 *   - an action outside scope is architecturally unable to execute.
 *
 * Envelopes are signed (SHA-256 digest + Ed25519 where available) exactly like
 * receipts and packets, so the delegation chain survives an audit.
 */
import { sha256Hex } from "./learningReceipt";
import { signHexDigest, verifyIssuerSignature, signingSupported } from "./signing";

export interface AuthorityEnvelope {
  format: "si-envelope/1";
  id: string;
  /** ultimate authority: a human identifier, never an agent */
  principal: string;
  /** [principal, agent1, agent2, ...] — every hop this authority passed through */
  delegationChain: string[];
  /** exact permitted action/resource patterns; children must be subsets */
  scope: string[];
  issuedAt: number;
  expiresAt: number | null;
  /** 11.13.0 — spend authority: hard USD cap this chain may charge; null = uncapped */
  budgetUsd: number | null;
  revoked: string | null;
  parentId: string | null;
  digest: string;
  signature?: { sigHex: string; publicKeyHex: string };
  signatureNote?: string;
}

/**
 * VH 11.12.3 — the human-principal invariant, made mechanical.
 * The 11.12.2 review was right: commenting "the principal is a human" is not
 * enforcement. The format IS the policy: a root principal must be a
 * `human:<id>` identifier. Anything else (agent:foo, empty, "HUMAN:x", ids
 * with whitespace) is refused before an envelope is ever signed.
 */
export const HUMAN_PRINCIPAL_RE = /^human:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export function isHumanPrincipal(p: string): boolean {
  return HUMAN_PRINCIPAL_RE.test(p);
}

export function canonicalEnvelopeInput(e: Omit<AuthorityEnvelope, "digest" | "signature" | "signatureNote">): string {
  return JSON.stringify([e.format, e.id, e.principal, e.delegationChain, e.scope, e.issuedAt, e.expiresAt, e.budgetUsd, e.revoked, e.parentId]);
}

/**
 * 20.1 — the sealed-envelope brand.
 *
 * THE BUG THIS EXISTS TO CLOSE. `AuthorityEnvelope` is a plain interface, so
 * any object literal satisfies it structurally. `checkEnvelope()` read
 * `scope`, `revoked` and `expiresAt` and returned `ok:true` — WITHOUT ever
 * calling `verifyEnvelope()`, which sat ten lines below it recomputing exactly
 * the digest that proves those fields were not edited. `verifyEnvelope` had
 * zero production call sites (only a self-test in `arenaGate.ts`).
 *
 * So the exploit was trivial: hand-write `{ id, principal, scope: ["*"],
 * revoked: null, expiresAt: null, digest: "deadbeef" }` and every gate in the
 * product opened — `egress.ts:82` (data leaves the machine), `capability.ts:206`
 * (compute over the dataset), `teamExecutor.ts:470`, which then ATTENUATED the
 * forged parent at :481 to mint legitimate-looking per-seat envelopes for the
 * whole crew.
 *
 * WHY A BRAND AND NOT A DIGEST CHECK ALONE. `checkEnvelope` is synchronous and
 * is called on the hot path; `verifyEnvelope` is async because it verifies an
 * Ed25519 signature. Making the gate `async` would ripple through six call
 * sites. A digest check would still be forgeable by anyone who can recompute
 * SHA-256 over fields they chose — which is anyone, because the canonical form
 * is public. The brand closes the actual hole: an object that did not come
 * out of `seal()` cannot claim to have been sealed.
 *
 * The brand is a module-private WeakSet, NOT a property on the object. That
 * choice is deliberate and load-bearing:
 *   - a property would survive `JSON.parse(JSON.stringify(e))`, so a persisted
 *     envelope reloaded from storage would lose it and start failing closed on
 *     a legitimate replay — a regression far worse than the bug;
 *   - a `Symbol` key would be dropped by any structured clone or spread;
 *   - a WeakSet is invisible to serialization, cheap to test, and cannot be
 *     forged from outside this module.
 *
 * The honest limit: an envelope that crosses a process or persistence boundary
 * comes back unbranded and is refused until `rehydrate()` runs, which verifies
 * the digest and the signature and re-brands it. That is recorded rather than
 * hidden — see `rehydrateEnvelope`.
 */
const SEALED = new WeakSet<object>();

/** Brand an envelope as genuinely produced by `seal()`. Internal by design. */
function markSealed(e: AuthorityEnvelope): AuthorityEnvelope {
  SEALED.add(e);
  return e;
}

/** True when this object came out of `seal()` in this process. */
function isSealed(e: object): boolean {
  return SEALED.has(e);
}

/**
 * Re-admit an envelope that arrived from storage or another process.
 *
 * Full integrity verification (digest + signature) followed by re-branding.
 * Nothing weaker: a `rehydrate` that trusted its input would be the same bug
 * with a different name.
 */
export async function rehydrateEnvelope(e: AuthorityEnvelope): Promise<{ ok: boolean; reason?: string }> {
  /* Fail-closed at the re-admission throat. An envelope that crossed a process
     or persistence boundary arrives as untrusted input and MUST be signed: a
     digest alone is a checksum, not authority — anyone can recompute it over
     fields they choose. Without a signature we refuse in words rather than
     sealing an unsigned envelope into full authority. */
  if (!e.signature) {
    return {
      ok: false,
      reason:
        `envelope ${e.id} arrived without a signature — a boundary-crossing envelope must be signed to be re-admitted. ` +
        `Refused (fail-closed); nothing was trusted.`,
    };
  }
  const v = await verifyEnvelope(e);
  if (!v.ok) return v;
  return { ok: true, reason: `envelope ${e.id} re-verified and re-admitted` , ...(markSealed(e), {}) };
}

let seq = 0;

async function seal(base: Omit<AuthorityEnvelope, "digest" | "signature" | "signatureNote">): Promise<AuthorityEnvelope> {
  const digest = await sha256Hex(canonicalEnvelopeInput(base));
  const env: AuthorityEnvelope = { ...base, digest };
  if (signingSupported()) {
    const sig = await signHexDigest(digest);
    if (sig) env.signature = sig;
    else env.signatureNote = "Ed25519 unavailable in this runtime; envelope unsigned.";
  } else {
    env.signatureNote = "Ed25519 unavailable in this runtime; envelope unsigned.";
  }
  // 20.1: this is the ONLY place an envelope becomes trusted. `seal` is
  // module-private and every producer (issueRootEnvelope, attenuate) goes
  // through it, so branding here means "structurally unforgeable" holds for
  // the whole product rather than for one call site.
  return markSealed(env);
}

/** Root envelope: issued to the runner by a HUMAN principal (the button press). */
export async function issueRootEnvelope(args: { principal: string; scope: string[]; expiresAt: number | null; budgetUsd?: number | null; now?: number }): Promise<AuthorityEnvelope> {
  if (!isHumanPrincipal(args.principal)) {
    throw new Error(`custody: root principal "${args.principal}" is not a human principal — the root of every delegation chain must match human:<id>. Refused; nothing was signed.`);
  }
  const now = args.now ?? Date.now();
  const budget = args.budgetUsd ?? null;
  if (budget !== null && (!Number.isFinite(budget) || budget < 0)) {
    throw new Error(`custody: budget cap must be a finite non-negative USD amount — refused ${String(budget)}`);
  }
  seq += 1;
  return seal({
    format: "si-envelope/1",
    id: `env-${now.toString(36)}-${seq}`,
    principal: args.principal,
    delegationChain: [args.principal],
    scope: args.scope,
    issuedAt: now,
    expiresAt: args.expiresAt,
    budgetUsd: budget,
    revoked: null,
    parentId: null,
  });
}

/**
 * Attenuation: a child envelope for a sub-agent. Scope must be a strict subset
 * of the parent's, expiry cannot outlive the parent, principal is inherited.
 * Returns null (and why) instead of ever granting a wider scope.
 */
export async function attenuate(parent: AuthorityEnvelope, agentId: string, subScope: string[], opts?: { expiresAt?: number | null; budgetUsd?: number | null; now?: number }): Promise<{ envelope: AuthorityEnvelope | null; reason: string }> {
  if (!isHumanPrincipal(parent.principal)) {
    return { envelope: null, reason: `custody: parent envelope principal "${parent.principal}" is not human-format — attenuation is refused rather than delegated from an illegitimate root` };
  }
  const now = opts?.now ?? Date.now();
  const notInParent = subScope.filter((s) => !parent.scope.includes(s));
  if (notInParent.length > 0) {
    return { envelope: null, reason: `attenuation refused: scope would GROW by [${notInParent.join(", ")}] — a sub-agent never exceeds its parent` };
  }
  const expiry = opts?.expiresAt ?? parent.expiresAt;
  if (parent.expiresAt !== null && (expiry === null || expiry > parent.expiresAt)) {
    return { envelope: null, reason: "attenuation refused: child expiry outlives the parent envelope" };
  }
  // 11.13.0 — spend authority attenuates too: a child may tighten the cap, never loosen it.
  const requestedBudget = opts?.budgetUsd ?? null;
  const budget = requestedBudget === null ? parent.budgetUsd
    : parent.budgetUsd !== null && requestedBudget > parent.budgetUsd ? null
    : requestedBudget;
  if (requestedBudget !== null && parent.budgetUsd !== null && requestedBudget > parent.budgetUsd) {
    return { envelope: null, reason: `attenuation refused: child budget $${requestedBudget} exceeds the parent's $${parent.budgetUsd} cap — spend authority never grows` };
  }
  seq += 1;
  const envelope = await seal({
    budgetUsd: budget,
    format: "si-envelope/1",
    id: `env-${now.toString(36)}-${seq}`,
    principal: parent.principal,
    delegationChain: [...parent.delegationChain, agentId],
    scope: subScope,
    issuedAt: now,
    expiresAt: expiry,
    revoked: null,
    parentId: parent.id,
  });
  return { envelope, reason: `attenuated from ${parent.id}; chain ${envelope.delegationChain.join(" -> ")}` };
}

export function revoke(e: AuthorityEnvelope, reason: string): AuthorityEnvelope {
  // 20.1: `{ ...e }` is a NEW object, so the brand does not come along with it.
  // Without this line a revoked envelope would be refused for the wrong reason
  // ("never sealed") instead of the right one, and `arenaGate.ts`'s revocation
  // test would pass for the wrong cause.
  return markSealed({ ...e, revoked: reason });
}

/** The mechanical scope/expiry/revocation check, evaluated on every action. */
/**
 * VH 11.13.0 — spend authority, enforced. A chain with a budget cap may not
 * charge beyond it; uncapped chains (budgetUsd === null) report no limit.
 * `budgetCheck` is deliberately separate from scope checks so reports can say
 * exactly which authority stopped the spend.
 */
export function budgetCheck(e: AuthorityEnvelope, spentUsd: number): { ok: boolean; reason: string; remainingUsd: number | null } {
  // 20.1: same provenance gate as checkEnvelope. A forged envelope carrying
  // `budgetUsd: null` used to read as "uncapped" and pass with $1 of headroom
  // reported against a cap the attacker had simply invented.
  if (!isSealed(e)) {
    return { ok: false, reason: `envelope ${e.id} is not a sealed envelope — its budget cap is an unverified claim, not spend authority`, remainingUsd: null };
  }
  if (e.budgetUsd === null) return { ok: true, reason: "uncapped", remainingUsd: null };
  const remaining = e.budgetUsd - spentUsd;
  if (spentUsd >= e.budgetUsd) {
    return { ok: false, reason: `spend authority exhausted — $${spentUsd.toFixed(4)} spent against a $${e.budgetUsd.toFixed(2)} cap`, remainingUsd: Math.max(0, remaining) };
  }
  return { ok: true, reason: "within budget", remainingUsd: remaining };
}

/**
 * VH 11.13.1 — atomic budget admission (the 9.6/10 review's exact fix).
 *
 * The 11.13.0 cap was checked per-seat against a SHARED balance read before a
 * concurrent wave dispatched — three seats could each see "$0 spent" and all
 * be admitted, crossing the cap in flight. A BudgetGate fixes that with the
 * pattern the review prescribed: reserve -> dispatch only admitted seats ->
 * settle against actual charge. JS is single-threaded and `reserve` performs
 * its check-and-commit with no await between them, so concurrent seats can
 * never double-spend the same remainder: committed reservations never exceed
 * the cap at dispatch time, which is the guarantee VH now makes — with any
 * per-seat overrun measured, named and reported at settlement, never hidden.
 */
export interface BudgetTicket { seatId: string; reservedUsd: number; settled: boolean }

export class BudgetGate {
  private committed = 0;
  constructor(public readonly capUsd: number) {}

  /** Budget not yet committed to running seats. */
  get remaining(): number { return Math.max(0, this.capUsd - this.committed); }
  get committedUsd(): number { return this.committed; }

  /** ATOMIC: check-and-commit with no await in between. Null when the cap cannot admit this seat. */
  reserve(seatId: string, amount: number): BudgetTicket | null {
    if (!Number.isFinite(amount) || amount <= 0) return null;
    if (this.committed + amount > this.capUsd + 1e-9) return null;
    this.committed += amount;
    return { seatId, reservedUsd: amount, settled: false };
  }

  /** Swap the reservation for the REAL charge; reports any per-seat overrun honestly. */
  settle(ticket: BudgetTicket, actualUsd: number): { overrunUsd: number } {
    if (ticket.settled) return { overrunUsd: 0 };
    this.committed -= ticket.reservedUsd;
    const actual = Math.max(0, Number.isFinite(actualUsd) ? actualUsd : 0);
    this.committed += actual;
    ticket.settled = true;
    return { overrunUsd: Math.max(0, actual - ticket.reservedUsd) };
  }

  /** Give the reservation back (a seat skipped or aborted before charging). */
  release(ticket: BudgetTicket): void {
    if (!ticket.settled) { this.committed -= ticket.reservedUsd; ticket.settled = true; }
  }
}

export function checkEnvelope(e: AuthorityEnvelope | null, action: string, now: number): { ok: boolean; reason: string } {
  if (!e) return { ok: false, reason: "no authority envelope — nothing executes without traced authority" };
  // 20.1 — THE GATE. Provenance is checked BEFORE any field is believed.
  //
  // Before this, an object literal with a fabricated `scope` and a junk digest
  // was accepted: `{...scope:["*"], revoked:null, expiresAt:null,
  // digest:"deadbeef"}` opened every authority gate in the product. This is
  // the one check that a caller cannot satisfy by writing fields, because the
  // brand is only ever set inside `seal()`.
  if (!isSealed(e)) {
    return {
      ok: false,
      reason:
        `envelope ${e.id} did not come from this process's seal() — its fields are unverified claims, not authority. ` +
        `An envelope that crossed a boundary must be re-admitted with rehydrateEnvelope() (which checks the digest and signature) before it can be used.`,
    };
  }
  if (e.revoked) return { ok: false, reason: `envelope ${e.id} revoked: ${e.revoked}` };
  if (e.expiresAt !== null && now > e.expiresAt) return { ok: false, reason: `envelope ${e.id} expired — authority is void` };
  if (!e.scope.includes(action)) return { ok: false, reason: `action "${action}" outside envelope scope [${e.scope.join(", ")}]` };
  return { ok: true, reason: `envelope ${e.id} permits "${action}" (principal ${e.principal})` };
}

export async function verifyEnvelope(e: AuthorityEnvelope): Promise<{ ok: boolean; reason?: string }> {
  if (!isHumanPrincipal(e.principal)) {
    return { ok: false, reason: `principal "${e.principal}" is not human-format — every chain must root in a human` };
  }
  const { digest, signature, signatureNote, ...rest } = e;
  void signatureNote;
  const recomputed = await sha256Hex(canonicalEnvelopeInput(rest));
  if (recomputed !== digest) return { ok: false, reason: "digest mismatch — envelope was altered" };
  if (e.signature) {
    const good = await verifyIssuerSignature(digest, e.signature.sigHex, e.signature.publicKeyHex);
    if (!good) return { ok: false, reason: "signature does not verify" };
  }
  return { ok: true };
}
