/**
 * §PROOF RECEIPTS — cryptographically attestable run evidence (VH 11.9.4-Redesign).
 *
 * THE DIFFERENTIATOR. Every orchestrator can *claim* a run happened. In 2026,
 * regulation and enterprise diligence demand receipts: the EU AI Act's
 * tamper-evident-logging enforcement (Art. 12, Aug 2026) and the IETF AAT/SCITT
 * receipt work all converge on hash-chained, externally verifiable action
 * logs. VH is uniquely placed to issue them, because VH never infers what it
 * can measure: exit codes, artifact branches, review-snapshot shas, costs read
 * from the CLI's own output — the receipt chains exactly those facts.
 *
 * SHAPE (JSONL-friendly, auditor-readable)
 *   header   — mission, team, started/finished, VH version, license edition
 *   events   — one per measured fact; each carries `prev` + `hash`,
 *              hash = SHA-256( canonical(prev ‖ event-without-hash) )
 *   seal     — HMAC-SHA-256 over the final chain hash with the published
 *              verification secret (same honesty posture as licensing: a soft
 *              seal, externally re-computable; hardware/Ed25519 signing is on
 *              the enterprise roadmap and the schema already has room for it)
 *
 * VERIFY needs no VH state: re-canonicalize, re-hash the chain, re-check the
 * seal. "We have logs" becomes evidence a third party can re-run.
 */
import { VERIFY_SECRET, SEAL_SECRET_BY_FORMAT } from "./licensing";
import { signChainHash, verifyIssuerSignature } from "./signing";
import { scrubAuditValue } from "../security/auditScrub";
import type { AutonomyRunSummary } from "./autonomyRuntime";

export interface ReceiptEvent {
  seq: number;
  ts: string;
  kind: string;
  seatId: string | null;
  data: Record<string, unknown>;
  prev: string;
  hash: string;
}

export interface ProofReceipt {
  /**
   * si-proof-receipt/2 (16.1.0): the SelfImpulse proof standard — chain + seal, plus `issuer`/`signature` — an Ed25519
   * signature over the final chain hash, verifiable with the exported public key alone.
   * verifyProofReceipt accepts BOTH formats: v1 receipts stay verifiable forever.
   */
  format: "si-proof-receipt/2" | "mj-proof-receipt/2" | "mj-proof-receipt/1";
  header: {
    mission: string;
    teamId: string;
    startedAt: string;
    finishedAt: string;
    mjVersion: string;
    edition: string;
    autonomyArms: string[];
  };
  events: ReceiptEvent[];
  seal: string;
  /** 11.10.1 — issuer identity; null when the runtime could not sign (see signatureNote). */
  issuer?: { keyId: string; publicKeyHex: string } | null;
  /** Hex Ed25519 signature over the final chain hash; null when unsigned. */
  signature?: string | null;
  /** Present exactly when signature is null: what happened, honestly. */
  signatureNote?: string;
}

const enc = new TextEncoder();
/** Deterministic canonical form: object keys sorted RECURSIVELY (the array
 *  replacer of JSON.stringify drops nested keys not in the list — that would
 *  make receipts blind to data tampering, which is the whole point). */
