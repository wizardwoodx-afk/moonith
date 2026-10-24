import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./signing', () => ({
  signingSupported: () => false,
  signHexDigest: async () => null,
  verifyIssuerSignature: async () => false
}))

import { loadLessons, saveLessons, type Lesson } from './lessons'
import { loadLearningReceipts, verifyLearningReceipt } from './learningReceipt'
import { adoptedVersion, initialState, loadImprovement, saveImprovement } from './selfImprove'
import { loadExperimentRuns, settleSelfEvolution } from './selfEvolveRuntime'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, String(value)) }
  removeItem(key: string): void { this.values.delete(key) }
  clear(): void { this.values.clear() }
}

const seededLesson: Lesson = {
  id: 'lesson-used',
  kind: 'failure',
  text: 'Isolate a failing deployment seat before retrying.',
  sourceMissionId: 'seed',
  evidence: ['failureClass=SEAT_FAILED'],
  strength: 1,
  createdAt: 0,
  lastUsedAt: 0,
  useCount: 0
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
  saveImprovement(initialState(0))
  saveLessons([seededLesson])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const input = () => ({
  missionId: 'mission-runtime',
  goal: 'deployment verification',
  simulated: false,
  verified: true,
  failureClasses: [],
  repairLadder: [],
  repaired: false,
  seatOutcomes: [{ role: 'reviewer', label: 'reviewer', harness: 'llm', passed: true }],
  strategyId: adoptedVersion(loadImprovement())?.id,
  usedLessonIds: ['lesson-used'],
  costUsd: 0.25,
  policyTokens: 1200,
  now: 1000
})

describe('RSIRALS runtime settlement', () => {
  it('persists attributed runs, memory credit, a candidate, and a verifiable learning receipt', async () => {
    const summary = await settleSelfEvolution(input())
    expect(summary.lessonsLearned).toBe(1)
    expect(summary.learningReceiptId).toBeTruthy()
    expect(summary.strategy.candidateStatus).toBe('candidate')

    const lesson = loadLessons().find((candidate) => candidate.id === 'lesson-used')
    expect(lesson?.utility).toBeGreaterThan(0.5)
    expect(lesson?.utilityCount).toBe(1)
    const runs = loadExperimentRuns()
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      strategyId: input().strategyId,
      verified: true,
      heldOut: false,
      evidenceLeak: false,
      costUsd: 0.25,
      policyTokens: 1200
    })
    const receipt = loadLearningReceipts()[0]
    expect(receipt.memoryCredit).toEqual({
      lessonIds: ['lesson-used'],
      verified: true,
      model: 'bounded-retrieval-utility/v1'
    })
    expect(receipt.evaluation).toEqual({
      heldOut: false,
      evidenceLeak: false,
      costUsd: 0.25,
      policyTokens: 1200
    })
    expect((await verifyLearningReceipt(receipt)).ok).toBe(true)
  })

  it('records but does not learn performance from contaminated evidence', async () => {
    await settleSelfEvolution(input())
    const before = loadLessons().find((candidate) => candidate.id === 'lesson-used')?.utilityCount
    const summary = await settleSelfEvolution({
      ...input(),
      missionId: 'mission-leaked',
      verified: false,
      evidenceLeak: true,
      now: 2000
    })
    expect(summary.lessonsLearned).toBe(0)
    expect(loadLessons().find((candidate) => candidate.id === 'lesson-used')?.utilityCount).toBe(before)
    const runs = loadExperimentRuns()
    expect(runs[1]?.evidenceLeak).toBe(true)
  })
})
