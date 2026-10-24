import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ReceiptService } from './service'
import { ephemeralSigner, signerFromSeed } from './signer'
import { RECEIPT_FORMAT, digestOfValue, requiresReceipt, type ActionReceipt } from './schema'
import type { ActionIds } from '../nomos/types'

const IDS: ActionIds = {
  runId: 'run_1',
  taskId: 'task_1',
  actionId: 'act_1',
  agentId: 'Captain',
  principalId: 'local-user'
}

const AUTHORIZATION = {
  decision: 'allow' as const,
  rule: 'nomos-default-allow',
  reason: 'identity and capability verified',
  approvedBy: null,
  approvedAt: null
}

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sphragis-'))
  file = join(dir, 'receipts.jsonl')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function service(signer = ephemeralSigner()): ReceiptService {
  return new ReceiptService({ signer, file, now: () => '2026-10-24T12:00:00.000Z' })
}

async function bracket(service: ReceiptService, actionId = IDS.actionId): Promise<ActionReceipt[]> {
  const intent = await service.recordIntent({
    ids: { ...IDS, actionId },
    tool: 'run_command',
    action: 'shell.exec',
    args: { command: 'npm test' },
    authorization: AUTHORIZATION
  })
  const result = await service.recordResult(actionId, 'success', { digest: digestOfValue({ exitCode: 0 }) })
  return [intent, result as ActionReceipt]
}

