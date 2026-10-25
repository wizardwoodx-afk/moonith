import { createHash, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { LOCAL_OWNER_PRINCIPAL_ID } from '../../../shared/enterpriseControl'
import type { RuntimeAuditOutcome } from '../../../shared/audit'
import {
  activeOutcomeVersion,
  checksPassed,
  decideOutcomeAction,
  evaluateOutcomeChecks,
  isOutcomeDataClass,
  isOutcomeEnvironment,
  isOutcomeLevel,
  outcomeId,
  outcomeLevelRank,
  outcomeText,
  outcomeVersion,
  recommendOutcomePromotion,
  validateOutcomeDefinition,
  type OutcomeActionDecision,
  type OutcomeActionProfile
} from './policy'
import type {
  OutcomeAutonomyGrant,
  OutcomeAutonomyLevel,
  OutcomeCheckDefinition,
  OutcomeContract,
  OutcomeContractVersion,
  OutcomeEvidenceReceipt,
  OutcomeExecutionEvidence,
  OutcomeModelVersion,
  OutcomeRegressionCandidate,
  OutcomeRunObservation,
  OutcomeShadowEvaluation,
  OutcomeTaskBinding,
  OutcomeTaskBindingInput,
  VerifiedOutcomeMutation,
  VerifiedOutcomeOperation,
  VerifiedOutcomeSnapshot
} from '../../../shared/verifiedOutcomes'
import { canonicalAuditJson, signAuditPayload } from '../../audit/chain'
import { atomicWriteFile } from '../../atomic'
import { newId } from '../../util'
import { redactSensitiveText } from '../governance/dlp'

interface VerifiedOutcomeState {
  format: 'selfimpulse-verified-outcomes/1'
  revision: number
  contracts: OutcomeContract[]
  grants: OutcomeAutonomyGrant[]
  receipts: OutcomeEvidenceReceipt[]
  regressions: OutcomeRegressionCandidate[]
  shadows: OutcomeShadowEvaluation[]
}

interface VerifiedOutcomeDisk {
  format: 'selfimpulse-verified-outcomes-disk/1'
  state: VerifiedOutcomeState
  signature: string
}

interface OutcomeAuditEvent {
  actor?: 'captain' | 'crew' | 'system'
  actorId?: string
  taskId?: string
  runId?: string
  action: string
  outcome: RuntimeAuditOutcome
  target?: string
  detail?: string
  metadata?: Record<string, unknown>
}

export interface VerifiedOutcomeServiceOptions {
  file: string
  loadKey: () => Promise<Buffer>
  now?: () => number
  authorizeAdmin?: () => Promise<void>
  audit?: (event: OutcomeAuditEvent) => Promise<boolean>
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const DOMAIN = 'selfimpulse-verified-outcomes-state-v1'
const LOCAL_ADMIN = LOCAL_OWNER_PRINCIPAL_ID

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalAuditJson(value), 'utf8').digest('hex')
}

function signature(state: VerifiedOutcomeState, key: Buffer): string {
  return signAuditPayload({ domain: DOMAIN, state }, key)
}

function sameSignature(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}

function emptyState(): VerifiedOutcomeState {
  return {
    format: 'selfimpulse-verified-outcomes/1',
    revision: 1,
    contracts: [],
    grants: [],
    receipts: [],
    regressions: [],
    shadows: []
  }
}

function stringArray(value: unknown, label: string, maximum = 50): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    throw new Error(`${label} must contain 1–${maximum} entries.`)
  }
  const result = value.map((entry) => outcomeId(entry, label))
  if (new Set(result).size !== result.length) throw new Error(`${label} contains duplicates.`)
  return result
}

function receiptDigest(receipt: OutcomeEvidenceReceipt): string {
  const {
    digest: _digest,
    demotedGrantIds: _demoted,
    review: _review,
    verificationStatus: _status,
    materialFailure: _material,
    ...core
  } = receipt
  return digest(core)
}

function shadowDigest(shadow: OutcomeShadowEvaluation): string {
  const { digest: _digest, ...core } = shadow
  return digest(core)
}

export class VerifiedOutcomeService {
  private disk: VerifiedOutcomeDisk | null = null
  private initialization: Promise<void> | null = null
  private mutations: Promise<unknown> = Promise.resolve()
  private keyMaterial: Buffer | null = null
  private readonly now: () => number

  constructor(private readonly options: VerifiedOutcomeServiceOptions) {
    this.now = options.now ?? Date.now
  }

  private key(): Buffer {
    if (!this.keyMaterial) throw new Error('Verified Outcomes signing is not initialized.')
    return this.keyMaterial
  }

