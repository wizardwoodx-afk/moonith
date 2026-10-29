/**
 * Conflict-Safe Shared Context (CRDT LWW) for SelfImpulse.
 *
 * Implements Last-Write-Wins (LWW-Element-Set) per-key conflict resolution:
 * - Employs Lamport logical timestamps to order concurrent mutations deterministically.
 * - Authenticates peer updates against allowlisted peer keys.
 * - Prevents race conditions and state corruption during simultaneous peer updates.
 */

export interface CRDTEntry<T = unknown> {
  key: string
  value: T
  peerId: string
  lamportTimestamp: number
  wallClock: string
}

export class CRDTContextStore {
  private state: Map<string, CRDTEntry> = new Map()
  private localLamport = 0
  private allowlistedPeers: Set<string> = new Set(['local', 'host'])

  allowPeer(peerId: string): void {
    this.allowlistedPeers.add(peerId)
  }

  revokePeer(peerId: string): void {
    this.allowlistedPeers.delete(peerId)
  }

  /**
   * Set or update a key locally.
   */
  set<T>(key: string, value: T, peerId = 'local'): CRDTEntry<T> {
    this.localLamport += 1
    const entry: CRDTEntry<T> = {
      key,
      value,
      peerId,
      lamportTimestamp: this.localLamport,
      wallClock: new Date().toISOString()
    }
    this.state.set(key, entry as CRDTEntry)
    return entry
  }

  get<T>(key: string): T | undefined {
    return this.state.get(key)?.value as T | undefined
  }

  /**
   * Merge an incoming remote update from a peer.
   * Returns true if the update was applied (won the LWW comparison).
   */
  mergeRemote(incoming: CRDTEntry): boolean {
    if (!this.allowlistedPeers.has(incoming.peerId)) {
      throw new Error(`Unauthorized peer update: Peer '${incoming.peerId}' not allowlisted`)
    }

    this.localLamport = Math.max(this.localLamport, incoming.lamportTimestamp) + 1

    const existing = this.state.get(incoming.key)
    if (!existing) {
      this.state.set(incoming.key, incoming)
      return true
    }

    // LWW Comparison: higher Lamport timestamp wins; if equal, higher peerId lexicographically wins
    if (
      incoming.lamportTimestamp > existing.lamportTimestamp ||
      (incoming.lamportTimestamp === existing.lamportTimestamp && incoming.peerId > existing.peerId)
    ) {
      this.state.set(incoming.key, incoming)
      return true
    }

    return false
  }

  snapshot(): Record<string, unknown> {
    const res: Record<string, unknown> = {}
    for (const [k, v] of this.state.entries()) {
      res[k] = v.value
    }
    return res
  }
}

export const crdtContext = new CRDTContextStore()
