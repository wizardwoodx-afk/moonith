/**
 * §ACTION PROVENANCE GRAPH + CONTINUOUS AUTHORIZATION + TIERED HITL
 *
 * Built from four results this product's own review asked for, and from the
 * research they came out of:
 *
 *  - AGENTSAFE (arXiv 2512.03180) — an Action Provenance Graph linking prompts,
 *    plans, tool calls and outcomes, with CONTINUOUS RUNTIME AUTHORIZATION:
 *    authority is re-checked at each step, not once at the start, and a step
 *    whose scope has drifted escalates instead of proceeding.
 *  - 3PM (arXiv 2601.06223) — Transparency/Accountability/Trustworthiness via
 *    agent activity logging and DECISION JOURNALING: not just what was done, but
 *    what was decided at the fork, and on what grounds.
 *  - AIR (arXiv 2602.11749) — runtime incident-response guardrails attached to
 *    the loop BEFORE and AFTER each tool call, so a run that drifts is caught
 *    mid-flight rather than in review afterwards.
 *  - Tiered HITL — three distinct human moments, not one: pre-execution approval,
 *    in-execution intervention, post-execution audit.
 *
 * WHY THIS IS A GRAPH AND NOT A LOG
 * A flat log says "these things happened". A graph says "this outcome was
 * produced by this tool call, which was authorized by this envelope, which was
 * derived from this prompt". The difference matters for the claim the product
 * actually makes: that an outcome is traceable to a decision. That is only
 * checkable if the links are hash-chained, and only useful if the chain can be
 * walked backwards from a receipt to the prompt that started it.
 *
 * THE HONESTY RULES (inherited from the rest of the codebase)
 *  - Nothing is recorded that did not happen. A refused step records the REFUSAL
 *    as the outcome; it does not record the effect the step would have had.
 *  - A node the graph cannot selfimpulse for is marked `unverified`, never dropped and
 *    never upgraded. A missing edge is reported as missing, not inferred.
 *  - Every authorization decision names the envelope it was measured against. A
 *    decision that cannot name one is not made.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { scrubAuditRecord, scrubAuditText, scrubAuditValue } from "./auditScrub";

/* ═══════════════════════════════════════════════════════════════════════════
   1 · THE GRAPH
   ═══════════════════════════════════════════════════════════════════════════ */

export type ProvenanceNodeKind = "prompt" | "plan" | "authorization" | "tool-call" | "outcome";

export interface ProvenanceNode {
  id: string;
  kind: ProvenanceNodeKind;
  /** Digest of the node's content. The content itself stays in the transcript;
   *  the graph carries the hash so a node can be proven without being stored. */
  digest: string;
  /** The nodes that caused this one. A prompt has none; an outcome has at least one. */
  parents: string[];
  ts: number;
  /** Present on every node except `prompt`. Free-form but never invented:
   *  fields the runtime cannot measure are absent, not guessed. */
  detail?: Record<string, string | number | boolean | null>;
  /** True when this node's content was signed by the issuer at record time. */
  signed: boolean;
}

export interface ActionProvenanceGraph {
  nodes: Record<string, ProvenanceNode>;
  /** Child index, so the chain can be walked back from an outcome. */
  children: Record<string, string[]>;
  rootId: string;
}

export const PROVENANCE_PREDICATE = "https://mj.desktop/action-provenance/v1";

/** Stable node id: kind + sequence, so ids are predictable to a human reading
 *  the graph and unique without a random source (which would make the digest
 *  of a node depend on when the clock ticked). */
function nodeId(kind: ProvenanceNodeKind, seq: number): string {
  return `${kind}#${String(seq).padStart(3, "0")}`;
}

export function digestOf(kind: ProvenanceNodeKind, content: unknown): string {
  return createHash("sha256")
    .update(`${PROVENANCE_PREDICATE}\n${kind}\n${stableStringify(content)}`)
    .digest("hex");
}

