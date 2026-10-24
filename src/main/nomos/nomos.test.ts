import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { GovernanceGate } from './gate'
import { GovernanceJournal } from './journal'
import { IdentityRegistry } from './identity'
import { KillSwitch, memoryKillSwitchStore } from './kill'
import { TrustEngine } from './trust'
import { ALL_CAPABILITIES, type GovernanceRequest, type GovernanceJournalSink, type GovernanceRecord } from './types'
import { capabilityForTool, type PolicyRule } from './policy'
import { crewAgentId } from './index'

function setup(): { gate: GovernanceGate; identities: IdentityRegistry; trust: TrustEngine } {
  const identities = new IdentityRegistry()
  identities.registerPrincipal({
    id: 'local-user',
    kind: 'user',
    displayName: 'The local owner',
    createdAt: '2026-10-24T00:00:00.000Z'
  })
  identities.registerAgent({
    agentId: 'Captain',
    principalId: 'local-user',
    displayName: 'Captain',
    scopes: [...ALL_CAPABILITIES]
  })
  const trust = new TrustEngine()
  const gate = new GovernanceGate({ identities, trust, kill: new KillSwitch() })
  return { gate, identities, trust }
}

function request(overrides: Partial<GovernanceRequest> = {}): GovernanceRequest {
  return {
    ids: {
      runId: 'run_1',
      taskId: 'task_1',
      actionId: 'act_1',
      agentId: 'Captain',
      principalId: 'local-user'
    },
    tool: 'read_file',
    args: { path: 'notes.md' },
    sideEffect: 'read',
    risk: 'low',
    approval: 'never',
    permissionMode: 'auto',
    ...overrides
  }
}

describe('the default allow', () => {
  it('allows a low-risk read for a known agent holding the capability', () => {
    const { gate } = setup()
    const decision = gate.govern(request())
    expect(decision.decision).toBe('allow')
    expect(decision.rule).toBe('nomos-default-allow')
    expect(decision.capability).toBe('fs.read')
  })

  it('names the capability a tool requires', () => {
    expect(capabilityForTool('run_command', 'execute')).toBe('shell.exec')
    expect(capabilityForTool('delete_path', 'write')).toBe('fs.delete')
    expect(capabilityForTool('some_mcp_tool', 'network')).toBe('tool.other')
    /* studio_commands spawns an external CLI; it is never a read, even if a
     * caller mislabels the side effect. */
    expect(capabilityForTool('studio_commands', 'execute')).toBe('shell.exec')
    expect(capabilityForTool('studio_commands', 'read')).toBe('shell.exec')
  })
})

describe('hard denials', () => {
  it('denies an agent with no registered identity', () => {
    const { gate } = setup()
    const decision = gate.govern(request({ ids: { ...request().ids, agentId: 'ghost' } }))
    expect(decision.decision).toBe('deny')
    expect(decision.rule).toBe('nomos-identity-unknown')
  })

  it('denies an action whose capability the agent does not hold', () => {
    const { gate, identities } = setup()
    const delegated = identities.delegateAgent('Captain', {
      agentId: 'crew:scout',
      displayName: 'Docs Scout',
      requested: ['fs.read', 'net.fetch']
    })
    expect(delegated.ok).toBe(true)
    const decision = gate.govern(
      request({
        ids: { ...request().ids, agentId: 'crew:scout' },
        tool: 'run_command',
        args: { command: 'rm -rf build' },
        sideEffect: 'execute',
        risk: 'high',
        approval: 'always'
      })
    )
    expect(decision.decision).toBe('deny')
    expect(decision.rule).toBe('nomos-capability-not-granted')
  })

  it('denies an unknown tool class for a delegated seat (default-deny)', () => {
    const { gate, identities } = setup()
    identities.delegateAgent('Captain', {
      agentId: 'crew:scout',
      displayName: 'Docs Scout',
      requested: ['fs.read']
    })
    const decision = gate.govern(
      request({
        ids: { ...request().ids, agentId: 'crew:scout' },
        tool: 'mcp__some_server__do_thing',
        sideEffect: 'network',
        risk: 'medium',
        approval: 'policy'
      })
    )
    expect(decision.decision).toBe('deny')
    expect(decision.rule).toBe('nomos-capability-not-granted')
  })

  it('denies a revoked agent mid-run', () => {
    const { gate, identities } = setup()
    identities.revokeAgent('Captain', 'operator stopped the session')
    const decision = gate.govern(request())
    expect(decision.decision).toBe('deny')
    expect(decision.rule).toBe('nomos-identity-revoked')
    expect(decision.reason).toContain('operator stopped the session')
  })
})

