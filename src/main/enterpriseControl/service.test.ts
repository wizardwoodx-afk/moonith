import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  LOCAL_OWNER_PRINCIPAL_ID,
  type EnterpriseControlState
} from '../../shared/enterpriseControl'
import { authorizeEnterprise, createDefaultEnterpriseState, nativeAgentPrincipalId, nativeToolAction } from './policy'
import { EnterpriseControlService } from './service'
import { deriveSealKey } from '../audit/chain'

const KEY = deriveSealKey('enterprise-control-test-key')
let directory = ''
let file = ''
let now = Date.parse('2026-10-24T00:00:00.000Z')

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'selfimpulse-enterprise-'))
  file = join(directory, 'control-plane.json')
  now = Date.parse('2026-10-24T00:00:00.000Z')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

const service = (): EnterpriseControlService =>
  new EnterpriseControlService({ file, loadKey: async () => KEY, now: () => (now += 1000) })

const agentRequest = (team = 'team.alpha', seat = 'researcher') => ({
  principalId: nativeAgentPrincipalId(team, seat),
  action: 'mission.run' as const,
  resource: { kind: 'mission' as const, namespaceId: 'default', id: 'mission-1' }
})

describe('native Enterprise Control Plane policy', () => {
  it('starts default-deny while granting the local recovery owner', () => {
    const state = createDefaultEnterpriseState(0)
    expect(
      authorizeEnterprise(state, {
        principalId: LOCAL_OWNER_PRINCIPAL_ID,
        action: 'enterprise.manage',
        resource: { kind: 'enterprise', namespaceId: 'default', id: 'control-plane' }
      }).allowed
    ).toBe(true)
    expect(authorizeEnterprise(state, agentRequest()).allowed).toBe(false)
    expect(nativeToolAction('remember').action).toBe('memory.write')
    expect(nativeToolAction('recall_memory').action).toBe('memory.read')
    expect(nativeToolAction('run_command')).toEqual({ action: 'tool.use', kind: 'tool', resourceId: 'run_command' })
  })
})

