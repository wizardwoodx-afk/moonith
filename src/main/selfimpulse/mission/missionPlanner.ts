/**
 * §2 Mission planner.
 *
 * Deterministic and inspectable. Given a goal, constraints, success criteria, budget,
 * deadline and risk policy, it proposes agents, framework, execution graph, harnesses,
 * tools, verification strategy and approval checkpoints — with a written rationale for
 * every step.
 *
 * It is rule-driven rather than model-driven on purpose: a plan you cannot explain is a plan
 * you cannot audit. Every step carries `rationale`, and the plan is presented to the user
 * BEFORE anything executes.
 */

import { uid } from "../app/id";
import { AGENT_FRAMEWORKS } from "../domain/frameworks";
import { DEFINITIONS_BY_ID } from "../domain/nodeLibrary";
import type { HarnessId } from "../domain/harness";
import type {
  Mission,
  MissionPlan,
  PlanStep,
  PlanStepKind,
  RiskClass,
} from "./types";
import { classifyRisk } from "./riskPolicy";

export interface PlannerRequest {
  objective: string;
  constraints: string[];
  successCriteria: string[];
  budgetUsd: number;
  deadlineMs: number | null;
  autonomy: Mission["riskPolicy"]["autonomy"];
  languages?: string[];
  repository?: string;
  preferredFramework?: string | null;
  allowedHarnesses?: HarnessId[];
}

interface DomainSignals {
  domain: string;
  needsArchitecture: boolean;
  needsSecurity: boolean;
  needsTests: boolean;
  needsResearch: boolean;
  needsBrowser: boolean;
  needsData: boolean;
  needsDocs: boolean;
  needsRelease: boolean;
  languages: string[];
  evidence: string[];
}

const DOMAIN_RULES: Array<{ domain: string; match: RegExp; why: string }> = [
  { domain: "saas-build", match: /\b(saas|web ?app|dashboard|product|platform|mvp)\b/i, why: "Product build" },
  { domain: "security", match: /\b(security|audit|threat|pentest|vulnerab|cve|compliance)\b/i, why: "Security work" },
  { domain: "research", match: /\b(research|investigate|analys|analyz|survey|literature|market)\b/i, why: "Research task" },
  { domain: "migration", match: /\b(migrat|upgrade|port\b|rewrit|modernis|moderniz)\b/i, why: "Migration" },
  { domain: "incident", match: /\b(incident|outage|postmortem|on-?call|rollback)\b/i, why: "Incident response" },
  { domain: "data", match: /\b(pipeline|etl|warehouse|dataset|dbt|streaming)\b/i, why: "Data engineering" },
  { domain: "content", match: /\b(content|copy|blog|documentation|docs|write)\b/i, why: "Content production" },
  { domain: "release", match: /\b(release|deploy|ship|launch|cut)\b/i, why: "Release engineering" },
];

const LANG_RULES: Array<{ lang: string; match: RegExp }> = [
  { lang: "TypeScript", match: /\b(typescript|tsx?\b|node|react|next\.?js|vue|svelte)\b/i },
  { lang: "Python", match: /\b(python|django|flask|fastapi|pandas|pytorch)\b/i },
  { lang: "Rust", match: /\b(rust|cargo|tokio)\b/i },
  { lang: "Go", match: /\b(go|golang)\b/i },
  { lang: "SQL", match: /\b(sql|postgres|mysql|sqlite|database|schema)\b/i },
  { lang: "Infrastructure", match: /\b(terraform|kubernetes|docker|aws|gcp|azure|helm)\b/i },
];

