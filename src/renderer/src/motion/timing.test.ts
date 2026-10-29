import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DURATION, EASE_ENTER, EASE_EXIT, EASE_HERO, EASE_MOVE, STAGGER_STEP_MS, createBatchOrder } from './timing'

const css = readFileSync('src/renderer/src/styles.css', 'utf8')

function cssBezier(token: string): string {
  const match = css.match(new RegExp(`--${token}:\\s*cubic-bezier\\(([^)]*)\\)`))
  if (!match) throw new Error(`--${token} is missing from styles.css`)
  return match[1]
}

function cssMs(token: string): number {
  const match = css.match(new RegExp(`--${token}:\\s*(\\d+)ms`))
  if (!match) throw new Error(`--${token} is missing from styles.css`)
  return Number(match[1])
}

describe('motion tokens', () => {
  it('keeps the JS curves identical to the CSS custom properties', () => {
    expect(cssBezier('ease-enter')).toBe(EASE_ENTER.join(', '))
    expect(cssBezier('ease-exit')).toBe(EASE_EXIT.join(', '))
    expect(cssBezier('ease-move')).toBe(EASE_MOVE.join(', '))
    expect(cssBezier('ease-hero')).toBe(EASE_HERO.join(', '))
  })

  it('keeps the JS durations identical to the CSS durations', () => {
    expect(cssMs('dur-feedback')).toBe(DURATION.feedback * 1000)
    expect(cssMs('dur-enter')).toBe(DURATION.enter * 1000)
    expect(cssMs('dur-pop')).toBe(DURATION.pop * 1000)
    expect(cssMs('dur-surface')).toBe(DURATION.surface * 1000)
    expect(cssMs('dur-exit')).toBe(DURATION.exit * 1000)
  })

  it('exits faster than it enters, everywhere', () => {
    expect(DURATION.exit).toBeLessThan(DURATION.enter)
    expect(cssMs('dur-exit')).toBeLessThan(cssMs('dur-enter'))
    expect(cssMs('dur-enter')).toBeLessThanOrEqual(300)
  })

  it('keeps the stagger step in both files', () => {
    expect(cssMs('stagger-step')).toBe(STAGGER_STEP_MS)
  })
})

describe('createBatchOrder', () => {
  it('cascades rows that mount in one burst', () => {
    let now = 1000
    const order = createBatchOrder(() => now)
    expect([0, 1, 2, 3].map((index) => order.positionFor(`row-${index}`))).toEqual([0, 1, 2, 3])
  })

  it('gives a row that arrives alone no delay at all', () => {
    let now = 1000
    const order = createBatchOrder(() => now)
    order.positionFor('a')
    now += 500
    expect(order.positionFor('latecomer')).toBe(0)
  })

  it('reuses the position once a row is known', () => {
    let now = 1000
    const order = createBatchOrder(() => now)
    order.positionFor('a')
    now += 500
    expect(order.positionFor('a')).toBe(0)
  })

  it('starts a new cascade after a reset', () => {
    const now = () => 1000
    const order = createBatchOrder(now)
    expect(order.positionFor('a')).toBe(0)
    expect(order.positionFor('b')).toBe(1)
    order.reset()
    expect(order.positionFor('a')).toBe(0)
  })
})
