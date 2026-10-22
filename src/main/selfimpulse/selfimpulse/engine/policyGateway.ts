/**
 * §POLICY GATEWAY — the single decision seam for every proposed action.
 *
 * Before any tool call or dispatch reaches the execution plane, it MUST pass
 * through `policyGateway.propose(...)`. The gateway returns one of three
 * decisions:
 *
 *   • ALLOW   — the action may execute; an audit event is sealed into the
 *               receipt chain with the policy rule that allowed it.
 *   • STEER   — execution pauses for human approval; the UI surfaces the
 *               reason and waits for approve/deny.
 *   • DENY    — the action is refused in words, with the rule that refused
 *               it; no execution happens and the refusal is audited.
 *
 * The gateway is introduced in 17.1.3 to make the RISKY_TOOLS set a data-
 * driven policy rather than inline `if`s, and to prepare for CEL policy
 * rules (17.2). Every tool call — bridge, MCP, dispatch_mission — routes
 * through here, so future policies (budget, business-hours, workspace root,
 * egress scope, capability envelope) can be added in one place.
 *
 * The receipt chain always carries the decision: { kind: "policy", decision,
 * rule, reason, tool? } so refusals are auditable and the policy-replay
 * sandbox can re-evaluate historical chains against new rules.
 */
import { authorize as graphAuthorize } from "../../security/actionGraph";
import { sovereign } from "../../security/sovereign";

export type PolicyDecision = "allow" | "steer" | "deny";

export interface PolicyInput {
  /** Tool id (e.g. "workspace_write", "shell_exec", "dispatch_mission"). */
  tool: string;
  /** Tool/dispatch arguments, used by future CEL predicates. */
  args?: Record<string, unknown>;
  /** Human-facing summary for the approval card / refusal message. */
  detail: string;
  /** Optional mission ID this action belongs to (for budget-per-mission). */
  missionId?: string;
}

export interface PolicyResult {
  decision: PolicyDecision;
  /** Machine-readable rule id that produced the decision. */
  rule: string;
  /** Human-readable reason (shown in the approval card / refusal toast). */
  reason: string;
}

export interface PolicyAuditEvent {
  kind: "policy";
  decision: PolicyDecision;
  rule: string;
  reason: string;
  tool: string;
  ts: string;
}

/**
 * A PolicyRule evaluates a proposed action and returns a decision, or returns
 * `null` to abstain and let the next rule decide. The first non-null decision
 * wins; rules are evaluated in registration order. If every rule abstains the
 * action is allowed under the "default-allow" rule (which is itself named so
 * it appears in the audit trail).
 */
export type PolicyRule = (input: PolicyInput) => PolicyResult | null;

/* ── built-in rules ────────────────────────────────────────────────────── */

/**
 * Tools that ALWAYS require human approval before execution. This is the
 * original 16.10/17.1 RISKY_TOOLS behaviour, extracted as a named rule so
 * it appears in audit events ("rule: risky-tool-requires-approval") rather
 * than as an anonymous `if` in the dispatch loop.
 */
export const riskyTools = new Set<string>(["workspace_write", "dispatch_mission", "shell_exec"]);

const riskyToolRule: PolicyRule = (input) => {
  if (!riskyTools.has(input.tool)) return null;
  return {
    decision: "steer",
    rule: "risky-tool-requires-approval",
    reason: `\"${input.tool}\" is a governed action — human approval required before execution.`,
  };
};

/* 1.2.0 — THE SINGLE THROAT. The gateway is no longer its own authority:
 * the second rule judges every non-risky action against the SOVEREIGN
 * envelope (security/sovereign.ts — the owner's signed mandate), using the
 * same risk classes and the same authorize() the governed native loop uses.
 * v1.1.0 had two policy semantics: this front door default-allowed anything
 * no rule named while the native path was default-deny. Now both throats
 * speak one language:
 *   • an action the sovereign judges CRITICAL is DENIED outright — a seat
 *     never takes a critical action on its own authority;
 *   • an action OUTSIDE the envelope (high-risk on a read-only seat) STEERs
 *     to the human — the approval IS the owner act, and it is receipted;
 *   • a low-risk read within the envelope passes through (null), letting
 *     the named safe-class allow speak;
 *   • an UNCLASSIFIABLE action resolves to medium risk — which steers.
 *     The anonymous default-allow is gone: nothing executes because no rule
 *     noticed it. */
