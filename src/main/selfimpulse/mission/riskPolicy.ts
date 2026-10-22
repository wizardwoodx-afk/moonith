/**
 * §10 Risk-aware autonomy.
 *
 * Actions are classified into four risk classes. The classification is derived from the
 * action itself — not asserted by the agent that wants to perform it. An agent cannot
 * downgrade its own risk class.
 */

import type { RiskClass } from "./types";

export interface RiskRule {
  /** Substrings/patterns matched against the action description and tool name. */
  match: RegExp;
  risk: RiskClass;
  why: string;
}

/**
 * Ordered most-severe first: the first match wins, so a specific CRITICAL rule cannot be
 * shadowed by a broader LOW rule.
 */
export const RISK_RULES: RiskRule[] = [
  // ---- CRITICAL -------------------------------------------------------------
  { match: /\bdeploy\b.*\b(prod|production)\b|\b(prod|production)\b.*\bdeploy\b/i, risk: "CRITICAL", why: "Production deployment is irreversible for end users." },
  { match: /\bdelete\b.*\b(data|database|volume|bucket|table)\b|\bdrop\s+(table|database)\b|\btruncate\b/i, risk: "CRITICAL", why: "Data destruction." },
  { match: /\b(rotate|revoke|modify|create|delete)\b.*\b(credential|secret|api[- ]?key|token|password)\b/i, risk: "CRITICAL", why: "Credential material." },
  { match: /\b(iam|rbac|role|policy)\b.*\b(grant|attach|modify|delete|create)\b|\bmodify\b.*\b(access policy|identity)\b/i, risk: "CRITICAL", why: "Identity and access policy." },
  { match: /\bgit\s+push\b.*(--force|-f)\b|\bforce[- ]push\b/i, risk: "CRITICAL", why: "Force push rewrites shared history." },
  { match: /\brm\s+-rf\s+\/(?!\w)|\bformat\b.*\bdisk\b|\bmkfs\b/i, risk: "CRITICAL", why: "Destructive filesystem operation." },
  { match: /\b(drop|migrate)\b.*\bproduction\b/i, risk: "CRITICAL", why: "Production schema change." },

  // ---- HIGH -----------------------------------------------------------------
  { match: /\bgit\s+push\b|\bpublish\b.*\b(package|release|npm|crate)\b|\btag\b.*\brelease\b/i, risk: "HIGH", why: "Publishes work outside the workspace." },
  { match: /\b(terraform|pulumi|cloudformation|kubectl|helm)\b.*\b(apply|destroy|delete|scale)\b/i, risk: "HIGH", why: "Infrastructure mutation." },
  { match: /\bmodify\b.*\b(deployment|ci|cd|pipeline)\s*config|\bedit\b.*\.github\/workflows/i, risk: "HIGH", why: "Deployment configuration." },
  { match: /\bnpm\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b/i, risk: "HIGH", why: "Publishes an artifact to a public registry." },
  { match: /\bALTER\s+TABLE\b|\bCREATE\s+INDEX\b.*\bCONCURRENTLY\b/i, risk: "HIGH", why: "Schema migration." },

  // ---- MEDIUM ---------------------------------------------------------------
  { match: /\b(npm|pnpm|yarn)\s+(install|add|remove)\b|\bpip\s+install\b|\bcargo\s+add\b|\bapt(-get)?\s+install\b|\bbrew\s+install\b/i, risk: "MEDIUM", why: "Installs packages, changing the dependency set." },
  { match: /\b(edit|write|modify|patch|refactor|implement|fix)\b.*\b(file|code|source|config)\b|\bapply\s+diff\b/i, risk: "MEDIUM", why: "Edits code or configuration." },
  { match: /\bgit\s+(commit|checkout|branch|merge|rebase|reset)\b/i, risk: "MEDIUM", why: "Mutates repository state." },
  { match: /\b(set|export)\b.*\b(env|environment variable)\b|\bedit\b.*\.(env|toml|ya?ml|ini)\b/i, risk: "MEDIUM", why: "Configuration change." },
  { match: /\bmigration\b|\bscaffold\b|\bgenerate\b.*\b(scaffold|boilerplate)\b/i, risk: "MEDIUM", why: "Bulk file creation." },

  // ---- LOW ------------------------------------------------------------------
  { match: /\b(read|view|cat|inspect|list|show)\b.*\b(file|log|output|diff|state)\b/i, risk: "LOW", why: "Read-only inspection." },
  { match: /\b(run|execute)\b.*\b(test|tests|test suite|lint|typecheck|build)\b/i, risk: "LOW", why: "Local verification with no side effects outside the workspace." },
  { match: /\b(research|search|summarise|summarize|analyse|analyze|explain|review|plan|draft)\b/i, risk: "LOW", why: "Analysis produces no external change." },
];

export interface RiskClassification {
  risk: RiskClass;
  why: string;
  matchedRule: string | null;
}

/**
 * Classify an action. Unknown actions default to MEDIUM, never LOW: an unrecognised action
 * is not thereby safe.
 */
export function classifyRisk(action: string, toolName?: string): RiskClassification {
  const haystack = [toolName ?? "", action].join(" :: ");
  for (const rule of RISK_RULES) {
    if (rule.match.test(haystack)) {
      return { risk: rule.risk, why: rule.why, matchedRule: String(rule.match) };
    }
  }
  return {
    risk: "MEDIUM",
    why: "Unrecognised action. Unknown actions are treated as MEDIUM, not LOW.",
    matchedRule: null,
  };
}

/**
 * Which tools a harness/agent may use at a given risk ceiling. The ceiling is the mission
 * policy's approval threshold: anything strictly above it needs a human.
 */
export function requiresHuman(risk: RiskClass, approvalThreshold: RiskClass, autonomy: "AUTONOMOUS" | "SUPERVISED" | "HUMAN_ONLY"): boolean {
  if (autonomy === "HUMAN_ONLY") return true;
  if (risk === "CRITICAL") return true; // §10: CRITICAL is always human-gated
  if (autonomy === "AUTONOMOUS") return false;
  const order: RiskClass[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  return order.indexOf(risk) >= order.indexOf(approvalThreshold);
}

/** Human-readable policy table for the UI (§10: make the policy visible). */
export function policyTable(autonomy: "AUTONOMOUS" | "SUPERVISED" | "HUMAN_ONLY", approvalThreshold: RiskClass) {
  const order: RiskClass[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  return order.map((risk) => ({
    risk,
    behaviour: requiresHuman(risk, approvalThreshold, autonomy)
      ? "Human approval required"
      : risk === "LOW"
        ? "Autonomous"
        : "Policy validation, then autonomous",
    examples: RISK_RULES.filter((r) => r.risk === risk)
      .slice(0, 3)
      .map((r) => r.why),
  }));
}