  private async init(): Promise<void> {
    if (this.disk) return
    if (!this.initialization) {
      this.initialization = (async () => {
        this.keyMaterial = await this.options.loadKey()
        await fs.mkdir(dirname(this.options.file), { recursive: true })
        let parsed: VerifiedOutcomeDisk | null = null
        try {
          parsed = JSON.parse(await fs.readFile(this.options.file, 'utf8')) as VerifiedOutcomeDisk
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw new Error(
              `Verified Outcomes data is unreadable; refusing to replace it. ${
                error instanceof Error ? error.message : String(error)
              }`
            )
          }
        }
        if (parsed) {
          this.validateDisk(parsed)
          this.disk = parsed
        } else {
          this.disk = {
            format: 'selfimpulse-verified-outcomes-disk/1',
            state: emptyState(),
            signature: ''
          }
          this.disk.signature = signature(this.disk.state, this.key())
          await this.persist(this.disk)
        }
      })().catch((error) => {
        this.disk = null
        this.initialization = null
        throw error
      })
    }
    await this.initialization
  }

  private validateDisk(value: VerifiedOutcomeDisk): void {
    if (
      !value ||
      value.format !== 'selfimpulse-verified-outcomes-disk/1' ||
      !value.state ||
      value.state.format !== 'selfimpulse-verified-outcomes/1' ||
      !Number.isInteger(value.state.revision) ||
      value.state.revision < 1 ||
      !sameSignature(value.signature, signature(value.state, this.key()))
    ) {
      throw new Error('Verified Outcomes state or signature is invalid; refusing to use it.')
    }
    const state = value.state
    if (
      !Array.isArray(state.contracts) ||
      !Array.isArray(state.grants) ||
      !Array.isArray(state.receipts) ||
      !Array.isArray(state.regressions) ||
      !Array.isArray(state.shadows) ||
      state.contracts.length > 100 ||
      state.grants.length > 500
    ) {
      throw new Error('Verified Outcomes state is malformed or exceeds its collection bounds.')
    }
    for (const contract of state.contracts) {
      outcomeId(contract.id, 'contract id')
      outcomeId(contract.workflowId, 'workflow id')
      if (!Array.isArray(contract.versions) || contract.versions.length < 1 || contract.versions.length > 50) {
        throw new Error(`Contract ${contract.id} has invalid revision history.`)
      }
      const active = contract.versions.filter((version) => version.status === 'active')
      if (active.length > 1) throw new Error(`Contract ${contract.id} has multiple active revisions.`)
      const revisions = new Set<number>()
      for (const version of contract.versions) {
        if (!Number.isInteger(version.revision) || version.revision < 1 || revisions.has(version.revision)) {
          throw new Error(`Contract ${contract.id} has invalid revision numbering.`)
        }
        revisions.add(version.revision)
        validateOutcomeDefinition(version)
      }
    }
  }

  private async persist(next: VerifiedOutcomeDisk): Promise<void> {
    next.signature = signature(next.state, this.key())
    await atomicWriteFile(this.options.file, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  }

  private async audit(event: OutcomeAuditEvent): Promise<boolean> {
    if (!this.options.audit) return true
    return this.options.audit({
      actor: event.actor ?? 'system',
      actorId: event.actorId ?? 'verified-outcomes',
      ...event
    })
  }

  private async requireAdmin(): Promise<void> {
    if (this.options.authorizeAdmin) await this.options.authorizeAdmin()
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(operation, operation)
    this.mutations = result.catch(() => undefined)
    return result
  }

  private state(): VerifiedOutcomeState {
    if (!this.disk) throw new Error('Verified Outcomes is not initialized.')
    return this.disk.state
  }

  private async commit(next: VerifiedOutcomeState): Promise<void> {
    const previous = this.disk as VerifiedOutcomeDisk
    const disk: VerifiedOutcomeDisk = {
      format: 'selfimpulse-verified-outcomes-disk/1',
      state: next,
      signature: ''
    }
    this.disk = disk
    try {
      await this.persist(disk)
    } catch (error) {
      this.disk = previous
      throw error
    }
  }

  async snapshot(): Promise<VerifiedOutcomeSnapshot> {
    await this.init()
    const state = this.state()
    const receipts = [...state.receipts].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    return {
      revision: state.revision,
      contracts: clone(state.contracts),
      grants: clone(state.grants),
      receipts: clone(receipts.slice(0, 100)),
      regressions: clone([...state.regressions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))),
      shadows: clone([...state.shadows].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 20)),
      recommendations: state.grants.map((grant) => {
        const contract = state.contracts.find((candidate) => candidate.id === grant.contractId)
        if (!contract) {
          return {
            grantId: grant.id,
            targetLevel: grant.level,
            eligible: false,
            reasons: ['The referenced outcome contract no longer exists.'],
            execution: null,
            sampleSize: 0,
            passRate: 0,
            receiptIds: []
          }
        }
        return recommendOutcomePromotion({ grant, contract, receipts: state.receipts, now: this.now() })
      }),
      metrics: {
        activeContracts: state.contracts.filter((contract) => contract.lifecycle === 'active').length,
        verifiedReceipts: state.receipts.filter((receipt) => receipt.verificationStatus === 'verified').length,
        boundedGrants: state.grants.filter(
          (grant) => grant.status === 'active' && grant.level === 'bounded-autonomy' && !grant.circuitOpen
        ).length,
        openCircuits: state.grants.filter((grant) => grant.circuitOpen).length,
        pendingReviews: state.receipts.filter((receipt) => receipt.review.state === 'pending').length,
        pendingRegressions: state.regressions.filter((candidate) => candidate.status === 'pending').length
      },
      security: {
        autonomyScope:
          'Agent + workflow + exact tool + data class + environment + active contract + model + policy version. No global agent autonomy score.',
        promotionAuthority:
          'RSIRALS and evidence can make a grant eligible; only the local enterprise administrator can authorize promotion. Automatic transitions only reduce authority.',
        evidence:
          'Deterministic independent checks over sanitized run metadata, signed state, source digests, and the existing HMAC-chained runtime audit. Raw prompts, tool arguments, outputs, paths, and page content are not copied here.',
        shadowBoundary:
          'Policy shadow only: draft checks are replayed against stored observations. No model is rerun and no external write or agent shadow deployment is claimed.'
      }
    }
  }

  async mutate(mutation: VerifiedOutcomeMutation): Promise<VerifiedOutcomeSnapshot> {
    return this.serialize(async () => {
      await this.init()
      await this.requireAdmin()
      const reason = outcomeText(mutation.reason, 'mutation reason', 240)
      if (reason.length < 3) throw new Error('Mutation reason must contain at least 3 characters.')
      if (!Number.isInteger(mutation.expectedRevision) || mutation.expectedRevision !== this.state().revision) {
        throw new Error(`Revision conflict: expected ${this.state().revision}, received ${mutation.expectedRevision}. Refresh before saving.`)
      }
      const next = clone(this.state())
      const target = this.applyOperation(next, mutation.operation)
      next.revision += 1
      await this.commit(next)
      const recorded = await this.audit({
        actorId: 'local-outcome-administrator',
        action: `outcome.${mutation.operation.type}`,
        outcome: 'ok',
        target,
        detail: reason,
        metadata: { revision: next.revision }
      })
      if (!recorded) {
        throw new Error(`Outcome revision ${next.revision} committed, but the signed runtime audit refused the event.`)
      }
      return this.snapshot()
    })
  }

  private applyOperation(state: VerifiedOutcomeState, operation: VerifiedOutcomeOperation): string {
    const at = new Date(this.now()).toISOString()
    if (operation.type === 'contract.create') {
      if (state.contracts.length >= 100) throw new Error('The 100-contract local safety limit has been reached.')
      const workflowId = outcomeId(operation.contract.workflowId, 'workflow id')
      const id = operation.contract.id
        ? outcomeId(operation.contract.id, 'contract id')
        : `contract:${workflowId}`
      if (state.contracts.some((contract) => contract.id === id || contract.workflowId === workflowId)) {
        throw new Error('Contract id and workflow id must be unique.')
      }
      const definition = validateOutcomeDefinition(operation.contract.definition)
      state.contracts.push({
        id,
        workflowId,
        name: outcomeText(operation.contract.name, 'contract name', 120),
        description: operation.contract.description
          ? outcomeText(operation.contract.description, 'contract description', 500)
          : '',
        lifecycle: 'active',
        versions: [{ ...definition, revision: 1, status: 'active', createdAt: at, activatedAt: at }],
        createdAt: at,
        updatedAt: at
      })
      return id
    }
    if (operation.type === 'contract.stage') {
      const contract = this.contract(state, operation.contractId)
      if (contract.lifecycle === 'archived') throw new Error('Archived contracts are immutable.')
      if (contract.versions.length >= 50) throw new Error('The 50-revision contract safety limit has been reached.')
      const definition = validateOutcomeDefinition(operation.definition)
      const revision = Math.max(...contract.versions.map((version) => version.revision)) + 1
      contract.versions.push({ ...definition, revision, status: 'draft', createdAt: at })
      contract.updatedAt = at
      return `${contract.id}@${revision}`
    }
    if (operation.type === 'contract.activate') {
      const contract = this.contract(state, operation.contractId)
      if (contract.lifecycle !== 'active') throw new Error('Enable the contract before activating a revision.')
      const draft = outcomeVersion(contract, operation.revision)
      if (!draft || draft.status !== 'draft') throw new Error('Only a draft revision can be activated.')
      const expectedCases = this.shadowObservations(state, contract.id).map((item) => `${item.regressionId ?? 'verified'}:${item.receipt.id}:${item.expected}`)
      if (expectedCases.length) {
        const compatible = state.shadows.some((shadow) => {
          if (shadow.contractId !== contract.id || shadow.contractRevision !== draft.revision || !shadow.passed) return false
          const actual = shadow.cases.map((item) => `${item.regressionId ?? 'verified'}:${item.receiptId}:${item.expected}`)
          return canonicalAuditJson(actual.sort()) === canonicalAuditJson([...expectedCases].sort())
        })
        if (!compatible) {
          throw new Error('Run a complete, passing policy-shadow evaluation for this draft before activation.')
        }
      }
      for (const version of contract.versions) {
        if (version.status === 'active') version.status = 'retired'
      }
      draft.status = 'active'
      draft.activatedAt = at
      contract.updatedAt = at
      return `${contract.id}@${draft.revision}`
    }
    if (operation.type === 'contract.lifecycle') {
      const contract = this.contract(state, operation.contractId)
      const lifecycle = operation.lifecycle
      if (!['active', 'disabled', 'archived'].includes(lifecycle)) throw new Error('Unsupported contract lifecycle.')
      if (contract.lifecycle === 'archived') throw new Error('Archived contracts are immutable.')
      contract.lifecycle = lifecycle
      contract.updatedAt = at
      return contract.id
    }
    if (operation.type === 'grant.create') {
      if (state.grants.length >= 500) throw new Error('The 500-grant local safety limit has been reached.')
      const contract = this.contract(state, operation.grant.contractId)
      const active = activeOutcomeVersion(contract)
      if (contract.lifecycle !== 'active' || !active) throw new Error('The contract must have an active revision.')
      const ceiling = operation.grant.ceiling
      const level = operation.grant.level ?? 'approved-action'
      if (
        !isOutcomeLevel(ceiling) ||
        !isOutcomeLevel(level) ||
        (level as OutcomeAutonomyLevel) === 'bounded-autonomy'
      ) {
        throw new Error('A new grant cannot start with bounded autonomy.')
      }
      if (outcomeLevelRank(level) > outcomeLevelRank(ceiling)) throw new Error('Grant level exceeds its ceiling.')
      if (outcomeLevelRank(ceiling) > outcomeLevelRank(active.autonomyCeiling)) {
        throw new Error('Grant ceiling exceeds the active contract ceiling.')
      }
      if (!isOutcomeDataClass(operation.grant.dataClass) || !isOutcomeEnvironment(operation.grant.environment)) {
        throw new Error('Unsupported data class or environment.')
      }
      const agentId = outcomeId(operation.grant.agentId, 'agent id')
      const id = operation.grant.id ? outcomeId(operation.grant.id, 'grant id') : newId('grant')
      if (state.grants.some((grant) => grant.id === id)) throw new Error('Grant id already exists.')
      state.grants.push({
        id,
        contractId: contract.id,
        contractRevision: active.revision,
        agentId,
        tools: stringArray(operation.grant.tools, 'grant tools'),
        dataClass: operation.grant.dataClass,
        environment: operation.grant.environment,
        level,
        ceiling,
        status: 'active',
        execution: null,
        circuitOpen: false,
        createdBy: LOCAL_ADMIN,
        authorizedBy: LOCAL_ADMIN,
        createdAt: at,
        updatedAt: at,
        revision: 1
      })
      return id
    }
    if (operation.type === 'grant.promote') {
      const grant = this.grant(state, operation.grantId)
      const contract = this.contract(state, grant.contractId)
      const recommendation = recommendOutcomePromotion({ grant, contract, receipts: state.receipts, now: this.now() })
      if (!recommendation.eligible) {
        throw new Error(`Promotion is not eligible: ${recommendation.reasons.join(' ')}`)
      }
      const active = activeOutcomeVersion(contract)
      if (!active) throw new Error('The contract has no active revision.')
      if (recommendation.targetLevel === 'bounded-autonomy' && !recommendation.execution) {
        throw new Error('Bounded autonomy requires an exact evidence-backed model and policy version.')
      }
      grant.level = recommendation.targetLevel
      grant.contractRevision = active.revision
      grant.execution = recommendation.execution
      grant.circuitOpen = false
      delete grant.circuitReason
      delete grant.circuitOpenedAt
      grant.authorizedBy = LOCAL_ADMIN
      grant.updatedAt = at
      grant.revision += 1
      return grant.id
    }
    if (operation.type === 'grant.demote') {
      const grant = this.grant(state, operation.grantId)
      if (outcomeLevelRank(grant.level) > outcomeLevelRank('approved-action')) grant.level = 'approved-action'
      grant.execution = null
      grant.updatedAt = at
      grant.revision += 1
      return grant.id
    }
    if (operation.type === 'grant.status') {
      const grant = this.grant(state, operation.grantId)
      if (grant.status === 'revoked') throw new Error('A revoked grant is immutable.')
      if (!['active', 'suspended', 'revoked'].includes(operation.status)) throw new Error('Unsupported grant status.')
      grant.status = operation.status
      if (operation.status !== 'active') grant.execution = null
      grant.updatedAt = at
      grant.revision += 1
      return grant.id
    }
    if (operation.type === 'receipt.review') {
      const receipt = state.receipts.find((candidate) => candidate.id === operation.receiptId)
      if (!receipt) throw new Error('Outcome receipt does not exist.')
      if (receipt.review.state !== 'pending') throw new Error('Only a pending human review can be decided.')
      const note = operation.note
        ? redactSensitiveText(outcomeText(operation.note, 'review note', 500)).text
        : undefined
      receipt.review = {
        state: operation.decision,
        by: LOCAL_ADMIN,
        at,
        ...(note ? { note } : {})
      }
      if (operation.decision === 'accepted') {
        if (!receipt.validEvidence || !receipt.checksPassed) throw new Error('Invalid or failed evidence cannot be accepted.')
        receipt.verificationStatus = 'verified'
      } else {
        receipt.verificationStatus = 'failed'
        receipt.materialFailure = true
        receipt.demotedGrantIds = this.circuitBreak(state, receipt, at)
        this.recordRegression(state, receipt, at, 'human-review-rejected')
      }
      return receipt.id
    }
    if (operation.type === 'regression.review') {
      const candidate = state.regressions.find((item) => item.id === operation.candidateId)
      if (!candidate) throw new Error('Regression candidate does not exist.')
      if (candidate.status !== 'pending') throw new Error('Only a pending regression candidate can be reviewed.')
      candidate.status = operation.decision
      candidate.reviewedBy = LOCAL_ADMIN
      candidate.reviewedAt = at
      candidate.updatedAt = at
      if (operation.note) {
        candidate.reviewNote = redactSensitiveText(outcomeText(operation.note, 'review note', 500)).text
      }
      return candidate.id
    }
    if (operation.type === 'regression.retire') {
      const candidate = state.regressions.find((item) => item.id === operation.candidateId)
      if (!candidate) throw new Error('Regression candidate does not exist.')
      if (candidate.status !== 'approved') throw new Error('Only an active approved regression can be retired.')
      candidate.status = 'retired'
      candidate.retiredBy = LOCAL_ADMIN
      candidate.retiredAt = at
      candidate.updatedAt = at
      return candidate.id
    }
    if (operation.type === 'shadow.run') {
      const contract = this.contract(state, operation.contractId)
      const draft = outcomeVersion(contract, operation.revision)
      if (!draft || draft.status !== 'draft') throw new Error('Policy shadow requires a draft contract revision.')
      const observations = this.shadowObservations(state, contract.id)
      const cases = observations.map((item) => {
        const matching = this.activeRegressions(state, contract.id, item.receipt.binding)
        const regressions = matching.slice(0, 16)
        const results = evaluateOutcomeChecks(
          { checks: [...draft.checks, ...regressions.flatMap((candidate) => candidate.check ? [candidate.check] : [])] },
          item.receipt.observation
        )
        const passedChecks = matching.length <= 16 && checksPassed(results)
        return {
          regressionId: item.regressionId,
          receiptId: item.receipt.id,
          expected: item.expected,
          passed: item.expected === 'pass' ? passedChecks : !passedChecks,
          failedCheckIds: results.filter((result) => result.required && !result.passed).map((result) => result.id)
        }
      })
      const shadow: OutcomeShadowEvaluation = {
        id: newId('shadow'),
        contractId: contract.id,
        contractRevision: draft.revision,
        sourceRegressionIds: [...new Set(cases.flatMap((item) => item.regressionId ? [item.regressionId] : []))],
        cases,
        passed: cases.length > 0 && cases.every((item) => item.passed),
        createdAt: at,
        digest: ''
      }
      shadow.digest = shadowDigest(shadow)
      state.shadows.push(shadow)
      if (state.shadows.length > 200) state.shadows.splice(0, state.shadows.length - 200)
      return shadow.id
    }
    throw new Error('Unsupported Verified Outcomes operation.')
  }

  private contract(state: VerifiedOutcomeState, id: string): OutcomeContract {
    const contract = state.contracts.find((candidate) => candidate.id === id)
    if (!contract) throw new Error(`Outcome contract ${id} does not exist.`)
    return contract
  }

  private grant(state: VerifiedOutcomeState, id: string): OutcomeAutonomyGrant {
    const grant = state.grants.find((candidate) => candidate.id === id)
    if (!grant) throw new Error(`Autonomy grant ${id} does not exist.`)
    return grant
  }

  /** Resolve and pin the active contract when a user binds a task. */
  async binding(input: OutcomeTaskBindingInput): Promise<OutcomeTaskBinding> {
    await this.init()
    const contract = this.contract(this.state(), outcomeId(input.contractId, 'contract id'))
    const active = activeOutcomeVersion(contract)
    if (contract.lifecycle !== 'active' || !active) throw new Error('Only an active outcome contract can be bound.')
    if (!isOutcomeDataClass(input.dataClass) || !isOutcomeEnvironment(input.environment)) {
      throw new Error('Unsupported task data class or environment.')
    }
    return {
      contractId: contract.id,
      contractRevision: active.revision,
      dataClass: input.dataClass,
      environment: input.environment
    }
  }

  async authorizeAction(input: {
    taskId: string
    runId?: string
    binding: OutcomeTaskBinding
    agentId: string
    toolName: string
    tool: OutcomeActionProfile
    grants?: never
    execution: OutcomeExecutionEvidence
    currentPolicyDigest: string
  }): Promise<OutcomeActionDecision> {
    await this.init()
    const contract = this.contract(this.state(), input.binding.contractId)
    if (!outcomeVersion(contract, input.binding.contractRevision)) {
      throw new Error('The pinned outcome contract revision no longer exists.')
    }
    const decision = decideOutcomeAction({
      contract,
      contractRevision: input.binding.contractRevision,
      agentId: outcomeId(input.agentId, 'agent id'),
      toolName: outcomeId(input.toolName, 'tool name'),
      tool: input.tool,
      dataClass: input.binding.dataClass,
      environment: input.binding.environment,
      grants: this.state().grants,
      execution: input.execution,
      currentPolicyDigest: input.currentPolicyDigest
    })
    if (decision.mode !== 'allow') {
      const recorded = await this.audit({
        taskId: input.taskId,
        runId: input.runId,
        action: 'outcome.action',
        outcome: decision.mode === 'deny' ? 'denied' : decision.mode === 'allow-autonomous' ? 'allowed' : 'requested',
        target: input.toolName,
        detail: decision.reason,
        metadata: {
          contractId: input.binding.contractId,
          contractRevision: input.binding.contractRevision,
          agentId: input.agentId,
          dataClass: input.binding.dataClass,
          environment: input.binding.environment,
          grantId: decision.grantId,
          level: decision.level
        }
      })
      if (!recorded && decision.mode === 'allow-autonomous') {
        return {
          mode: 'require-approval',
          level: 'approved-action',
          grantId: decision.grantId,
          reason: 'The signed runtime audit is unavailable; bounded autonomy is suspended for this action.'
        }
      }
    }
    return decision
  }

  async recordTaskOutcome(input: {
    taskId: string
    runId: string
    sourceDigest: string
    binding: OutcomeTaskBinding
    agentIds: string[]
    execution: OutcomeExecutionEvidence
    observation: OutcomeRunObservation
  }): Promise<OutcomeEvidenceReceipt> {
    return this.serialize(async () => {
      await this.init()
      if (!/^[0-9a-f]{64}$/.test(input.sourceDigest)) throw new Error('A SHA-256 task source digest is required.')
      const existing = this.state().receipts.find(
        (receipt) =>
          receipt.taskId === input.taskId &&
          receipt.runId === input.runId &&
          receipt.sourceDigest === input.sourceDigest
      )
      if (existing) return clone(existing)
      const contract = this.contract(this.state(), input.binding.contractId)
      const version = outcomeVersion(contract, input.binding.contractRevision)
      if (!version) throw new Error('The pinned outcome contract revision no longer exists.')
      const binding = clone(input.binding)
      const execution = this.execution(input.execution)
      const observation = this.observation(input.observation)
      const agentIds = stringArray(input.agentIds, 'outcome agent ids', 64)
      const matchingRegressions = this.activeRegressions(this.state(), contract.id, binding)
      const regressionOverflow = matchingRegressions.length > 16
      const regressions = matchingRegressions.slice(0, 16)
      const regressionChecks = regressions.flatMap((candidate) => candidate.check ? [candidate.check] : [])
      const results = evaluateOutcomeChecks(
        { checks: [...version.checks, ...regressionChecks] },
        observation
      )
      const passed = checksPassed(results)
      const invalidReasons: string[] = []
      if (regressionOverflow) {
        invalidReasons.push('More than 16 approved regressions match this scope; retire superseded checks before verification.')
      }
      if (execution.attempts.length !== 1) {
        invalidReasons.push(`Expected one exact provider/model attempt; observed ${execution.attempts.length}.`)
      }
      if (execution.policyDigests.length !== 1) {
        invalidReasons.push(`Expected one exact policy version; observed ${execution.policyDigests.length}.`)
      }
      let validEvidence = invalidReasons.length === 0
      const humanReviewRequired =
        version.humanReviewRequired || regressionOverflow || regressions.some((candidate) => !candidate.check)
      const at = new Date(this.now()).toISOString()
      const receipt: OutcomeEvidenceReceipt = {
        id: newId('outcome'),
        taskId: outcomeId(input.taskId, 'task id'),
        runId: outcomeText(input.runId, 'run id', 220),
        sourceDigest: input.sourceDigest,
        contractId: contract.id,
        contractRevision: version.revision,
        agentIds,
        binding,
        execution,
        observation,
        regressionIds: regressions.map((candidate) => candidate.id),
        checks: results,
        checksPassed: passed,
        validEvidence,
        invalidReasons,
        verificationStatus: !validEvidence
          ? 'invalid'
            : !passed
            ? 'failed'
            : humanReviewRequired
              ? 'pending-review'
              : 'verified',
        materialFailure: !validEvidence || !passed || observation.taskStatus === 'error',
        review: { state: humanReviewRequired ? 'pending' : 'not-required' },
        demotedGrantIds: [],
        createdAt: at,
        digest: ''
      }
      receipt.digest = receiptDigest(receipt)
      const recorded = await this.audit({
        taskId: receipt.taskId,
        runId: receipt.runId,
        action: 'outcome.verified',
        outcome: receipt.materialFailure ? 'error' : receipt.verificationStatus === 'pending-review' ? 'requested' : 'ok',
        target: `${receipt.contractId}@${receipt.contractRevision}`,
        detail: receipt.verificationStatus,
        metadata: {
          receiptId: receipt.id,
          digest: receipt.digest,
          sourceDigest: receipt.sourceDigest,
          checks: receipt.checks.map((check) => ({ id: check.id, required: check.required, passed: check.passed })),
          invalidReasons: receipt.invalidReasons
        }
      })
      if (!recorded) {
        receipt.validEvidence = false
        receipt.invalidReasons.push('The signed runtime audit was unavailable for this outcome.')
        receipt.verificationStatus = 'invalid'
        receipt.materialFailure = true
        receipt.digest = receiptDigest(receipt)
      }
      const next = clone(this.state())
      next.receipts.push(receipt)
      if (receipt.materialFailure) {
        receipt.demotedGrantIds = this.circuitBreak(next, receipt, at)
        this.recordRegression(next, receipt, at)
      }
      next.revision += 1
      await this.commit(next)
      return clone(receipt)
    })
  }

  private activeRegressions(
    state: VerifiedOutcomeState,
    contractId: string,
    binding: OutcomeTaskBinding
  ): OutcomeRegressionCandidate[] {
    return state.regressions.filter(
      (candidate) =>
        candidate.status === 'approved' &&
        candidate.contractId === contractId &&
        candidate.binding.dataClass === binding.dataClass &&
        candidate.binding.environment === binding.environment
    )
  }

  private execution(value: OutcomeExecutionEvidence): OutcomeExecutionEvidence {
    if (!value || !Array.isArray(value.attempts) || !Array.isArray(value.policyDigests)) {
      throw new Error('Execution evidence must contain model attempts and policy digests.')
    }
    if (value.attempts.length > 64 || value.policyDigests.length > 64) {
      throw new Error('Execution evidence exceeds its safety bounds.')
    }
    const attempts: OutcomeModelVersion[] = value.attempts.map((attempt) => ({
      providerId: outcomeId(attempt.providerId, 'provider id'),
      model: outcomeText(attempt.model, 'model', 180)
    }))
    const policies = value.policyDigests.map((policy) => {
      if (typeof policy !== 'string' || !/^[0-9a-f]{64}$/.test(policy)) {
        throw new Error('Policy evidence must use SHA-256 digests.')
      }
      return policy
    })
    return {
      attempts: [...new Map(attempts.map((attempt) => [`${attempt.providerId}\u0000${attempt.model}`, attempt])).values()],
      policyDigests: [...new Set(policies)]
    }
  }

  private observation(value: OutcomeRunObservation): OutcomeRunObservation {
    if (!value || !['draft', 'running', 'waiting', 'paused', 'done', 'error'].includes(value.taskStatus)) {
      throw new Error('Invalid task outcome status.')
    }
    if (!Array.isArray(value.steps) || value.steps.length > 500) throw new Error('Invalid outcome step observations.')
    const steps = value.steps.map((step) => {
      if (!['running', 'waiting', 'ok', 'error'].includes(step.status)) throw new Error('Invalid observed step status.')
      return { tool: outcomeId(step.tool, 'observed tool'), status: step.status }
    })
    for (const [name, number] of Object.entries({ artifacts: value.artifacts, planTotal: value.planTotal, planDone: value.planDone })) {
      if (!Number.isInteger(number) || number < 0 || number > 100_000) throw new Error(`Invalid ${name} observation.`)
    }
    return {
      taskStatus: value.taskStatus,
      steps,
      artifacts: value.artifacts,
      planTotal: value.planTotal,
      planDone: value.planDone
    }
  }

  private circuitBreak(state: VerifiedOutcomeState, receipt: OutcomeEvidenceReceipt, at: string): string[] {
    const demoted: string[] = []
    for (const grant of state.grants) {
      if (
        grant.status !== 'active' ||
        grant.contractId !== receipt.contractId ||
        grant.dataClass !== receipt.binding.dataClass ||
        grant.environment !== receipt.binding.environment ||
        grant.circuitOpen
      ) {
        continue
      }
      if (outcomeLevelRank(grant.level) > outcomeLevelRank('approved-action')) grant.level = 'approved-action'
      grant.execution = null
      grant.circuitOpen = true
      grant.circuitReason = `Material outcome failure ${receipt.id}; administrator and fresh recovery evidence required.`
      grant.circuitOpenedAt = at
      grant.updatedAt = at
      grant.revision += 1
      demoted.push(grant.id)
    }
    return demoted
  }

  private recordRegression(
    state: VerifiedOutcomeState,
    receipt: OutcomeEvidenceReceipt,
    at: string,
    extraCode?: string
  ): void {
    const failedChecks = receipt.checks.filter((check) => check.required && !check.passed)
    const sourceForCheck = (checkId: string): OutcomeRegressionCandidate | undefined =>
      state.regressions.find((candidate) => candidate.check?.id === checkId)
    const codes = [
      ...failedChecks.map((check) => `check:${sourceForCheck(check.id)?.sourceCheckId ?? check.id}`),
      ...(!receipt.validEvidence ? ['evidence:invalid'] : []),
      ...(extraCode ? [extraCode] : [])
    ]
    const fingerprint = digest({
      contractId: receipt.contractId,
      dataClass: receipt.binding.dataClass,
      environment: receipt.binding.environment,
      codes: [...new Set(codes)].sort()
    })
    const firstFailure = failedChecks[0]
    const priorRegression = firstFailure ? sourceForCheck(firstFailure.id) : undefined
    const version = outcomeVersion(this.contract(state, receipt.contractId), receipt.contractRevision)
    const contractCheck = firstFailure
      ? version?.checks.find((check) => check.id === firstFailure.id)
      : undefined
    const sourceCheckId = priorRegression?.sourceCheckId ?? contractCheck?.id ?? null
    const sourceDefinition = priorRegression?.check ?? contractCheck ?? null
    const copySource = (candidate: OutcomeRegressionCandidate): void => {
      candidate.sourceCheckId = sourceCheckId
      candidate.check = sourceDefinition
        ? {
            ...clone(sourceDefinition),
            id: `regression:${candidate.id}`,
            label: `Regression: ${sourceDefinition.label.replace(/^Regression: /, '')}`.slice(0, 140)
          }
        : null
    }
    const existing = state.regressions.find(
      (candidate) => candidate.contractId === receipt.contractId && candidate.failureFingerprint === fingerprint
    )
    if (existing) {
      existing.occurrences += 1
      existing.updatedAt = at
      existing.contractRevision = receipt.contractRevision
      existing.binding = clone(receipt.binding)
      existing.sourceReceiptIds = [...new Set([receipt.id, ...existing.sourceReceiptIds])].slice(0, 20)
      if (existing.status === 'retired') {
        existing.status = 'pending'
        delete existing.reviewedBy
        delete existing.reviewedAt
        delete existing.reviewNote
        delete existing.retiredBy
        delete existing.retiredAt
      }
      if (existing.status === 'pending') copySource(existing)
      return
    }
    if (state.regressions.length >= 500) throw new Error('The 500-regression safety limit has been reached.')
    const contract = this.contract(state, receipt.contractId)
    const candidate: OutcomeRegressionCandidate = {
      id: newId('regression'),
      contractId: receipt.contractId,
      contractRevision: receipt.contractRevision,
      binding: clone(receipt.binding),
      failureFingerprint: fingerprint,
      title: `${contract.name}: ${failedChecks.map((check) => check.label).join(', ') || (extraCode ? 'human outcome rejection' : 'evidence integrity failure')}`.slice(0, 220),
      status: 'pending',
      check: null,
      sourceCheckId: null,
      sourceReceiptIds: [receipt.id],
      occurrences: 1,
      createdAt: at,
      updatedAt: at
    }
    copySource(candidate)
    state.regressions.push(candidate)
  }

  private shadowObservations(
    state: VerifiedOutcomeState,
    contractId: string
  ): Array<{ regressionId: string | null; receipt: OutcomeEvidenceReceipt; expected: 'pass' | 'fail' }> {
    const failures = state.regressions
      .filter((candidate) => candidate.status === 'approved' && candidate.contractId === contractId)
      .flatMap((candidate) => {
        const receipt = state.receipts.find((item) => item.id === candidate.sourceReceiptIds[0])
        if (!receipt || !receipt.validEvidence || receipt.checksPassed) return []
        return [{ regressionId: candidate.id, receipt, expected: 'fail' as const }]
      })
    const verified = [...state.receipts]
      .filter((receipt) => receipt.contractId === contractId && receipt.verificationStatus === 'verified')
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 20)
      .map((receipt) => ({ regressionId: null, receipt, expected: 'pass' as const }))
    const seen = new Set<string>()
    return [...failures, ...verified].filter((item) => {
      const key = `${item.regressionId ?? 'verified'}:${item.receipt.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }
}
