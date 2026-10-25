import { describe, expect, it } from 'vitest'
import { cronTimeMinutes, replaceCronTime } from './cron'

describe('schedule time helpers', () => {
  it('reads fixed daily and weekday cron times', () => {
    expect(cronTimeMinutes('30 9 * * 1-5')).toBe(570)
    expect(cronTimeMinutes('5 0 * * *')).toBe(5)
  })

  it('does not treat interval or wildcard schedules as fixed times', () => {
    expect(cronTimeMinutes('*/30 * * * *')).toBeNull()
    expect(cronTimeMinutes('0 * * * *')).toBeNull()
    expect(cronTimeMinutes('not a cron')).toBeNull()
  })

  it('rejects invalid hours and minutes', () => {
    expect(cronTimeMinutes('60 9 * * *')).toBeNull()
    expect(cronTimeMinutes('0 24 * * *')).toBeNull()
  })

  it('changes only the time fields and preserves schedule days', () => {
    expect(replaceCronTime('30 9 * * 1-5', 18 * 60 + 45)).toBe('45 18 * * 1-5')
    expect(replaceCronTime('0 0 1 * *', 23 * 60 + 59)).toBe('59 23 1 * *')
  })

  it('clamps scrubber values to a valid day', () => {
    expect(replaceCronTime('0 9 * * *', -20)).toBe('0 0 * * *')
    expect(replaceCronTime('0 9 * * *', 2000)).toBe('59 23 * * *')
  })
})
