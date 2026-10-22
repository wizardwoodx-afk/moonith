/**
 * §12 Artifact lineage + §13 explainability.
 *
 * Artifacts are immutable and versioned. Modifying an artifact never overwrites it: it
 * creates a new version whose `parentArtifactIds` point back at what it came from. The
 * "only known good" copy is therefore never destroyed, and `rollback` can always restore a
 * prior version.
 *
 * `explainLineage` walks the parent graph backwards and returns the ordered chain the UI
 * renders for "why is this like this?".
 */

import { uid } from "../app/id";
import type {
  Artifact,
  ArtifactEvaluation,
  ArtifactProvenance,
  FlightEvent,
} from "./types";
import type { FlightRecorder } from "./flightRecorder";

export interface CreateArtifactInput {
  missionId: string;
  name: string;
  content: string;
  contentType: Artifact["contentType"];
  createdBy: string;
  parentArtifactIds?: string[];
  inputs?: string[];
  provenance: ArtifactProvenance;
  taskId?: string | null;
}

export interface LineageNode {
  artifactId: string;
  version: number;
  name: string;
  contentType: Artifact["contentType"];
  createdBy: string;
  harness: string | null;
  model: string | null;
  toolsUsed: string[];
  evaluation: string;
  approvalState: Artifact["approvalState"];
  costUsd: number;
  latencyMs: number;
  at: string;
  /** Depth from the queried artifact; 0 = the artifact itself. */
  depth: number;
  parentArtifactIds: string[];
}

export interface LineageExplanation {
  artifactId: string;
  /** Ordered oldest-first chain of everything that produced this artifact. */
  chain: LineageNode[];
  /** Governance events touching this lineage, oldest first. */
  decisions: FlightEvent[];
  totalCostUsd: number;
  totalLatencyMs: number;
  versions: number;
  /** True when some ancestor was never independently evaluated. */
  hasUnverifiedAncestor: boolean;
  unverified: string[];
}

export class ArtifactStore {
  private artifacts = new Map<string, Artifact>();
  /** lineageRoot -> artifactIds, ordered by version. */
  private lineage = new Map<string, string[]>();

  create(input: CreateArtifactInput, recorder: FlightRecorder): Artifact {
    const artifactId = uid("art");
    const parents = input.parentArtifactIds ?? [];
    // A new version of an existing lineage reuses the root; a genuinely new artifact is its
    // own root.
    const root = parents.length ? this.artifacts.get(parents[0])?.lineageRoot ?? artifactId : artifactId;
    const siblings = this.lineage.get(root) ?? [];
    const artifact: Artifact = {
      artifactId,
      missionId: input.missionId,
      version: siblings.length + 1,
      lineageRoot: root,
      name: input.name,
      content: input.content,
      contentType: input.contentType,
      createdBy: input.createdBy,
      modifiedBy: input.createdBy,
      parentArtifactIds: parents,
      inputs: input.inputs ?? [],
      provenance: input.provenance,
      evaluation: null,
      approvalState: "NONE",
      approvalId: null,
      rollbackTargetVersion: siblings.length ? siblings.length : null,
      createdAt: new Date().toISOString(),
    };
    this.artifacts.set(artifactId, artifact);
    this.lineage.set(root, [...siblings, artifactId]);
    recorder.record({
      kind: siblings.length ? "ARTIFACT_VERSIONED" : "ARTIFACT_CREATED",
      actor: input.createdBy,
      authority: "runtime",
      policy: "artifact.immutable-versioning",
      reason: siblings.length
        ? `Version ${artifact.version} of ${input.name}; previous version preserved.`
        : `Created ${input.name}.`,
      evidence: input.inputs ?? [],
      subjectId: artifactId,
      data: {
        version: artifact.version,
        lineageRoot: root,
        contentType: artifact.contentType,
        bytes: artifact.content.length,
        parents,
        harness: artifact.provenance.harness,
        costUsd: artifact.provenance.costUsd,
      },
    });
    return artifact;
  }

  /**
   * Record a new version of an existing artifact. The previous version is untouched.
   */
  revise(parentArtifactId: string, content: string, modifiedBy: string, provenance: ArtifactProvenance, recorder: FlightRecorder, reason: string): Artifact {
    const parent = this.artifacts.get(parentArtifactId);
    if (!parent) throw new Error(`unknown artifact ${parentArtifactId}`);
    if (parent.content === content) {
      // No change: do not manufacture a version. Return the existing artifact.
      return parent;
    }
    const next = this.create(
      {
        missionId: parent.missionId,
        name: parent.name,
        content,
        contentType: parent.contentType,
        createdBy: modifiedBy,
        parentArtifactIds: [parentArtifactId],
        inputs: [parentArtifactId],
        provenance,
      },
      recorder,
    );
    recorder.record({
      kind: "ARTIFACT_VERSIONED",
      actor: modifiedBy,
      authority: "runtime",
      policy: "artifact.immutable-versioning",
      reason,
      subjectId: next.artifactId,
      data: { previousVersion: parent.version, newVersion: next.version, lineageRoot: parent.lineageRoot },
    });
    return next;
  }

  get(artifactId: string): Artifact | null {
    return this.artifacts.get(artifactId) ?? null;
  }

