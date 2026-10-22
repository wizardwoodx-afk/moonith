/**
 * §4 Dynamic graph evolution + §17 self-healing graph + §30 graph ↔ organization sync.
 *
 * An agent may *request* a graph mutation. It may never apply one. Every mutation passes
 * three gates before it touches the graph:
 *
 *   1. policy   — does mission policy and budget permit this change at all?
 *   2. evaluation — is the proposed graph structurally valid (typed ports, no cycles)?
 *   3. regression — does it preserve everything the previous version already delivered?
 *
 * The full previous graph is snapshotted into the mutation record, so rollback is exact.
 */

import { uid } from "../app/id";
import { validateWorkflow } from "../graph/validation";
import type { WorkflowGraph } from "../domain/types";
import type { GraphMutation, Mission } from "./types";
import type { FlightRecorder } from "./flightRecorder";

export interface MutationRequest {
  mission: Mission;
  graph: WorkflowGraph;
  nextGraph: WorkflowGraph;
  reason: string;
  evidence: string[];
  requestedBy: string;
  authority: GraphMutation["authority"];
  /** Node titles the previous run already completed; a mutation must not discard them. */
  completedWork: string[];
}

export interface MutationOutcome {
  mutation: GraphMutation;
  applied: boolean;
  blockedBy: string | null;
}

/** Gate 1: policy. Cheap, checked first, so an illegal request never reaches the graph. */
export function policyCheck(req: MutationRequest): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  const policy = req.mission.riskPolicy;
  if (!policy.allowGraphMutation) failures.push("mission policy disables graph mutation");
  if (req.authority === "SUPERVISOR" && policy.autonomy === "HUMAN_ONLY") {
    failures.push("autonomy is HUMAN_ONLY: only a human may authorise a graph change");
  }
  if (req.mission.graphVersion >= req.mission.budget.maxGraphMutations) {
    failures.push(
      `graph mutation budget exhausted: version ${req.mission.graphVersion} of max ${req.mission.budget.maxGraphMutations}`,
    );
  }
  if (!req.evidence.length) failures.push("no evidence supplied — a graph change must cite what it observed");
  if (!req.reason.trim()) failures.push("no reason supplied");
  return { passed: failures.length === 0, failures };
}

/** Gate 2: evaluation. The proposed graph must actually be a valid graph. */
export function evaluationCheck(nextGraph: WorkflowGraph): { passed: boolean; detail: string } {
  const issues = validateWorkflow(nextGraph);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length) {
    return { passed: false, detail: `${errors.length} structural error(s): ${errors.slice(0, 4).map((e) => e.message).join(" | ")}` };
  }
  if (!nextGraph.nodes.length) return { passed: false, detail: "proposed graph has no nodes" };
  return {
    passed: true,
    detail: `${nextGraph.nodes.length} nodes, ${nextGraph.connections.length} connections, ${issues.filter((i) => i.severity === "warning").length} warning(s)`,
  };
}

/**
 * Gate 3: regression. A mutation may add and rewire; it may not silently delete work that
 * already completed. Removing a node that produced a result is a rollback, not a mutation,
 * and must go through the checkpoint path instead.
 */
export function regressionCheck(req: MutationRequest): { passed: boolean; detail: string } {
  const nextTitles = new Set(req.nextGraph.nodes.map((n) => n.title));
  const lost = req.completedWork.filter((t) => !nextTitles.has(t));
  if (lost.length) {
    return {
      passed: false,
      detail: `mutation would discard completed work: ${lost.join(", ")}. Roll back to a checkpoint instead of mutating.`,
    };
  }
  const before = new Set(req.graph.nodes.map((n) => n.title));
  const added = [...nextTitles].filter((t) => !before.has(t));
  const removed = [...before].filter((t) => !nextTitles.has(t));
  return {
    passed: true,
    detail: `adds [${added.join(", ") || "nothing"}], removes [${removed.join(", ") || "nothing"}], preserves ${req.completedWork.length} completed node(s)`,
  };
}

/**
 * Propose a mutation. Returns the record whether or not it was applied — a rejected
 * mutation is still evidence, and the UI shows it as a refused request rather than hiding it.
 */
