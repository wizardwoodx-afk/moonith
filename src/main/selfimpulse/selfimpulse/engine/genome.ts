/**
 * SI-COLOR Phase 1 — the Capability Genome.
 *
 * The SI-COLOR protocol (open standard, v1.0) names its core unit the
 * "Capability Genome": a portable, versioned, signable description of one
 * evolved capability — what it improves, when it fires, how it runs, what it
 * may touch, where it came from, and where it stands in the lifecycle.
 *
 * This module is VH's engine-level implementation of the Phase 1 surface:
 *
 *   §11  Capability Genome shape            -> CapabilityGenome
 *   §31  21-stage lifecycle, state machine  -> GenomeStatus + GENOME_TRANSITIONS
 *   §41/42 promotion chain + hard gates     -> promote() / quarantine (G1-G4)
 *   §32-33 THE central invariant            -> the genome cannot carry its own
 *      "EVOLUTION MAY CHANGE CAPABILITY /    safety authority: the governor
 *       MAY NOT CONTROL ITS OWN SAFETY       grant is a SEPARATE argument to
 *       AUTHORITY"                           promote() (see G1), and the
 *                                            probe pins it.
 *   §40  signed capability package          -> buildCapabilityPackage / verify
 *   §70  trust grades C0-C5                 -> trustGrade()
 *   §45  auto-rollback                      -> monitor() (regression -> rollback)
 *   §46  evolution memory                   -> GenomeEvent history, append-only
 *   M4   bridge: existing SelfImpulseSkills are   -> genomeFromSelfImpulseSkill()
 *        the first genomes (lineage kept)
 *
 * Design rule for the phase: engine-level, test-pinned, ZERO new MCP surface
 * (the 20-tool conformance pin stays intact; a capability_* tool surface is
 * Phase 2, only after this engine is probe-locked).
 */

import {
  signHexDigest,
  verifyIssuerSignature,
  type IssuerSignature,
} from "./signing";
import type { SelfImpulseSkill } from "./selfimpulse";

/* ------------------------------------------------------------------ *
 * §11 — the genome
 * ------------------------------------------------------------------ */

/** §36 — capability permission classes (the coarse declaration a genome makes;
 * the fine enforcement is the host's, via the existing gate machinery). */
export type PermissionClass = "read-local" | "write-local" | "external";

/** §31 — the lifecycle. Five forward states, five negative states. */
export type GenomeStatus =
  | "OBSERVED"
  | "CANDIDATE"
  | "UNDER_EVALUATION"
  | "SHADOW"
  | "CANARY"
  | "ACTIVE"
  // negative states — evolution's honest "no"
  | "REJECTED"
  | "BLOCKED"
  | "ROLLED_BACK"
  | "DEPRECATED"
  | "QUARANTINED";

/** §46 — one append-only entry in a genome's evolution memory. */
export interface GenomeEvent {
  ts: string;
  from: GenomeStatus | null; // null = creation
  to: GenomeStatus;
  by: string; // "engine" | "governor:<who>" | "package:<issuer>"
  reason: string;
}

/** The genome itself. NOTE what is deliberately ABSENT: no grant, no
 * override, no "self-approved" field anywhere. §32-33 — safety authority is
 * not a field evolution can write. */
