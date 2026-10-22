/**
 * VH 11.11.1 SELF-EVOLVING — settlement orchestrator.
 *
 * Called once per finished team run with the SAME measured report the other
 * engines settle on. Runs the full loop: reflect lessons → merge into org
 * memory → append the run ATTRIBUTED to the strategy that governed it →
 * settle the online experiment on attributed measured runs → propose skills →
 * issue a learning receipt for whatever was learned. Returns a plain summary
 * the runner UI can display. Never throws: a failure to persist must not
 * break the run.
 *
 * 11.11.1 causal contract: the runner asks `nextRunStrategy()` BEFORE the run,
 * executes THAT strategy's parameters, and reports the id back via
 * `strategyId`. Settlement scores each arm only on its own runs — a strategy
 * can never be credited with results it did not produce.
 */
import { reflectOnMission, mergeLessons, loadLessons, saveLessons, lessonsForBriefing, retrieveCausal, type Lesson } from "./lessons";
import { beliefsForBriefing, loadBeliefs, mergeBeliefs, saveBeliefs, beliefFromMeasured, beliefDigestInput } from "./belief";
import {
  loadImprovement, saveImprovement, proposeVariation, settleCandidate, adoptedVersion,
  nextAssignment, armScores, type RunOutcome, type StrategyParams, MIN_TRIALS, TRIAL_CAP, ADOPT_MARGIN,
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
  now?: number;
}

export interface RunAssignment {
  id: string;
  gen: number;
  params: StrategyParams;
  isCandidate: boolean;
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
    baseline: { id: string | null; measured: number; score: number | null };
    candidate: { id: string | null; measured: number; score: number | null } | null;
    nextRun: string | null;
    rule: string;
  };
  skillsProposed: number;
  learningReceiptId: string | null;
}

const RUNS_KEY = "vh.selfimprove.runs.v2";
const RUNS_KEY_V1 = "vh.selfimprove.runs.v1";

/**
 * Load the attributed run log. Pre-11.11.1 entries (v1, no strategyId) migrate
 * with strategyId null: they were never part of an experiment, so they are kept
 * for continuity but excluded from both arms' scores.
 */
export function loadExperimentRuns(): RunOutcome[] {
  try {
    const raw = localStorage.getItem(RUNS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as RunOutcome[];
      if (Array.isArray(p)) return p;
    }
    const old = localStorage.getItem(RUNS_KEY_V1);
    if (old) {
      const p = JSON.parse(old) as Array<{ verified: boolean; simulated: boolean }>;
      if (Array.isArray(p)) {
        const migrated: RunOutcome[] = p.map((r) => ({ verified: r.verified, simulated: r.simulated, strategyId: null }));
        localStorage.setItem(RUNS_KEY, JSON.stringify(migrated.slice(-100)));
        localStorage.removeItem(RUNS_KEY_V1);
        return migrated;
      }
    }
  } catch { /* ignore */ }
  return [];
}

function saveRunLog(runs: RunOutcome[]): void {
  try { localStorage.setItem(RUNS_KEY, JSON.stringify(runs.slice(-100))); } catch { /* ignore */ }
}

/** The strategy the NEXT run must execute. The runner records the id for attribution. */
export function nextRunStrategy(): RunAssignment | null {
  const v = nextAssignment(loadImprovement(), loadExperimentRuns());
  if (!v) return null;
  return { id: v.id, gen: v.gen, params: v.params, isCandidate: v.status === "candidate" };
}

/** Pure briefing composer: org lessons + approved learned skills, budgeted by the GOVERNING strategy. */
/** 11.12.1 — canonical digest of the current world-belief, for action packets. */
export async function currentBeliefDigest(): Promise<string> {
  return sha256Hex(beliefDigestInput(loadBeliefs()));
}

/**
 * Pure briefing composer: org lessons (SCAR-first) + regime-gated mosaic lines
 * (causal memory + beliefs) + approved learned skills, budgeted by the
 * GOVERNING strategy. Mosaic lines only enter when the governing regime says
 * so — which is exactly what makes the extract measurable as an experiment arm.
 */
export function composeBriefing(lessons: Lesson[], skillLines: string[], mosaicLines: string[], goal: string, now: number, params: StrategyParams): string[] {
  const lines = lessonsForBriefing(lessons, goal, now);
  if (params.mosaic) for (const m of mosaicLines) lines.push(m); // regime-gated: the extract is measurable
  for (const d of skillLines) lines.push(d);
  return lines.slice(0, Math.max(0, params.lessonBudget) + 2 + (params.mosaic ? 4 : 0));
}