describe('the kill switch', () => {
  it('denies every action while engaged, then allows again after release', () => {
    const { gate } = setup()
    gate.engageKill('suspected runaway loop', 'local-user')
    const denied = gate.govern(request())
    expect(denied.decision).toBe('deny')
    expect(denied.rule).toBe('nomos-kill-switch')
    expect(denied.reason).toContain('suspected runaway loop')

    gate.releaseKill('local-user')
    expect(gate.govern(request()).decision).toBe('allow')
  })

  it('persists across a restart', () => {
    const store = memoryKillSwitchStore()
    const first = new GovernanceGate({ kill: new KillSwitch(store) })
    first.engageKill('incident 42', 'local-user')
    const second = new GovernanceGate({ kill: new KillSwitch(store) })
    expect(second.kill.engaged).toBe(true)
    expect(second.killState().reason).toBe('incident 42')
  })
})

describe('fail-closed policy evaluation', () => {
  it('denies when a rule throws (the engine is unavailable)', () => {
    const broken: PolicyRule = () => {
      throw new Error('rule database unreachable')
    }
    const { gate } = setup()
    const failing = new GovernanceGate({
      identities: gate.identities,
      trust: gate.trust,
      kill: gate.kill,
      rules: [broken]
    })
    const decision = failing.govern(request())
    expect(decision.decision).toBe('deny')
    expect(decision.rule).toBe('nomos-policy-engine-unavailable')
    expect(decision.reason).toContain('rule database unreachable')
  })

  it('denies when a rule returns a malformed decision', () => {
    const malformed = (() => ({ decision: 'yolo', rule: '' })) as unknown as PolicyRule
    const { gate } = setup()
    const failing = new GovernanceGate({
      identities: gate.identities,
      trust: gate.trust,
      kill: gate.kill,
      rules: [malformed]
    })
    const decision = failing.govern(request())
    expect(decision.decision).toBe('deny')
    expect(decision.rule).toBe('nomos-policy-malformed-decision')
  })
})

describe('trust is a signal, never an authority', () => {
  it('steers a high-risk action even at maximum trust', () => {
    const { gate, trust } = setup()
    for (let i = 0; i < 100; i += 1) trust.recordSuccess('Captain')
    expect(trust.view('Captain').band).toBe('established')
    const decision = gate.govern(
      request({ tool: 'run_command', args: { command: 'ls' }, sideEffect: 'execute', risk: 'high', approval: 'always' })
    )
    expect(decision.decision).toBe('steer')
    expect(decision.rule).toBe('nomos-high-risk-requires-human')
  })

  it('steers a policy action when trust is low', () => {
    const { gate, trust } = setup()
    for (let i = 0; i < 10; i += 1) trust.recordFailure('Captain')
    expect(trust.view('Captain').band).toBe('low')
    const decision = gate.govern(
      request({ tool: 'web_fetch', args: { url: 'https://example.com' }, sideEffect: 'network', risk: 'medium', approval: 'policy' })
    )
    expect(decision.decision).toBe('steer')
    expect(decision.rule).toBe('nomos-policy-approval')
  })

  it('does not steer a policy action at neutral trust in auto mode', () => {
    const { gate } = setup()
    const decision = gate.govern(
      request({ tool: 'web_fetch', args: { url: 'https://example.com' }, sideEffect: 'network', risk: 'medium', approval: 'policy' })
    )
    expect(decision.decision).toBe('allow')
  })

  it('records a denial against the agent that attempted it', () => {
    const { gate, trust } = setup()
    const before = trust.score('Captain')
    gate.govern(request({ tool: 'run_command', args: {}, sideEffect: 'execute', risk: 'high', approval: 'always', ids: { ...request().ids, agentId: 'Captain' } }))
    // high risk steers, not denies — trust must not move for a lawful ask
    expect(trust.score('Captain')).toBe(before)
    gate.govern(request({ ids: { ...request().ids, agentId: 'ghost' } }))
    expect(trust.score('ghost')).toBeLessThan(before)
  })
})

