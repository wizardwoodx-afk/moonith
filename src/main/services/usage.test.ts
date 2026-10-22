import { describe, expect, it } from 'vitest'
import { dayKey, usageLevel } from './usage'

describe('usage accounting', () => {
  it('levels days by real token volume', () => {
    expect(usageLevel(0)).toBe(0)
    expect(usageLevel(1)).toBe(1)
    expect(usageLevel(2_000)).toBe(2)
    expect(usageLevel(10_000)).toBe(3)
    expect(usageLevel(40_000)).toBe(4)
    expect(usageLevel(120_000)).toBe(5)
  })

  it('uses local calendar days for buckets', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
    expect(dayKey(new Date(2026, 11, 31, 0, 5))).toBe('2026-12-31')
  })
})