export interface CapabilityGenome {
  id: string; // "cap.<slug>" — stable across versions
  version: number; // 1-based, per id
  objective: { current: string; improve: string }; // §11 objective
  trigger: string; // §11 trigger — when this capability applies
  procedure: string[]; // §11 procedure — the real steps
  inputs: string[];
  outputs: string[];
  dependencies: string[]; // §11 dependencies — other capability ids
  resourceLimits: { maxSteps?: number; maxDurationMs?: number; maxTokens?: number }; // §72
  failureModes: string[]; // §11 failure_modes — declared, not discovered
  evaluation: { required: boolean; gate: "hard" | "soft" }; // §11 evaluation
  safety: {
    permissionClass: PermissionClass; // §36
    externalSideEffects: boolean; // §11 safety.external_side_effects
  };
  provenance: {
    originType: "distilled" | "observed" | "derived"; // §38
    originReceiptId?: string; // §38 — the receipt of the run it was distilled from
    lineage?: { parent: string; parentVersion: number }; // §76 — the parent id
    verifiedSeats?: number; // how many verified seats saw it
  };
  status: GenomeStatus;
  /** §42 — the last evidence snapshot that passed the gates (trust input). */
  lastEvidence?: PromotionEvidence;
  createdAt: string;
  updatedAt: string;
  /** §46 — append-only evolution memory. */
  history: GenomeEvent[];
}

/* ------------------------------------------------------------------ *
 * §41/42 — promotion: evidence, gates, the state machine
 * ------------------------------------------------------------------ */

/** §42 — what the evaluation produced. A promotion is only as good as this. */
export interface PromotionEvidence {
  evaluated: number;
  passed: number;
  failed: number;
  regressions: number;
  avgScore: number | null; // 1..5 feedback average, or null
  replayed: boolean; // the procedure was replayed against its own objective
  crossVerifiedSeats: number; // how many independent seats verified it
}

/** §36 host-side policy: which permission classes this host permits at all. */
export interface HostPolicy {
  permittedClasses: PermissionClass[];
}

/** Default host policy: local read/write only. Anything external needs the
 * governor's explicit grant — a separate authority, never a genome field. */
export const DEFAULT_HOST_POLICY: HostPolicy = {
  permittedClasses: ["read-local", "write-local"],
};

/** §32-33 — the governor's grant. It travels as an ARGUMENT to promote(),
 * not inside the genome. A genome that contains a forged copy of one in its
 * own fields cannot spend it: the gates only read this argument. */
export interface GovernorGrant {
  by: string; // non-empty identity of the authority granting
  grantedClass: PermissionClass;
  scope: string; // human-readable what/why
  ts: string;
}

/** §31 — the allowed transitions. Terminal states have no outgoing arrows
 * except QUARANTINED, which a governor may reopen into UNDER_EVALUATION. */
export const GENOME_TRANSITIONS: Record<GenomeStatus, readonly GenomeStatus[]> = {
  OBSERVED: ["CANDIDATE", "BLOCKED", "QUARANTINED"],
  CANDIDATE: ["UNDER_EVALUATION", "REJECTED", "BLOCKED", "QUARANTINED"],
  UNDER_EVALUATION: ["SHADOW", "REJECTED", "QUARANTINED"],
  SHADOW: ["CANARY", "REJECTED", "QUARANTINED"],
  CANARY: ["ACTIVE", "ROLLED_BACK", "QUARANTINED"],
  ACTIVE: ["DEPRECATED", "ROLLED_BACK", "QUARANTINED"],
  // terminal — no outgoing transitions (quarantine re-review is the exception)
  REJECTED: [],
  BLOCKED: [],
  ROLLED_BACK: [],
  DEPRECATED: [],
  QUARANTINED: ["UNDER_EVALUATION"],
};

/** The single forward arrow of the lifecycle (§31): promotion is a LINE
 * that ends at ACTIVE. Everything else in GENOME_TRANSITIONS is an exit —
 * a negative state, or a maintenance move (deprecate / rollback) that only
 * the governor or monitoring makes, never promote(). */
const FORWARD_STEP: Partial<Record<GenomeStatus, GenomeStatus>> = {
  OBSERVED: "CANDIDATE",
  CANDIDATE: "UNDER_EVALUATION",
  UNDER_EVALUATION: "SHADOW",
  SHADOW: "CANARY",
  CANARY: "ACTIVE",
};

/** A hard gate's verdict. */
export interface GateVerdict {
  gate: "G1-safety" | "G2-provenance" | "G3-dependencies" | "G4-regression";
  pass: boolean;
  reason: string;
}