/** Read the objective for what it actually implies. Evidence is retained for the UI. */
export function analyseObjective(req: PlannerRequest): DomainSignals {
  const text = [req.objective, ...req.constraints, ...req.successCriteria].join("\n");
  const evidence: string[] = [];
  const domains: string[] = [];
  for (const rule of DOMAIN_RULES) {
    if (rule.match.test(text)) {
      domains.push(rule.domain);
      evidence.push(`${rule.why}: matched /${rule.match.source}/`);
    }
  }
  const languages = LANG_RULES.filter((l) => l.match.test(text)).map((l) => l.lang);
  if (req.languages?.length) {
    for (const l of req.languages) if (!languages.includes(l)) languages.push(l);
  }
  if (languages.length) evidence.push(`Languages detected: ${languages.join(", ")}`);

  const hasCode = languages.length > 0 || domains.includes("saas-build") || domains.includes("migration") || /\b(implement|build|code|feature|api|service)\b/i.test(text);

  return {
    domain: domains[0] ?? "general",
    needsArchitecture: hasCode && (domains.includes("saas-build") || domains.includes("migration") || /\b(architect|design|system|scale|schema)\b/i.test(text)),
    needsSecurity: domains.includes("security") || /\b(secur|auth|permission|credential|pii|gdpr|compliance)\b/i.test(text),
    needsTests: hasCode || /\b(test|qa|verif|quality|regression)\b/i.test(text),
    needsResearch: domains.includes("research") || domains.includes("data") || /\b(research|unknown|explore|compare|evaluate options)\b/i.test(text),
    needsBrowser: /\b(browse|scrape|crawl|web page|screenshot|e2e)\b/i.test(text),
    needsData: domains.includes("data") || /\b(dataset|csv|database|query|metrics)\b/i.test(text),
    needsDocs: domains.includes("content") || /\b(document|docs|readme|changelog|report)\b/i.test(text),
    // "production-ready" describes something end users will run: that is release-shaped even
    // when the sentence never uses the word ship/deploy/publish.
    needsRelease:
      domains.includes("release") ||
      /\b(release|deploy|ship|publish)\b/i.test(text) ||
      /\bproduction[- ]?ready\b|\bgo[- ]?live\b|\bproduction\b/i.test(text),
    languages,
    evidence,
  };
}

/**
 * Framework selection. Scored, not guessed, and the scores are returned so the plan can
 * show why the framework was chosen.
 */
export function selectFramework(req: PlannerRequest, sig: DomainSignals): { frameworkId: string; scores: Array<{ id: string; score: number; why: string[] }> } {
  const text = [req.objective, ...req.constraints].join(" ").toLowerCase();
  const scores = AGENT_FRAMEWORKS.map((fw) => {
    const why: string[] = [];
    let score = 0;
    if (req.preferredFramework === fw.id) {
      score += 100;
      why.push("explicitly preferred by the mission");
    }
    if (fw.category === "engineering" && (sig.domain === "saas-build" || sig.domain === "migration")) {
      score += 3;
      why.push(`engineering framework for ${sig.domain}`);
    }
    if (fw.category === "security" && sig.needsSecurity) {
      score += 4;
      why.push("security work required");
    }
    if (fw.category === "knowledge" && sig.needsResearch) {
      score += 4;
      why.push("research required");
    }
    if (fw.category === "risk" && (sig.needsRelease || sig.needsSecurity)) {
      score += 3;
      why.push("risk gating required");
    }
    if (fw.pattern === "gate" && req.autonomy !== "AUTONOMOUS") {
      score += 2;
      why.push(`autonomy=${req.autonomy} benefits from an explicit gate`);
    }
    if (fw.pattern === "map-reduce" && sig.needsResearch) {
      score += 2;
      why.push("fan-out suits independent research");
    }
    if (fw.id === "fw.specdriven" && sig.domain === "saas-build") {
      score += 3;
      why.push("spec-driven suits a product build");
    }
    if (fw.id === "fw.due-diligence" && sig.domain === "research") {
      score += 2;
      why.push("due-diligence shape suits investigation");
    }
    // Every framework must at least be able to staff its roster.
    const staffable = fw.roster.filter((r) => DEFINITIONS_BY_ID.has(r)).length;
    if (staffable < fw.roster.length) {
      score -= 10 * (fw.roster.length - staffable);
      why.push(`${fw.roster.length - staffable} roster member(s) unresolvable`);
    }
    if (/\bcrew\b/.test(text) && fw.id === "fw.crew-cli") {
      score += 5;
      why.push("user asked for a CLI crew");
    }
    return { id: fw.id, score, why };
  }).sort((a, b) => b.score - a.score);

  return { frameworkId: scores[0].id, scores };
}

interface StepSpec {
  kind: PlanStepKind;
  agentDefId: string;
  title: string;
  purpose: string;
  capabilities: string[];
  preferredHarness: HarnessId | null;
  dependsOn: number[];
  rationale: string;
}

/**
 * Build the step list. Steps are declared with index-based dependencies and then resolved to
 * ids, so the graph is always acyclic by construction.
 */
