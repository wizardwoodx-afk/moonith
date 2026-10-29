import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  AGENT_ROLE_ID,
  DEFAULT_NAMESPACE_ID,
  LOCAL_OWNER_PRINCIPAL_ID,
  OWNER_ROLE_ID,
  ENTERPRISE_ACTIONS,
  ENTERPRISE_RESOURCE_KINDS,
  isEnterpriseAction,
  isEnterpriseResourceKind,
  type EnterpriseAccessBinding,
  type EnterpriseAuthorization,
  type EnterpriseControlMutation,
  type EnterpriseControlOperation,
  type EnterpriseControlSnapshot,
  type EnterpriseControlState,
  type EnterpriseDecision,
  type EnterpriseLifecycle,
  type EnterpriseNamespace,
  type EnterprisePrincipal,
  type EnterpriseResource,
  type EnterpriseRestriction,
  type EnterpriseRevisionInfo,
  type EnterpriseRole
} from '../../shared/enterpriseControl'
import { atomicWriteFile } from '../atomic'
import { signAuditPayload } from '../audit/chain'
import type { AuditIdentity } from '../audit/identity'
import {
  authorizeEnterprise,
  createDefaultEnterpriseState,
  nativeAgentBindingId,
  nativeAgentPrincipalId
} from './policy'

interface EnterpriseRevisionRecord extends EnterpriseRevisionInfo {
  previousDigest: string | null
  state: EnterpriseControlState
  signature?: string
}

interface EnterpriseDiskState {
  current: EnterpriseControlState
  revisions: EnterpriseRevisionRecord[]
  head?: { revision: number; digest: string; signature: string }
}

