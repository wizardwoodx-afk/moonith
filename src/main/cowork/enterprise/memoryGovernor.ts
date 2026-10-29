import crypto from 'node:crypto'
import type { MemoryPartition } from './types'

export interface MemoryEntry {
  key: string;
  value: string;
  sensitivity: 'public' | 'internal' | 'confidential' | 'restricted';
  updatedAt: number;
}

export class MemoryGovernor {
  private partitions: Map<string, { meta: MemoryPartition; entries: Map<string, MemoryEntry> }> = new Map();

  public createPartition(
    namespace: string,
    sensitivity: 'public' | 'internal' | 'confidential' | 'restricted' = 'internal',
    allowedRoles: string[] = ['coworker', 'operator']
  ): MemoryPartition {
    const partitionId = `mem_${namespace}_${Date.now()}`;
    const meta: MemoryPartition = {
      partitionId,
      namespace,
      sensitivity,
      allowedRoles,
      entryCount: 0,
      tamperSealHash: crypto.createHash('sha256').update(partitionId).digest('hex')
    };

    this.partitions.set(namespace, { meta, entries: new Map() });
    return meta;
  }

  public writeScopedMemory(
    namespace: string,
    key: string,
    value: string,
    callerRole: string = 'coworker'
  ): { success: boolean; error?: string } {
    let part = this.partitions.get(namespace);
    if (!part) {
      this.createPartition(namespace);
      part = this.partitions.get(namespace)!;
    }

    if (!part.meta.allowedRoles.includes(callerRole) && !part.meta.allowedRoles.includes('*')) {
      return { success: false, error: `Unauthorized memory access for role: ${callerRole}` };
    }

    part.entries.set(key, {
      key,
      value,
      sensitivity: part.meta.sensitivity,
      updatedAt: Date.now()
    });

    part.meta.entryCount = part.entries.size;
    part.meta.tamperSealHash = this.computeSealHash(part.entries);

    return { success: true };
  }

  public readScopedMemory(
    namespace: string,
    key: string,
    callerRole: string = 'coworker'
  ): { value?: string; error?: string } {
    const part = this.partitions.get(namespace);
    if (!part) return { error: `Namespace '${namespace}' does not exist` };

    if (!part.meta.allowedRoles.includes(callerRole) && !part.meta.allowedRoles.includes('*')) {
      return { error: `Unauthorized memory read for role: ${callerRole}` };
    }

    const entry = part.entries.get(key);
    return { value: entry?.value };
  }

  public listPartitions(): MemoryPartition[] {
    return Array.from(this.partitions.values()).map((p) => ({ ...p.meta }));
  }

  private computeSealHash(entries: Map<string, MemoryEntry>): string {
    const serialized = Array.from(entries.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v.value}:${v.updatedAt}`)
      .join('|');
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }
}