function buildSteps(sig: DomainSignals, req: PlannerRequest): StepSpec[] {
  const steps: StepSpec[] = [];
  let i = 0;
  const idx = () => i++;

  const research = sig.needsResearch ? idx() : -1;
  if (research >= 0) {
    steps[research] = {
      kind: "research",
      agentDefId: "agent.researcher",
      title: "Research",
      purpose: `Establish what is actually known about: ${req.objective}. Cite evidence, mark unknowns, list the options that were rejected and why.`,
      capabilities: ["research", "synthesis"],
      preferredHarness: null,
      dependsOn: [],
      rationale: "The objective contains unknowns; planning without research would guess.",
    };
  }

  const arch = sig.needsArchitecture ? idx() : -1;
  if (arch >= 0) {
    steps[arch] = {
      kind: "architecture",
      agentDefId: "agent.architect",
      title: "Architecture",
      purpose: `Produce a concrete architecture for: ${req.objective}. Name the components, the data model, the interfaces, the failure modes and the trade-offs taken.`,
      capabilities: ["architecture", "design"],
      preferredHarness: null,
      dependsOn: research >= 0 ? [research] : [],
      rationale: "A build of this shape needs an explicit design before code, so failures surface as design arguments rather than test failures.",
    };
  }

  const impl = idx();
  steps[impl] = {
    kind: "implementation",
    agentDefId: "agent.coder",
    title: "Implementation",
    purpose: `Implement: ${req.objective}. Follow the architecture where one exists. Produce runnable code plus the exact commands used to build it.`,
    capabilities: ["coding", sig.languages[0]?.toLowerCase() ?? "coding"].filter(Boolean) as string[],
    // The arbitrator decides the harness; we only express a preference when the language is
    // strongly associated with one.
    preferredHarness: null,
    dependsOn: arch >= 0 ? [arch] : research >= 0 ? [research] : [],
    rationale: "Core delivery step.",
  };

  let test = -1;
  if (sig.needsTests) {
    test = idx();
    steps[test] = {
      kind: "test",
      agentDefId: "agent.tester",
      title: "Verification",
      purpose: `Verify the implementation against: ${req.successCriteria.join("; ") || req.objective}. Run the tests, record actual command output, and report failures verbatim.`,
      capabilities: ["testing", "verification"],
      preferredHarness: null,
      dependsOn: [impl],
      rationale: "An agent must never be the sole authority on its own success (§18); this is the independent check.",
    };
  }

  let sec = -1;
  if (sig.needsSecurity) {
    sec = idx();
    steps[sec] = {
      kind: "security",
      agentDefId: "agent.security",
      title: "Security review",
      purpose: `Review the implementation for injection, authorisation gaps, secret handling and unsafe defaults. No exploit payloads. Rank findings by exploitability.`,
      capabilities: ["security-review"],
      preferredHarness: null,
      dependsOn: test >= 0 ? [test] : [impl],
      rationale: "The objective touches security-sensitive surface.",
    };
  }

  let review = -1;
  if (steps.length > 2 || sig.domain === "saas-build") {
    review = idx();
    steps[review] = {
      kind: "review",
      agentDefId: "agent.reviewer",
      title: "Independent review",
      purpose: `Review the produced work against the mission success criteria. Say what is missing. Do not rewrite it.`,
      capabilities: ["review"],
      preferredHarness: null,
      dependsOn: sec >= 0 ? [sec] : test >= 0 ? [test] : [impl],
      rationale: "A reviewer who did not produce the work is the cheapest independent signal available.",
    };
  }

  let docs = -1;
  if (sig.needsDocs) {
    docs = idx();
    steps[docs] = {
      kind: "synthesis",
      agentDefId: "agent.docs",
      title: "Documentation",
      purpose: `Document what was actually built, from the trace. Do not invent APIs that were not implemented.`,
      capabilities: ["documentation"],
      preferredHarness: null,
      dependsOn: review >= 0 ? [review] : [impl],
      rationale: "The mission asks for written output.",
    };
  }

  let synth = -1;
  if (steps.length >= 4) {
    synth = idx();
    steps[synth] = {
      kind: "synthesis",
      agentDefId: "agent.synthesizer",
      title: "Synthesis",
      purpose: `Merge the artifacts into one deliverable that answers: ${req.objective}. Surface conflicts between agents rather than smoothing them over.`,
      capabilities: ["synthesis"],
      preferredHarness: null,
      dependsOn: [docs >= 0 ? docs : review >= 0 ? review : impl],
      rationale: "More than three contributors produce overlapping output; something has to reconcile it.",
    };
  }

  if (sig.needsRelease || req.autonomy === "HUMAN_ONLY") {
    const rel = idx();
    steps[rel] = {
      kind: "release",
      agentDefId: "control.approval",
      title: "Release gate",
      purpose: "Human decision on whether the mission outcome may be released.",
      capabilities: [],
      preferredHarness: null,
      dependsOn: [synth >= 0 ? synth : review >= 0 ? review : impl],
      rationale: sig.needsRelease ? "The objective includes shipping something." : "Mission runs in HUMAN_ONLY autonomy.",
    };
  }

  return steps.filter((s): s is StepSpec => Boolean(s));
}

