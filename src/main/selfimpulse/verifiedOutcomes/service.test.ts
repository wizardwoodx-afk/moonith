import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deriveSealKey } from '../../audit/chain'
import type {
  OutcomeContractDefinition,
  OutcomeTaskBinding,
  VerifiedOutcomeOperation,
  VerifiedOutcomeSnapshot
} from '../../../shared/verifiedOutcomes'
import { decideOutcomeAction } from './policy'
import { VerifiedOutcomeService } from './service'

const KEY = deriveSealKey('verified-outcomes-test-key')
const MODEL = { providerId: 'openai', model: 'enterprise-model-v1' }
const POLICY = 'a'.repeat(64)
let directory = ''
let file = ''
let now = 0

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'selfimpulse-outcomes-'))
  file = join(directory, 'verified-outcomes.json')
  now = Date.parse('2026-10-25T00:00:00.000Z')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function service(options: { audit?: boolean; admin?: boolean } = {}): VerifiedOutcomeService {
  return new VerifiedOutcomeService({
    file,
    loadKey: async () => KEY,
    now: () => (now += 1000),
    authorizeAdmin: async () => {
      if (options.admin === false) throw new Error('Local administrator required.')
    },
    audit: async () => options.audit !== false
  })
}

const definition: OutcomeContractDefinition = {
  downstreamOutcome: 'The support case is resolved and remains closed in the downstream system.',
  checks: [
    { id: 'completed', label: 'Task completed', kind: 'task-completed', required: true },
    { id: 'clean-tools', label: 'No failed tool steps', kind: 'no-failed-tools', required: true }
  ],
  promotion: { minimumRuns: 3, minimumPassRate: 1, lookbackDays: 30 },
  autonomyCeiling: 'bounded-autonomy',
  humanReviewRequired: false
}

async function mutate(
  target: VerifiedOutcomeService,
  snapshot: VerifiedOutcomeSnapshot,
  operation: VerifiedOutcomeOperation
): Promise<VerifiedOutcomeSnapshot> {
  return target.mutate({
    expectedRevision: snapshot.revision,
    reason: `Test ${operation.type}`,
    operation
  })
}

async function contract(target: VerifiedOutcomeService): Promise<VerifiedOutcomeSnapshot> {
  return mutate(target, await target.snapshot(), {
    type: 'contract.create',
    contract: {
      workflowId: 'itsm-resolution',
      name: 'ITSM resolution',
      description: 'Resolve and verify a governed support workflow.',
      definition
    }
  })
}

async function grant(target: VerifiedOutcomeService): Promise<VerifiedOutcomeSnapshot> {
  return mutate(target, await target.snapshot(), {
    type: 'grant.create',
    grant: {
      contractId: 'contract:itsm-resolution',
      agentId: 'captain',
      tools: ['write_file'],
      dataClass: 'internal',
      environment: 'development',
      ceiling: 'bounded-autonomy'
    }
  })
}

async function record(
  target: VerifiedOutcomeService,
  taskId: string,
  options: {
    failed?: boolean
    reviewDefinition?: OutcomeContractDefinition
    attempts?: Array<{ providerId: string; model: string }>
    policies?: string[]
    agentIds?: string[]
    revision?: number
  } = {}
) {
  const binding: OutcomeTaskBinding = {
    contractId: 'contract:itsm-resolution',
    contractRevision: options.revision ?? 1,
    dataClass: 'internal',
    environment: 'development'
  }
  return target.recordTaskOutcome({
    taskId,
    runId: `run:${taskId}`,
    sourceDigest: createHash('sha256').update(`${taskId}:${options.failed ? 'failed' : 'ok'}`).digest('hex'),
    binding,
    agentIds: options.agentIds ?? ['captain'],
    execution: {
      attempts: options.attempts ?? [MODEL],
      policyDigests: options.policies ?? [POLICY]
    },
    observation: {
      taskStatus: options.failed ? 'error' : 'done',
      steps: [{ tool: 'write_file', status: options.failed ? 'error' : 'ok' }],
      artifacts: 1,
      planTotal: 1,
      planDone: options.failed ? 0 : 1
    }
  })
}

