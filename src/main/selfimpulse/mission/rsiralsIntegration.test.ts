import { describe, expect, it } from 'vitest'
import { creditLessonUtility, selectLessonsForBriefing, type Lesson } from './lessons'
import {
  adoptedVersion,
  initialState,
  nextAssignment,
  nextAssignmentHeldOut,
  proposeVariation,
  settleCandidate,
  type RunOutcome
} from './selfImprove'

const lesson: Lesson = {
  id: 'lesson-1',
  kind: 'failure',
  text: 'Isolate the failing deployment step before retrying.',
  sourceMissionId: 'm-1',
  evidence: ['failureClass=SEAT_FAILED'],
  strength: 0.8,
  createdAt: 0,
  lastUsedAt: 0,
  useCount: 2
}

describe('RSIRALS utility-attributed organizational memory', () => {
  it('credits only retrieved ids and keeps retrieval separate from repeated evidence', () => {
    const other = { ...lesson, id: 'lesson-2', text: 'A different lesson.' }
    const credited = creditLessonUtility(
      [lesson, other],
      ['lesson-1'],
      { verified: true, simulated: false, costUsd: 0 },
      1000
    )
    expect(credited[0].utility).toBeGreaterThan(0.5)
    expect(credited[0].utilityCount).toBe(1)
    expect(credited[0].retrievalCount).toBe(1)
    expect(credited[0].useCount).toBe(2)
    expect(credited[1].utility).toBeUndefined()
  })

  it('does not credit memory from simulations', () => {
    const credited = creditLessonUtility([lesson], ['lesson-1'], { verified: true, simulated: true }, 1000)
    expect(credited[0].utility).toBeUndefined()
    expect(credited[0].retrievalCount).toBeUndefined()
  })

  it('returns exact lesson attribution for the selected briefing lines', () => {
    const selection = selectLessonsForBriefing([lesson], 'deployment retry', 1000)
    expect(selection.lessonIds).toEqual(['lesson-1'])
    expect(selection.lines).toHaveLength(1)
    expect(selection.lines[0]).toContain('org memory scar')
  })
})

describe('RSIRALS attributed strategy lifecycle', () => {
  it('alternates its own arms, reserves a held-out pair, and adopts after transfer', () => {
    const now = 1000
    let state = proposeVariation(initialState(now), now)
    const baseline = adoptedVersion(state)
    const candidate = state.versions.find((version) => version.status === 'candidate')
    expect(baseline).toBeTruthy()
    expect(candidate).toBeTruthy()
    if (!baseline || !candidate) return

    const runs: RunOutcome[] = []
    // The first six real development runs alternate by attribution. The
    // candidate is perfect; the baseline is not.
    for (let index = 0; index < 6; index += 1) {
      const assignment = nextAssignment(state, runs)
      expect(assignment).toBeTruthy()
      if (!assignment) continue
      runs.push({
        strategyId: assignment.id,
        verified: assignment.id === candidate.id,
        simulated: false,
        heldOut: false
      })
    }
    expect(runs.filter((run) => run.strategyId === candidate.id)).toHaveLength(3)
    expect(runs.filter((run) => run.strategyId === baseline.id)).toHaveLength(3)
    expect(nextAssignmentHeldOut(state, runs)).toBe(true)

    for (let index = 0; index < 2; index += 1) {
      const assignment = nextAssignment(state, runs)
      if (!assignment) continue
      runs.push({ strategyId: assignment.id, verified: true, simulated: false, heldOut: true })
    }
    state = settleCandidate(state, runs, now + 1)
    expect(adoptedVersion(state)?.id).toBe(candidate.id)
    expect(candidate.note.length).toBeGreaterThan(0)
    expect(adoptedVersion(state)?.note).toContain('held-out')
  })

  it('never counts leaked or unattributed runs toward candidate trials', () => {
    let state = proposeVariation(initialState(0), 0)
    const candidate = state.versions.find((version) => version.status === 'candidate')
    const baseline = adoptedVersion(state)
    if (!candidate || !baseline) throw new Error('missing experiment arms')
    const runs: RunOutcome[] = [
      ...Array.from({ length: 8 }, () => ({
        strategyId: candidate.id,
        verified: true,
        simulated: false,
        evidenceLeak: true
      })),
      ...Array.from({ length: 8 }, () => ({
        strategyId: null,
        verified: true,
        simulated: false
      }))
    ]
    state = settleCandidate(state, runs, 1)
    expect(state.adoptedId).toBe(baseline.id)
    expect(state.versions.find((version) => version.id === candidate.id)?.status).toBe('retired')
  })
})