describe('the receipt barrier', () => {
  it('requires receipts for executing and high-risk actions only', () => {
    expect(requiresReceipt({ sideEffect: 'execute', risk: 'high' })).toBe(true)
    expect(requiresReceipt({ sideEffect: 'write', risk: 'high' })).toBe(true)
    expect(requiresReceipt({ sideEffect: 'write', risk: 'medium' })).toBe(false)
    expect(requiresReceipt({ sideEffect: 'read', risk: 'low' })).toBe(false)
    expect(requiresReceipt({ sideEffect: 'network', risk: 'medium' })).toBe(false)
  })

  it('stores digests, never the raw arguments', async () => {
    const svc = service()
    const [intent] = await bracket(svc)
    const serialized = JSON.stringify(intent)
    expect(intent.inputDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(serialized).not.toContain('npm test')
    expect(intent.inputDigest).toBe(digestOfValue({ command: 'npm test' }))
  })

  it('refuses a result with no open intent', async () => {
    const svc = service()
    const result = await svc.recordResult('act_ghost', 'success', { digest: 'x' })
    expect(result).toBeNull()
  })
})

describe('verification', () => {
  it('verifies a signed intent→result pair', async () => {
    const svc = service()
    await bracket(svc)
    const report = await svc.verify()
    expect(report.ok).toBe(true)
    expect(report.signed).toBe(true)
    expect(report.receipts).toBe(2)
    expect(report.problems).toEqual([])
  })

  it('detects an edited outcome', async () => {
    const svc = service()
    await bracket(svc)
    const entries = await ReceiptService.read(file)
    entries[1].outcome = 'failure'
    const report = (await import('./verify')).verifyReceiptChain(entries)
    expect(report.ok).toBe(false)
    expect(report.problems.join(' ')).toContain('modified after signing')
  })

  it('detects a stripped signature', async () => {
    const svc = service()
    await bracket(svc)
    const entries = await ReceiptService.read(file)
    entries[0].signature = null
    const report = (await import('./verify')).verifyReceiptChain(entries)
    expect(report.ok).toBe(false)
    expect(report.signed).toBe(false)
    expect(report.problems.join(' ')).toContain('authorship is not attested')
  })

  it('detects a receipt signed by a different key than it names', async () => {
    const svc = service()
    await bracket(svc)
    const other = ephemeralSigner()
    const entries = await ReceiptService.read(file)
    entries[0].issuer = { keyId: other.keyId, publicKeyHex: other.publicKeyHex }
    const report = (await import('./verify')).verifyReceiptChain(entries)
    expect(report.ok).toBe(false)
    expect(report.problems.join(' ')).toContain('signature verification FAILED')
  })

  it('detects a deleted intent (a result left without its authorization)', async () => {
    const svc = service()
    await bracket(svc)
    const entries = await ReceiptService.read(file)
    entries.shift()
    const report = (await import('./verify')).verifyReceiptChain(entries)
    expect(report.ok).toBe(false)
    expect(report.problems.join(' ')).toContain('no preceding intent')
  })

  it('detects a reordered journal', async () => {
    const svc = service()
    await bracket(svc, 'act_a')
    await bracket(svc, 'act_b')
    const entries = await ReceiptService.read(file)
    const swapped = [entries[1], entries[0], ...entries.slice(2)]
    const report = (await import('./verify')).verifyReceiptChain(swapped)
    expect(report.ok).toBe(false)
    expect(report.problems.join(' ')).toContain('the chain breaks')
  })

  it('reports an unclosed intent — the crash signal', async () => {
    const svc = service()
    await svc.recordIntent({
      ids: IDS,
      tool: 'run_command',
      action: 'shell.exec',
      args: { command: 'long job' },
      authorization: AUTHORIZATION
    })
    const report = await svc.verify()
    expect(report.ok).toBe(false)
    expect(report.problems.join(' ')).toContain('reconcile before retrying')
  })

  it('is honest when the runtime cannot sign', async () => {
    const svc = new ReceiptService({ signer: null, file, now: () => '2026-10-24T12:00:00.000Z' })
    await bracket(svc)
    const report = await svc.verify()
    expect(report.ok).toBe(false)
    expect(report.signed).toBe(false)
    expect(report.problems.join(' ')).toContain('OS keychain is unavailable')
    expect(svc.summary().unsigned).toBe(2)
  })
})

describe('the journal survives a restart', () => {
  it('reloads and verifies a journal written by a previous process', async () => {
    const signer = signerFromSeed(Buffer.alloc(32, 7))
    await bracket(service(signer))
    const reopened = new ReceiptService({ signer, file })
    const report = await reopened.verify()
    expect(report.ok).toBe(true)
    expect(reopened.summary().intents).toBe(1)
    expect(reopened.summary().keyId).toBe(signer.keyId)
  })

  it('continues the chain after a restart', async () => {
    const signer = ephemeralSigner()
    const first = service(signer)
    await bracket(first, 'act_a')
    const second = new ReceiptService({ signer, file, now: () => '2026-10-24T12:01:00.000Z' })
    await bracket(second, 'act_b')
    const report = await second.verify()
    expect(report.ok).toBe(true)
    const entries = await ReceiptService.read(file)
    expect(entries).toHaveLength(4)
    expect(entries[2].prev).toBe(entries[1].hash)
    expect(entries[2].seq).toBe(2)
  })

  it('serialises concurrent intents so a cold start cannot fork the chain', async () => {
    const signer = ephemeralSigner()
    /* A pre-existing chain: the head a fresh process must link to. */
    await bracket(service(signer), 'act_a')
    const before = await ReceiptService.read(file)
    const head = before[before.length - 1]

    /* Two intents right after boot, before the journal has been read. The
     * old load() flipped `loaded` before the read finished, so both minted
     * prev=ZERO_HASH and forked the chain. */
    const reopened = new ReceiptService({ signer, file, now: () => '2026-10-24T12:05:00.000Z' })
    const intent = (actionId: string) =>
      reopened.recordIntent({
        ids: { ...IDS, actionId },
        tool: 'run_command',
        action: 'shell.exec',
        args: { command: actionId },
        authorization: AUTHORIZATION
      })
    await Promise.all([intent('act_b'), intent('act_c')])

    const entries = await ReceiptService.read(file)
    expect(entries).toHaveLength(4)
    expect(entries[2].prev).toBe(head.hash)
    expect(entries[2].seq).toBe(head.seq + 1)
    expect(entries[3].prev).toBe(entries[2].hash)
    expect(entries[3].seq).toBe(entries[2].seq + 1)
    expect(entries.filter((entry) => entry.prev === '0'.repeat(64))).toHaveLength(1)

    /* The chain links; close the two intents and it verifies end to end. */
    await reopened.recordResult('act_b', 'success', { digest: digestOfValue({ ok: true }) })
    await reopened.recordResult('act_c', 'success', { digest: digestOfValue({ ok: true }) })
    const report = await reopened.verify()
    expect(report.problems).toEqual([])
    expect(report.ok).toBe(true)
  })

  it('serialises concurrent intents on a fresh journal', async () => {
    const signer = ephemeralSigner()
    const svc = service(signer)
    await Promise.all([
      svc
        .recordIntent({
          ids: { ...IDS, actionId: 'act_b' },
          tool: 'run_command',
          action: 'shell.exec',
          args: {},
          authorization: AUTHORIZATION
        })
        .then((minted) => svc.recordResult(minted.ids.actionId, 'success', { digest: digestOfValue({}) })),
      svc
        .recordIntent({
          ids: { ...IDS, actionId: 'act_c' },
          tool: 'run_command',
          action: 'shell.exec',
          args: {},
          authorization: AUTHORIZATION
        })
        .then((minted) => svc.recordResult(minted.ids.actionId, 'success', { digest: digestOfValue({}) }))
    ])
    const report = await svc.verify()
    expect(report.ok).toBe(true)
    const entries = await ReceiptService.read(file)
    expect(entries.map((entry) => entry.seq)).toEqual([0, 1, 2, 3])
    expect(entries.filter((entry) => entry.prev === '0'.repeat(64))).toHaveLength(1)
  })
})

describe('the wire format', () => {
  it('stamps the current format on every receipt', async () => {
    const svc = service()
    const [intent, result] = await bracket(svc)
    expect(intent.format).toBe(RECEIPT_FORMAT)
    expect(result.format).toBe(RECEIPT_FORMAT)
    expect(intent.kind).toBe('intent')
    expect(result.kind).toBe('result')
    expect(result.prev).toBe(intent.hash)
  })
})
