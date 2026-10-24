import type { RsiralsSnapshot } from '../../../shared/rsirals'
import { loadLessons } from './lessons'
import { loadLearningReceipts } from './learningReceipt'
import { adoptedVersion, loadImprovement } from './selfImprove'
import { loadExperimentRuns, RSIRALS_ACCEPTANCE_RULE } from './selfEvolveRuntime'
import { loadSkills } from './skillEvolution'

/** Read-only product view over the actual stores used by mission execution. */
export function rsiralsSnapshot(): RsiralsSnapshot {
  const improvement = loadImprovement()
  const adopted = adoptedVersion(improvement)
  const candidate = improvement.versions.find((version) => version.status === 'candidate') ?? null
  const skills = loadSkills()
  return {
    name: 'RSIRALS',
    fullName: 'Recursive Self-Improving Reinforcement Agentic Learning System',
    mode: 'non-parametric-runtime-learning',
    adopted: adopted
      ? {
          id: adopted.id,
          gen: adopted.gen,
          score: adopted.score,
          evaluatedOn: adopted.evaluatedOn,
          note: adopted.note,
          params: { ...adopted.params }
        }
      : null,
    candidate: candidate
      ? {
          id: candidate.id,
          gen: candidate.gen,
          score: candidate.score,
          evaluatedOn: candidate.evaluatedOn,
          note: candidate.note
        }
      : null,
    runs: loadExperimentRuns()
      .slice(-16)
      .reverse()
      .map((run) => ({
        strategyId: run.strategyId,
        verified: run.verified,
        simulated: run.simulated,
        heldOut: run.heldOut === true,
        evidenceLeak: run.evidenceLeak === true,
        costUsd: run.costUsd ?? null,
        policyTokens: run.policyTokens ?? null
      })),
    lessons: loadLessons()
      .sort(
        (left, right) =>
          (right.utilityCount ?? 0) - (left.utilityCount ?? 0) || right.strength - left.strength
      )
      .slice(0, 8)
      .map((lesson) => ({
        id: lesson.id,
        kind: lesson.kind,
        text: lesson.text,
        strength: lesson.strength,
        utility: lesson.utility ?? 0.5,
        utilityCount: lesson.utilityCount ?? 0,
        retrievalCount: lesson.retrievalCount ?? 0,
        evidence: [...lesson.evidence]
      })),
    skills: {
      proposed: skills.filter((skill) => skill.status === 'proposed').length,
      approved: skills.filter((skill) => skill.status === 'approved').length,
      discarded: skills.filter((skill) => skill.status === 'discarded').length
    },
    receipts: loadLearningReceipts()
      .slice(-10)
      .reverse()
      .map((receipt) => ({
        id: receipt.id,
        at: receipt.at,
        missionId: receipt.missionId,
        strategyChange: receipt.strategyChange,
        evidenceDigest: receipt.evidenceDigest,
        signed: Boolean(receipt.signature),
        memoryCredit: receipt.memoryCredit ?? null,
        evaluation: receipt.evaluation ?? null
      })),
    acceptanceRule: RSIRALS_ACCEPTANCE_RULE,
    boundaries: [
      'Learns harness strategies, organizational memory, and human-approved skills from measured mission outcomes.',
      'Does not train model weights, rewrite SelfImpulse source, or bypass approval and verification gates.',
      'Simulated and contaminated runs are retained as evidence context but excluded from performance posteriors.',
      'Held-out transfer checks reduce selection overfitting; they do not turn small samples into a guarantee of future performance.'
    ]
  }
}
