import { describe, expect, it } from 'vitest'
import { activityLevel, buildActivity } from './activity'

function task(updatedAt: string, artifactsCount = 0) {
  return { updatedAt, artifactsCount }
}

const NOON = new Date('2026-10-21T12:00:00.000Z')

describe('activity levels', () => {
  it('maps counts onto five visible levels', () => {
    expect([0, 1, 2, 3, 5, 8].map(activityLevel)).toEqual([0, 1, 2, 3, 4, 5])
  })
})

describe('activity grid', () => {
  it('builds 52 columns of seven days ending today', () => {
    const grid = buildActivity([], 'sessions', NOON)
    expect(grid.columns).toHaveLength(52)
    expect(grid.columns.every((column) => column.length === 7)).toBe(true)
    const last = grid.columns[51][6]
    expect(last.date).toBe('2026-10-21')
    expect(grid.days).toHaveLength(364)
  })

  it('counts sessions on the local day they were touched', () => {
    const grid = buildActivity(
      [
        task('2026-10-21T08:00:00.000Z'),
        task('2026-10-21T09:00:00.000Z'),
        task('2026-10-20T09:00:00.000Z')
      ],
      'sessions',
      NOON
    )
    const today = grid.days.find((day) => day.date === '2026-10-21')
    const yesterday = grid.days.find((day) => day.date === '2026-10-20')
    expect(today).toMatchObject({ count: 2, level: 2 })
    expect(yesterday).toMatchObject({ count: 1, level: 1 })
    expect(grid.stats).toEqual({
      total: 3,
      peak: 2,
      streak: 2,
      activeDays: 2
    })
  })

  it('uses delivered artifacts for the receipts metric', () => {
    const grid = buildActivity([task('2026-10-21T08:00:00.000Z', 3)], 'receipts', NOON)
    expect(grid.stats.total).toBe(3)
    expect(grid.days.find((day) => day.date === '2026-10-21')?.level).toBe(3)
  })

  it('labels each month once at the column where it begins', () => {
    const grid = buildActivity([], 'sessions', NOON)
    expect(grid.months.length).toBeGreaterThanOrEqual(12)
    expect(grid.months[0].label).not.toBe('')
    const indexes = grid.months.map((month) => month.index)
    expect(new Set(indexes).size).toBe(indexes.length)
    expect(indexes.every((index) => index >= 0 && index < 52)).toBe(true)
  })
})
