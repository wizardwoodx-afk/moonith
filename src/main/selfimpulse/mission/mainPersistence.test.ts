import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./signing', () => ({
  signingSupported: () => false,
  signHexDigest: async () => null,
  verifyIssuerSignature: async () => false
}))

import { configureNodeStorageRoot, resetNodeStorageForTests } from '../persist/nodeStorage'
import { beliefFromMeasured, loadBeliefs, saveBeliefs } from './belief'
import { issueLearningReceipt, loadLearningReceipts, saveLearningReceipts } from './learningReceipt'
import { loadLessons, saveLessons } from './lessons'
import { loadExperimentRuns, settleSelfEvolution } from './selfEvolveRuntime'
import { initialState, loadImprovement, saveImprovement } from './selfImprove'
import { loadSkills, saveSkills } from './skillEvolution'

let directory = ''
let previousRoot: string | undefined

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'selfimpulse-native-learning-'))
  previousRoot = process.env.SELFIMPULSE_USER_DATA
  process.env.SELFIMPULSE_USER_DATA = directory
  configureNodeStorageRoot(join(directory, 'selfimpulse'))
  vi.stubGlobal('localStorage', undefined)
})

afterEach(async () => {
  resetNodeStorageForTests()
  vi.unstubAllGlobals()
  if (previousRoot === undefined) delete process.env.SELFIMPULSE_USER_DATA
  else process.env.SELFIMPULSE_USER_DATA = previousRoot
  await rm(directory, { recursive: true, force: true })
})

describe('native RSIRALS persistence', () => {
  it('reloads every learning store and the experiment run log from disk', async () => {
    saveImprovement(initialState(0))
    saveLessons([{
      id: 'lesson-native', kind: 'failure', text: 'Persist the native learning state.',
      sourceMissionId: 'mission-native', evidence: ['test=native'], strength: 1,
      createdAt: 0, lastUsedAt: 0, useCount: 0
    }])
    saveBeliefs([beliefFromMeasured('Native storage works', true, 1, 'test', 0)])
    saveSkills([{
      id: 'skill-native', name: 'native-pattern', description: 'A persisted proposal.',
      source: 'verified-mission', sourceMissionId: 'mission-native', status: 'proposed', learnedAt: 0
    }])
    saveLearningReceipts([await issueLearningReceipt({
      mjVersion: 'test', missionId: 'mission-native', lessons: [], strategyChange: null, now: 0
    })])
    await settleSelfEvolution({
      missionId: 'mission-native', goal: 'Verify native persistence', simulated: false, verified: true,
      failureClasses: [], repairLadder: [], repaired: false,
      seatOutcomes: [{ role: 'reviewer', label: 'reviewer', harness: 'llm', passed: true }],
      strategyId: 'strategy-v1', now: 1000
    })

    // Clear all process-local state; the environment root now forces file reads.
    resetNodeStorageForTests()
    expect(loadImprovement().adoptedId).toBe('strategy-v1')
    expect(loadLessons().some((lesson) => lesson.id === 'lesson-native')).toBe(true)
    expect(loadBeliefs().some((belief) => belief.claim === 'Native storage works')).toBe(true)
    expect(loadSkills().some((skill) => skill.id === 'skill-native')).toBe(true)
    expect(loadLearningReceipts().length).toBeGreaterThan(0)
    expect(loadExperimentRuns()).toHaveLength(1)
    expect((await readdir(join(directory, 'selfimpulse', 'store'))).length).toBeGreaterThanOrEqual(6)
  })

  it('refuses malformed native learning data instead of returning empty memory', async () => {
    saveLessons([])
    const file = join(directory, 'selfimpulse', 'store', 'vh.lessons.v1.json')
    await writeFile(file, '{broken', 'utf8')
    expect(() => loadLessons()).toThrow()
  })
})