export interface GenomeRegistry {
  /** keyed by `${id}@${version}` */
  genomes: Map<string, CapabilityGenome>;
}

export function createGenomeRegistry(): GenomeRegistry {
  return { genomes: new Map() };
}

function keyOf(id: string, version: number): string {
  return `${id}@${version}`;
}

/** The highest version of a capability id that is still live (not in a
 * terminal negative state). */
export function latestVersion(reg: GenomeRegistry, id: string): CapabilityGenome | null {
  let best: CapabilityGenome | null = null;
  for (const g of reg.genomes.values()) {
    if (g.id !== id) continue;
    if (TERMINAL_STATES.has(g.status) && g.status !== "QUARANTINED") continue;
    if (!best || g.version > best.version) best = g;
  }
  return best;
}

const TERMINAL_STATES: ReadonlySet<GenomeStatus> = new Set<GenomeStatus>([
  "REJECTED",
  "BLOCKED",
  "ROLLED_BACK",
  "DEPRECATED",
]);

/** §11 — create an observed genome (status OBSERVED). */
export function newGenome(
  spec: Omit<CapabilityGenome, "version" | "status" | "createdAt" | "updatedAt" | "history"> &
    Partial<Pick<CapabilityGenome, "version">>,
  now: string = new Date().toISOString(),
): CapabilityGenome {
  const version = spec.version ?? 1;
  return {
    ...spec,
    version,
    status: "OBSERVED",
    createdAt: now,
    updatedAt: now,
    history: [{ ts: now, from: null, to: "OBSERVED", by: "engine", reason: "observed" }],
  };
}

export function registerGenome(reg: GenomeRegistry, genome: CapabilityGenome): { ok: boolean; reason?: string } {
  const k = keyOf(genome.id, genome.version);
  if (reg.genomes.has(k)) return { ok: false, reason: `${k} already exists` };
  reg.genomes.set(k, genome);
  return { ok: true };
}

