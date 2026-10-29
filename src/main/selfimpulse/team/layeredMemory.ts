/**
 * Layered Memory Engine for SelfImpulse.
 *
 * Implements two distinct memory tiers:
 * 1. Private Agent Memory: Isolated per-agent scratchpad, hypotheses, and scratch files.
 * 2. Shared Team Memory: Team-wide repository of conventions, decisions, and handoff facts
 *    with granular per-agent read-only or read-write access control.
 */
import { nowIso } from '../../util'

export interface MemoryFact {
  id: string
  key: string
  value: string
  authorAgentId: string
  scope: 'private' | 'shared'
  accessLevel: 'read-only' | 'read-write'
  updatedAt: string
}

export class LayeredMemoryService {
  private privateMemories: Map<string, Map<string, MemoryFact>> = new Map() // agentId -> (key -> fact)
  private sharedMemories: Map<string, MemoryFact> = new Map() // key -> fact

  /**
   * Set a private scratchpad fact for an individual agent.
   */
  setPrivate(agentId: string, key: string, value: string): MemoryFact {
    if (!this.privateMemories.has(agentId)) {
      this.privateMemories.set(agentId, new Map())
    }
    const agentMap = this.privateMemories.get(agentId)!
    const fact: MemoryFact = {
      id: `priv_${Date.now()}`,
      key,
      value,
      authorAgentId: agentId,
      scope: 'private',
      accessLevel: 'read-write',
      updatedAt: nowIso()
    }
    agentMap.set(key, fact)
    return fact
  }

  getPrivate(agentId: string, key: string): string | null {
    return this.privateMemories.get(agentId)?.get(key)?.value ?? null
  }

  /**
   * Set a shared team memory fact, checking write permissions.
   */
  setShared(
    agentId: string,
    key: string,
    value: string,
    accessLevel: 'read-only' | 'read-write' = 'read-write'
  ): MemoryFact {
    const existing = this.sharedMemories.get(key)
    if (existing && existing.accessLevel === 'read-only' && existing.authorAgentId !== agentId) {
      throw new Error(`Permission denied: Memory key '${key}' is marked read-only by ${existing.authorAgentId}`)
    }

    const fact: MemoryFact = {
      id: existing?.id || `shared_${Date.now()}`,
      key,
      value,
      authorAgentId: agentId,
      scope: 'shared',
      accessLevel,
      updatedAt: nowIso()
    }
    this.sharedMemories.set(key, fact)
    return fact
  }

  getShared(key: string): string | null {
    return this.sharedMemories.get(key)?.value ?? null
  }

  /**
   * Build complete contextual memory view for an agent (combining private + shared).
   */
  getMergedContext(agentId: string): Record<string, string> {
    const merged: Record<string, string> = {}
    // 1. Shared facts first
    for (const [k, v] of this.sharedMemories.entries()) {
      merged[k] = v.value
    }
    // 2. Private facts override for this agent only
    const privateMap = this.privateMemories.get(agentId)
    if (privateMap) {
      for (const [k, v] of privateMap.entries()) {
        merged[`private:${k}`] = v.value
      }
    }
    return merged
  }
}

export const layeredMemory = new LayeredMemoryService()