/** Deterministic JSON. Object key order must not change a digest, or the same
 *  decision recorded twice would produce two different hashes and the graph
 *  could not be compared across runs. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function emptyGraph(): { graph: ActionProvenanceGraph; seq: { n: number } } {
  return {
    graph: { nodes: {}, children: {}, rootId: "" },
    seq: { n: 0 },
  };
}

export function addNode(
  graph: ActionProvenanceGraph,
  seq: { n: number },
  kind: ProvenanceNodeKind,
  content: unknown,
  parents: string[],
  detail?: Record<string, string | number | boolean | null>,
  signed = true,
): ProvenanceNode {
  const id = nodeId(kind, seq.n);
  seq.n += 1;
  const node: ProvenanceNode = {
    id,
    kind,
    digest: digestOf(kind, content),
    parents,
    ts: 0, // set by the recorder; kept 0 here so digests stay content-only
    /* §AUDIT SCRUB — `detail` is the one part of a node that is STORED as text
     * rather than committed to as a digest, and tool-call nodes carry the
     * runtime's own description of what a tool said. The digest is left
     * computed over the ORIGINAL content: it is a commitment, not a document,
     * and scrubbing it would move every existing graph link. */
    detail: detail ? (scrubAuditValue(detail) as Record<string, string | number | boolean | null>) : detail,
    signed,
  };
  graph.nodes[id] = node;
  graph.children[id] = [];
  for (const p of parents) (graph.children[p] ??= []).push(id);
  if (!graph.rootId && kind === "prompt") graph.rootId = id;
  return node;
}

/**
 * Walk back from a node to the root, returning the chain.
 * Returns `null` the moment a parent id does not exist — a dangling edge is a
 * broken graph, and reporting it is the whole point of having edges.
 */
export function chainTo(graph: ActionProvenanceGraph, nodeIdOrId: string): ProvenanceNode[] | null {
  let cur: string | undefined = nodeIdOrId;
  const out: ProvenanceNode[] = [];
  const seen = new Set<string>();
  while (cur) {
    if (seen.has(cur)) return null; // cycle: refuse rather than spin
    seen.add(cur);
    const n: ProvenanceNode | undefined = graph.nodes[cur];
    if (!n) return null;
    out.push(n);
    cur = n.parents[0];
  }
  return out.reverse();
}

/** Every ancestor of a node, breadth-first. Used for the post-execution audit
 *  view: "show me everything that led to this". */
export function ancestorsOf(graph: ActionProvenanceGraph, id: string): string[] {
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    const n = graph.nodes[cur];
    if (!n) continue;
    for (const p of n.parents) if (!seen.has(p)) { seen.add(p); queue.push(p); }
  }
  return [...seen];
}

/** Structural integrity. Every parent exists; every child index points at a node
 *  that really lists it; the root is reachable from every node. */
export function verifyGraph(graph: ActionProvenanceGraph): { ok: true; nodes: number } | { ok: false; reason: string } {
  for (const [id, node] of Object.entries(graph.nodes)) {
    for (const p of node.parents) {
      if (!graph.nodes[p]) return { ok: false, reason: `${id} names a parent ${p} that is not in the graph` };
      if (!(graph.children[p] ?? []).includes(id)) {
        return { ok: false, reason: `${id} claims ${p} as a parent but ${p}'s child index does not list it` };
      }
    }
  }
  for (const [id, kids] of Object.entries(graph.children)) {
    if (!graph.nodes[id]) return { ok: false, reason: `child index names ${id}, which is not a node` };
    for (const k of kids) {
      if (!graph.nodes[k]) return { ok: false, reason: `${id} lists child ${k}, which is not a node` };
      if (!graph.nodes[k].parents.includes(id)) {
        return { ok: false, reason: `${id} lists child ${k}, but ${k} does not name ${id} as a parent` };
      }
    }
  }
  if (Object.keys(graph.nodes).length > 0) {
    for (const id of Object.keys(graph.nodes)) {
      if (!chainTo(graph, id)) return { ok: false, reason: `${id} has no walkable chain back to a prompt` };
    }
  }
  return { ok: true, nodes: Object.keys(graph.nodes).length };
}

/* ═══════════════════════════════════════════════════════════════════════════
   2 · CONTINUOUS RUNTIME AUTHORIZATION
   ═══════════════════════════════════════════════════════════════════════════ */

export type RiskClass = "low" | "medium" | "high" | "critical";

export interface AuthorityEnvelope {
  /** What the seat is allowed to touch, in the order the system understands it. */
  allowWrite: boolean;
  allowShell: boolean;
  allowNetwork: boolean;
  /** The working directory the seat is confined to. */
  root: string;
  /** Ceiling on spend for this run, in the smallest unit the ledger uses. */
  budgetCeiling: number;
  /** The highest risk the human approved in advance. */
  maxRisk: RiskClass;
}

