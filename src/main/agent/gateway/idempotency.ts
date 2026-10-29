/**
 * Idempotency Subsystem for the Tool Execution Gateway.
 *
 * Prevents unintentional duplicate executions of tools across agent turns,
 * retries, or network interruptions. If an identical idempotency key is presented
 * within its TTL window, the cached result is returned without re-running the side-effect.
 */
import { createHash } from 'node:crypto'

export interface CachedExecution {
  key: string
  tool: string
  actionId: string
  timestamp: number
  result: { content: string; isError?: boolean }
}

export class IdempotencyStore {
  private cache = new Map<string, CachedExecution>()
  private ttlMs: number

  constructor(ttlMinutes = 30) {
    this.ttlMs = ttlMinutes * 60 * 1000
  }

  /**
   * Generates a deterministic idempotency key from action parameters if none was explicitly passed.
   */
  generateKey(agentId: string, tool: string, args: Record<string, unknown>): string {
    const payload = `${agentId}:${tool}:${JSON.stringify(args, Object.keys(args).sort())}`
    return createHash('sha256').update(payload).digest('hex')
  }

  get(key: string): CachedExecution | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined

    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key)
      return undefined
    }

    return entry
  }

  set(key: string, tool: string, actionId: string, result: { content: string; isError?: boolean }): void {
    // Evict oldest entries if cache exceeds 1,000 items
    if (this.cache.size > 1000) {
      const oldest = this.cache.keys().next().value
      if (oldest) this.cache.delete(oldest)
    }

    this.cache.set(key, {
      key,
      tool,
      actionId,
      timestamp: Date.now(),
      result
    })
  }

  clear(): void {
    this.cache.clear()
  }
}

export const idempotencyStore = new IdempotencyStore()