interface EnterpriseServiceOptions {
  file: string
  loadKey: () => Promise<AuditIdentity>
  now?: () => number
  audit?: (event: {
    action: string
    outcome: 'allowed' | 'denied' | 'ok' | 'error'
    target?: string
    detail?: string
    metadata?: Record<string, unknown>
  }) => Promise<boolean>
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function revisionDigest(record: Omit<EnterpriseRevisionRecord, 'digest' | 'signature'>): string {
  return createHash('sha256').update(stableJson(record)).digest('hex')
}

function revisionSignature(
  record: Omit<EnterpriseRevisionRecord, 'signature'>,
  identity: AuditIdentity
): string {
  return signAuditPayload({ domain: 'selfimpulse-enterprise-revision-v1', record }, identity)
}

function headSignature(
  head: { revision: number; digest: string },
  identity: AuditIdentity
): string {
  return signAuditPayload({ domain: 'selfimpulse-enterprise-head-v1', ...head }, identity)
}

function text(value: unknown, label: string, maximum = 160): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`)
  const result = value.trim()
  if (!result || result.length > maximum || /[\u0000-\u001f]/.test(result)) {
    throw new Error(`${label} must contain 1–${maximum} printable characters.`)
  }
  return result
}

function id(value: unknown, label = 'id'): string {
  const result = text(value, label, 140)
  if (!/^[A-Za-z0-9][A-Za-z0-9:._%@-]*$/.test(result)) {
    throw new Error(`${label} may contain letters, numbers, and : . _ % @ - only.`)
  }
  return result
}

function validActions(value: unknown, allowEmpty = true): typeof ENTERPRISE_ACTIONS[number][] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new Error('actions must be a non-empty list.')
  const actions = [...new Set(value.filter(isEnterpriseAction))]
  if (actions.length !== value.length || (!allowEmpty && actions.length === 0)) {
    throw new Error('actions contain an unsupported or duplicate action.')
  }
  return actions
}

function validResourceKinds(value: unknown): typeof ENTERPRISE_RESOURCE_KINDS[number][] {
  if (!Array.isArray(value)) throw new Error('resourceKinds must be a list.')
  const kinds = [...new Set(value.filter(isEnterpriseResourceKind))]
  if (kinds.length !== value.length) throw new Error('resourceKinds contain an unsupported or duplicate kind.')
  return kinds
}

function validResource(value: unknown): EnterpriseResource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('resource must be an object.')
  const input = value as Record<string, unknown>
  if (!isEnterpriseResourceKind(input.kind)) throw new Error('Unsupported resource kind.')
  const resource: EnterpriseResource = {
    kind: input.kind,
    namespaceId: id(input.namespaceId, 'resource namespace')
  }
  if (input.id !== undefined) resource.id = id(input.id, 'resource id')
  return resource
}

function expectLifecycle(value: unknown): EnterpriseLifecycle {
  if (value !== 'active' && value !== 'disabled' && value !== 'archived') {
    throw new Error('lifecycle must be active, disabled, or archived.')
  }
  return value
}

export class EnterpriseControlService {
  private disk: EnterpriseDiskState | null = null
  private initialization: Promise<void> | null = null
  private mutations: Promise<unknown> = Promise.resolve()
  private readonly decisions: EnterpriseDecision[] = []
  private readonly now: () => number
  private keyMaterial: AuditIdentity | null = null

  constructor(private readonly options: EnterpriseServiceOptions) {
    this.now = options.now ?? Date.now
  }

  private key(): AuditIdentity {
    if (!this.keyMaterial) throw new Error('Enterprise revision signing is not initialized.')
    return this.keyMaterial
  }

  private async init(): Promise<void> {
    if (this.disk) return
    if (!this.initialization) {
      this.initialization = (async () => {
        this.keyMaterial = await this.options.loadKey()
        await fs.mkdir(dirname(this.options.file), { recursive: true })
        let parsed: EnterpriseDiskState | null = null
        try {
          const raw = await fs.readFile(this.options.file, 'utf8')
          parsed = JSON.parse(raw) as EnterpriseDiskState
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw new Error(
              `Enterprise Control Plane data is unreadable; refusing to replace it with defaults. ${
                error instanceof Error ? error.message : String(error)
              }`
            )
          }
        }
        if (parsed) {
          const legacy = this.validateDisk(parsed)
          this.disk = parsed
          if (legacy) {
            for (const revision of parsed.revisions) {
              const { signature: _signature, ...unsigned } = revision
              revision.signature = revisionSignature(unsigned, this.key())
            }
            await this.persist()
          }
          return
        }
        const current = createDefaultEnterpriseState(this.now())
        const revision = this.makeRevision(current, null, 'system', 'Initialize native Enterprise Control Plane')
        this.disk = { current, revisions: [revision] }
        await this.persist()
      })().catch((error) => {
        this.disk = null
        this.initialization = null
        throw error
      })
    }
    await this.initialization
  }

  /** Returns true only for a wholly legacy, unsigned file eligible for one-time migration. */
  private validateDisk(value: EnterpriseDiskState): boolean {
    if (!value || !Array.isArray(value.revisions) || value.revisions.length === 0) {
      throw new Error('Missing immutable revision history.')
    }
    const signed = value.revisions.filter((revision) => typeof revision.signature === 'string').length
    if (signed !== 0 && signed !== value.revisions.length) {
      throw new Error('Revision history mixes signed and unsigned records.')
    }
    let previous: EnterpriseRevisionRecord | null = null
    for (const revision of value.revisions) {
      const { digest, signature, ...unsigned } = revision
      if (revisionDigest(unsigned) !== digest) {
        throw new Error(`Revision ${revision.revision} digest integrity mismatch.`)
      }
      if (signed && revisionSignature({ ...unsigned, digest }, this.key()) !== signature) {
        throw new Error(`Revision ${revision.revision} signature mismatch.`)
      }
      if (previous && (revision.revision !== previous.revision + 1 || revision.previousDigest !== previous.digest)) {
        throw new Error(`Revision chain is broken at ${revision.revision}.`)
      }
      if (!previous && (revision.revision !== 1 || revision.previousDigest !== null)) {
        throw new Error('Revision history must start at revision 1.')
      }
      previous = revision
    }
    if (!value.current || value.current.format !== 'selfimpulse-enterprise-control/1') {
      throw new Error('Unsupported control-plane state.')
    }
    if (stableJson(value.current) !== stableJson(previous?.state)) {
      throw new Error('Current state does not match the latest immutable revision.')
    }
    if (signed) {
      const head = value.head
      if (!head || head.revision !== previous?.revision || head.digest !== previous.digest) {
        throw new Error('The signed revision head is missing or names a different chain.')
      }
      if (headSignature({ revision: head.revision, digest: head.digest }, this.key()) !== head.signature) {
        throw new Error('The signed revision head is invalid.')
      }
    } else if (value.head) {
      throw new Error('A legacy unsigned chain cannot carry a signed head.')
    }
    return signed === 0
  }

  private makeRevision(
    state: EnterpriseControlState,
    previousDigest: string | null,
    actor: string,
    reason: string
  ): EnterpriseRevisionRecord {
    const unsigned = {
      revision: state.revision,
      at: new Date(this.now()).toISOString(),
      actor,
      reason,
      previousDigest,
      state: clone(state)
    }
    const digest = revisionDigest(unsigned)
    return { ...unsigned, digest, signature: revisionSignature({ ...unsigned, digest }, this.key()) }
  }

  private async persist(): Promise<void> {
    if (!this.disk) throw new Error('Control plane is not initialized.')
    const latest = this.disk.revisions[this.disk.revisions.length - 1]
    if (!latest) throw new Error('Control plane has no revision to persist.')
    const head = { revision: latest.revision, digest: latest.digest }
    this.disk.head = { ...head, signature: headSignature(head, this.key()) }
    await atomicWriteFile(this.options.file, `${JSON.stringify(this.disk, null, 2)}\n`, { mode: 0o600 })
  }

  private async audit(event: Parameters<NonNullable<EnterpriseServiceOptions['audit']>>[0]): Promise<void> {
    if (!this.options.audit) return
    const recorded = await this.options.audit(event)
    if (!recorded) throw new Error(`The signed runtime audit ledger refused ${event.action}.`)
  }

  async snapshot(): Promise<EnterpriseControlSnapshot> {
    await this.init()
    const disk = this.disk as EnterpriseDiskState
    return {
      state: clone(disk.current),
      revisions: disk.revisions.map(({ state: _state, previousDigest: _previous, signature: _signature, ...info }) => ({ ...info })).reverse(),
      recentDecisions: clone(this.decisions),
      security: {
        execution: 'native-in-process',
        defaultPolicy: 'deny',
        denyOverrides: true,
        revisionIntegrity: 'Ed25519-signed revisions and signed head; legacy unsigned files are migrated once after digest validation.',
        isolation:
          'Native policy and lifecycle enforcement inside SelfImpulse. It does not claim hosted SSO, OS-sandboxed workloads, or hard multi-tenant isolation.'
      }
    }
  }

  async authorize(request: EnterpriseAuthorization): Promise<EnterpriseDecision> {
    await this.init()
    const principalId = id(request.principalId, 'principal')
    if (!isEnterpriseAction(request.action)) throw new Error('Unsupported enterprise action.')
    const normalized = { principalId, action: request.action, resource: validResource(request.resource) }
    const decision = authorizeEnterprise((this.disk as EnterpriseDiskState).current, normalized, this.now())
    this.decisions.unshift(decision)
    if (this.decisions.length > 50) this.decisions.length = 50
    await this.audit({
      action: `enterprise.authorize.${request.action}`,
      outcome: decision.allowed ? 'allowed' : 'denied',
      target: `${request.resource.kind}:${request.resource.namespaceId}:${request.resource.id ?? '*'}`,
      detail: decision.reason,
      metadata: { principalId, revision: decision.revision, grantedBy: decision.grantedBy, deniedBy: decision.deniedBy }
    })
    return decision
  }

  async requireLocalOwner(): Promise<void> {
    const decision = await this.authorize({
      principalId: LOCAL_OWNER_PRINCIPAL_ID,
      action: 'enterprise.manage',
      resource: { kind: 'enterprise', namespaceId: DEFAULT_NAMESPACE_ID, id: 'control-plane' }
    })
    if (!decision.allowed) throw new Error(`Enterprise Control Plane administration refused: ${decision.reason}`)
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(operation, operation)
    this.mutations = result.catch(() => undefined)
    return result
  }

  async mutate(mutation: EnterpriseControlMutation): Promise<EnterpriseControlSnapshot> {
    return this.serialize(async () => {
      await this.init()
      await this.requireLocalOwner()
      const reason = text(mutation.reason, 'revision reason', 240)
      if (reason.length < 3) throw new Error('revision reason must contain at least 3 characters.')
      await this.apply(mutation.operation, mutation.expectedRevision, LOCAL_OWNER_PRINCIPAL_ID, reason)
      return this.snapshot()
    })
  }

  private async apply(
    operation: EnterpriseControlOperation,
    expectedRevision: number,
    actor: string,
    reason: string
  ): Promise<void> {
    const disk = this.disk as EnterpriseDiskState
    if (!Number.isInteger(expectedRevision) || expectedRevision !== disk.current.revision) {
      throw new Error(`Revision conflict: expected ${disk.current.revision}, received ${expectedRevision}. Refresh before saving.`)
    }
    const current = clone(disk.current)
    this.applyOperation(current, operation)
    const recovery = authorizeEnterprise(current, {
      principalId: LOCAL_OWNER_PRINCIPAL_ID,
      action: 'enterprise.manage',
      resource: { kind: 'enterprise', namespaceId: DEFAULT_NAMESPACE_ID, id: 'control-plane' }
    }, this.now())
    if (!recovery.allowed) {
      throw new Error(`Operation would remove the local recovery owner's control-plane access: ${recovery.reason}`)
    }
    current.revision += 1
    const previous = disk.revisions[disk.revisions.length - 1]
    const revision = this.makeRevision(current, previous.digest, actor, reason)
    const next: EnterpriseDiskState = { current, revisions: [...disk.revisions, revision] }
    this.disk = next
    try {
      await this.persist()
    } catch (error) {
      this.disk = disk
      throw error
    }
    try {
      await this.audit({
        action: `enterprise.${operation.type}`,
        outcome: 'ok',
        target: `${current.revision}`,
        detail: reason,
        metadata: { revision: current.revision, digest: revision.digest }
      })
    } catch (error) {
      throw new Error(
        `Control-plane revision ${current.revision} committed, but signed audit recording failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  private applyOperation(state: EnterpriseControlState, operation: EnterpriseControlOperation): void {
    const at = new Date(this.now()).toISOString()
    if (operation.type === 'revision.restore') {
      if (!Number.isInteger(operation.revision)) throw new Error('revision must be an integer.')
      const disk = this.disk as EnterpriseDiskState
      const target = disk.revisions.find((revision) => revision.revision === operation.revision)
      if (!target) throw new Error(`Revision ${operation.revision} does not exist.`)
      const restored = clone(target.state)
      restored.revision = state.revision
      Object.assign(state, restored)
      return
    }
    if (operation.type === 'namespace.create') {
      const namespace = operation.namespace
      const entity: EnterpriseNamespace = {
        id: id(namespace.id, 'namespace id'),
        name: text(namespace.name, 'namespace name', 100),
        description: namespace.description ? text(namespace.description, 'description', 300) : '',
        lifecycle: 'active',
        createdAt: at,
        updatedAt: at
      }
      if (state.namespaces.some((candidate) => candidate.id === entity.id)) throw new Error('Namespace id already exists.')
      state.namespaces.push(entity)
      return
    }
    if (operation.type === 'role.upsert') {
      const input = operation.role
      const namespaceId = id(input.namespaceId, 'role namespace')
      this.requireNamespace(state, namespaceId)
      const entity: EnterpriseRole = {
        id: id(input.id, 'role id'),
        namespaceId,
        name: text(input.name, 'role name', 100),
        description: input.description ? text(input.description, 'description', 300) : '',
        actions: validActions(input.actions),
        resourceKinds: validResourceKinds(input.resourceKinds),
        lifecycle: 'active',
        createdAt: at,
        updatedAt: at
      }
      this.upsert(state.roles, entity, ['namespaceId'])
      return
    }
    if (operation.type === 'binding.upsert') {
      const input = operation.binding
      const namespaceId = id(input.namespaceId, 'binding namespace')
      this.requireNamespace(state, namespaceId)
      const principalId = id(input.principalId, 'binding principal')
      const roleId = id(input.roleId, 'binding role')
      if (!state.principals.some((principal) => principal.id === principalId)) throw new Error('Binding principal does not exist.')
      const role = state.roles.find((candidate) => candidate.id === roleId)
      if (!role || role.namespaceId !== namespaceId) throw new Error('Binding Role must exist in the same namespace.')
      const resource = validResource(input.resource)
      if (resource.namespaceId !== namespaceId) throw new Error('Binding and resource namespaces must match.')
      const entity: EnterpriseAccessBinding = {
        id: id(input.id, 'binding id'),
        namespaceId,
        principalId,
        roleId,
        resource,
        lifecycle: 'active',
        createdAt: at,
        updatedAt: at
      }
      this.upsert(state.bindings, entity, ['namespaceId', 'principalId'])
      return
    }
    if (operation.type === 'restriction.upsert') {
      const input = operation.restriction
      const namespaceId = id(input.namespaceId, 'Restriction namespace')
      this.requireNamespace(state, namespaceId)
      const principalId = input.principalId === null ? null : id(input.principalId, 'Restriction principal')
      if (principalId && !state.principals.some((principal) => principal.id === principalId)) {
        throw new Error('Restriction principal does not exist.')
      }
      const resource = validResource(input.resource)
      if (resource.namespaceId !== namespaceId) throw new Error('Restriction and resource namespaces must match.')
      const entity: EnterpriseRestriction = {
        id: id(input.id, 'Restriction id'),
        namespaceId,
        principalId,
        name: text(input.name, 'Restriction name', 100),
        actions: validActions(input.actions, false),
        resource,
        lifecycle: 'active',
        createdAt: at,
        updatedAt: at
      }
      this.upsert(state.restrictions, entity, ['namespaceId'])
      return
    }
    if (operation.type === 'lifecycle.set') {
      const lifecycle = expectLifecycle(operation.lifecycle)
      const entityId = id(operation.id)
      if (
        (operation.kind === 'namespace' && entityId === DEFAULT_NAMESPACE_ID) ||
        (operation.kind === 'principal' && entityId === LOCAL_OWNER_PRINCIPAL_ID) ||
        (operation.kind === 'role' && entityId === OWNER_ROLE_ID) ||
        (operation.kind === 'binding' && entityId === 'binding:local-owner')
      ) {
        if (lifecycle !== 'active') throw new Error('The local recovery owner and default namespace must remain active.')
      }
      const collection = this.collection(state, operation.kind)
      const entity = collection.find((candidate) => candidate.id === entityId)
      if (!entity) throw new Error(`${operation.kind} ${entityId} does not exist.`)
      if (entity.lifecycle === 'archived') throw new Error('Archived entities are immutable; restore a revision instead.')
      entity.lifecycle = lifecycle
      entity.updatedAt = at
      return
    }
    throw new Error('Unsupported control-plane operation.')
  }

  private collection(
    state: EnterpriseControlState,
    kind: 'namespace' | 'principal' | 'role' | 'binding' | 'restriction'
  ): Array<{ id: string; lifecycle: EnterpriseLifecycle; updatedAt: string }> {
    if (kind === 'namespace') return state.namespaces
    if (kind === 'principal') return state.principals
    if (kind === 'role') return state.roles
    if (kind === 'binding') return state.bindings
    return state.restrictions
  }

  private upsert<T extends { id: string; createdAt: string; updatedAt: string; lifecycle: EnterpriseLifecycle }>(
    collection: T[],
    entity: T,
    immutable: Array<keyof T>
  ): void {
    const index = collection.findIndex((candidate) => candidate.id === entity.id)
    if (index < 0) {
      collection.push(entity)
      return
    }
    const existing = collection[index]
    if (existing.lifecycle === 'archived') throw new Error('Archived entities are immutable; restore a revision instead.')
    for (const key of immutable) {
      if (existing[key] !== entity[key]) throw new Error(`${String(key)} is immutable; use a new id.`)
    }
    collection[index] = { ...entity, createdAt: existing.createdAt, lifecycle: existing.lifecycle }
  }

  private requireNamespace(state: EnterpriseControlState, namespaceId: string): void {
    if (!state.namespaces.some((namespace) => namespace.id === namespaceId)) {
      throw new Error(`Namespace ${namespaceId} does not exist.`)
    }
  }

  /** Enroll a native per-agent identity once; later revocations are never silently undone. */
  async ensureAgentPrincipal(teamId: string, seatId: string, seatName: string): Promise<string> {
    const team = text(teamId, 'team id', 140)
    const seat = text(seatId, 'seat id', 140)
    const principalId = nativeAgentPrincipalId(team, seat)
    return this.serialize(async () => {
      await this.init()
      const disk = this.disk as EnterpriseDiskState
      if (disk.current.principals.some((principal) => principal.id === principalId)) return principalId
      const livePrincipals = disk.current.principals.filter(
        (principal) => principal.lifecycle !== 'archived'
      ).length
      if (livePrincipals >= 5_000) {
        throw new Error(
          'Enterprise Control Plane refused a new agent principal: the 5,000 live-principal limit is reached.'
        )
      }
      const at = new Date(this.now()).toISOString()
      const current = clone(disk.current)
      const principal: EnterprisePrincipal = {
        id: principalId,
        kind: 'agent',
        name: text(seatName, 'agent name', 100),
        namespaceId: DEFAULT_NAMESPACE_ID,
        agentRef: { teamId: team, seatId: seat },
        lifecycle: 'active',
        createdAt: at,
        updatedAt: at
      }
      current.principals.push(principal)
      current.bindings.push({
        id: nativeAgentBindingId(principalId),
        namespaceId: DEFAULT_NAMESPACE_ID,
        principalId,
        roleId: AGENT_ROLE_ID,
        resource: { kind: 'namespace', namespaceId: DEFAULT_NAMESPACE_ID, id: DEFAULT_NAMESPACE_ID },
        lifecycle: 'active',
        createdAt: at,
        updatedAt: at
      })
      current.revision += 1
      const previous = disk.revisions[disk.revisions.length - 1]
      const seatLabel = team === 'captain' ? 'agent' : team
      const revision = this.makeRevision(current, previous.digest, 'mission-runtime', `Enroll the ${seatLabel} seat for ${seat}`)
      this.disk = { current, revisions: [...disk.revisions, revision] }
      try {
        await this.persist()
      } catch (error) {
        this.disk = disk
        throw error
      }
      await this.audit({
        action: 'enterprise.agent.enroll',
        outcome: 'ok',
        target: principalId,
        detail: `Native per-agent identity for the ${seatLabel} seat on ${seat}`,
        metadata: { revision: current.revision }
      })
      return principalId
    })
  }

  async revision(revisionNumber: number): Promise<{ info: EnterpriseRevisionInfo; state: EnterpriseControlState }> {
    await this.init()
    const revision = (this.disk as EnterpriseDiskState).revisions.find((candidate) => candidate.revision === revisionNumber)
    if (!revision) throw new Error(`Revision ${revisionNumber} does not exist.`)
    const { state, previousDigest: _previous, signature: _signature, ...info } = revision
    return { info: { ...info }, state: clone(state) }
  }
}
