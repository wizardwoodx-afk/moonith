import { describe, expect, it, vi } from 'vitest'
import { OutputRepetitionGuard } from './outputGuard'
import { TurnInputQueue } from './inputQueue'

describe('Impulse Runtime input queue', () => {
  it('restores an uncommitted batch ahead of later input and commits once', () => {
    const queue = new TurnInputQueue<{ id: string }>('all')
    const a = { id: 'a' }
    const b = { id: 'b' }
    const c = { id: 'c' }
    queue.enqueue(a)
    queue.enqueue(b)
    expect(queue.drain()).toEqual([a, b])
    expect(queue.hasItems()).toBe(false)
    expect(queue.inFlightCount).toBe(2)

    queue.enqueue(c)
    queue.restore()
    expect(queue.pendingCount).toBe(3)
    const retry = queue.drain()
    expect(retry).toEqual([a, b, c])
    for (const message of retry) queue.commit(message)
    expect(queue.inFlightCount).toBe(0)
    expect(queue.hasItems()).toBe(false)
  })

  it('fences a reserved continuation from later input', () => {
    const queue = new TurnInputQueue<{ id: string }>('all')
    const a = { id: 'a' }
    const b = { id: 'b' }
    queue.enqueue(a)
    const release = queue.reserve([a])
    queue.enqueue(b)
    expect(queue.drain()).toEqual([a])
    release()
    expect(queue.drain()).toEqual([b])
  })

  it('notifies subscribers without making them owners of the queue', () => {
    const queue = new TurnInputQueue<{ id: string }>()
    const listener = vi.fn()
    const unsubscribe = queue.subscribe(listener)
    queue.enqueue({ id: 'a' })
    unsubscribe()
    queue.enqueue({ id: 'b' })
    expect(listener).toHaveBeenCalledOnce()
    expect(queue.pendingCount).toBe(2)
  })
})

describe('Impulse Runtime output guard', () => {
  it('detects a repeated phrase across small provider deltas', () => {
    const guard = new OutputRepetitionGuard()
    const phrase = 'The same response repeats without making progress. '
    let stopped = false
    for (let index = 0; index < 500 && !stopped; index++) {
      stopped = guard.feed(phrase)
    }
    expect(stopped).toBe(true)
    expect(guard.feed('')).toBe(true)
  })

  it('does not reject varied numbered records', () => {
    const guard = new OutputRepetitionGuard()
    const varied = Array.from(
      { length: 1200 },
      (_, index) => `record ${index}: unique value ${(index * 7919).toString(36)}\n`
    ).join('')
    expect(guard.feed(varied)).toBe(false)
  })
})
