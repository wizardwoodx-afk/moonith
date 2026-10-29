/**
 * The two faults the donor build still has, pinned as tests.
 *
 *  1. A ledger that is live in this process trusts its cached head. If the
 *     file is truncated underneath it — a partial delete, a logrotated tail,
 *     another writer — the next append extends a chain whose evidence already
 *     vanished, and the file still verifies. The append must refuse.
 *  2. A stored signing key that cannot be decrypted must never be silently
 *     replaced. Minting a second key makes every line signed under the first
 *     one unverifiable, which is worse than not writing at all: it looks like
 *     an intact audit trail.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AuditEntry } from '@shared/audit'
import { RuntimeAuditLedger } from './runtimeLedger'
import { createTestAuditIdentity } from './identity'
import { loadAuditSigningKeyFrom } from './keychain'

const roots: string[] = []
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'audit-fault-'))
  roots.push(dir)
  return dir
}
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})
function entry(action: string): AuditEntry {
  return {
    kind: 'runtime',
    ts: new Date('2026-10-25T00:00:00Z').toISOString(),
    data: { action, actor: 'system', actorId: 'test', outcome: 'ok' }
  } as unknown as AuditEntry
}

describe('ledger fault handling', () => {
  it('refuses to append after the file was truncated underneath the process', async () => {
    const file = join(tempRoot(), 'runtime.jsonl')
    const ledger = new RuntimeAuditLedger(file, createTestAuditIdentity())
    await ledger.append(entry('one'))
    await ledger.append(entry('two'))
    await ledger.append(entry('three'))
    const kept = readFileSync(file, 'utf8').split('\n').filter(Boolean)
    writeFileSync(file, `${kept.slice(0, 1).join('\n')}\n`, 'utf8')
    await expect(ledger.append(entry('four'))).rejects.toThrow(/integrity/i)
  })

  it('refuses to mint a second key when the stored key cannot be decrypted', async () => {
    const root = tempRoot()
    writeFileSync(
      join(root, 'audit-seal-key.json'),
      JSON.stringify({ secret: 'enc:not-a-real-seal' }),
      'utf8'
    )
    await expect(loadAuditSigningKeyFrom(root)).rejects.toThrow(/existing audit signing key/i)
  })
})