const sovereignRule: PolicyRule = (input) => {
  const env = sovereign.frontDoorEnvelope();
  const verdict = graphAuthorize(env, input.tool);
  if (verdict.allowed) return null;
  if (verdict.risk === "critical") {
    return {
      decision: "deny",
      rule: "sovereign-critical-refuses",
      reason: verdict.reason,
    };
  }
  return {
    decision: "steer",
    rule: "sovereign-envelope",
    reason: `${verdict.reason} — the human decides.`,
  };
};

/**
 * Budget-aware refuse: once per-mission spend exceeds the envelope, refuse
 * with the budget rule. 17.1.3 ships this as a hook (predicate returns false
 * = no budget) so consumers can wire in envelope state in 17.2.
 */
const budgetRule: PolicyRule = (_input) => null;

/**
 * Workspace root containment: refuse writes whose target path escapes the
 * workspace root.
 *
 * THE FS TOOLS NOW DO THIS THEMSELVES. `src/engine/tools.ts` resolves a
 * path lexically AND canonicalises it — following every symlink — and
 * refuses when the real path is outside the real root. A lexical check
 * alone was not a boundary: a symlink inside the workspace pointing at
 * `/etc` made `workspace/link/passwd` lexically inside and actually
 * outside, and the read served `/etc/passwd` to the model.
 *
 * So this rule stays a no-op: the fs tools are the only surface that
 * resolves a workspace path, and they refuse before they touch the disk.
 * It is registered to keep the rule ordering explicit, not because it
 * enforces anything.
 */
const workspaceRootRule: PolicyRule = (_input) => null;

/** Ordered list. Order matters: earlier rules win. The risky-set rule
 * speaks first so a governed tool keeps its historical rule name; the
 * sovereign envelope judges everything else. */
const RULES: PolicyRule[] = [riskyToolRule, sovereignRule, workspaceRootRule, budgetRule];

/* 1.2.0 — the anonymous default-allow is RETIRED. The fallback decision now
 * names the sovereign envelope that allowed it: a low-risk read passes with
 * a rule an auditor can read, and anything the sovereign cannot vouch for
 * never reaches this line (the sovereign rule already steered or denied it). */
const SOVEREIGN_ALLOW: PolicyResult = {
  decision: "allow",
  rule: "sovereign-safe-class",
  reason: "within the front-door envelope — low-risk action on the owner's own authority",
};

/** Trusted-startup registration of an additional rule (tests; the CEL
 *  loader when it lands). SEALED AFTER BOOT: once `sealPolicyRegistry`
 *  runs, registration refuses forever — a worker or plugin loaded later
 *  can evaluate policy, never rewrite it. The same immutable treatment
 *  the read-only action registry already has. */
let policySealed = false;

export function registerPolicyRule(rule: PolicyRule): void {
  if (policySealed) {
    throw new Error("the policy registry is sealed — rules are registered at trusted startup only, never by loaded code");
  }
  RULES.push(rule);
}

/** Freeze the policy registry — the last step of trusted startup, next to
 *  the read-only registry seal. Policy semantics become load-time fact. */
export function sealPolicyRegistry(): void {
  policySealed = true;
}

/** Test helper: clear rules back to the built-in set. PRE-SEAL ONLY — once
 *  the registry is sealed, NO path mutates RULES, this one included: a
 *  security-critical module does not keep a public reset that outlives its
 *  own seal. (Probes that need a reset must run before sealing, exactly
 *  like every other registration.) */
export function _resetPolicyRulesForProbe(): void {
  if (policySealed) {
    throw new Error("the policy registry is sealed — no path mutates rules after trusted startup, test helpers included");
  }
  RULES.length = 0;
  RULES.push(riskyToolRule, sovereignRule, workspaceRootRule, budgetRule);
}

/** Propose an action. Returns the winning decision and produces a sealed audit event. */
export function propose(input: PolicyInput): PolicyResult & { audit: PolicyAuditEvent } {
  for (const rule of RULES) {
    const r = rule(input);
    if (r) {
      return { ...r, audit: { kind: "policy", decision: r.decision, rule: r.rule, reason: r.reason, tool: input.tool, ts: new Date().toISOString() } };
    }
  }
  return { ...SOVEREIGN_ALLOW, audit: { kind: "policy", decision: "allow", rule: SOVEREIGN_ALLOW.rule, reason: SOVEREIGN_ALLOW.reason, tool: input.tool, ts: new Date().toISOString() } };
}
