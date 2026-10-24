/**
 * RSIRALS — Recursive Self-Improving Reinforcement Agentic Learning System.
 *
 * This is SelfImpulse's measured, non-parametric learning loop, not a second
 * agent runtime. A mission executes an assigned harness strategy; settlement
 * reflects measured lessons, credits only the memory actually retrieved,
 * settles a controlled baseline/candidate experiment, proposes verifier-backed
 * skills for human approval, and issues a learning receipt. It never trains
 * model weights and never rewrites application source code.
 *
 * Causal contract: `nextRunStrategy()` is called BEFORE execution and the same
 * assignment is reported back. Development runs choose promising candidates;
 * reserved held-out runs must confirm transfer. Simulated or contaminated runs
 * teach no performance lesson.
 */
import {
  reflectOnMission,
  mergeLessons,
  loadLessons,
  saveLessons,
  selectLessonsForBriefing,
  retrieveCausal,
  creditLessonUtility,
  type Lesson,
} from "./lessons";
import { beliefsForBriefing, loadBeliefs, mergeBeliefs, saveBeliefs, beliefFromMeasured, beliefDigestInput } from "./belief";
import {
  loadImprovement,
  saveImprovement,
  proposeVariation,
  settleCandidate,
  adoptedVersion,
  nextAssignment,
  nextAssignmentHeldOut,
  armScores,
  type RunOutcome,
  type StrategyParams,
  MIN_TRIALS,
  TRIAL_CAP,
  ADOPT_MARGIN,
} from "./selfImprove";
import { proposeSkills, mergeProposals, approvedSkillDefs, loadSkills, saveSkills, type SkillProposal } from "./skillEvolution";
import { issueLearningReceipt, loadLearningReceipts, saveLearningReceipts, sha256Hex } from "./learningReceipt";
import { ENGINE_VERSION } from "../version";

export interface SelfEvolveInput {
  missionId: string;
  goal: string;
  simulated: boolean;
  verified: boolean;
  failureClasses: string[];
  repairLadder: string[];
  repaired: boolean;
  seatOutcomes: Array<{ role: string; label: string; harness: string; passed: boolean }>;
  /** The strategy version whose parameters governed this run (attribution). */
  strategyId?: string | null;
  /** True only when this run was reserved by the experiment for transfer evaluation. */
  heldOut?: boolean;
  /** Contaminated evidence is persisted for audit but excluded from every score. */
  evidenceLeak?: boolean;
  /** Lesson ids returned by the briefing artifact used for THIS run. */
  usedLessonIds?: string[];
  costUsd?: number;
  policyTokens?: number;
  now?: number;
}

export interface RunAssignment {
  id: string;
  gen: number;
  params: StrategyParams;
  isCandidate: boolean;
  heldOut?: boolean;
}

export interface BriefingArtifact {
  lines: string[];
  /** Exact memory ids exposed to the run; settlement credits no others. */
  lessonIds: string[];
  strategy: RunAssignment | null;
}

export interface SelfEvolveSummary {
  lessonsLearned: number;
  memorySize: number;
  briefingLines: string[];
  strategy: {
    adoptedGen: number;
    candidateStatus: string | null;
    note: string;
    governedBy: string | null;
    baseline: { id: string | null; measured: number; score: number | null; quality: number | null };
    candidate: { id: string | null; measured: number; score: number | null; quality: number | null } | null;
    nextRun: string | null;
    rule: string;
  };
  skillsProposed: number;
  learningReceiptId: string | null;
}

const RUNS_KEY = "vh.selfimprove.runs.v2";
const RUNS_KEY_V1 = "vh.selfimprove.runs.v1";
export const RSIRALS_ACCEPTANCE_RULE = `RSIRALS: ${MIN_TRIALS} real development runs per arm, regularized margin > ${ADOPT_MARGIN}, then one non-regressing held-out run per arm; ${TRIAL_CAP}-run cap retires inconclusive; simulated, leaked, and unattributed runs score for no arm`;

/** Load the attributed run log; legacy unattributed entries remain audit history only. */
export function loadExperimentRuns(): RunOutcome[] {
  try {
    const raw = localStorage.getItem(RUNS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as RunOutcome[];
      if (Array.isArray(parsed)) return parsed;
    }
    const old = localStorage.getItem(RUNS_KEY_V1);
    if (old) {
      const parsed = JSON.parse(old) as Array<{ verified: boolean; simulated: boolean }>;
      if (Array.isArray(parsed)) {
        const migrated: RunOutcome[] = parsed.map((run) => ({
          verified: run.verified,
          simulated: run.simulated,
          strategyId: null,
        }));
        localStorage.setItem(RUNS_KEY, JSON.stringify(migrated.slice(-100)));
        localStorage.removeItem(RUNS_KEY_V1);
        return migrated;
      }
    }
  } catch {
    /* Storage is an optional host capability; callers receive no false evidence. */
  }
  return [];
}

