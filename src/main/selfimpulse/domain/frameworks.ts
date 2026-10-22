/**
 * Agent-native composition frameworks.
 * These are not n8n HTTP/Slack/Gmail nodes. They are how autonomous workers coordinate.
 */
export interface AgentFramework {
  id: string;
  name: string;
  category: string;
  description: string;
  /** Role pack slugs or core definition ids, in execution order. */
  roster: string[];
  /** How the graph is wired. */
  pattern:
    | "pipeline"
    | "hierarchy"
    | "debate"
    | "map-reduce"
    | "swarm"
    | "pair"
    | "council"
    | "shadow"
    | "loop"
    | "gate";
  notes: string;
}

export const AGENT_FRAMEWORKS: AgentFramework[] = [
  { id: "fw.pipeline", name: "Specialist Pipeline", category: "flow", description: "Plan → research → implement → test → review.", roster: ["agent.planner", "agent.researcher", "agent.coder", "agent.tester", "agent.reviewer"], pattern: "pipeline", notes: "Default engineering path." },
  { id: "fw.hierarchy", name: "Hierarchical Crew", category: "crew", description: "Supervisor assigns; specialists execute; supervisor merges.", roster: ["agent.supervisor", "agent.planner", "agent.coder", "agent.tester"], pattern: "hierarchy", notes: "Supervisor never does specialist work." },
  { id: "fw.debate", name: "Dialectic Debate", category: "quality", description: "Proposal vs critic vs judge.", roster: ["agent.planner", "agent.critic", "agent.judge"], pattern: "debate", notes: "Steelman then attack." },
  { id: "fw.redblue", name: "Red / Blue", category: "security", description: "Attacker framing vs defender; judge binds.", roster: ["agent.security", "agent.reviewer", "agent.judge"], pattern: "debate", notes: "No exploit payloads." },
  { id: "fw.mapreduce", name: "Map–Reduce Research", category: "knowledge", description: "Fan-out researchers, synthesizer reduces.", roster: ["agent.planner", "agent.researcher", "agent.researcher", "agent.synthesizer"], pattern: "map-reduce", notes: "Conflicts are first-class." },
  { id: "fw.swarm", name: "Peer Swarm", category: "crew", description: "Peers work in parallel; synthesizer only merges.", roster: ["agent.coder", "agent.docs", "agent.security", "agent.synthesizer"], pattern: "swarm", notes: "No supervisor. Merge is explicit." },
  { id: "fw.pair", name: "Pair Programming", category: "engineering", description: "Driver implements, tester verifies, navigator reviews.", roster: ["agent.coder", "agent.tester", "agent.reviewer"], pattern: "pair", notes: "Navigator does not rewrite. Roster is typed: Coder.result(AgentResult) -> Tester.subject, Tester.report(Evaluation) -> Reviewer.workProduct." },
  { id: "fw.council", name: "Council / Jury", category: "quality", description: "Three specialists score; judge binds.", roster: ["agent.critic", "agent.reviewer", "agent.qa", "agent.judge"], pattern: "council", notes: "Majority is not automatic — judge explains dissent." },
  { id: "fw.shadow", name: "Shadow Harness", category: "eval", description: "Same task on two harnesses; synthesizer diffs.", roster: ["agent.coder", "agent.coder", "agent.synthesizer"], pattern: "shadow", notes: "Set different harnesses on the two coders." },
  { id: "fw.specdriven", name: "Spec-Driven", category: "engineering", description: "Architect → contract → implement → verify.", roster: ["agent.architect", "agent.planner", "agent.coder", "agent.tester", "agent.qa"], pattern: "pipeline", notes: "Code is illegal before the contract." },
  { id: "fw.incident", name: "Incident Command", category: "ops", description: "Commander, debugger, SRE, coder, human gate.", roster: ["agent.supervisor", "agent.debugger", "agent.preset.sre", "agent.coder", "control.approval"], pattern: "hierarchy", notes: "Destructive actions require approval." },
  { id: "fw.socratic", name: "Socratic", category: "quality", description: "Critic only asks; author revises; judge scores.", roster: ["agent.critic", "agent.reflection", "agent.judge"], pattern: "loop", notes: "Bounded revisions." },
  { id: "fw.ensemble", name: "Ensemble Vote", category: "quality", description: "Three independent answers; synthesizer + judge.", roster: ["agent.custom", "agent.custom", "agent.custom", "agent.synthesizer", "agent.judge"], pattern: "council", notes: "Independence is the point — no shared scratch." },
  { id: "fw.scoutact", name: "Scout then Act", category: "flow", description: "Researcher scouts; planner commits; coder acts.", roster: ["agent.researcher", "agent.planner", "agent.coder"], pattern: "pipeline", notes: "No coding before evidence." },
  { id: "fw.adversarial-review", name: "Adversarial Review", category: "quality", description: "Author, hostile critic, constructive reviewer, judge.", roster: ["agent.coder", "agent.critic", "agent.reviewer", "agent.judge"], pattern: "debate", notes: "Hostile and constructive are different jobs." },
  { id: "fw.contract-net", name: "Contract Net", category: "crew", description: "Router auctions work; specialists bid via plans; supervisor awards.", roster: ["agent.router", "agent.planner", "agent.planner", "agent.supervisor", "agent.coder"], pattern: "hierarchy", notes: "Award is explicit." },
  { id: "fw.blackboard", name: "Blackboard", category: "crew", description: "Shared memory; specialists post; synthesizer reads the board.", roster: ["agent.researcher", "agent.architect", "agent.security", "agent.synthesizer"], pattern: "swarm", notes: "Enable memory on every node. Same team key." },
  { id: "fw.war-room", name: "War Room", category: "ops", description: "Supervisor, security, SRE, debugger, human approval.", roster: ["agent.supervisor", "agent.security", "agent.preset.sre", "agent.debugger", "control.approval"], pattern: "hierarchy", notes: "Time-boxed. No silent changes." },
  { id: "fw.producer-gate", name: "Producer → Reviewer → Gate", category: "flow", description: "Make, review, QA gate, optional human.", roster: ["agent.coder", "agent.reviewer", "agent.qa", "control.approval"], pattern: "gate", notes: "QA cannot rewrite the work." },
  { id: "fw.recursive", name: "Recursive Decompose", category: "flow", description: "Planner splits; parallel specialists; synthesizer.", roster: ["agent.planner", "control.parallel", "agent.coder", "agent.docs", "control.merge", "agent.synthesizer"], pattern: "map-reduce", notes: "Control nodes are real traffic." },
  { id: "fw.canary", name: "Canary then Full", category: "engineering", description: "Small coder pass, tester, then full coder.", roster: ["agent.coder", "agent.tester", "agent.coder", "agent.qa"], pattern: "pipeline", notes: "Second coder sees the canary evidence." },
  { id: "fw.dual-control", name: "Dual Control", category: "risk", description: "Two independent agents must agree; else human.", roster: ["agent.security", "agent.reviewer", "agent.judge", "control.approval"], pattern: "gate", notes: "Disagreement is a stop, not a merge." },
  { id: "fw.knowledge-distill", name: "Knowledge Distill", category: "learning", description: "Run → reflection → evolution propose. Never auto-invariants.", roster: ["agent.coder", "agent.reflection", "agent.evolution"], pattern: "loop", notes: "Evolution SUGGEST only." },
  { id: "fw.handoff-chain", name: "Handoff Chain", category: "flow", description: "Each agent writes a handoff packet for the next identity.", roster: ["agent.researcher", "agent.architect", "agent.coder", "agent.docs", "agent.qa"], pattern: "pipeline", notes: "Handoff must be executable without the author." },
  { id: "fw.clinic", name: "Specialist Clinic", category: "crew", description: "Router sends to one of several enterprise specialists.", roster: ["agent.router", "agent.preset.legal", "agent.security", "agent.preset.data-analyst"], pattern: "hierarchy", notes: "Router classifies; only one clinic sees the case." },
  { id: "fw.triangulation", name: "Research Triangulation", category: "knowledge", description: "Three researchers, different angles; synthesizer; judge.", roster: ["agent.researcher", "agent.researcher", "agent.researcher", "agent.synthesizer", "agent.judge"], pattern: "map-reduce", notes: "Force independent sources." },
  { id: "fw.moe-router", name: "Mixture of Experts", category: "crew", description: "Router picks expert; expert works; critic checks routing.", roster: ["agent.router", "agent.custom", "agent.critic"], pattern: "hierarchy", notes: "Misroutes are feedback for the router." },
  { id: "fw.staged-approval", name: "Staged Approval", category: "risk", description: "Draft, internal review, human, then execute.", roster: ["agent.planner", "agent.reviewer", "control.approval", "agent.coder"], pattern: "gate", notes: "Coder does not run before approval." },
  { id: "fw.refine-loop", name: "Critic–Refine Loop", category: "quality", description: "Make, attack, revise, bounded.", roster: ["agent.coder", "agent.critic", "agent.reflection", "agent.tester"], pattern: "loop", notes: "maxAttempts on reflection." },
  { id: "fw.docs-from-trace", name: "Docs from Trace", category: "engineering", description: "Coder, tester, docs from what actually ran.", roster: ["agent.coder", "agent.tester", "agent.docs", "agent.reviewer"], pattern: "pipeline", notes: "Docs may not invent APIs." },
  { id: "fw.security-gate", name: "Security Gate", category: "security", description: "Threat model, secure review, judge, human.", roster: ["agent.security", "agent.reviewer", "agent.judge", "control.approval"], pattern: "gate", notes: "Fail closed." },
  { id: "fw.local-offline", name: "Air-gapped Local", category: "local", description: "Planner + local LLM + synthesizer. No cloud.", roster: ["agent.planner", "agent.local", "agent.synthesizer"], pattern: "pipeline", notes: "Harness = llm / Ollama." },
  { id: "fw.enterprise-change", name: "Enterprise Change Advisory", category: "enterprise", description: "PM, architect, security, SRE, legal, CAB human.", roster: ["agent.preset.pm", "agent.architect", "agent.security", "agent.preset.sre", "agent.preset.legal", "control.approval"], pattern: "council", notes: "CAB is the human node." },
  { id: "fw.due-diligence", name: "Due Diligence", category: "enterprise", description: "Research, finance, legal, security, synthesizer, judge.", roster: ["agent.researcher", "agent.preset.data-analyst", "agent.preset.legal", "agent.security", "agent.synthesizer", "agent.judge"], pattern: "map-reduce", notes: "Conflicts stay visible." },
];

export const FRAMEWORK_COUNT = AGENT_FRAMEWORKS.length;
