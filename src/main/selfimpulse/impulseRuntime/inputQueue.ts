/**
 * Transactional steering queue for Impulse Runtime.
 * Adapted to SelfImpulse's persisted transcript ownership; see PROVENANCE.json.
 */
export type InputQueueMode = 'all' | 'one-at-a-time'

export class TurnInputQueue<T extends object> {
  private messages: T[] = []
  private inFlight: T[] = []
  private readonly submitted = new Set<T>()
  private cancelled = new WeakSet<T>()
  private readonly listeners = new Set<() => void>()

  constructor(public mode: InputQueueMode = 'all') {}

  enqueue(message: T): void {
    this.messages.push(message)
    for (const listener of this.listeners) listener()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  hasItems(): boolean {
    return this.messages.length > 0
  }

  get pendingCount(): number {
    return this.messages.length
  }

  get inFlightCount(): number {
    return this.inFlight.length
  }

  peek(): readonly T[] {
    const messages = this.inFlight.length > 0 ? this.inFlight : this.messages
    return messages.slice(0, this.mode === 'all' ? undefined : 1)
  }

  /**
   * Fence a provider continuation to one admitted batch. Input accepted later
   * stays queued instead of rewriting that continuation's context.
   */
  reserve(messages: readonly T[]): () => void {
    for (const message of messages) this.submitted.add(message)
    return () => {
      for (const message of messages) this.submitted.delete(message)
    }
  }

  drain(): T[] {
    let count = this.mode === 'all' ? this.messages.length : 1
    const boundary = this.messages.findIndex((message) => !this.submitted.has(message))
    if (boundary > 0) count = Math.min(count, boundary)
    const drained = this.messages.splice(0, count)
    this.inFlight.push(...drained)
    return drained
  }

  commit(message: T): void {
    this.submitted.delete(message)
    this.cancelled.delete(message)
    const index = this.inFlight.indexOf(message)
    if (index >= 0) this.inFlight.splice(index, 1)
  }

  /** Restore uncommitted input ahead of messages accepted later. */
  restore(): void {
    this.messages = [...this.inFlight, ...this.messages]
    this.inFlight = []
    this.submitted.clear()
  }

  cancelFirst(predicate: (message: T) => boolean): T | undefined {
    const pendingIndex = this.messages.findIndex(predicate)
    const pending = this.messages[pendingIndex]
    if (pending) {
      if (this.submitted.has(pending)) return undefined
      return this.messages.splice(pendingIndex, 1)[0]
    }
    const inFlightIndex = this.inFlight.findIndex(predicate)
    const message = this.inFlight[inFlightIndex]
    if (!message || this.submitted.has(message)) return undefined
    this.inFlight.splice(inFlightIndex, 1)
    this.cancelled.add(message)
    return message
  }

  consumeCancellation(message: T): boolean {
    return this.cancelled.delete(message)
  }

  clear(): void {
    this.messages = this.messages.filter((message) => this.submitted.has(message))
    this.inFlight = this.inFlight.filter((message) => this.submitted.has(message))
    this.cancelled = new WeakSet<T>()
  }
}