/** §42 — evaluate the four hard gates. Any failure quarantines. */
export function runHardGates(
  genome: CapabilityGenome,
  evidence: PromotionEvidence,
  reg: GenomeRegistry,
  hostPolicy: HostPolicy = DEFAULT_HOST_POLICY,
  governorGrant: GovernorGrant | undefined = undefined,
): GateVerdict[] {
  const verdicts: GateVerdict[] = [];

  // G1 — SAFETY. The capability's declared class must be one the host permits,
  // or the governor must hold an explicit grant for exactly that class. The
  // grant is an argument — a field the genome wrote for itself is invisible
  // to this gate. (This is §32-33 made mechanical.)
  const permitted = hostPolicy.permittedClasses.includes(genome.safety.permissionClass);
  const granted =
    !!governorGrant &&
    governorGrant.by.trim().length > 0 &&
    governorGrant.grantedClass === genome.safety.permissionClass;
  if (permitted) {
    verdicts.push({ gate: "G1-safety", pass: true, reason: `class "${genome.safety.permissionClass}" permitted by host policy` });
  } else if (granted) {
    verdicts.push({ gate: "G1-safety", pass: true, reason: `governor grant by "${governorGrant!.by}" for class "${genome.safety.permissionClass}"` });
  } else {
    verdicts.push({
      gate: "G1-safety",
      pass: false,
      reason:
        genome.safety.externalSideEffects
          ? `class "${genome.safety.permissionClass}" declares external side effects and no governor grant was presented`
          : `class "${genome.safety.permissionClass}" is not permitted by this host and no governor grant was presented`,
    });
  }

  // G2 — PROVENANCE. A distilled capability must name the receipt of the real
  // run it came from; a derived one must name a parent that actually exists.
  // No orphan capabilities.
  if (genome.provenance.originType === "distilled") {
    const has = typeof genome.provenance.originReceiptId === "string" && genome.provenance.originReceiptId.trim().length > 0;
    verdicts.push(
      has
        ? { gate: "G2-provenance", pass: true, reason: `receipt ${genome.provenance.originReceiptId}` }
        : { gate: "G2-provenance", pass: false, reason: "distilled capability carries no origin receipt" },
    );
  } else if (genome.provenance.originType === "derived") {
    const parent = genome.provenance.lineage;
    const exists = !!parent && reg.genomes.has(keyOf(parent.parent, parent.parentVersion));
    verdicts.push(
      exists
        ? { gate: "G2-provenance", pass: true, reason: `lineage ${parent!.parent}@${parent!.parentVersion}` }
        : { gate: "G2-provenance", pass: false, reason: "derived capability's lineage parent is missing from the registry" },
    );
  } else {
    verdicts.push({ gate: "G2-provenance", pass: true, reason: "observed — no origin receipt required" });
  }

  // G3 — DEPENDENCIES. Every declared dependency must exist in the registry
  // (some version). A capability that leans on a capability that isn't there
  // is not promotable.
  const dangling = genome.dependencies.filter((d) => !reg.genomes.has(keyOf(d, 1)) && !hasAnyVersion(reg, d));
  verdicts.push(
    dangling.length === 0
      ? { gate: "G3-dependencies", pass: true, reason: "all dependencies resolvable" }
      : { gate: "G3-dependencies", pass: false, reason: `dangling dependencies: ${dangling.join(", ")}` },
  );

  // G4 — REGRESSION. Zero regressions, always. And if the genome declares its
  // evaluation required, the evidence must actually show passes and no fails.
  if (evidence.regressions > 0) {
    verdicts.push({ gate: "G4-regression", pass: false, reason: `${evidence.regressions} regression(s) in the evidence` });
  } else if (genome.evaluation.required && (evidence.passed < 1 || evidence.failed > 0)) {
    verdicts.push({ gate: "G4-regression", pass: false, reason: `evaluation required but evidence is ${evidence.passed} passed / ${evidence.failed} failed` });
  } else {
    verdicts.push({ gate: "G4-regression", pass: true, reason: "no regressions" });
  }

  return verdicts;
}

function hasAnyVersion(reg: GenomeRegistry, id: string): boolean {
  for (const g of reg.genomes.values()) if (g.id === id) return true;
  return false;
}

export interface PromoteResult {
  ok: boolean;
  from?: GenomeStatus;
  to?: GenomeStatus;
  quarantined: boolean;
  failedGate?: string;
  reason: string;
  /** §70 — set when the genome reaches ACTIVE. */
  grade?: TrustGrade;
}

/** §41 — advance ONE transition in the promotion chain. Gates run on every
 * call: a capability that would fail G1 today can never be "promoted later
 * after it learned to look nicer" — it is quarantined now, with the reason. */