export interface AuthorizationVerdict {
  allowed: boolean;
  /** Why. Present on every verdict, allowed or not — a silent allow is not a decision. */
  reason: string;
  /** The action being judged, for the journal. */
  action: string;
  risk: RiskClass;
  /** Set when the decision is escalated rather than simply granted or denied. */
  escalated?: boolean;
}

const RISK_ORDER: Record<RiskClass, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function riskAtLeast(actual: RiskClass, ceiling: RiskClass): boolean {
  return RISK_ORDER[actual] >= RISK_ORDER[ceiling];
}

/** Effects an action has, used to decide what the authority check must look at.
 *  Derived from the action name, not declared by the caller — a caller that
 *  declared its own risk could always understate it. */
export function riskOfAction(action: string): RiskClass {
  const a = action.toLowerCase();
  if (/(rm|delete|drop\s+table|truncate|revoke|force.push|reset --hard|chmod 777|sudo)/.test(a)) return "critical";
  if (/(write|edit|patch|apply|commit|install|exec|run|shell|http|fetch|curl|npm|pip)/.test(a)) return "high";
  if (/(test|read|stat|ls|grep|search)/.test(a)) return "low";
  return "medium";
}

/**
 * The continuous check. Called BEFORE every tool call, not once at mission
 * start, because authority held at step 0 says nothing about step 7.
 *
 * It answers three separate questions and reports which one failed, so the
 * refusal names the actual cause instead of a generic "denied".
 */
export function authorize(env: AuthorityEnvelope, action: string): AuthorizationVerdict {
  const a = action.toLowerCase();
  const risk = riskOfAction(action);

  if (!env || typeof env.root !== "string" || env.root.length === 0) {
    return { allowed: false, reason: "no authority envelope: a decision that cannot name its envelope is not made", action, risk, escalated: true };
  }
  if (risk === "critical") {
    return {
      allowed: false,
      reason: "critical-risk actions are never taken on the seat's own authority; they require a named human",
      action, risk, escalated: true,
    };
  }
  // Capability first: it is the most specific and most actionable reason, and it
  // is the one the operator can actually change for THIS seat. The risk ceiling
  // is checked after, because "your ceiling is too low" is a much worse message
  // to give someone whose seat is simply read-only.
  if (/(write|edit|patch|apply|commit)/.test(a) && !env.allowWrite) {
    return { allowed: false, reason: "this seat is read-only: it may not change the workspace", action, risk, escalated: true };
  }
  if (/(exec|run|shell|npm|pip)/.test(a) && !env.allowShell) {
    return { allowed: false, reason: "shell execution is outside this seat's authority", action, risk, escalated: true };
  }
  if (/(http|fetch|curl|network)/.test(a) && !env.allowNetwork) {
    return { allowed: false, reason: "network egress is outside this seat's authority", action, risk, escalated: true };
  }
  if (riskAtLeast(risk, "high") && !riskAtLeast(env.maxRisk, "high")) {
    return {
      allowed: false,
      reason: `action is ${risk} risk but this seat's approved ceiling is ${env.maxRisk}`,
      action, risk, escalated: true,
    };
  }
  return { allowed: true, reason: `within the approved envelope (ceiling ${env.maxRisk}, write=${env.allowWrite}, shell=${env.allowShell})`, action, risk };
}

/**
 * Continuity: has authority DRIFTED since the envelope was issued?
 * AGENTSAFE's point is that authority is attenuated over a run. This compares
 * the envelope a step was authorized against with the one it is being run under
 * and reports a drift rather than silently continuing under the new one.
 */