export interface PlanResult {
  plan: MissionPlan;
  signals: DomainSignals;
  frameworkScores: Array<{ id: string; score: number; why: string[] }>;
}

export function planMission(mission: Mission, req?: Partial<PlannerRequest>): PlanResult {
  const request: PlannerRequest = {
    objective: mission.objective,
    constraints: mission.constraints,
    successCriteria: mission.successCriteria,
    budgetUsd: mission.budget.maxCostUsd,
    deadlineMs: mission.deadline ? new Date(mission.deadline).getTime() - Date.now() : null,
    autonomy: mission.riskPolicy.autonomy,
    languages: req?.languages,
    repository: req?.repository,
    preferredFramework: mission.preferredFramework,
    allowedHarnesses: mission.allowedHarnesses,
  };

  const signals = analyseObjective(request);
  const { frameworkId, scores } = selectFramework(request, signals);
  const specs = buildSteps(signals, request);

  const warnings: string[] = [];
  const perStepUsd = request.budgetUsd > 0 ? request.budgetUsd / Math.max(1, specs.length) : 0;

  const steps: PlanStep[] = specs.map((s, n) => {
    const def = DEFINITIONS_BY_ID.get(s.agentDefId);
    if (!def) warnings.push(`No node definition for ${s.agentDefId}; step "${s.title}" will be skipped at instantiation.`);
    const risk = classifyRisk(s.purpose, s.kind).risk;
    const needsHuman =
      s.kind === "release" ||
      risk === "CRITICAL" ||
      (request.autonomy === "HUMAN_ONLY") ||
      (request.autonomy === "SUPERVISED" && risk === "HIGH");
    return {
      id: `step-${n + 1}`,
      kind: s.kind,
      title: s.title,
      agentDefId: s.agentDefId,
      purpose: s.purpose,
      requiredCapabilities: s.capabilities,
      languages: s.kind === "implementation" || s.kind === "test" ? signals.languages : [],
      preferredHarness: s.preferredHarness,
      dependsOn: s.dependsOn.map((d) => `step-${d + 1}`),
      estimatedCostUsd: Number(perStepUsd.toFixed(4)),
      estimatedMs: estimateMs(s.kind),
      risk: s.kind === "release" ? "HIGH" : risk,
      requiresApproval: needsHuman,
      rationale: s.rationale,
    };
  });

  if (!steps.length) warnings.push("The planner produced no steps. The objective may be too vague to plan.");
  if (signals.needsBrowser && !mission.boundary.browser) {
    warnings.push("The objective implies browser use but the mission boundary disables it.");
  }
  if (request.deadlineMs && request.deadlineMs > 0) {
    const total = steps.reduce((s, x) => s + x.estimatedMs, 0);
    if (total > request.deadlineMs) {
      warnings.push(`Estimated ${Math.round(total / 60000)} min of sequential work against a ${Math.round(request.deadlineMs / 60000)} min deadline. Parallelise or reduce scope.`);
    }
  }
  const estimatedCostUsd = steps.reduce((s, x) => s + x.estimatedCostUsd, 0);
  if (estimatedCostUsd > request.budgetUsd) {
    warnings.push(`Plan estimates $${estimatedCostUsd.toFixed(2)} against a $${request.budgetUsd.toFixed(2)} budget.`);
  }

  const plan: MissionPlan = {
    planId: uid("plan"),
    missionId: mission.missionId,
    version: 1,
    frameworkId,
    steps,
    verificationStrategy: verificationStrategy(signals, steps),
    approvalCheckpoints: steps.filter((s) => s.requiresApproval).map((s) => s.id),
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(4)),
    estimatedMs: steps.reduce((s, x) => s + x.estimatedMs, 0),
    requiresBrowser: signals.needsBrowser,
    workspaceRequirements: workspaceRequirements(signals),
    warnings,
    createdAt: new Date().toISOString(),
  };

  return { plan, signals, frameworkScores: scores };
}

