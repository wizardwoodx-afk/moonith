import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { initialState, saveImprovement } from './selfImprove'
import { saveLessons, type Lesson } from './lessons'
import { rsiralsSnapshot } from './rsiralsSnapshot'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, String(value)) }
  removeItem(key: string): void { this.values.delete(key) }
}

const LESSONS_KEY = 'vh.lessons.v1'
const RUNS_KEY = 'vh.selfimprove.runs.v2'

let storage: MemoryStorage

/** A persisted lesson row is only renderable when its evidence really is a list. */
const goodLesson = (id: string, strength: number): Lesson => ({
  id,
  kind: 'failure',
  text: `Isolate the failing seat (${id}) before retrying.`,
  sourceMissionId: 'seed',
  evidence: [`failureClass=${id}`],
  strength,
  createdAt: 0,
  lastUsedAt: 0,
  useCount: 0
})

/** Write a row the Lesson type forbids but a legacy or damaged store can hold. */
function saveBrokenLesson(id: string): void {
  const row = { ...goodLesson(id, 0.9), evidence: undefined } as unknown as Record<string, unknown>
  delete row.evidence
  storage.setItem(LESSONS_KEY, JSON.stringify([goodLesson('lesson-alpha', 1), row, goodLesson('lesson-gamma', 0.5)]))
}

beforeEach(() => {
  storage = new MemoryStorage()
  vi.stubGlobal('localStorage', storage)
  saveImprovement(initialState(0))
  storage.setItem(RUNS_KEY, JSON.stringify([{ strategyId: 'strategy-v1', verified: true, simulated: false }]))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RSIRALS Learning snapshot', () => {
  it('skips a lesson without evidence instead of failing the whole snapshot', () => {
    saveBrokenLesson('lesson-without-evidence')

    const snapshot = rsiralsSnapshot()

    expect(snapshot.lessons.map((lesson) => lesson.id)).toEqual(['lesson-alpha', 'lesson-gamma'])
    // Everything else in the snapshot still renders.
    expect(snapshot.adopted?.id).toBe('strategy-v1')
    expect(snapshot.runs).toHaveLength(1)
    expect(snapshot.acceptanceRule).toContain('RSIRALS')
    expect(snapshot.boundaries.length).toBeGreaterThan(0)
    expect(snapshot.receipts).toEqual([])
  })

  it('survives every other non-list evidence shape without dropping good rows', () => {
    storage.setItem(
      LESSONS_KEY,
      JSON.stringify([
        { ...goodLesson('lesson-null-evidence', 1), evidence: null },
        { ...goodLesson('lesson-string-evidence', 1), evidence: 'failureClass=SEAT_FAILED' },
        goodLesson('lesson-good', 0.4)
      ])
    )

    expect(() => rsiralsSnapshot()).not.toThrow()
    expect(rsiralsSnapshot().lessons.map((lesson) => lesson.id)).toEqual(['lesson-good'])
  })

  it('still renders intact evidence for well-formed lessons', () => {
    saveLessons([goodLesson('lesson-alpha', 1)])

    const snapshot = rsiralsSnapshot()

    expect(snapshot.lessons).toHaveLength(1)
    expect(snapshot.lessons[0]?.evidence).toEqual(['failureClass=lesson-alpha'])
    expect(snapshot.lessons[0]?.utility).toBe(0.5)
  })
})