describe('Verified Outcomes scoped autonomy', () => {
  it('earns bounded autonomy only from exact evidence and an administrator mutation', async () => {
    const target = service()
    await contract(target)
    await grant(target)
    for (const task of ['task-1', 'task-2']) await record(target, task)
    let snapshot = await target.snapshot()
    expect(snapshot.recommendations[0]).toMatchObject({ eligible: false, sampleSize: 2 })
    await expect(
      mutate(target, snapshot, { type: 'grant.promote', grantId: snapshot.grants[0].id })
    ).rejects.toThrow('not eligible')

    await record(target, 'task-3')
    snapshot = await target.snapshot()
    expect(snapshot.recommendations[0]).toMatchObject({
      eligible: true,
      sampleSize: 3,
      passRate: 1,
      execution: { model: MODEL, policyDigest: POLICY }
    })
    const beforeAdmin = snapshot.revision
    snapshot = await mutate(target, snapshot, {
      type: 'grant.promote',
      grantId: snapshot.grants[0].id
    })
    expect(snapshot.revision).toBe(beforeAdmin + 1)
    expect(snapshot.grants[0]).toMatchObject({
      level: 'bounded-autonomy',
      ceiling: 'bounded-autonomy',
      execution: { model: MODEL, policyDigest: POLICY },
      circuitOpen: false
    })

    const base = {
      contract: snapshot.contracts[0],
      contractRevision: 1,
      agentId: 'captain',
      toolName: 'write_file',
      dataClass: 'internal' as const,
      environment: 'development' as const,
      grants: snapshot.grants,
      execution: { attempts: [MODEL], policyDigests: [POLICY] },
      currentPolicyDigest: POLICY
    }
    expect(decideOutcomeAction({
      ...base,
      tool: { sideEffect: 'write', risk: 'medium', approval: 'policy' }
    }).mode).toBe('allow-autonomous')
    expect(decideOutcomeAction({
      ...base,
      toolName: 'edit_file',
      tool: { sideEffect: 'write', risk: 'medium', approval: 'policy' }
    }).mode).toBe('require-approval')
    expect(decideOutcomeAction({
      ...base,
      execution: { attempts: [{ ...MODEL, model: 'different-model' }], policyDigests: [POLICY] },
      tool: { sideEffect: 'write', risk: 'medium', approval: 'policy' }
    }).mode).toBe('require-approval')
    expect(decideOutcomeAction({
      ...base,
      execution: { attempts: [MODEL], policyDigests: ['b'.repeat(64)] },
      tool: { sideEffect: 'write', risk: 'medium', approval: 'policy' }
    }).mode).toBe('require-approval')
    expect(decideOutcomeAction({
      ...base,
      tool: { sideEffect: 'execute', risk: 'high', approval: 'always' }
    }).mode).toBe('require-approval')
  })

  it('fails closed when administration is unavailable but still records automatic demotion', async () => {
    const admin = service()
    await contract(admin)
    let snapshot = await grant(admin)
    expect(snapshot.grants).toHaveLength(1)
    const target = service({ admin: false })
    await expect(mutate(target, await target.snapshot(), {
      type: 'grant.demote',
      grantId: snapshot.grants[0].id
    })).rejects.toThrow('administrator')
    const receipt = await record(target, 'task-failure', { failed: true })
    expect(receipt.materialFailure).toBe(true)
    expect(receipt.demotedGrantIds).toEqual([snapshot.grants[0].id])
    snapshot = await target.snapshot()
    expect(snapshot.grants[0]).toMatchObject({ level: 'approved-action', circuitOpen: true })
    expect(snapshot.regressions[0]).toMatchObject({ status: 'pending', occurrences: 1 })
  })

  it('requires fresh post-circuit recovery evidence rather than replaying old success', async () => {
    const target = service()
    await contract(target)
    await grant(target)
    for (const task of ['task-1', 'task-2', 'task-3']) await record(target, task)
    let snapshot = await target.snapshot()
    snapshot = await mutate(target, snapshot, { type: 'grant.promote', grantId: snapshot.grants[0].id })
    await record(target, 'task-4', { failed: true })
    snapshot = await target.snapshot()
    expect(snapshot.grants[0].circuitOpen).toBe(true)
    expect(snapshot.recommendations[0].sampleSize).toBe(0)
    for (const task of ['task-5', 'task-6']) await record(target, task)
    expect((await target.snapshot()).recommendations[0].eligible).toBe(false)
    await record(target, 'task-7')
    snapshot = await target.snapshot()
    expect(snapshot.recommendations[0]).toMatchObject({ eligible: true, sampleSize: 3 })
  })

  it('rejects mixed model or policy evidence and deduplicates sanitized regressions', async () => {
    const target = service()
    await contract(target)
    await grant(target)
    const first = await record(target, 'task-1', {
      attempts: [MODEL, { providerId: 'anthropic', model: 'fallback-v1' }]
    })
    const second = await record(target, 'task-2', {
      policies: [POLICY, 'b'.repeat(64)]
    })
    expect(first).toMatchObject({ validEvidence: false, verificationStatus: 'invalid', materialFailure: true })
    expect(second.validEvidence).toBe(false)
    const snapshot = await target.snapshot()
    expect(snapshot.regressions).toHaveLength(1)
    expect(snapshot.regressions[0].occurrences).toBe(2)
    expect(snapshot.regressions[0].sourceReceiptIds).toHaveLength(2)
    expect(snapshot.regressions[0].title).not.toContain('fallback-v1')
  })

  it('uses human acceptance for verified outcomes and rejection as a material failure', async () => {
    const target = service()
    let snapshot = await mutate(target, await target.snapshot(), {
      type: 'contract.create',
      contract: {
        workflowId: 'itsm-resolution',
        name: 'ITSM resolution',
        definition: { ...definition, humanReviewRequired: true }
      }
    })
    snapshot = await grant(target)
    const receipt = await record(target, 'task-1')
    expect(receipt).toMatchObject({ verificationStatus: 'pending-review', checksPassed: true })
    snapshot = await target.snapshot()
    snapshot = await mutate(target, snapshot, {
      type: 'receipt.review',
      receiptId: receipt.id,
      decision: 'accepted',
      note: 'Downstream ticket state checked.'
    })
    expect(snapshot.receipts[0].verificationStatus).toBe('verified')
    const rejected = await record(target, 'task-2')
    snapshot = await mutate(target, await target.snapshot(), {
      type: 'receipt.review',
      receiptId: rejected.id,
      decision: 'rejected',
      note: 'The downstream case was reopened.'
    })
    expect(snapshot.receipts.find((item) => item.id === rejected.id)).toMatchObject({
      verificationStatus: 'failed',
      materialFailure: true
    })
    expect(snapshot.grants[0].circuitOpen).toBe(true)
    expect(snapshot.regressions.some((candidate) => candidate.title.includes('human outcome rejection'))).toBe(true)
  })

  it('shadow-checks draft verification and invalidates bounded grants on activation', async () => {
    const target = service()
    await contract(target)
    await grant(target)
    for (const task of ['task-1', 'task-2', 'task-3']) await record(target, task)
    let snapshot = await target.snapshot()
    snapshot = await mutate(target, snapshot, { type: 'grant.promote', grantId: snapshot.grants[0].id })
    const failed = await record(target, 'task-4', { failed: true })
    snapshot = await target.snapshot()
    const regression = snapshot.regressions.find((candidate) => candidate.sourceReceiptIds.includes(failed.id))!
    snapshot = await mutate(target, snapshot, {
      type: 'regression.review',
      candidateId: regression.id,
      decision: 'approved'
    })
    snapshot = await mutate(target, snapshot, {
      type: 'contract.stage',
      contractId: 'contract:itsm-resolution',
      definition
    })
    await expect(mutate(target, snapshot, {
      type: 'contract.activate',
      contractId: 'contract:itsm-resolution',
      revision: 2
    })).rejects.toThrow('policy-shadow')
    snapshot = await mutate(target, snapshot, {
      type: 'shadow.run',
      contractId: 'contract:itsm-resolution',
      revision: 2
    })
    expect(snapshot.shadows[0]).toMatchObject({ passed: true })
    expect(snapshot.shadows[0].cases.some((item) => item.expected === 'fail')).toBe(true)
    expect(snapshot.shadows[0].cases.some((item) => item.expected === 'pass')).toBe(true)
    snapshot = await mutate(target, snapshot, {
      type: 'contract.activate',
      contractId: 'contract:itsm-resolution',
      revision: 2
    })
    expect(snapshot.contracts[0].versions.find((version) => version.status === 'active')?.revision).toBe(2)
    expect(snapshot.grants[0].contractRevision).toBe(1)
    const decision = decideOutcomeAction({
      contract: snapshot.contracts[0],
      contractRevision: 1,
      agentId: 'captain',
      toolName: 'write_file',
      tool: { sideEffect: 'write', risk: 'medium', approval: 'policy' },
      dataClass: 'internal',
      environment: 'development',
      grants: snapshot.grants,
      execution: { attempts: [MODEL], policyDigests: [POLICY] },
      currentPolicyDigest: POLICY
    })
    expect(decision.mode).toBe('require-approval')
    expect(await target.binding({
      contractId: 'contract:itsm-resolution',
      dataClass: 'internal',
      environment: 'development'
    })).toMatchObject({ contractRevision: 2 })
  })

  it('turns a reviewed subjective failure into a human gate instead of a fabricated test', async () => {
    const target = service()
    let snapshot = await mutate(target, await target.snapshot(), {
      type: 'contract.create',
      contract: {
        workflowId: 'itsm-resolution',
        name: 'ITSM resolution',
        definition: { ...definition, humanReviewRequired: true }
      }
    })
    await grant(target)
    const receipt = await record(target, 'task-subjective-1')
    snapshot = await mutate(target, await target.snapshot(), {
      type: 'receipt.review',
      receiptId: receipt.id,
      decision: 'rejected',
      note: 'The downstream case was reopened.'
    })
    const candidate = snapshot.regressions.find((item) => item.sourceReceiptIds.includes(receipt.id))!
    expect(candidate.check).toBeNull()
    snapshot = await mutate(target, snapshot, {
      type: 'regression.review',
      candidateId: candidate.id,
      decision: 'approved'
    })
    snapshot = await mutate(target, snapshot, {
      type: 'contract.stage',
      contractId: 'contract:itsm-resolution',
      definition: { ...definition, humanReviewRequired: false }
    })
    snapshot = await mutate(target, snapshot, {
      type: 'contract.activate',
      contractId: 'contract:itsm-resolution',
      revision: 2
    })
    const gated = await record(target, 'task-subjective-2', { revision: 2 })
    expect(gated).toMatchObject({
      verificationStatus: 'pending-review',
      checksPassed: true,
      validEvidence: true,
      regressionIds: [candidate.id],
      review: { state: 'pending' }
    })
  })

  it('enforces an approved regression on later runs and stops after administrator retirement', async () => {
    const target = service()
    await contract(target)
    await grant(target)
    const failed = await record(target, 'task-regression-1', { failed: true })
    let snapshot = await target.snapshot()
    const candidate = snapshot.regressions.find((item) => item.sourceReceiptIds.includes(failed.id))!
    expect(candidate.check?.kind).toBe('task-completed')
    snapshot = await mutate(target, snapshot, {
      type: 'regression.review',
      candidateId: candidate.id,
      decision: 'approved'
    })

    const recurrence = await record(target, 'task-regression-2', { failed: true })
    expect(recurrence.regressionIds).toEqual([candidate.id])
    expect(recurrence.checks.some((check) => check.id === `regression:${candidate.id}` && !check.passed)).toBe(true)
    snapshot = await target.snapshot()
    expect(snapshot.regressions).toHaveLength(1)
    expect(snapshot.regressions[0].occurrences).toBe(2)

    const recovered = await record(target, 'task-regression-3')
    expect(recovered.regressionIds).toEqual([candidate.id])
    expect(recovered.checksPassed).toBe(true)
    snapshot = await mutate(target, await target.snapshot(), {
      type: 'regression.retire',
      candidateId: candidate.id
    })
    expect(snapshot.regressions[0].status).toBe('retired')
    const afterRetirement = await record(target, 'task-regression-4')
    expect(afterRetirement.regressionIds).toEqual([])
    expect(afterRetirement.checks).toHaveLength(2)
  })

  it('persists signed state and refuses tampering on restart', async () => {
    const target = service()
    await contract(target)
    const reopened = service()
    expect((await reopened.snapshot()).contracts).toHaveLength(1)
    const disk = JSON.parse(await readFile(file, 'utf8')) as { state: { contracts: Array<{ name: string }> } }
    disk.state.contracts[0].name = 'Forged contract'
    await writeFile(file, JSON.stringify(disk), 'utf8')
    await expect(service().snapshot()).rejects.toThrow('signature')
  })

  it('marks evidence invalid when the signed runtime audit is unavailable', async () => {
    const target = service()
    await contract(target)
    await grant(target)
    const sealed = service({ audit: false })
    const receipt = await record(sealed, 'task-1')
    expect(receipt).toMatchObject({ validEvidence: false, verificationStatus: 'invalid', materialFailure: true })
    expect(receipt.invalidReasons.join(' ')).toContain('audit')
    expect((await sealed.snapshot()).grants[0].circuitOpen).toBe(true)
  })
})