describe('delegation narrows, never widens', () => {
  it('refuses a capability the parent does not hold', () => {
    const { gate, identities } = setup()
    identities.delegateAgent('Captain', {
      agentId: 'crew:reader',
      displayName: 'Reader',
      requested: ['fs.read']
    })
    const escaped = identities.delegateAgent('crew:reader', {
      agentId: 'crew:writer',
      displayName: 'Writer',
      requested: ['fs.write']
    })
    expect(escaped.ok).toBe(false)
    if (!escaped.ok) expect(escaped.reason).toContain('never be wider')
  })

  it('refuses an unknown capability string', () => {
    const { identities } = setup()
    const result = identities.delegateAgent('Captain', {
      agentId: 'crew:magic',
      displayName: 'Magic',
      requested: ['fs.everything' as never]
    })
    expect(result.ok).toBe(false)
  })

  it('lets a seat vary within its delegation grant, never past it', () => {
    const { gate, identities } = setup()
    identities.delegateAgent('Captain', {
      agentId: 'crew:x',
      displayName: 'X',
      requested: ['fs.read', 'net.fetch']
    })
    const narrowed = identities.updateScopes('crew:x', ['fs.read'])
    expect(narrowed.ok).toBe(true)
    const escaped = identities.updateScopes('crew:x', ['shell.exec'])
    expect(escaped.ok).toBe(false)
    // and the gate sees the refreshed scopes
    expect(
      gate.govern(
        request({
          ids: { ...request().ids, agentId: 'crew:x' },
          tool: 'web_fetch',
          args: { url: 'https://x.dev' },
          sideEffect: 'network',
          risk: 'medium',
          approval: 'policy'
        })
      ).decision
    ).toBe('deny')
    expect(
      gate.govern(
        request({
          ids: { ...request().ids, agentId: 'crew:x' },
          tool: 'read_file',
          args: { path: 'a.md' },
          sideEffect: 'read',
          risk: 'low',
          approval: 'never'
        })
      ).decision
    ).toBe('allow')
  })
})

describe('the decision record', () => {
  it('records the decision with its ids and annotations', async () => {
    const appended: GovernanceRecord[] = []
    const sink: GovernanceJournalSink = { append: (record) => void appended.push(record) }
    const { gate } = setup()
    const recording = new GovernanceGate({
      identities: gate.identities,
      trust: gate.trust,
      kill: gate.kill,
      journal: sink
    })
    const decision = await recording.governAwait(request())
    expect(appended).toHaveLength(1)
    expect(appended[0].actionId).toBe('act_1')
    expect(appended[0].decision).toBe('allow')

    recording.recordApproval('act_1', 'local-user')
    recording.recordOutcome('act_1', 'success')
    const record = recording.recent(1)[0]
    expect(record.approvedBy).toBe('local-user')
    expect(record.outcome).toBe('success')
    expect(decision.actionId).toBe('act_1')
  })

  it('summarises the session honestly', () => {
    const { gate } = setup()
    gate.govern(request({ actionId: 'a1' } as never))
    gate.govern(request({ ids: { ...request().ids, actionId: 'a2' }, tool: 'run_command', args: {}, sideEffect: 'execute', risk: 'high', approval: 'always' }))
    gate.govern(request({ ids: { ...request().ids, actionId: 'a3', agentId: 'ghost' } }))
    const summary = gate.summary()
    expect(summary.allow).toBe(1)
    expect(summary.steer).toBe(1)
    expect(summary.deny).toBe(1)
    expect(summary.outcomes.denied).toBe(1)
  })

  it('does not move the trust of a phantom agent for an evicted record', () => {
    const { gate, trust } = setup()
    const success = vi.spyOn(trust, 'recordSuccess')
    const failure = vi.spyOn(trust, 'recordFailure')
    /* No record with this id: an evicted (ring-trimmed) or unknown action.
     * The old code called recordSuccess('') / recordFailure('') here. */
    gate.recordOutcome('act_unknown', 'success')
    gate.recordOutcome('act_unknown', 'failure')
    expect(success).not.toHaveBeenCalled()
    expect(failure).not.toHaveBeenCalled()
    expect(trust.view('').agentId).toBe('')
  })
})