export function proposeMutation(req: MutationRequest, recorder: FlightRecorder): MutationOutcome {
  const policy = policyCheck(req);
  const evaluation = policy.passed ? evaluationCheck(req.nextGraph) : null;
  const regression = policy.passed && evaluation?.passed ? regressionCheck(req) : null;

  const mutation: GraphMutation = {
    mutationId: uid("mut"),
    missionId: req.mission.missionId,
    fromGraphVersion: req.mission.graphVersion,
    toGraphVersion: req.mission.graphVersion + 1,
    reason: req.reason,
    evidence: req.evidence,
    requestedBy: req.requestedBy,
    authority: req.authority,
    policyCheck: policy,
    evaluation,
    regression,
    rollbackTargetVersion: req.mission.graphVersion,
    graphSnapshotBefore: req.graph,
    appliedAt: new Date().toISOString(),
    applied: false,
  };

  const blockedBy = !policy.passed
    ? `policy: ${policy.failures.join("; ")}`
    : evaluation && !evaluation.passed
      ? `evaluation: ${evaluation.detail}`
      : regression && !regression.passed
        ? `regression: ${regression.detail}`
        : null;

  mutation.applied = blockedBy === null;

  recorder.record({
    kind: "GRAPH_MUTATED",
    actor: req.requestedBy,
    authority: req.authority,
    policy: `allowGraphMutation=${req.mission.riskPolicy.allowGraphMutation};autonomy=${req.mission.riskPolicy.autonomy}`,
    reason: req.reason,
    evidence: req.evidence,
    subjectId: mutation.mutationId,
    data: {
      applied: mutation.applied,
      blockedBy,
      fromVersion: mutation.fromGraphVersion,
      toVersion: mutation.toGraphVersion,
      evaluation: evaluation?.detail ?? null,
      regression: regression?.detail ?? null,
    },
  });

  return { mutation, applied: mutation.applied, blockedBy };
}

/**
 * §30 Sync. The organization is a projection of the graph, so when the graph changes the
 * organization state is recomputed from it — never the other way round. This returns the
 * reconciliation the runtime should apply.
 */
export interface GraphOrgDelta {
  addedNodeIds: string[];
  removedNodeIds: string[];
  /** Node ids whose definition or purpose changed. */
  changedNodeIds: string[];
  connectionCount: number;
}

export function diffGraphToOrg(before: WorkflowGraph, after: WorkflowGraph): GraphOrgDelta {
  const beforeIds = new Map(before.nodes.map((n) => [n.id, n]));
  const afterIds = new Map(after.nodes.map((n) => [n.id, n]));
  const added = [...afterIds.keys()].filter((id) => !beforeIds.has(id));
  const removed = [...beforeIds.keys()].filter((id) => !afterIds.has(id));
  const changed = [...afterIds.entries()]
    .filter(([id, n]) => {
      const old = beforeIds.get(id);
      return old && (old.definitionId !== n.definitionId || old.purpose !== n.purpose || old.title !== n.title);
    })
    .map(([id]) => id);
  return { addedNodeIds: added, removedNodeIds: removed, changedNodeIds: changed, connectionCount: after.connections.length };
}

/** Titles of nodes the run already completed — the input to the regression gate. */
export function completedTitles(graph: WorkflowGraph, completedNodeIds: Set<string>): string[] {
  return graph.nodes.filter((n) => completedNodeIds.has(n.id)).map((n) => n.title);
}

/** Human-readable mutation history for the mission view. */
export function renderMutations(mutations: GraphMutation[]): string {
  if (!mutations.length) return "No graph mutations.";
  return mutations
    .map(
      (m) =>
        `v${m.fromGraphVersion} → v${m.toGraphVersion} [${m.applied ? "applied" : "REFUSED"}] by ${m.requestedBy} (${m.authority})\n` +
        `  reason: ${m.reason}\n` +
        `  evidence: ${m.evidence.join(" | ") || "none"}\n` +
        (m.evaluation ? `  evaluation: ${m.evaluation.detail}\n` : "") +
        (m.regression ? `  regression: ${m.regression.detail}\n` : "") +
        `  rollback target: v${m.rollbackTargetVersion}`,
    )
    .join("\n\n");
}
