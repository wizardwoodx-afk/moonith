import { describe, expect, it, vi } from 'vitest'
import { createToolArgumentSnapshot } from './toolArgumentSnapshot'

describe('createToolArgumentSnapshot', () => {
  it('detaches and recursively freezes execution data but leaves display data editable', () => {
    const input = { values: [null, true, 0, -0, 'text', { nested: ['safe'] }], empty: {} }
    const { executionArgs, displayArgs } = createToolArgumentSnapshot(input)
    expect(executionArgs).toEqual(input)
    expect(displayArgs).toEqual(input)
    expect(Object.isFrozen(executionArgs)).toBe(true)
    expect(Object.isFrozen(executionArgs.values)).toBe(true)
    const values = executionArgs.values as typeof input.values
    expect(Object.is(values[3], -0)).toBe(true)
    expect(Object.isFrozen(values[5])).toBe(true)
    expect(Object.isFrozen((values[5] as { nested: string[] }).nested)).toBe(true)
    expect(() => (values[5] as { nested: string[] }).nested.push('no')).toThrow(TypeError)
    input.values.push('original mutation')
    ;(displayArgs.values as unknown[]).push('display mutation')
    ;((displayArgs.values as typeof input.values)[5] as { nested: string[] }).nested[0] = 'edited'
    expect((values[5] as { nested: string[] }).nested).toEqual(['safe'])
    expect(values).toHaveLength(6)
    expect(Object.isFrozen(input)).toBe(false)
    expect(Object.isFrozen(displayArgs)).toBe(false)
  })

  it('preserves null-prototype records and own __proto__ keys without prototype pollution', () => {
    const input = Object.assign(Object.create(null), JSON.parse('{"__proto__":{"safe":true},"constructor":"value"}'))
    const { executionArgs, displayArgs } = createToolArgumentSnapshot(input)
    expect(Object.getPrototypeOf(executionArgs)).toBeNull()
    expect(Object.hasOwn(executionArgs, '__proto__')).toBe(true)
    expect(executionArgs.__proto__).toEqual({ safe: true })
    expect(displayArgs.__proto__).not.toBe(executionArgs.__proto__)
    expect(Object.getPrototypeOf(executionArgs.__proto__)).toBe(Object.prototype)
    expect(executionArgs.constructor).toBe('value')
  })

  it('accepts shared non-cyclic subtrees without keeping input references', () => {
    const shared = { text: 'safe' }
    const { executionArgs } = createToolArgumentSnapshot({ a: shared, b: shared })
    shared.text = 'changed'
    expect(executionArgs).toEqual({ a: { text: 'safe' }, b: { text: 'safe' } })
  })

  const cycle: Record<string, unknown> = {}
  cycle.self = cycle
  const sparse = new Array(2)
  const extraArrayProperty = Object.assign(['safe'], { extra: true })
  const nonEnumerable = Object.defineProperty({}, 'hidden', { value: 'secret' })
  const symbolKey = { [Symbol('hidden')]: true }
  const arrayCycle: unknown[] = []
  arrayCycle.push(arrayCycle)

  it.each([
    ['undefined', undefined], ['function', () => 'unsafe'], ['symbol', Symbol('unsafe')],
    ['bigint', 1n], ['NaN', NaN], ['infinity', Infinity], ['negative infinity', -Infinity],
    ['date', new Date()], ['map', new Map()], ['set', new Set()],
    ['typed array', new Uint8Array([1])], ['custom prototype', Object.create({ inherited: true })],
    ['cycle', cycle], ['array cycle', arrayCycle], ['sparse array', sparse],
    ['array extra property', extraArrayProperty], ['non-enumerable property', nonEnumerable],
    ['symbol key', symbolKey], ['proxy', new Proxy({}, {})]
  ])('rejects unsupported nested %s instead of silently converting or omitting it', (_name, value) => {
    expect(() => createToolArgumentSnapshot({ value })).toThrow(/unsupported tool arguments/i)
  })

  it.each([
    ['null', null], ['array', []], ['string', 'text'], ['number', 1], ['boolean', false]
  ])('rejects non-record argument roots: %s', (_name, value) => {
    expect(() => createToolArgumentSnapshot(value)).toThrow(/unsupported tool arguments/i)
  })

  it('rejects accessors without invoking them or serialization hooks', () => {
    const getter = vi.fn(() => 'secret')
    const toJSON = vi.fn(() => ({}))
    expect(() => createToolArgumentSnapshot({ value: Object.defineProperty({}, 'secret', { enumerable: true, get: getter }) })).toThrow(/unsupported tool arguments/i)
    expect(() => createToolArgumentSnapshot({ toJSON })).toThrow(/unsupported tool arguments/i)
    expect(getter).not.toHaveBeenCalled()
    expect(toJSON).not.toHaveBeenCalled()
  })
})