export function promote(
  reg: GenomeRegistry,
  id: string,
  evidence: PromotionEvidence,
  opts: { hostPolicy?: HostPolicy; governorGrant?: GovernorGrant; now?: string } = {},
): PromoteResult {
  const now = opts.now ?? new Date().toISOString();
  const genome = latestVersion(reg, id);
  if (!genome) return { ok: false, quarantined: false, reason: `no live genome for "${id}"` };

  // §32-33, enforced: the promotion path itself cannot lift a quarantine.
  // Only governorReopen() (a separate authority, named) may re-enter the
  // chain — and then from UNDER_EVALUATION, not from where it fell.
  if (genome.status === "QUARANTINED") {
    return { ok: false, quarantined: true, reason: "quarantined — only a named governorReopen() may re-enter the chain" };
  }

  const verdicts = runHardGates(genome, evidence, reg, opts.hostPolicy ?? DEFAULT_HOST_POLICY, opts.governorGrant);
  const failed = verdicts.find((v) => !v.pass);
  if (failed) {
    const from = genome.status;
    genome.status = "QUARANTINED";
    genome.updatedAt = now;
    genome.history.push({ ts: now, from, to: "QUARANTINED", by: "engine", reason: `${failed.gate}: ${failed.reason}` });
    return { ok: false, quarantined: true, from, to: "QUARANTINED", failedGate: failed.gate, reason: failed.reason };
  }

  // Gates passed — take the single forward step.
  const forward = FORWARD_STEP[genome.status];
  if (!forward) {
    return { ok: false, quarantined: false, reason: `state ${genome.status} has no forward promotion — the line ends at ACTIVE; evolution is a child (deriveChild), not a re-promotion` };
  }
  const from = genome.status;
  genome.status = forward;
  genome.lastEvidence = evidence;
  genome.updatedAt = now;
  genome.history.push({ ts: now, from, to: forward, by: "engine", reason: "all hard gates passed" });

  if (forward === "ACTIVE") {
    const t = trustGrade(reg, id);
    return { ok: true, quarantined: false, from, to: forward, reason: "promoted to ACTIVE", grade: t.grade };
  }
  return { ok: true, quarantined: false, from, to: forward, reason: `promoted to ${forward}` };
}

/** A governor reopens a quarantined capability for a FULL re-evaluation.
 * This is the only path out of QUARANTINED, and it lands in UNDER_EVALUATION
 * — the capability re-climbs the chain, it does not skip to where it fell. */
export function governorReopen(
  reg: GenomeRegistry,
  id: string,
  by: string,
  now: string = new Date().toISOString(),
): PromoteResult {
  if (by.trim().length === 0) return { ok: false, quarantined: false, reason: "a reopen needs the governor's identity" };
  const genome = latestVersion(reg, id);
  if (!genome) return { ok: false, quarantined: false, reason: `no genome for "${id}"` };
  if (genome.status !== "QUARANTINED") return { ok: false, quarantined: false, reason: `genome is ${genome.status}, not QUARANTINED` };
  const from = genome.status;
  genome.status = "UNDER_EVALUATION";
  genome.updatedAt = now;
  genome.history.push({ ts: now, from, to: "UNDER_EVALUATION", by: `governor:${by}`, reason: "quarantine re-review: full re-evaluation required" });
  return { ok: true, quarantined: false, from, to: "UNDER_EVALUATION", reason: "reopened by governor into UNDER_EVALUATION" };
}

/* ------------------------------------------------------------------ *
 * §70 — trust grades C0-C5
 * ------------------------------------------------------------------ */

export type TrustGrade = "C0" | "C1" | "C2" | "C3" | "C4" | "C5";

/** Does a REAL receipt stand behind this genome — in its own provenance
 * (distilled) or anywhere up its lineage (derived)? Cycles are refused, so
 * a lineage loop can never mint trust. */
function receiptChain(reg: GenomeRegistry, g: CapabilityGenome, seen: Set<string> = new Set()): boolean {
  const k = keyOf(g.id, g.version);
  if (seen.has(k)) return false;
  seen.add(k);
  if (g.provenance.originType === "distilled") return !!g.provenance.originReceiptId;
  if (g.provenance.originType === "derived") {
    const l = g.provenance.lineage;
    if (!l) return false;
    const parent = reg.genomes.get(keyOf(l.parent, l.parentVersion));
    return parent ? receiptChain(reg, parent, seen) : false;
  }
  return false;
}

/** §70 — how much this host may trust the capability, from the provenance
 * chain alone (never from the capability's own claims):
 *
 *   C0  nothing — unknown capability
 *   C1  observed locally, no receipt chain
 *   C2  replayed against its own objective (with or without a receipt chain)
 *   C3  receipt chain + replay, single seat
 *   C4  C3 + cross-verified on >= 2 seats
 *   C5  C4 + ACTIVE with an ACTIVE C3+ lineage parent (a proven chain)
 *
 * A "receipt chain" means the genome (distilled) or one of its lineage
 * ancestors (derived) holds the receipt of a real run — §38/§76.
 */
