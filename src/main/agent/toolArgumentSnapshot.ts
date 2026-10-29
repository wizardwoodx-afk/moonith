import { types } from 'node:util'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

function unsupported(reason: string): never {
  throw new TypeError(`Unsupported tool arguments: ${reason}`)
}

/** Copy only JSON data, without invoking getters or serialization hooks. */
function copyJson(value: unknown, freeze: boolean, ancestors = new Set<object>()): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) unsupported('numbers must be finite')
    return value
  }
  if (typeof value !== 'object') unsupported('expected JSON data')
  if (types.isProxy(value)) unsupported('proxies are not JSON data')
  const prototype = Object.getPrototypeOf(value)
  const array = Array.isArray(value)
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    unsupported('expected plain objects or arrays')
  }
  if (ancestors.has(value)) unsupported('cyclic data')
  ancestors.add(value)
  try {
    const keys = Reflect.ownKeys(value)
    // Dense arrays have exactly their indices and the built-in length property.
    if (array && keys.length !== value.length + 1) unsupported('sparse arrays or extra array properties')
    const copy: JsonValue[] | { [key: string]: JsonValue } = array ? [] : Object.create(prototype)
    for (const key of keys) {
      if (array && key === 'length') continue
      if (typeof key !== 'string') unsupported('symbol keys')
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) {
        unsupported('extra array properties')
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      if (!descriptor.enumerable || !('value' in descriptor)) unsupported('accessors or hidden properties')
      // Defining an own property also preserves a literal __proto__ key safely.
      Object.defineProperty(copy, key, {
        value: copyJson(descriptor.value, freeze, ancestors),
        enumerable: true,
        writable: true,
        configurable: true
      })
    }
    if (freeze) Object.freeze(copy)
    return copy
  } finally {
    ancestors.delete(value)
  }
}

/** One immutable action payload plus a separately owned, editable UI copy. */
export function createToolArgumentSnapshot(value: unknown): {
  executionArgs: Record<string, unknown>
  displayArgs: Record<string, unknown>
} {
  if (value === null || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) {
    unsupported('the argument root must be a plain object')
  }
  const executionArgs = copyJson(value, true) as Record<string, unknown>
  const displayArgs = copyJson(executionArgs, false) as Record<string, unknown>
  return { executionArgs, displayArgs }
}