export function briefingForMission(goal: string, now: number): string[] {
  const assigned = nextRunStrategy();
  const params = assigned?.params ?? { reviewDepth: 1, checkBias: 0.5, serialExec: false, lessonBudget: 3, mosaic: false };
  const skillLines = approvedSkillDefs(loadSkills()).map((d) => `[learned skill ${d.label}] ${d.description}`);
  let mosaicLines: string[] = [];
  if (params.mosaic) {
    const mem = loadLessons();
    mosaicLines = [
      ...retrieveCausal(mem, goal, 2, now).map((l) => `[causal memory] tried: ${l.causal?.action ?? l.causal?.decision ?? "-"} → ${l.causal?.outcome ?? "-"}`),
      ...beliefsForBriefing(loadBeliefs(), goal, now),
    ];
  }
  return composeBriefing(loadLessons(), skillLines, mosaicLines, goal, now, params);
}

export async function settleSelfEvolution(input: SelfEvolveInput): Promise<SelfEvolveSummary> {
  const now = input.now ?? Date.now();
  const governedBy = input.strategyId ?? null;
  try {
    // 1. reflect + merge
    const fresh = reflectOnMission(input);
    let memory = mergeLessons(loadLessons(), fresh, now);
    saveLessons(memory);

    // 1b. 11.12 — measured run facts also update the world-belief store.
    // Verified real execution may be "known"; anything simulated stays uncertain.
    saveBeliefs(mergeBeliefs(loadBeliefs(), [
      beliefFromMeasured(
        `mission ${input.missionId} ${input.verified ? "verified" : "did not verify"} on ${input.simulated ? "a simulated host" : "real execution"}`,
        input.verified && !input.simulated, 1, `run:${input.missionId}`, now,
      ),
    ]));

    // 2. strategy experiment: append the run ATTRIBUTED, settle on attributed runs
    const runLog = [...loadExperimentRuns(), { verified: input.verified, simulated: input.simulated, strategyId: governedBy }];
    saveRunLog(runLog);
    let imp = settleCandidate(loadImprovement(), runLog, now);
    if (!imp.versions.some((v) => v.status === "candidate")) {
      imp = proposeVariation(imp, now);
    }
    const strategyBefore = adoptedVersion(loadImprovement())?.id ?? null;
    saveImprovement(imp);
    const adopted = adoptedVersion(imp);
    const candidate = imp.versions.find((v) => v.status === "candidate") ?? null;
    const arms = armScores(imp, runLog);
    const next = nextAssignment(imp, runLog);

    // 3. skills — recurring failures counted over memory
    const recurring = memory
      .filter((l) => l.kind === "failure" && l.useCount >= 2)
      .map((l) => l.text);
    const freshSkills = proposeSkills({
      missionId: input.missionId,
      verified: input.verified,
      simulated: input.simulated,
      tasks: input.seatOutcomes.map((s) => ({ role: s.role, label: s.label, passed: s.passed })),
      recurringFailureTexts: recurring,
      now,
    });
    const skills = mergeProposals(loadSkills(), freshSkills);
    saveSkills(skills);

    // 4. learning receipt for what this mission taught
    const strategyChange = adopted && strategyBefore !== adopted.id ? `${strategyBefore} -> ${adopted.id}` : null;
    let receiptId: string | null = null;
    if (fresh.length > 0 || strategyChange) {
      const receipt = await issueLearningReceipt({
        mjVersion: ENGINE_VERSION,
        missionId: input.missionId,
        lessons: fresh.map((l) => ({ id: l.id, kind: l.kind, text: l.text, evidence: l.evidence })),
        strategyChange,
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
        baseline: { id: arms.baselineId, measured: arms.baseline.measured, score: arms.baseline.score },
        candidate: arms.candidateId ? { id: arms.candidateId, measured: (arms.candidate as { measured: number }).measured, score: (arms.candidate as { score: number | null }).score } : null,
        nextRun: next?.id ?? null,
        rule: `verdict needs ${MIN_TRIALS} measured runs per arm, strict margin > ${ADOPT_MARGIN}; ${TRIAL_CAP}-run cap retires inconclusive; unattributed runs score for no arm`,
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
        adoptedGen: 1, candidateStatus: null, note: "self-evolution settlement skipped",
        governedBy, baseline: { id: null, measured: 0, score: null }, candidate: null, nextRun: null,
        rule: `verdict needs ${MIN_TRIALS} measured runs per arm, strict margin > ${ADOPT_MARGIN}; ${TRIAL_CAP}-run cap retires inconclusive; unattributed runs score for no arm`,
      },
      skillsProposed: 0,
      learningReceiptId: null,
    };
  }
}

export type { Lesson, SkillProposal };