export function detectDrift(issued: AuthorityEnvelope, current: AuthorityEnvelope): string | null {
  // Shrinkage first: that is the expected, benign direction (a human tightening
  // authority mid-run). Growth is reported too and is a louder event.
  if (issued.allowWrite && !current.allowWrite) return "write authority was attenuated mid-run";
  if (issued.allowShell && !current.allowShell) return "shell authority was attenuated mid-run";
  if (issued.allowNetwork && !current.allowNetwork) return "network authority was attenuated mid-run";
  if (RISK_ORDER[current.maxRisk] < RISK_ORDER[issued.maxRisk]) return "the risk ceiling was lowered mid-run";
  if (current.budgetCeiling < issued.budgetCeiling) return "the budget ceiling was lowered mid-run";
  if (current.root !== issued.root) return `the workspace root moved from ${issued.root} to ${current.root}`;
  // ESCALATION. A run that acquired more authority than it was issued is the
  // exact failure mode continuous authorization exists to catch. Reporting only
  // shrinkage would let a self-escalating run pass as "no drift".
  if (!issued.allowWrite && current.allowWrite) return "write authority was ESCALATED mid-run without a human decision";
  if (!issued.allowShell && current.allowShell) return "shell authority was ESCALATED mid-run without a human decision";
  if (!issued.allowNetwork && current.allowNetwork) return "network authority was ESCALATED mid-run without a human decision";
  if (RISK_ORDER[current.maxRisk] > RISK_ORDER[issued.maxRisk]) return "the risk ceiling was ESCALATED mid-run without a human decision";
  if (current.budgetCeiling > issued.budgetCeiling) return "the budget ceiling was ESCALATED mid-run without a human decision";
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3 · TIERED HITL
   ═══════════════════════════════════════════════════════════════════════════ */

export type HitlTier = "pre-execution" | "in-execution" | "post-execution";

export interface HitlRequest {
  tier: HitlTier;
  /** What the human is being asked to decide. */
  question: string;
  /** The context they need to decide without reading a transcript. */
  evidence: Record<string, string | number | boolean>;
  /** What happens if they do not answer in time. */
  defaultIfSilent: "proceed" | "refuse";
  /** How long the human has, in ms. 0 means "block until answered". */
  timeoutMs: number;
}

export type HitlOutcome = "approved" | "refused" | "timed-out";

export interface HitlRecord {
  tier: HitlTier;
  question: string;
  outcome: HitlOutcome;
  /** Who answered, when the answer is attributable to a person. */
  answeredBy?: string;
  ts: number;
  evidence: Record<string, string | number | boolean>;
}

export type HitlResponder = (req: HitlRequest) => Promise<HitlOutcome | { outcome: HitlOutcome; by: string }>;

/**
 * The three tiers are genuinely different moments and the difference is
 * enforced, not documented:
 *
 *   pre-execution  — BEFORE anything runs. Default if silent is REFUSE, because
 *                    the work has not happened and refusing costs only delay.
 *   in-execution   — WHILE running, after a drift or an escalation. Default if
 *                    silent is REFUSE, because the run has already been shown to
 *                    want something outside its envelope.
 *   post-execution — AFTER the work, for audit. Default if silent is PROCEED,
 *                    because the work is already done and blocking here would
 *                    mean discarding a completed, verified result on a formality.
 *
 * That asymmetry is the whole design. An audit that can veto completed work is
 * not an audit, and an approval that times out into "proceed" is not approval.
 */
export async function askHuman(req: HitlRequest, respond: HitlResponder): Promise<HitlRecord> {
  const started = Date.now();
  let outcome: HitlOutcome;
  let answeredBy: string | undefined;

  if (req.timeoutMs > 0) {
    const timeout = new Promise<HitlOutcome>((r) => setTimeout(() => r("timed-out"), req.timeoutMs));
    const answer = respond(req);
    const winner = await Promise.race([answer, timeout]);
    if (typeof winner === "object" && winner !== null && "outcome" in winner) {
      outcome = winner.outcome;
      answeredBy = winner.by;
    } else {
      outcome = winner as HitlOutcome;
    }
  } else {
    const answer = await respond(req);
    if (typeof answer === "object" && answer !== null && "outcome" in answer) {
      outcome = answer.outcome;
      answeredBy = answer.by;
    } else {
      outcome = answer as HitlOutcome;
    }
  }

  if (outcome === "timed-out") {
    outcome = req.defaultIfSilent === "proceed" ? "approved" : "refused";
    answeredBy = answeredBy ?? "(silent — default applied)";
  }

  return {
    tier: req.tier,
    question: scrubAuditText(req.question),
    outcome,
    answeredBy,
    ts: started,
    /* The evidence the human was judged on is kept as what a later reader may
     * see, not as what the runtime happened to hand the dialog: a HITL request's
     * evidence map is exactly where a caller puts the diff, the endpoint and the
     * command line it wants reviewed. */
    evidence: scrubAuditRecord(req.evidence),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   4 · THE DECISION JOURNAL
   ═══════════════════════════════════════════════════════════════════════════ */

export interface JournalEntry {
  seq: number;
  ts: number;
  /** Which of the three moments this decision belongs to. */
  stage: "authorize" | "hitl" | "drift" | "execute" | "observe";
  /** The decision in one line, written for a human reading a log at 2am. */
  decision: string;
  outcome: "allowed" | "refused" | "approved" | "timed-out" | "completed" | "failed";
  /** The graph node this decision produced or governed, when there is one. */
  nodeId?: string;
  evidence: Record<string, string | number | boolean>;
  /** The digest of the previous entry. This is what makes the journal
   *  tamper-evident: editing entry 4 invalidates every entry after it. */
  prev: string;
  digest: string;
}

export class DecisionJournal {
  private entries: JournalEntry[] = [];
  private lastDigest = "genesis";

  append(
    entry: Omit<JournalEntry, "seq" | "prev" | "digest" | "ts"> & { ts?: number },
  ): JournalEntry {
    const body = {
      seq: this.entries.length,
      ts: entry.ts ?? 0,
      stage: entry.stage,
      /* §AUDIT SCRUB — `decision` is a sentence written straight out of what
       * the runtime was doing: the action string (which a model composed), the
       * authorization reason, the guard trip's `detail`, which for
       * `path-escape` is built from the tool's own stdout. `evidence` is the
       * same story in key/value form. Scrubbed at append, so the digest below
       * commits to what was ACTUALLY STORED rather than to what the caller
       * tried to write — a chain that hashed the unsent text would verify a
       * journal that does not contain it. */
      decision: scrubAuditText(entry.decision),
      outcome: entry.outcome,
      nodeId: entry.nodeId ?? null,
      evidence: scrubAuditRecord(entry.evidence),
      prev: this.lastDigest,
    };
    const digest = createHash("sha256").update(stableStringify(body)).digest("hex");
    const full: JournalEntry = { ...body, nodeId: body.nodeId ?? undefined, digest };
    this.entries.push(full);
    this.lastDigest = digest;
    return full;
  }

  all(): readonly JournalEntry[] {
    return this.entries;
  }

  /**
   * Verify the chain. Returns the index of the first entry whose digest does not
   * match its content, or -1. It does NOT stop at the first break: a journal
   * with a gap is more interesting than a journal that merely fails, so the
   * caller gets every index.
   */
  verify(): { ok: boolean; brokenAt: number[] } {
    const brokenAt: number[] = [];
    let prev = "genesis";
    for (const e of this.entries) {
      const body = {
        seq: e.seq, ts: e.ts, stage: e.stage, decision: e.decision,
        outcome: e.outcome, nodeId: e.nodeId ?? null, evidence: e.evidence, prev,
      };
      const expect = createHash("sha256").update(stableStringify(body)).digest("hex");
      if (expect !== e.digest || e.prev !== prev) brokenAt.push(e.seq);
      prev = e.digest;
    }
    return { ok: brokenAt.length === 0, brokenAt };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   5 · THE AIR GUARD — before AND after each tool call
   ═══════════════════════════════════════════════════════════════════════════ */

export interface GuardTrip {
  when: "before" | "after";
  rule: string;
  detail: string;
}

/**
 * AIR: runtime incident-response guardrails attached to the loop. These run
 * around the call, not at the end of the mission, because an incident response
 * that only fires in post-mortem is a report, not a response.
 *
 * BEFORE — the call is judged against the live envelope and the graph is told
 *          what is about to happen.
 * AFTER  — the RESULT is judged, because a tool that was authorized can still
 *          return something that warrants stopping the run (a path escaping the
 *          root, an error that repeats, a size that should not have happened).
 */
export function guardBefore(args: {
  action: string;
  env: AuthorityEnvelope;
  verdict: AuthorizationVerdict;
  repeatCount: number;
}): GuardTrip[] {
  const trips: GuardTrip[] = [];
  if (!args.verdict.allowed) {
    trips.push({ when: "before", rule: "authority", detail: scrubAuditText(args.verdict.reason) });
  }
  if (args.verdict.escalated) {
    trips.push({ when: "before", rule: "escalation", detail: scrubAuditText(`escalated to a human: ${args.verdict.reason}`) });
  }
  // A tool called the same thing many times in a row is the signature of a loop
  // that is not converging. Stopping it is cheaper than reading the transcript.
  if (args.repeatCount >= 3) {
    trips.push({
      when: "before",
      rule: "non-convergence",
      detail: scrubAuditText(`"${args.action}" has been attempted ${args.repeatCount} times; the run is not converging`),
    });
  }
  return trips;
}

export function guardAfter(args: {
  action: string;
  env: AuthorityEnvelope;
  stdout: string;
  failed: boolean;
  failureStreak: number;
}): GuardTrip[] {
  const trips: GuardTrip[] = [];
  const out = args.stdout ?? "";
  // A path escaping the sandbox is the single most important runtime signal: a
  // tool that can name a path outside its root is the incident.
  const root = args.env.root;
  const escaped = [...out.matchAll(/(?:^|\s)((?:\/|\.\.\/)[^\s"'`,)]+)/g)]
    .map((m) => m[1])
    // The exemption list is read-only library/system paths that appear in
    // ordinary output. /etc is deliberately NOT exempt: it holds secrets, so a
    // tool naming it is reporting something the operator needs to see. Exempting
    // it here would have made the most common real incident look clean.
    .filter((p) => p.startsWith("/") && !p.startsWith(root)
      && !/^\/(usr|proc|sys|dev|lib|bin|sbin)\b/.test(p));
  if (escaped.length > 0) {
    trips.push({
      when: "after",
      rule: "path-escape",
      /* The paths stay readable — a filesystem path is the audit fact this rule
       * exists to surface, and scrubbing it would blind the guard it belongs to.
       * Scrubbing the composed line still catches the case where the escape is
       * reported with a credential-bearing URL attached to it. */
      detail: scrubAuditText(`output names ${escaped.length} path(s) outside the seat root ${root}: ${escaped.slice(0, 3).join(", ")}`),
    });
  }
  if (args.failed && args.failureStreak >= 3) {
    trips.push({
      when: "after",
      rule: "repeated-failure",
      detail: scrubAuditText(`${args.failureStreak} consecutive failures — stopping rather than burning the budget on a loop`),
    });
  }
  if (out.length > 2_000_000) {
    trips.push({ when: "after", rule: "output-volume", detail: scrubAuditText(`a single tool call returned ${out.length} bytes`) });
  }
  return trips;
}

/* ═══════════════════════════════════════════════════════════════════════════
   6 · THE SESSION — the three wired together, as the loop uses them
   ═══════════════════════════════════════════════════════════════════════════ */

export interface GovernedSession {
  graph: ActionProvenanceGraph;
  journal: DecisionJournal;
  issued: AuthorityEnvelope;
  trips: GuardTrip[];
  /** The last human decision, for the post-execution audit view. */
  hitl: HitlRecord[];
  /** The LIVE authority source — read fresh before every governed step.
   *
   * v1.1.0's review caught the honest defect: with no source, governStep
   * compared `session.issued` to itself, so the drift detector could never
   * fire in a running agent — it proved the detector works, not that the
   * runtime detects drift. The sovereign authority (security/sovereign.ts)
   * supplies this reader: it re-verifies the seat's signed mandate against
   * its profile on every call and returns null when authority is no longer
   * valid (tampered, expired, or the config changed under the mandate).
   * A session without a source behaves exactly as before: issued is
   * authoritative for the whole run. */
  source?: () => AuthorityEnvelope | null;
}

/** A REVOKED envelope: what a seat runs under when its live authority is
 *  gone. Fail-closed by construction — nothing is writable, runnable or
 *  reachable, and the ceiling is the floor. */
function revokedEnvelope(issued: AuthorityEnvelope): AuthorityEnvelope {
  return {
    allowWrite: false, allowShell: false, allowNetwork: false,
    root: issued.root, budgetCeiling: 0, maxRisk: "low",
  };
}

/**
 * One call per tool invocation, in the order the runtime performs it.
 * Returns the verdict the caller must obey plus the trips the guard raised;
 * the caller is expected to STOP on a trip, and to record the stop.
 */
export function governStep(
  session: GovernedSession,
  seq: { n: number },
  args: { action: string; repeatCount: number; stdout?: string; failed?: boolean; failureStreak?: number },
): { verdict: AuthorizationVerdict; proceed: boolean; tripped: GuardTrip[] } {
  /* THE LIVE READ. Authority is refreshed from the session's source before
   * the step is judged — the mandate is re-verified and its profile digest
   * re-measured against the seat's actual configuration. A null read means
   * the sovereign no longer vouches for this seat, and the step runs under
   * the revoked envelope: fail-closed, with the reason named in the journal. */
  const refreshed = session.source ? session.source() : session.issued;
  const live = refreshed ?? revokedEnvelope(session.issued);
  /* An unavailable source is its OWN drift cause — it is not an attenuation.
   * Name the root cause: the mandate is gone, so the envelope was revoked,
   * and the attenuation the revoked envelope produces is a symptom. */
  const drift = refreshed
    ? detectDrift(session.issued, live)
    : "the live authority is unavailable (mandate invalid, expired, or its profile changed) — authority revoked for this step";
  const verdict = authorize(live, args.action);
  const before = guardBefore({ action: args.action, env: live, verdict, repeatCount: args.repeatCount });

  if (drift) {
    session.journal.append({
      stage: "drift", decision: `authority drift: ${drift}`, outcome: "refused",
      evidence: { action: args.action, liveRefreshed: refreshed !== null },
    });
  }
  if (refreshed === null && session.source) {
    session.journal.append({
      stage: "authorize", decision: "live authority read returned null — proceeding under the revoked envelope",
      outcome: "refused", evidence: { action: args.action, liveRefreshed: false },
    });
  }

  const authNode = addNode(
    session.graph, seq, "authorization",
    { action: args.action, allowed: verdict.allowed, reason: verdict.reason, risk: verdict.risk },
    [session.graph.rootId].filter(Boolean),
    { action: args.action, allowed: verdict.allowed, risk: verdict.risk },
  );
  session.journal.append({
    stage: "authorize",
    decision: `${verdict.allowed ? "allow" : "refuse"} "${args.action}": ${verdict.reason}`,
    outcome: verdict.allowed ? "allowed" : "refused",
    nodeId: authNode.id,
    evidence: { action: args.action, risk: verdict.risk, escalated: verdict.escalated === true },
  });

  if (!verdict.allowed || drift) {
    addNode(session.graph, seq, "outcome", { action: args.action, result: "refused", reason: drift ?? verdict.reason }, [authNode.id]);
    /* A DRIFTED AUTHORITY IS A STOP, not a note. AGENTSAFE's contract is
     * escalate-instead-of-proceed: a step whose envelope moved mid-run does
     * not continue under the new one. The synthetic trip names the rule so
     * the caller's stop message says WHY without re-deriving it. */
    const driftTrip = drift
      ? [{ when: "before" as const, rule: "authority-drift", detail: drift }]
      : [];
    return { verdict, proceed: false, tripped: [...before, ...driftTrip] };
  }

  const after = guardAfter({
    action: args.action, env: session.issued, stdout: args.stdout ?? "",
    failed: args.failed === true, failureStreak: args.failureStreak ?? 0,
  });
  const trips = [...before, ...after];
  if (trips.length > 0) {
    for (const t of trips) {
      session.journal.append({
        stage: "observe", decision: `guard tripped (${t.when}/${t.rule}): ${t.detail}`,
        outcome: "refused", evidence: { rule: t.rule, when: t.when },
      });
    }
    return { verdict, proceed: false, tripped: trips };
  }
  return { verdict, proceed: true, tripped: [] };
}

export function startSession(
  env: AuthorityEnvelope,
  prompt: string,
  opts?: { source?: () => AuthorityEnvelope | null },
): GovernedSession {
  const { graph, seq } = emptyGraph();
  addNode(graph, seq, "prompt", { prompt }, [], { bytes: prompt.length });
  const journal = new DecisionJournal();
  journal.append({
    stage: "execute",
    decision: `session opened with a ${env.maxRisk} ceiling, write=${env.allowWrite}, shell=${env.allowShell}`,
    outcome: "allowed",
    nodeId: graph.rootId,
    evidence: { maxRisk: env.maxRisk, allowWrite: env.allowWrite, allowShell: env.allowShell, root: env.root },
  });
  return { graph, journal, issued: env, trips: [], hitl: [], source: opts?.source };
}

/** Compare two digests without leaking their contents through timing. */
export function sameDigest(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