function saveRunLog(runs: RunOutcome[]): void {
  try {
    localStorage.setItem(RUNS_KEY, JSON.stringify(runs.slice(-100)));
  } catch {
    /* The mission result remains authoritative if learning persistence is unavailable. */
  }
}

/** The exact strategy and evaluation split the NEXT run must execute. */
export function nextRunStrategy(): RunAssignment | null {
  const state = loadImprovement();
  const runs = loadExperimentRuns();
  const version = nextAssignment(state, runs);
  if (!version) return null;
  return {
    id: version.id,
    gen: version.gen,
    params: version.params,
    isCandidate: version.status === "candidate",
    heldOut: nextAssignmentHeldOut(state, runs),
  };
}

/** Canonical digest of the current world-belief, for action packets. */
export async function currentBeliefDigest(): Promise<string> {
  return sha256Hex(beliefDigestInput(loadBeliefs()));
}

export type ComposedBriefing = BriefingArtifact;

/** Pure briefing composer with exact lesson attribution retained. */
export function composeBriefingArtifact(
  lessons: Lesson[],
  skillLines: string[],
  mosaicLines: string[],
  goal: string,
  now: number,
  params: StrategyParams,
  strategy: RunAssignment | null = null,
): ComposedBriefing {
  const selected = selectLessonsForBriefing(lessons, goal, now);
  const lessonBudget = Math.max(0, Math.floor(params.lessonBudget));
  const budgetedLessons = selected.lessons.slice(0, lessonBudget);
  const budgetedIds = new Set(budgetedLessons.map((lesson) => lesson.id));
  const lines = selected.lines.filter((_line, index) => budgetedIds.has(selected.lessons[index]?.id ?? ""));
  if (params.mosaic) lines.push(...mosaicLines.slice(0, 4));
  lines.push(...skillLines.slice(0, 2));
  return {
    lines,
    lessonIds: budgetedLessons.map((lesson) => lesson.id),
    strategy,
  };
}

/** Backward-compatible line-only composer. */
export function composeBriefing(
  lessons: Lesson[],
  skillLines: string[],
  mosaicLines: string[],
  goal: string,
  now: number,
  params: StrategyParams,
): string[] {
  return composeBriefingArtifact(lessons, skillLines, mosaicLines, goal, now, params).lines;
}

export function briefingArtifactForMission(
  goal: string,
  now: number,
  assigned?: RunAssignment | null,
): BriefingArtifact {
  const governing = assigned === undefined ? nextRunStrategy() : assigned;
  const params = governing?.params ?? {
    reviewDepth: 1,
    checkBias: 0.5,
    serialExec: false,
    lessonBudget: 3,
    mosaic: false,
  };
  const skillLines = approvedSkillDefs(loadSkills()).map((definition) => `[learned skill ${definition.label}] ${definition.description}`);
  const memory = loadLessons();
  let mosaicLines: string[] = [];
  let causalLessons: Lesson[] = [];
  if (params.mosaic) {
    causalLessons = retrieveCausal(memory, goal, 2, now);
    mosaicLines = [
      ...causalLessons.map((lesson) => `[causal memory] tried: ${lesson.causal?.action ?? lesson.causal?.decision ?? "-"} → ${lesson.causal?.outcome ?? "-"}`),
      ...beliefsForBriefing(loadBeliefs(), goal, now),
    ];
  }
  const artifact = composeBriefingArtifact(memory, skillLines, mosaicLines, goal, now, params, governing);
  artifact.lessonIds = [...new Set([...artifact.lessonIds, ...causalLessons.map((lesson) => lesson.id)])];
  return artifact;
}

export function briefingForMission(
  goal: string,
  now: number,
  assigned?: RunAssignment | null,
): string[] {
  return briefingArtifactForMission(goal, now, assigned).lines;
}