export function trustGrade(reg: GenomeRegistry, id: string): { grade: TrustGrade; basis: string } {
  const g = latestVersion(reg, id);
  return g ? trustGradeOf(reg, g) : { grade: "C0", basis: "unknown capability" };
}

/** Grade a SPECIFIC genome (a specific version). The public trustGrade()
 * resolves the id to its live version and delegates here. C5 checks grade
 * the parent genome object directly — never by id — so a parent/child pair
 * can never chase each other. */
function trustGradeOf(reg: GenomeRegistry, g: CapabilityGenome): { grade: TrustGrade; basis: string } {
  if (!receiptChain(reg, g)) {
    if (g.lastEvidence?.replayed) return { grade: "C2", basis: "observed + replayed, no receipt chain" };
    return { grade: "C1", basis: "observed locally" };
  }
  if (!g.lastEvidence?.replayed) return { grade: "C2", basis: "receipt chain held, not yet replayed" };
  const seats = Math.max(g.provenance.verifiedSeats ?? 0, g.lastEvidence?.crossVerifiedSeats ?? 0);
  if (seats < 2) return { grade: "C3", basis: "receipt chain + replay, single seat" };
  // C4 reached — C5 needs the ACTIVE lineage chain.
  if (g.status === "ACTIVE" && g.provenance.lineage) {
    const parent = reg.genomes.get(keyOf(g.provenance.lineage.parent, g.provenance.lineage.parentVersion));
    if (parent && parent.status === "ACTIVE") {
      const p = trustGradeOf(reg, parent);
      if (p.grade === "C3" || p.grade === "C4" || p.grade === "C5") {
        return { grade: "C5", basis: `ACTIVE child of ACTIVE ${p.grade} parent ${parent.id}` };
      }
    }
  }
  return { grade: "C4", basis: "receipt chain + replay + multi-seat verification" };
}

/* ------------------------------------------------------------------ *
 * §45 — monitoring and auto-rollback
 * ------------------------------------------------------------------ */

/** §45 — a live capability under monitoring: regressions roll it back
 * immediately, without a human in the loop. Rollback is always safe;
 * promotion is what needs the gates. */
export function monitor(
  reg: GenomeRegistry,
  id: string,
  evidence: PromotionEvidence,
  now: string = new Date().toISOString(),
): { rolledBack: boolean; reason: string } {
  const g = latestVersion(reg, id);
  if (!g || g.status !== "ACTIVE") return { rolledBack: false, reason: "not ACTIVE — nothing to monitor" };
  if (evidence.regressions > 0) {
    const r = rollbackActive(reg, id, `monitoring detected ${evidence.regressions} regression(s)`, now);
    return { rolledBack: r.ok, reason: r.reason };
  }
  return { rolledBack: false, reason: "no regressions — stays ACTIVE" };
}

/** §45 — explicit or automatic rollback of an ACTIVE capability. */
export function rollbackActive(
  reg: GenomeRegistry,
  id: string,
  reason: string,
  now: string = new Date().toISOString(),
): { ok: boolean; reason: string } {
  const g = latestVersion(reg, id);
  if (!g) return { ok: false, reason: `no genome for "${id}"` };
  if (g.status !== "ACTIVE") return { ok: false, reason: `genome is ${g.status}, not ACTIVE` };
  g.status = "ROLLED_BACK";
  g.updatedAt = now;
  g.history.push({ ts: now, from: "ACTIVE", to: "ROLLED_BACK", by: "engine", reason });
  return { ok: true, reason: `rolled back: ${reason}` };
}

/** The capability a host would actually run: the newest ACTIVE version, or,
 * after a rollback, the newest ACTIVE version of an earlier lineage (fall
 * back, don't fail). Null when nothing is currently active. */