describe('native Enterprise Control Plane persistence and enforcement', () => {
  it('enrolls per-agent identities once and enforces deny-overriding Restrictions', async () => {
    const control = service()
    const principalId = await control.ensureAgentPrincipal('team.alpha', 'researcher', 'Researcher')
    expect(principalId).toBe(agentRequest().principalId)
    expect((await control.authorize(agentRequest())).allowed).toBe(true)
    expect(
      (
        await control.authorize({
          ...agentRequest(),
          action: 'approval.decide',
          resource: { kind: 'approval', namespaceId: 'default', id: 'approval-1' }
        })
      ).allowed
    ).toBe(false)

    const beforeDeny = await control.snapshot()
    const deniedState = await control.mutate({
      expectedRevision: beforeDeny.state.revision,
      reason: 'Block this agent from running missions',
      operation: {
        type: 'restriction.upsert',
        restriction: {
          id: 'restriction:researcher-run',
          namespaceId: 'default',
          principalId,
          name: 'Researcher mission freeze',
          actions: ['mission.run'],
          resource: { kind: 'mission', namespaceId: 'default' }
        }
      }
    })
    const denied = await control.authorize(agentRequest())
    expect(denied.allowed).toBe(false)
    expect(denied.deniedBy).toEqual(['restriction:researcher-run'])
    expect(denied.grantedBy.length).toBeGreaterThan(0)

    // Re-enrollment is idempotent and cannot silently repair a revoked grant.
    await control.ensureAgentPrincipal('team.alpha', 'researcher', 'Researcher')
    expect((await control.snapshot()).state.revision).toBe(deniedState.state.revision)
    expect((await control.authorize(agentRequest())).allowed).toBe(false)

    const enabled = await control.mutate({
      expectedRevision: deniedState.state.revision,
      reason: 'Temporarily disable the freeze',
      operation: {
        type: 'lifecycle.set',
        kind: 'restriction',
        id: 'restriction:researcher-run',
        lifecycle: 'disabled'
      }
    })
    expect((await control.authorize(agentRequest())).allowed).toBe(true)

    // Restore the denied revision as a NEW revision; history is not rewritten.
    const restored = await control.mutate({
      expectedRevision: enabled.state.revision,
      reason: 'Restore the enforced freeze',
      operation: { type: 'revision.restore', revision: deniedState.state.revision }
    })
    expect(restored.state.revision).toBe(enabled.state.revision + 1)
    expect(restored.revisions[0].revision).toBe(restored.state.revision)
    expect((await control.authorize(agentRequest())).allowed).toBe(false)

    // A fresh service reads the same native disk state and digest chain.
    const reopened = service()
    expect((await reopened.snapshot()).state.revision).toBe(restored.state.revision)
    expect((await reopened.authorize(agentRequest())).allowed).toBe(false)
  })

  it('applies tool Restrictions to the exact resource only', async () => {
    const control = service()
    const principalId = await control.ensureAgentPrincipal('captain', 'task-1', 'Captain · task-1')
    const snapshot = await control.snapshot()
    await control.mutate({
      expectedRevision: snapshot.state.revision,
      reason: 'Block shell execution for this Captain',
      operation: {
        type: 'restriction.upsert',
        restriction: {
          id: 'restriction:no-shell',
          namespaceId: 'default',
          principalId,
          name: 'No shell',
          actions: ['tool.use'],
          resource: { kind: 'tool', namespaceId: 'default', id: 'run_command' }
        }
      }
    })
    const request = {
      principalId,
      action: 'tool.use' as const,
      resource: { kind: 'tool' as const, namespaceId: 'default', id: 'run_command' }
    }
    expect((await control.authorize(request)).allowed).toBe(false)
    expect((await control.authorize({ ...request, resource: { ...request.resource, id: 'read_file' } })).allowed).toBe(true)
  })

  it('supports isolated namespace policy without hard-isolation claims', async () => {
    const control = service()
    let snapshot = await control.snapshot()
    snapshot = await control.mutate({
      expectedRevision: snapshot.state.revision,
      reason: 'Create research namespace',
      operation: { type: 'namespace.create', namespace: { id: 'research', name: 'Research' } }
    })
    const request = {
      principalId: LOCAL_OWNER_PRINCIPAL_ID,
      action: 'mission.run' as const,
      resource: { kind: 'mission' as const, namespaceId: 'research', id: 'm-1' }
    }
    expect((await control.authorize(request)).allowed).toBe(false)

    snapshot = await control.mutate({
      expectedRevision: snapshot.state.revision,
      reason: 'Define research runner Role',
      operation: {
        type: 'role.upsert',
        role: {
          id: 'role:research-runner',
          namespaceId: 'research',
          name: 'Research runner',
          actions: ['mission.run'],
          resourceKinds: ['mission']
        }
      }
    })
    snapshot = await control.mutate({
      expectedRevision: snapshot.state.revision,
      reason: 'Bind owner inside research only',
      operation: {
        type: 'binding.upsert',
        binding: {
          id: 'binding:research-owner',
          namespaceId: 'research',
          principalId: LOCAL_OWNER_PRINCIPAL_ID,
          roleId: 'role:research-runner',
          resource: { kind: 'mission', namespaceId: 'research' }
        }
      }
    })
    expect((await control.authorize(request)).allowed).toBe(true)
    expect(
      (
        await control.authorize({
          ...request,
          resource: { ...request.resource, namespaceId: 'default' }
        })
      ).allowed
    ).toBe(true) // the original default owner grant remains independent
    expect((await control.snapshot()).security.isolation).toContain('does not claim')
  })

  it('migrates a valid legacy unsigned chain once and then enforces signatures', async () => {
    const control = service()
    await control.snapshot()
    await control.ensureAgentPrincipal('team.alpha', 'researcher', 'Researcher')
    const legacy = JSON.parse(await readFile(file, 'utf8')) as {
      revisions: Array<{ signature?: string }>
      head?: unknown
    }
    for (const revision of legacy.revisions) delete revision.signature
    delete legacy.head
    await writeFile(file, JSON.stringify(legacy), 'utf8')
    const migrated = service()
    await migrated.snapshot()
    const signed = JSON.parse(await readFile(file, 'utf8')) as {
      revisions: Array<{ signature?: string }>
      head?: { signature?: string }
    }
    expect(signed.revisions.every((revision) => Boolean(revision.signature))).toBe(true)
    expect(signed.head?.signature).toBeTruthy()
    await expect(service().snapshot()).resolves.toBeDefined()
  })

  it('rejects forged signatures and truncation against the signed head', async () => {
    const control = service()
    await control.snapshot()
    await control.ensureAgentPrincipal('team.alpha', 'researcher', 'Researcher')
    const persisted = JSON.parse(await readFile(file, 'utf8')) as {
      current: EnterpriseControlState
      revisions: Array<{ signature: string; state: EnterpriseControlState }>
      head: { revision: number }
    }
    expect(persisted.revisions.every((revision) => revision.signature)).toBe(true)
    expect(persisted.head.revision).toBe(2)

    const originalSignature = persisted.revisions[0].signature
    persisted.revisions[0].signature = '0'.repeat(64)
    await writeFile(file, JSON.stringify(persisted), 'utf8')
    await expect(service().snapshot()).rejects.toThrow('signature mismatch')

    persisted.revisions[0].signature = originalSignature
    persisted.revisions.pop()
    persisted.current = persisted.revisions[persisted.revisions.length - 1].state
    await writeFile(file, JSON.stringify(persisted), 'utf8')
    await expect(service().snapshot()).rejects.toThrow('signed revision head')
  })

  it('rejects stale writes, recovery-owner lockout, and corrupted storage', async () => {
    const control = service()
    const snapshot = await control.snapshot()
    await expect(
      control.mutate({
        expectedRevision: snapshot.state.revision - 1,
        reason: 'Stale write',
        operation: {
          type: 'namespace.create',
          namespace: { id: 'stale', name: 'Stale' }
        }
      })
    ).rejects.toThrow('Revision conflict')

    await expect(
      control.mutate({
        expectedRevision: snapshot.state.revision,
        reason: 'Attempt recovery lockout',
        operation: {
          type: 'restriction.upsert',
          restriction: {
            id: 'restriction:lockout',
            namespaceId: 'default',
            principalId: LOCAL_OWNER_PRINCIPAL_ID,
            name: 'Lockout',
            actions: ['enterprise.manage'],
            resource: { kind: 'enterprise', namespaceId: 'default' }
          }
        }
      })
    ).rejects.toThrow("recovery owner's control-plane access")
    expect((await control.snapshot()).state.revision).toBe(snapshot.state.revision)

    const persisted = JSON.parse(await readFile(file, 'utf8')) as { current: EnterpriseControlState }
    expect(persisted.current.revision).toBe(1)
    await writeFile(file, '{not json', 'utf8')
    await expect(service().snapshot()).rejects.toThrow('refusing to replace it with defaults')
    expect(await readFile(file, 'utf8')).toBe('{not json')
  })
})