describe('the durable decision journal', () => {
  it('governAwait resolves only after the append has settled', async () => {
    let release: () => void = () => {
      throw new Error('the append was never called')
    }
    const appended: GovernanceRecord[] = []
    const sink: GovernanceJournalSink = {
      append: (record) => {
        appended.push(record)
        return new Promise<void>((resolve) => {
          release = resolve
        })
      }
    }
    const { gate } = setup()
    const recording = new GovernanceGate({
      identities: gate.identities,
      trust: gate.trust,
      kill: gate.kill,
      journal: sink
    })
    let settled = false
    const pending = recording.governAwait(request()).then((decision) => {
      settled = true
      return decision
    })
    await Promise.resolve()
    expect(appended).toHaveLength(1)
    expect(settled).toBe(false)
    release()
    const decision = await pending
    expect(settled).toBe(true)
    expect(decision.decision).toBe('allow')
  })

  it('writes the decision to disk before governAwait resolves', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nomos-journal-'))
    try {
      const file = join(dir, 'nomos', 'governance.jsonl')
      const { gate } = setup()
      const recording = new GovernanceGate({
        identities: gate.identities,
        trust: gate.trust,
        kill: gate.kill,
        journal: new GovernanceJournal(file)
      })
      await recording.governAwait(request())
      const lines = readFileSync(file, 'utf8').trim().split('\n')
      expect(lines).toHaveLength(1)
      expect(JSON.parse(lines[0]).actionId).toBe('act_1')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails CLOSED when the decision cannot be written to disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nomos-journal-broken-'))
    try {
      /* A directory where the journal file should be: every append fails. */
      const file = join(dir, 'nomos', 'governance.jsonl')
      mkdirSync(file, { recursive: true })
      const { gate } = setup()
      const recording = new GovernanceGate({
        identities: gate.identities,
        trust: gate.trust,
        kill: gate.kill,
        journal: new GovernanceJournal(file)
      })
      const decision = await recording.governAwait(request())
      expect(decision.decision).toBe('deny')
      expect(decision.rule).toBe('nomos-journal-unavailable')
      expect(decision.reason).toContain('could not be written')
      /* The in-memory record agrees with what the caller was told. */
      expect(recording.recent(1)[0].decision).toBe('deny')
      expect(recording.recent(1)[0].outcome).toBe('denied')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('crew identity', () => {
  it('keeps two distinct names that normalise alike on distinct ids', () => {
    const a = crewAgentId('Docs Scout')
    const b = crewAgentId('Docs-Scout')
    const c = crewAgentId('docs_scout')
    expect(new Set([a, b, c]).size).toBe(3)
    /* Readable, still prefixed as a Crew seat. */
    expect(a.startsWith('crew:docs-scout-')).toBe(true)
  })

  it('is stable for the same name, so re-delegation replaces the same seat', () => {
    expect(crewAgentId('Docs Scout')).toBe(crewAgentId('Docs Scout'))
    expect(crewAgentId('  Docs Scout  ')).toBe(crewAgentId('Docs Scout'))
  })

  it('revokes and forgets a seat, and both are visible at the gate', () => {
    const { gate, identities } = setup()
    const seat = crewAgentId('scout')
    expect(
      identities.delegateAgent('Captain', { agentId: seat, displayName: 'scout', requested: ['fs.read'] }).ok
    ).toBe(true)
    expect(identities.revokeAgent(seat, 'seat retired').ok).toBe(true)
    const revoked = gate.govern(
      request({ ids: { ...request().ids, agentId: seat } })
    )
    expect(revoked.decision).toBe('deny')
    expect(revoked.rule).toBe('nomos-identity-revoked')

    identities.forgetAgent(seat)
    expect(identities.getAgent(seat)).toBeUndefined()
    const forgotten = gate.govern(request({ ids: { ...request().ids, agentId: seat } }))
    expect(forgotten.decision).toBe('deny')
    expect(forgotten.rule).toBe('nomos-identity-unknown')
  })
})