  latestOf(lineageRoot: string): Artifact | null {
    const ids = this.lineage.get(lineageRoot);
    if (!ids || !ids.length) return null;
    return this.artifacts.get(ids[ids.length - 1]) ?? null;
  }

  versionsOf(lineageRoot: string): Artifact[] {
    return (this.lineage.get(lineageRoot) ?? [])
      .map((id) => this.artifacts.get(id))
      .filter((a): a is Artifact => Boolean(a));
  }

  forMission(missionId: string): Artifact[] {
    return [...this.artifacts.values()]
      .filter((a) => a.missionId === missionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  setEvaluation(artifactId: string, evaluation: ArtifactEvaluation): void {
    const a = this.artifacts.get(artifactId);
    if (a) a.evaluation = evaluation;
  }

  setApprovalState(artifactId: string, state: Artifact["approvalState"], approvalId: string | null): void {
    const a = this.artifacts.get(artifactId);
    if (!a) return;
    a.approvalState = state;
    a.approvalId = approvalId;
  }

  /**
   * §13 Explain lineage. Breadth-first walk backwards through parents, deduplicated,
   * returned oldest-first so the UI can render it top-down.
   */
  explainLineage(artifactId: string, recorder?: FlightRecorder): LineageExplanation {
    const visited = new Map<string, LineageNode>();
    const queue: Array<{ id: string; depth: number }> = [{ id: artifactId, depth: 0 }];
    const inQueue = new Set<string>([artifactId]);

    while (queue.length) {
      const { id, depth } = queue.shift()!;
      const a = this.artifacts.get(id);
      if (!a || visited.has(id)) continue;
      visited.set(id, {
        artifactId: a.artifactId,
        version: a.version,
        name: a.name,
        contentType: a.contentType,
        createdBy: a.createdBy,
        harness: a.provenance.harness,
        model: a.provenance.model,
        toolsUsed: a.provenance.toolsUsed,
        evaluation: a.evaluation
          ? a.evaluation.passed
            ? a.evaluation.fullyMeasured
              ? "passed (measured)"
              : `passed with ${a.evaluation.unmeasured.length} unmeasured check(s)`
            : "failed"
          : "not evaluated",
        approvalState: a.approvalState,
        costUsd: a.provenance.costUsd,
        latencyMs: a.provenance.latencyMs,
        at: a.createdAt,
        depth,
        parentArtifactIds: a.parentArtifactIds,
      });
      for (const p of a.parentArtifactIds) {
        if (!inQueue.has(p)) {
          inQueue.add(p);
          queue.push({ id: p, depth: depth + 1 });
        }
      }
    }

    const chain = [...visited.values()].sort((a, b) => a.at.localeCompare(b.at) || a.depth - b.depth);
    const ids = new Set(visited.keys());
    const decisions = recorder
      ? recorder.all().filter((e) => e.subjectId && ids.has(e.subjectId))
      : [];
    const unverified = chain.filter((n) => n.evaluation === "not evaluated").map((n) => n.name);

    return {
      artifactId,
      chain,
      decisions,
      totalCostUsd: chain.reduce((s, n) => s + n.costUsd, 0),
      totalLatencyMs: chain.reduce((s, n) => s + n.latencyMs, 0),
      versions: chain.length,
      hasUnverifiedAncestor: unverified.length > 0,
      unverified,
    };
  }

  /**
   * §26 Rollback: produce the artifact that a given version should revert to, without
   * destroying anything. Returns the restored artifact as a NEW version so history stays
   * append-only.
   */
  rollback(artifactId: string, recorder: FlightRecorder, actor: string, reason: string): Artifact | null {
    const a = this.artifacts.get(artifactId);
    if (!a || a.rollbackTargetVersion == null) return null;
    const target = this.versionsOf(a.lineageRoot).find((v) => v.version === a.rollbackTargetVersion);
    if (!target) return null;
    const restored = this.create(
      {
        missionId: a.missionId,
        name: a.name,
        content: target.content,
        contentType: a.contentType,
        createdBy: actor,
        parentArtifactIds: [artifactId],
        inputs: [target.artifactId],
        provenance: {
          ...target.provenance,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          toolsUsed: ["checkpoint.rollback"],
        },
      },
      recorder,
    );
    recorder.record({
      kind: "MISSION_ROLLED_BACK",
      actor,
      authority: "human",
      policy: "artifact.rollback",
      reason,
      subjectId: restored.artifactId,
      data: { fromVersion: a.version, toVersion: target.version, lineageRoot: a.lineageRoot },
    });
    return restored;
  }

  hydrate(artifacts: Artifact[]): void {
    for (const a of artifacts) {
      this.artifacts.set(a.artifactId, a);
      const list = this.lineage.get(a.lineageRoot) ?? [];
      if (!list.includes(a.artifactId)) this.lineage.set(a.lineageRoot, [...list, a.artifactId]);
    }
    for (const [k, v] of this.lineage) {
      this.lineage.set(
        k,
        v.sort((x, y) => (this.artifacts.get(x)?.version ?? 0) - (this.artifacts.get(y)?.version ?? 0)),
      );
    }
  }

  export(): Artifact[] {
    return [...this.artifacts.values()];
  }
}