export function currentFor(reg: GenomeRegistry, id: string): CapabilityGenome | null {
  let best: CapabilityGenome | null = null;
  for (const g of reg.genomes.values()) {
    if (g.id !== id || g.status !== "ACTIVE") continue;
    if (!best || g.version > best.version) best = g;
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * §76 — evolution: a new version is a CHILD, never a mutation
 * ------------------------------------------------------------------ */

/** Evolution does not edit an active genome. A change is a new version with
 * the old one as lineage parent — and the child starts at CANDIDATE and must
 * re-climb the full chain. */
export function deriveChild(
  reg: GenomeRegistry,
  id: string,
  changes: Partial<Pick<CapabilityGenome, "objective" | "trigger" | "procedure" | "inputs" | "outputs" | "dependencies" | "resourceLimits" | "failureModes" | "evaluation" | "safety">>,
  now: string = new Date().toISOString(),
): { ok: boolean; reason?: string; genome?: CapabilityGenome } {
  const parent = latestVersion(reg, id);
  if (!parent) return { ok: false, reason: `no live genome for "${id}"` };
  const child: CapabilityGenome = {
    ...parent,
    ...changes,
    version: parent.version + 1,
    status: "CANDIDATE",
    lastEvidence: undefined,
    provenance: {
      ...parent.provenance,
      originType: "derived",
      lineage: { parent: parent.id, parentVersion: parent.version },
    },
    createdAt: now,
    updatedAt: now,
    history: [{ ts: now, from: null, to: "CANDIDATE", by: "engine", reason: `evolved from ${parent.id}@${parent.version}` }],
  };
  const r = registerGenome(reg, child);
  if (!r.ok) return r;
  return { ok: true, genome: child };
}

/* ------------------------------------------------------------------ *
 * §40 — the signed capability package
 * ------------------------------------------------------------------ */

/** Canonical JSON: sorted keys, no whitespace. The digest of the genome is
 * the digest of THIS string — byte-stable across hosts and versions. */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = walk((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

async function sha256hex(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** §40 — a portable, signable package. The signature is the issuer's Ed25519
 * over the canonical digest, reusing the same keychain the proof receipts use.
 * When signing is unavailable the package is still digest-sealed — and says
 * so honestly (signature: null). */
export interface CapabilityPackage {
  format: "si-capability-package/1";
  genome: CapabilityGenome;
  digest: string; // sha256 hex of canonicalJson(genome)
  signature: IssuerSignature | null;
  issuedAt: string;
}

export async function buildCapabilityPackage(genome: CapabilityGenome, now: string = new Date().toISOString()): Promise<CapabilityPackage> {
  const digest = await sha256hex(canonicalJson(genome));
  const signature = await signHexDigest(digest);
  return { format: "si-capability-package/1", genome, digest, signature, issuedAt: now };
}

export interface PackageVerification {
  ok: boolean;
  reasons: string[];
  signed: boolean;
}

/** Verify a package end-to-end: canonical digest, then the issuer signature
 * (when present) against the issuer's own public key. */
export async function verifyCapabilityPackage(pkg: CapabilityPackage): Promise<PackageVerification> {
  const reasons: string[] = [];
  if (pkg.format !== "si-capability-package/1") reasons.push(`unknown format "${pkg.format}"`);
  const recomputed = await sha256hex(canonicalJson(pkg.genome));
  if (recomputed !== pkg.digest) reasons.push("digest mismatch — the genome was modified after sealing");
  let signed = false;
  if (pkg.signature) {
    signed = true;
    const ok = await verifyIssuerSignature(pkg.digest, pkg.signature.sigHex, pkg.signature.publicKeyHex);
    if (!ok) reasons.push("issuer signature does not verify");
  }
  return { ok: reasons.length === 0, reasons, signed };
}

/** Import a verified package into a host's registry. The strict rule (§37):
 * an import is NEVER trusted into ACTIVE — it lands in UNDER_EVALUATION and
 * re-climbs the chain on THIS host, as a child of nothing (its lineage is
 * recorded but the trust is earned locally). */
export async function importPackage(
  reg: GenomeRegistry,
  pkg: CapabilityPackage,
  now: string = new Date().toISOString(),
): Promise<{ ok: boolean; reason?: string; genome?: CapabilityGenome }> {
  const v = await verifyCapabilityPackage(pkg);
  if (!v.ok) return { ok: false, reason: v.reasons.join("; ") };
  const incoming = pkg.genome;
  let version = incoming.version;
  while (reg.genomes.has(keyOf(incoming.id, version))) version += 1;
  const genome: CapabilityGenome = {
    ...incoming,
    version,
    status: "UNDER_EVALUATION",
    createdAt: now,
    updatedAt: now,
    history: [
      ...incoming.history,
      { ts: now, from: incoming.status, to: "UNDER_EVALUATION", by: `package:${pkg.signature?.keyId ?? "unsigned"}`, reason: "imported — trust is earned per host; full re-evaluation required" },
    ],
  };
  const r = registerGenome(reg, genome);
  if (!r.ok) return r;
  return { ok: true, genome };
}

/* ------------------------------------------------------------------ *
 * ledger — the registry in a portable file (snapshot JSONL)
 * ------------------------------------------------------------------ */

export function exportGenomeLedger(reg: GenomeRegistry, now: string = new Date().toISOString()): string {
  const snapshot = {
    format: "si-genome-ledger/1",
    exportedAt: now,
    genomes: Array.from(reg.genomes.values()).sort((a, b) => (a.id === b.id ? a.version - b.version : a.id < b.id ? -1 : 1)),
  };
  return JSON.stringify(snapshot, null, 2);
}

export function importGenomeLedger(text: string): GenomeRegistry {
  const reg = createGenomeRegistry();
  const parsed = JSON.parse(text) as { format?: string; genomes?: CapabilityGenome[] };
  if (parsed?.format !== "si-genome-ledger/1") throw new Error("not a si-genome-ledger/1 document");
  for (const g of parsed.genomes ?? []) reg.genomes.set(keyOf(g.id, g.version), g);
  return reg;
}

/* ------------------------------------------------------------------ *
 * M4 bridge — SelfImpulseSkills are genomes, with their lineage kept
 * ------------------------------------------------------------------ */

/** M4 skills (selfimpulse.ts) already carry everything a genome needs: a trigger,
 * real steps, a receipt, and run history. This bridge turns one into an
 * OBSERVED genome — provenance intact (bornReceiptId -> originReceiptId,
 * mission seats -> verifiedSeats). The skill's own `flagged` state is
 * carried into the declared failure modes, so a review-flagged skill cannot
 * quietly arrive clean. */
export function genomeFromSelfImpulseSkill(skill: SelfImpulseSkill, now: string = new Date().toISOString()): CapabilityGenome {
  const failureModes: string[] = [`failure in the wrapped tool "${skill.tool}"`];
  if (skill.flagged) failureModes.push("flagged for review by feedback before genome conversion (avg score <= 2 or an unsafe report)");
  return newGenome(
    {
      id: `cap.skill.${skill.id}`,
      objective: {
        current: skill.when,
        improve: "execute the verified procedure without re-planning every run",
      },
      trigger: skill.when,
      procedure: [...skill.steps],
      inputs: [],
      outputs: [],
      dependencies: [],
      resourceLimits: { maxSteps: skill.steps.length * 4 },
      failureModes,
      evaluation: { required: true, gate: "hard" },
      safety: {
        permissionClass: skill.tool === "dispatch_mission" ? "write-local" : "read-local",
        externalSideEffects: false,
      },
      provenance: {
        originType: "distilled",
        originReceiptId: skill.bornReceiptId,
        verifiedSeats: skill.mission?.verifiedSeats ?? 0,
      },
    },
    now,
  );
}