function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = sortDeep((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}
const canon = (o: unknown): string => JSON.stringify(sortDeep(o));

async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(s: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(s));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Build a receipt from the SAME measured summary the autonomy settlement consumes. */
export async function buildProofReceipt(args: {
  mission: string;
  teamId: string;
  startedAt: string;
  finishedAt: string;
  mjVersion: string;
  edition: string;
  report: AutonomyRunSummary;
}): Promise<ProofReceipt> {
  const { report } = args;
  // 11.10.1 — when the summary names a seat's harness, the event carries the seat's
  // IDENTITY DIGEST (sha256 of seat|role|harness): a deterministic, chain-bound binding
  // of "which agent, in which role, under which harness" into the evidence.
  const seatEvents: Array<{ kind: string; seatId: string | null; data: Record<string, unknown> }> = [];
  for (const s of report.seats) {
    const data: Record<string, unknown> = { role: s.role, outcome: s.outcome, verified: s.verified };
    if (s.harness) {
      data.harness = s.harness;
      data.identity = await sha256hex(`${s.seatId}|${s.role}|${s.harness}`);
    }
    seatEvents.push({ kind: "seat.outcome", seatId: s.seatId, data });
  }
  const raw: Array<{ kind: string; seatId: string | null; data: Record<string, unknown> }> = [
    { kind: "mission.status", seatId: null, data: { status: report.status, reviewedBySnapshot: report.reviewedBySnapshot === true } },
    ...seatEvents,
    { kind: "mission.verdict", seatId: null, data: { verified: report.seats.some((s) => s.verified), arms: report.autonomyArms ?? [] } },
  ];
  // 11.9.9 — the adversarial-gate verdict becomes part of the chain when (and only when)
  // the run was gated. Keeping it conditional means pre-11.9.9 summaries produce exactly
  // the event sequence they always did (probe/receipts.test.ts pins that shape).
  if (report.gateStatus !== undefined) {
    raw.push({
      kind: "gate.verdict",
      seatId: null,
      data: {
        status: report.gateStatus,
        tier: report.gateTier ?? "n/a",
        // 11.10 — the writer→snapshot→verifier evidence link, in the chain itself.
        snapshotSha: report.gateSnapshotSha ?? null,
      },
    });
  }
  // 11.14.8 — the governance-arena preflight joins the chain when (and only when)
  // the run was admitted through the arena: the receipt then proves not just that
  // the work was verified, but that VH's own hostile battery PASSED before any
  // seat was invoked — digest + refusal evidence, in the sealed chain.
  if (report.arenaGate) {
    raw.push({
      kind: "arena.gate",
      seatId: null,
      data: {
        gate: report.arenaGate.gate,
        digest: report.arenaGate.digest,
        defended: report.arenaGate.defended,
        total: report.arenaGate.total,
        summary: report.arenaGate.summary,
      },
    });
  }

  const header = {
    mission: args.mission,
    teamId: args.teamId,
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    mjVersion: args.mjVersion,
    edition: args.edition,
    autonomyArms: report.autonomyArms ?? [],
  };

  // 20.1: the header is chained FIRST, so it lands inside the hash chain, so
  // the seal covers it and the signature covers it. Previously the header sat
  // beside the chain as ordinary JSON and could be rewritten freely.
  const events: ReceiptEvent[] = [];
  let prev = "0".repeat(64);
  let seq = 0;
  const chain = [
    { kind: "receipt.header", seatId: null, data: { ...header } as Record<string, unknown> },
    ...raw,
  ];
  for (const r of chain) {
    const ts = new Date().toISOString();
    /* THE SCRUB, BEFORE THE HASH. A receipt is a thing people hand to auditors,
       ship to a SIEM and archive for years; a key inside one is a key inside
       everyone's evidence store. Scrubbing BEFORE the hash means the chain
       attests to the scrubbed fact, so the verifier's recomputation still
       matches — and the exported artifact carries no secret. */
    const scrubbedPayload = scrubAuditValue(r.data ?? {}) as Record<string, unknown>;
    const body = { seq, ts, kind: r.kind, seatId: r.seatId, data: scrubbedPayload, prev };
    const hash = await sha256hex(canon(body));
    events.push({ ...body, hash });
    prev = hash;
    seq += 1;
  }

  const seal = await hmacHex(prev, VERIFY_SECRET);
  // 11.10.1 — ISSUER SIGNATURE over the final chain hash. When the runtime cannot sign
  // (no Ed25519), the receipt stays tamper-evident via the seal and says so plainly —
  // a null signature is an honest state, never a silent one.
  const sig = await signChainHash(prev);
  if (sig) {
    return {
      format: "si-proof-receipt/2",
      header,
      events,
      seal,
      issuer: { keyId: sig.keyId, publicKeyHex: sig.publicKeyHex },
      signature: sig.sigHex,
    };
  }
  return {
    format: "si-proof-receipt/2",
    header,
    events,
    seal,
    issuer: null,
    signature: null,
    signatureNote: "This runtime has no Ed25519 (WebCrypto refused or is absent). The receipt is tamper-evident via its HMAC seal but NOT issuer-signed.",
  };
}

/**
 * External verification: no VH state, just the receipt and public constants.
 * Accepts the current si-proof-receipt/2 and the legacy mj-proof-receipt/1|2 — older receipts verify exactly as
 * before.
 *
 * 20.1 — two holes closed here, both proven by execution.
 *
 * (1) THE HEADER WAS NEVER SIGNED. The chain, the seal and the signature all
 *     covered `events[]` alone. `header` — `mission`, `teamId`, `edition`,
 *     `finishedAt`, and above all `autonomyArms`, which is the record of WHICH
 *     STRATEGY ARMS EXECUTED and is a settlement input at autonomyRuntime.ts:144
 *     — was readable and writable by anyone holding the file. Rewriting
 *     `header.mission` to "ATTACKER-MISSION" and `edition` to "pro" still
 *     verified `ok:true` with a valid signature attached.
 *
 * (2) THE SIGNATURE WAS OPTIONAL. The issuer check sat behind `&& rc.signature`,
 *     so stripping the signature produced an artifact that verified clean.
 *     Combined with the HMAC seal using a constant that ships in the client
 *     bundle (`licensing.ts` VERIFY_SECRET), that made a wholly forged receipt
 *     verify. The fallback is exactly what the old comment called "honest" —
 *     it was honest about a state it should never have accepted for the current
 *     format.
 *
 * BACKWARD COMPATIBILITY IS EXPLICIT. Legacy `mj-proof-receipt/1|2` receipts
 * minted before this change have neither a bound header nor a guaranteed
 * signature, and the constants they were sealed with must keep working forever
 * (see `SEAL_SECRET_BY_FORMAT`). They are verified exactly as before, with an
 * honest `binding` result so a caller can tell a legacy receipt from a current
 * one. The current format gets neither loophole.
 */
export async function verifyProofReceipt(rc: ProofReceipt): Promise<{ ok: true; events: number; binding: "header-bound" | "legacy-unbound"; signed: boolean } | { ok: false; reason: string }> {
  if (rc.format !== "si-proof-receipt/2" && rc.format !== "mj-proof-receipt/2" && rc.format !== "mj-proof-receipt/1") return { ok: false, reason: "unknown format" };

  // (1) Bind the header to the chain. The first event of a bound receipt IS
  // the header, so its hash is inside the chain, so the seal covers it, so the
  // signature covers it. Nothing new to store, nothing to migrate.
  const HEADER_KIND = "receipt.header";
  const bound = rc.events[0]?.kind === HEADER_KIND;
  if (rc.format === "si-proof-receipt/2" && !bound) {
    return {
      ok: false,
      reason:
        "receipt header is not bound to the signed chain — mission, teamId, edition and autonomyArms could be edited freely. " +
        "A current-format receipt must begin with a receipt.header event.",
    };
  }
  if (bound) {
    const first = rc.events[0];
    const h = first.data as Record<string, unknown> | undefined;
    if (!h || typeof h !== "object") {
      return { ok: false, reason: "receipt has a bound header event with no header data" };
    }
    /* EVERY HEADER FIELD IS CROSS-CHECKED, NOT JUST THREE OF THEM.
     *
     * The check used to compare `mission`, `teamId` and `edition` and
     * nothing else — so `startedAt`, `finishedAt`, `mjVersion` and
     * `autonomyArms` could be rewritten on the top-level header and the
     * receipt still verified. Those are the fields a reader actually
     * uses ("when did this run?", "what was granted?"), and the seal
     * DOES cover them, because the bound event carries the whole header.
     * The refusal text even claimed autonomyArms was covered, which it
     * was not.
     *
     * And the comparison is made against the SCRUBBED header, because the
     * bound event holds the scrubbed values. Comparing the raw header
     * against a scrubbed event would refuse a receipt whose mission text
     * merely LOOKED like a secret — a false refusal is its own kind of
     * lie. */
    const scrubbedHeader = scrubAuditValue((rc.header ?? {}) as Record<string, unknown>) as Record<string, unknown>;
    if (canon(scrubbedHeader) !== canon(h)) {
      const diff = Object.keys({ ...h, ...scrubbedHeader }).filter(
        (k) => canon((h as Record<string, unknown>)[k]) !== canon((scrubbedHeader as Record<string, unknown>)[k]),
      );
      return {
        ok: false,
        reason: `receipt header does not match the bound header event - the header was edited after signing (fields: ${diff.join(", ") || "unknown"})`,
      };
    }
  }

  let prev = "0".repeat(64);
  for (const e of rc.events) {
    if (e.prev !== prev) return { ok: false, reason: `chain broken at seq ${e.seq}` };
    const { hash, ...body } = e;
    const expect = await sha256hex(canon(body));
    if (expect !== hash) return { ok: false, reason: `hash mismatch at seq ${e.seq}` };
    prev = hash;
  }
  const sealSecret = SEAL_SECRET_BY_FORMAT[rc.format as keyof typeof SEAL_SECRET_BY_FORMAT] ?? VERIFY_SECRET;
  const seal = await hmacHex(prev, sealSecret);
  if (seal !== rc.seal) return { ok: false, reason: "seal mismatch" };

  // (2) Require the signature on the CURRENT format only.
  const isCurrent = rc.format === "si-proof-receipt/2";
  if (isCurrent && !rc.signature) {
    return {
      ok: false,
      reason:
        `receipt carries no issuer signature${rc.signatureNote ? ` (${rc.signatureNote})` : ""}. ` +
        "For si-proof-receipt/2 an issuer signature is required: without it the chain attests only tamper-evidence against anyone who knows the published seal secret, not authorship.",
    };
  }
  if (rc.signature) {
    if (!rc.issuer?.publicKeyHex) return { ok: false, reason: "receipt is signed but carries no issuer public key" };
    const ok = await verifyIssuerSignature(prev, rc.signature, rc.issuer.publicKeyHex);
    if (!ok) return { ok: false, reason: `issuer signature verification FAILED for chain head ${prev}` };
  }
  return { ok: true, events: rc.events.length, binding: bound ? "header-bound" : "legacy-unbound", signed: Boolean(rc.signature) };
}

/**
 * VH 15.0.0 — the generic chained-receipt builder. The Mission Loop path keeps
 * `buildProofReceipt` (summary-driven, probe-pinned); the Teammate door mints
 * receipts from an explicit event list instead — same shape, same chain, same
 * seal, same honest null-signature posture. One protocol, two minters.
 */
export async function buildChainedReceipt(args: {
  mission: string;
  teamId: string;
  startedAt: string;
  finishedAt: string;
  mjVersion: string;
  edition: string;
  events: Array<{ kind: string; seatId: string | null; data: Record<string, unknown> }>;
}): Promise<ProofReceipt> {
  const header = {
    mission: args.mission,
    teamId: args.teamId,
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    mjVersion: args.mjVersion,
    edition: args.edition,
    autonomyArms: [] as string[],
  };

  // 20.1: identical header-binding to buildProofReceipt. One protocol, two
  // minters — so both minters must bind, or the weaker one becomes the way in.
  const events: ReceiptEvent[] = [];
  let prev = "0".repeat(64);
  let seq = 0;
  const chain = [
    { kind: "receipt.header", seatId: null, data: { ...header } as Record<string, unknown> },
    ...args.events,
  ];
  for (const r of chain) {
    const ts = new Date().toISOString();
    /* THE SCRUB, BEFORE THE HASH. A receipt is a thing people hand to auditors,
       ship to a SIEM and archive for years; a key inside one is a key inside
       everyone's evidence store. Scrubbing BEFORE the hash means the chain
       attests to the scrubbed fact, so the verifier's recomputation still
       matches — and the exported artifact carries no secret. */
    const scrubbedPayload = scrubAuditValue(r.data ?? {}) as Record<string, unknown>;
    const body = { seq, ts, kind: r.kind, seatId: r.seatId, data: scrubbedPayload, prev };
    const hash = await sha256hex(canon(body));
    events.push({ ...body, hash });
    prev = hash;
    seq += 1;
  }

  const seal = await hmacHex(prev, VERIFY_SECRET);
  // Same honesty posture as buildProofReceipt: a null signature says so, plainly.
  const sig = await signChainHash(prev);
  if (sig) {
    return {
      format: "si-proof-receipt/2",
      header,
      events,
      seal,
      issuer: { keyId: sig.keyId, publicKeyHex: sig.publicKeyHex },
      signature: sig.sigHex,
    };
  }
  return {
    format: "si-proof-receipt/2",
    header,
    events,
    seal,
    issuer: null,
    signature: null,
    signatureNote: "This runtime has no Ed25519 (WebCrypto refused or is absent). The receipt is tamper-evident via its HMAC seal but NOT issuer-signed.",
  };
}

/** JSONL export — human-readable, SIEM-ingestible, chain-preserving (IETF AAT guidance). */
export function receiptToJsonl(rc: ProofReceipt): string {
  const head: Record<string, unknown> = { receipt: rc.header, format: rc.format, seal: rc.seal };
  if (rc.issuer !== undefined) head.issuer = rc.issuer;
  if (rc.signature !== undefined) head.signature = rc.signature;
  if (rc.signatureNote !== undefined) head.signatureNote = rc.signatureNote;
  const lines = [JSON.stringify(head), ...rc.events.map((e) => JSON.stringify(e))];
  return `${lines.join("\n")}\n`;
}

export function receiptFromJsonl(text: string): ProofReceipt | null {
  try {
    const lines = text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as unknown);
    if (lines.length < 1) return null;
    const head = lines[0] as {
      receipt?: ProofReceipt["header"];
      format?: string;
      seal?: string;
      issuer?: ProofReceipt["issuer"];
      signature?: ProofReceipt["signature"];
      signatureNote?: ProofReceipt["signatureNote"];
    };
    if (!head.receipt || !head.seal) return null;
    const out: ProofReceipt = {
      format: (head.format as ProofReceipt["format"]) ?? "mj-proof-receipt/1",
      header: head.receipt,
      events: lines.slice(1) as ReceiptEvent[],
      seal: head.seal,
    };
    if (head.issuer !== undefined) out.issuer = head.issuer;
    if (head.signature !== undefined) out.signature = head.signature;
    if (head.signatureNote !== undefined) out.signatureNote = head.signatureNote;
    return out;
  } catch {
    return null;
  }
}