export async function settleSelfEvolution(input: SelfEvolveInput): Promise<SelfEvolveSummary> {
  const now = input.now ?? Date.now();
  const governedBy = input.strategyId ?? null;
  try {
    // 1. Credit only memory this run actually retrieved, then add new measured reflection.
    const usedLessonIds = [...new Set(input.usedLessonIds ?? [])];
    const credited = creditLessonUtility(
      loadLessons(),
      usedLessonIds,
      { verified: input.verified, simulated: input.simulated || input.evidenceLeak === true, costUsd: input.costUsd },
      now,
    );
    const fresh = input.evidenceLeak === true ? [] : reflectOnMission(input);
    const memory = mergeLessons(credited, fresh, now);
    saveLessons(memory, "agent");

    // 1b. Measured run facts update the separate world-belief store.
    saveBeliefs(mergeBeliefs(loadBeliefs(), [
      beliefFromMeasured(
        `mission ${input.missionId} ${input.verified ? "verified" : "did not verify"} on ${input.simulated ? "a simulated host" : "real execution"}`,
        input.verified && !input.simulated && input.evidenceLeak !== true,
        1,
        `run:${input.missionId}`,
        now,
      ),
    ]));

    // 2. Append the attributed observation and settle the controlled experiment.
    const before = loadImprovement();
    const strategyBefore = adoptedVersion(before)?.id ?? null;
    const runLog: RunOutcome[] = [
      ...loadExperimentRuns(),
      {
        verified: input.verified,
        simulated: input.simulated,
        strategyId: governedBy,
        heldOut: input.heldOut === true,
        evidenceLeak: input.evidenceLeak === true,
        costUsd: input.costUsd,
        policyTokens: input.policyTokens,
      },
    ];
    saveRunLog(runLog);
    let improvement = settleCandidate(before, runLog, now);
    if (!improvement.versions.some((version) => version.status === "candidate")) {
      improvement = proposeVariation(improvement, now);
    }
    saveImprovement(improvement);
    const adopted = adoptedVersion(improvement);
    const candidate = improvement.versions.find((version) => version.status === "candidate") ?? null;
    const arms = armScores(improvement, runLog);
    const next = nextAssignment(improvement, runLog);

    // 3. Skill candidates remain proposals until the existing human approval gate.
    const recurring = memory
      .filter((lesson) => lesson.kind === "failure" && lesson.useCount >= 2)
      .map((lesson) => lesson.text);
    const freshSkills = proposeSkills({
      missionId: input.missionId,
      verified: input.verified,
      simulated: input.simulated || input.evidenceLeak === true,
      tasks: input.seatOutcomes.map((seat) => ({ role: seat.role, label: seat.label, passed: seat.passed })),
      recurringFailureTexts: recurring,
      now,
    });
    const skills = mergeProposals(loadSkills(), freshSkills);
    saveSkills(skills);

    // 4. Receipts cover memory-only updates as well as lessons and strategy changes.
    const strategyChange = adopted && strategyBefore !== adopted.id ? `${strategyBefore} -> ${adopted.id}` : null;
    let receiptId: string | null = null;
    if (fresh.length > 0 || strategyChange || (usedLessonIds.length > 0 && !input.simulated && input.evidenceLeak !== true)) {
      const receipt = await issueLearningReceipt({
        mjVersion: ENGINE_VERSION,
        missionId: input.missionId,
        lessons: fresh.map((lesson) => ({ id: lesson.id, kind: lesson.kind, text: lesson.text, evidence: lesson.evidence })),
        strategyChange,
        memoryCredit: usedLessonIds.length > 0 && !input.simulated && input.evidenceLeak !== true
          ? { lessonIds: usedLessonIds, verified: input.verified, model: "bounded-retrieval-utility/v1" }
          : undefined,
        evaluation: {
          heldOut: input.heldOut === true,
          evidenceLeak: input.evidenceLeak === true,
          costUsd: input.costUsd ?? null,
          policyTokens: input.policyTokens ?? null,
        },
        now,
      });
      const all = [...loadLearningReceipts(), receipt];
      saveLearningReceipts(all);
      receiptId = receipt.id;
    }

    return {
      lessonsLearned: fresh.length,
      memorySize: memory.length,
      briefingLines: briefingForMission(input.goal, now),
      strategy: {
        adoptedGen: adopted?.gen ?? 1,
        candidateStatus: candidate?.status ?? null,
        note: candidate?.note ?? adopted?.note ?? "",
        governedBy,
        baseline: { id: arms.baselineId, measured: arms.baseline.measured, score: arms.baseline.score, quality: arms.baseline.quality },
        candidate: arms.candidateId
          ? {
              id: arms.candidateId,
              measured: arms.candidate?.measured ?? 0,
              score: arms.candidate?.score ?? null,
              quality: arms.candidate?.quality ?? null,
            }
          : null,
        nextRun: next?.id ?? null,
        rule: RSIRALS_ACCEPTANCE_RULE,
      },
      skillsProposed: freshSkills.length,
      learningReceiptId: receiptId,
    };
  } catch {
    return {
      lessonsLearned: 0,
      memorySize: 0,
      briefingLines: [],
      strategy: {
        adoptedGen: 1,
        candidateStatus: null,
        note: "RSIRALS settlement skipped; the mission result was not changed",
        governedBy,
        baseline: { id: null, measured: 0, score: null, quality: null },
        candidate: null,
        nextRun: null,
        rule: RSIRALS_ACCEPTANCE_RULE,
      },
      skillsProposed: 0,
      learningReceiptId: null,
    };
  }
}

export type { Lesson, SkillProposal };
