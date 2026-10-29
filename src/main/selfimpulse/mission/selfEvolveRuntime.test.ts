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
  /** Keys whose writes throw, used to interrupt a settlement mid-pass. */
  readonly failingKeys = new Set<string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void {
    if (this.failingKeys.has(key)) throw new Error(`synthetic storage failure for ${key}`)
    this.values.set(key, String(value))
  }
  removeItem(key: string): void { this.values.delete(key) }
  clear(): void { this.values.clear() }
}

/** Raw store keys the settlement writes to, used to interrupt and to inspect persisted rows. */
const LESSONS_KEY = 'vh.lessons.v1'
const IMPROVEMENT_KEY = 'vh.selfimprove.v1'
const RUNS_KEY = 'vh.selfimprove.runs.v2'

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

let storage: MemoryStorage

beforeEach(() => {
  storage = new MemoryStorage()
  vi.stubGlobal('localStorage', storage)
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

describe('RSIRALS settlement reporting', () => {
  it('names the rows that landed when settlement fails after earlier writes', async () => {
    storage.failingKeys.add(IMPROVEMENT_KEY)
    const summary = await settleSelfEvolution(input())

    expect(summary.settlement?.outcome).toBe('partially-settled')
    expect(summary.settlement?.landed).toEqual(['memory', 'beliefs', 'run-log'])
    expect(summary.settlement?.failureReason).toContain('synthetic storage failure')
    // The writes at lessons, beliefs and the run log really landed, so the summary says so.
    expect(summary.lessonsLearned).toBe(1)
    expect(summary.memorySize).toBe(loadLessons().length)
    expect(loadLessons()).toHaveLength(2)
    expect(loadExperimentRuns()).toHaveLength(1)
    expect(loadImprovement().versions.some((version) => version.status === 'candidate')).toBe(false)
  })

  it('reports did-not-settle when nothing was written', async () => {
    storage.setItem(LESSONS_KEY, '{}')
    const summary = await settleSelfEvolution(input())

    expect(summary.settlement?.outcome).toBe('did-not-settle')
    expect(summary.settlement?.landed).toEqual([])
    expect(summary.settlement?.failureReason?.length).toBeGreaterThan(0)
    expect(summary.lessonsLearned).toBe(0)
    expect(summary.memorySize).toBe(0)
    expect(loadExperimentRuns()).toHaveLength(0)
    expect(storage.getItem(IMPROVEMENT_KEY)).not.toContain('candidate')
  })
})

describe('RSIRALS settlement idempotency', () => {
  it('a replayed settlement records one trial, not two', async () => {
    const first = await settleSelfEvolution(input())
    expect(first.settlement?.outcome).toBe('settled')
    expect(first.strategy.baseline.measured).toBe(1)

    const second = await settleSelfEvolution({ ...input(), now: 5000 })
    expect(second.settlement?.outcome).toBe('already-settled')
    expect(second.lessonsLearned).toBe(0)
    expect(second.strategy.baseline.measured).toBe(1)

    // One attributed observation, carrying a stable identity of its own.
    expect(loadExperimentRuns()).toHaveLength(1)
    const persisted = JSON.parse(storage.getItem(RUNS_KEY) ?? '[]') as Array<{ settlementKey?: string }>
    expect(persisted[0]?.settlementKey).toBe('run:mission-runtime')
    // Replaying the settlement inflates no other evidence either.
    expect(loadLessons().find((candidate) => candidate.id === 'lesson-used')?.utilityCount).toBe(1)
    expect(loadLearningReceipts()).toHaveLength(1)
  })

  it('refuses a second, contradictory trial for the same mission and writes nothing', async () => {
    await settleSelfEvolution(input())
    const lessonsBefore = storage.getItem(LESSONS_KEY)

    const summary = await settleSelfEvolution({ ...input(), verified: false, now: 5000 })
    expect(summary.settlement?.outcome).toBe('did-not-settle')
    expect(summary.settlement?.failureReason).toContain('already settled')
    expect(loadExperimentRuns()).toHaveLength(1)
    expect(storage.getItem(LESSONS_KEY)).toBe(lessonsBefore)
    expect(loadLearningReceipts()).toHaveLength(1)
  })

  it('completes an interrupted settlement on retry without counting a second trial', async () => {
    storage.failingKeys.add(IMPROVEMENT_KEY)
    const interrupted = await settleSelfEvolution(input())
    expect(interrupted.settlement?.outcome).toBe('partially-settled')

    storage.failingKeys.clear()
    const retry = await settleSelfEvolution({ ...input(), now: 2000 })
    expect(retry.settlement?.outcome).toBe('already-settled')
    // The trial already recorded is not appended again, and the strategy store heals.
    expect(loadExperimentRuns()).toHaveLength(1)
    expect(loadImprovement().versions.some((version) => version.status === 'candidate')).toBe(true)
    expect(retry.strategy.candidateStatus).toBe('candidate')
    // The replay pass writes no further learning rows for the same mission.
    expect(loadLessons()).toHaveLength(2)
    expect(loadLessons().find((candidate) => candidate.id === 'lesson-used')?.utilityCount).toBe(1)
    expect(loadLearningReceipts()).toHaveLength(0)
  })

  it('refuses a settlement that carries no stable mission identity', async () => {
    const summary = await settleSelfEvolution({ ...input(), missionId: '   ' })
    expect(summary.settlement?.outcome).toBe('did-not-settle')
    expect(summary.settlement?.failureReason).toContain('identity')
    expect(loadExperimentRuns()).toHaveLength(0)
  })
})