function estimateMs(kind: PlanStepKind): number {
  switch (kind) {
    case "research": return 90_000;
    case "architecture": return 120_000;
    case "implementation": return 300_000;
    case "test": return 120_000;
    case "security": return 120_000;
    case "review": return 90_000;
    case "synthesis": return 60_000;
    case "approval": return 0;
    case "release": return 0;
  }
}

/** §18 — the verification strategy is part of the plan, decided before execution. */
export function verificationStrategy(sig: DomainSignals, steps: PlanStep[]): string[] {
  const out: string[] = [];
  out.push("No agent declares its own success: every deliverable is checked by a step that did not produce it.");
  if (steps.some((s) => s.kind === "test")) {
    out.push("Tests are executed, not asserted. Recorded command output is the evidence.");
  }
  if (sig.languages.length) {
    out.push(`Static checks for ${sig.languages.join(", ")} (typecheck/lint) where a toolchain exists.`);
  }
  if (sig.needsSecurity) out.push("Security review with findings ranked by exploitability; no exploit payloads produced.");
  out.push("An independent reviewer states what is missing rather than restating what was done.");
  out.push("Checks that could not be measured are reported as unmeasured, never counted as passes.");
  return out;
}

export function workspaceRequirements(sig: DomainSignals): string[] {
  const out: string[] = [];
  if (sig.languages.length) out.push(`Toolchain for ${sig.languages.join(", ")}`);
  if (sig.needsBrowser) out.push("A browser session with a scoped profile");
  if (sig.needsData) out.push("Readable dataset location");
  if (sig.needsRelease) out.push("Deployment target credentials (mission boundary must grant `credentials`)");
  if (!out.length) out.push("Workspace filesystem access only");
  return out;
}

/**
 * §24 Parallelism. Derives execution waves from the dependency graph. Tasks in the same wave
 * are parallel-safe; waves run sequentially. Nothing is parallelised by default.
 */
export function parallelWaves(steps: PlanStep[]): PlanStep[][] {
  const placed = new Set<string>();
  const waves: PlanStep[][] = [];
  let remaining = [...steps];
  let guard = 0;
  while (remaining.length && guard++ < 100) {
    const wave = remaining.filter((s) => s.dependsOn.every((d) => placed.has(d)));
    if (!wave.length) {
      // Unresolvable dependency: surface it rather than looping forever.
      waves.push(remaining);
      break;
    }
    for (const s of wave) placed.add(s.id);
    remaining = remaining.filter((s) => !placed.has(s.id));
    waves.push(wave);
  }
  return waves;
}

export function describePlan(plan: MissionPlan): string {
  const waves = parallelWaves(plan.steps);
  const lines = [
    `Framework: ${plan.frameworkId}`,
    `Steps: ${plan.steps.length} across ${waves.length} wave(s)`,
    `Estimated: $${plan.estimatedCostUsd.toFixed(2)} / ${Math.round(plan.estimatedMs / 1000)}s`,
    "",
  ];
  waves.forEach((wave, i) => {
    lines.push(`Wave ${i + 1}${wave.length > 1 ? " (parallel-safe)" : ""}:`);
    for (const s of wave) {
      lines.push(`  - ${s.title} [${s.agentDefId}] risk=${s.risk}${s.requiresApproval ? " HUMAN GATE" : ""}`);
      lines.push(`      why: ${s.rationale}`);
    }
  });
  if (plan.warnings.length) {
    lines.push("", "Warnings:");
    for (const w of plan.warnings) lines.push(`  ! ${w}`);
  }
  return lines.join("\n");
}

export function riskOf(step: PlanStep): RiskClass {
  return step.risk;
}
