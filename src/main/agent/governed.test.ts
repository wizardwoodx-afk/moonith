import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GovernanceGate } from '../nomos/gate'
import { GovernanceJournal } from '../nomos/journal'
import { IdentityRegistry } from '../nomos/identity'
import { KillSwitch } from '../nomos/kill'
import { TrustEngine } from '../nomos/trust'
import { ALL_CAPABILITIES, type ActionIds, type GovernanceDecision, type GovernanceJournalSink } from '../nomos/types'
import { crewAgentId } from '../nomos'
import { ReceiptService } from '../sphragis/service'
import { ephemeralSigner } from '../sphragis/signer'
import { newId } from '../util'
import { captainActionIds, executeGovernedTool, registerCrewSeat } from './governed'
import type { AgentTool, ToolContext } from './tools/types'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'governed-'))
  file = join(dir, 'receipts.jsonl')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** A gate with the production identities: the local owner, and the Captain
 *  holding every capability. Injected deps keep the production singletons
 *  (and Electron) out of the test entirely. */
function setup(): {
  gate: GovernanceGate
  identities: IdentityRegistry
  receipts: ReceiptService
  file: string
} {
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
  const gate = new GovernanceGate({ identities, trust: new TrustEngine(), kill: new KillSwitch() })
  const receipts = new ReceiptService({ signer: ephemeralSigner(), file })
  return { gate, identities, receipts, file }
}

function ids(overrides: Partial<ActionIds> = {}): ActionIds {
  return {
    runId: 'run_1',
    taskId: 'task_1',
    actionId: newId('act'),
    agentId: 'Captain',
    principalId: 'local-user',
    ...overrides
  }
}

/** A fake AgentTool. `behaviour` is what execute does; the caller observes
 *  it through a closure. */
function fakeTool(
  spec: {
    name: string
    sideEffect?: AgentTool['sideEffect']
    risk?: AgentTool['risk']
    approval?: AgentTool['approval']
  },
  behaviour: () => Promise<{ content: string; isError?: boolean }>
): AgentTool {
  return {
    name: spec.name,
    title: spec.name,
    description: 'a fake tool',
    inputSchema: {},
    sideEffect: spec.sideEffect ?? 'read',
    risk: spec.risk ?? 'low',
    approval: spec.approval ?? 'never',
    execute: behaviour
  }
}

function runCommandTool(behaviour: () => Promise<{ content: string; isError?: boolean }>): AgentTool {
  return fakeTool({ name: 'run_command', sideEffect: 'execute', risk: 'high', approval: 'always' }, behaviour)
}

function readFileTool(behaviour: () => Promise<{ content: string; isError?: boolean }>): AgentTool {
  return fakeTool({ name: 'read_file', sideEffect: 'read', risk: 'low', approval: 'never' }, behaviour)
}

function writeFileTool(behaviour: () => Promise<{ content: string; isError?: boolean }>): AgentTool {
  return fakeTool({ name: 'write_file', sideEffect: 'write', risk: 'medium', approval: 'policy' }, behaviour)
}

describe('the governed execution path', () => {
  it('mints Captain ids for the local owner', () => {
    const minted = captainActionIds('task_1', 'run_1')
    expect(minted.agentId).toBe('Captain')
    expect(minted.principalId).toBe('local-user')
    expect(minted.runId).toBe('run_1')
    expect(minted.taskId).toBe('task_1')
    expect(minted.actionId).toMatch(/^act_/)
  })

  describe('a denied tool has zero side effects', () => {
    it('never executes for an agent with no registered identity', async () => {
      const { gate, receipts } = setup()
      const calls: string[] = []
      const target = join(dir, 'side-effect.txt')
      const tool = fakeTool({ name: 'write_file', sideEffect: 'write', risk: 'medium', approval: 'policy' }, async () => {
        calls.push('execute')
        writeFileSync(target, 'written', 'utf8')
        return { content: 'wrote the file' }
      })

      const result = await executeGovernedTool({
        tool,
        args: { path: target },
        rawArgs: { path: target },
        ctx: {} as ToolContext,
        ids: ids({ agentId: 'ghost' }),
        deps: { gate, receipts }
      })

      expect(result.decision).toBe('deny')
      expect(result.rule).toBe('nomos-identity-unknown')
      expect(result.executed).toBe(false)
      expect(result.isError).toBe(true)
      expect(result.content).toContain('Blocked by the governance gate (nomos-identity-unknown)')
      expect(calls).toEqual([])
      expect(existsSync(target)).toBe(false)
      expect(gate.recent(1)[0].outcome).toBe('denied')
    })

    it('never executes for a revoked agent', async () => {
      const { gate, identities, receipts } = setup()
      identities.revokeAgent('Captain', 'operator stopped the session')
      const calls: string[] = []
      const tool = readFileTool(async () => {
        calls.push('execute')
        return { content: 'contents' }
      })

      const result = await executeGovernedTool({
        tool,
        args: { path: 'a.md' },
        rawArgs: { path: 'a.md' },
        ctx: {} as ToolContext,
        ids: ids({ agentId: 'Captain' }),
        deps: { gate, receipts }
      })

      expect(result.decision).toBe('deny')
      expect(result.rule).toBe('nomos-identity-revoked')
      expect(result.executed).toBe(false)
      expect(calls).toEqual([])
    })
  })

  it('executes an allowed tool exactly once and records the success', async () => {
    const { gate, receipts } = setup()
    const calls: number[] = []
    const tool = readFileTool(async () => {
      calls.push(1)
      return { content: 'file contents' }
    })

    const result = await executeGovernedTool({
      tool,
      args: { path: 'notes.md' },
      rawArgs: { path: 'notes.md' },
      ctx: {} as ToolContext,
      ids: ids(),
      permissionMode: 'auto',
      deps: { gate, receipts }
    })

    expect(result.decision).toBe('allow')
    expect(result.rule).toBe('nomos-default-allow')
    expect(result.executed).toBe(true)
    expect(result.isError).toBe(false)
    expect(result.content).toBe('file contents')
    expect(calls).toHaveLength(1)
    const record = gate.recent(1)[0]
    expect(record.outcome).toBe('success')
    expect(record.approvedBy).toBeNull()
  })

  describe('a steered tool', () => {
    it('does not execute when the human declines', async () => {
      const { gate, receipts } = setup()
      const calls: number[] = []
      const tool = runCommandTool(async () => {
        calls.push(1)
        return { content: 'ran' }
      })

      const result = await executeGovernedTool({
        tool,
        args: { command: 'ls' },
        rawArgs: { command: 'ls' },
        ctx: {} as ToolContext,
        ids: ids(),
        permissionMode: 'auto',
        onSteer: async () => false,
        deps: { gate, receipts }
      })

      expect(result.decision).toBe('steer')
      expect(result.rule).toBe('nomos-high-risk-requires-human')
      expect(result.executed).toBe(false)
      expect(result.isError).toBe(true)
      expect(calls).toEqual([])
      // Nothing was authorized, so nothing was attested either.
      expect(receipts.recent()).toEqual([])
    })

    it('executes when the human approves, and records the approval', async () => {
      const { gate, receipts } = setup()
      const calls: number[] = []
      const seen: GovernanceDecision[] = []
      const tool = runCommandTool(async () => {
        calls.push(1)
        return { content: 'ran' }
      })

      const result = await executeGovernedTool({
        tool,
        args: { command: 'ls' },
        rawArgs: { command: 'ls' },
        ctx: {} as ToolContext,
        ids: ids(),
        permissionMode: 'auto',
        onSteer: async (decision) => {
          seen.push(decision)
          return true
        },
        deps: { gate, receipts }
      })

      expect(result.executed).toBe(true)
      expect(result.decision).toBe('steer')
      expect(calls).toHaveLength(1)
      expect(seen).toHaveLength(1)
      const record = gate.recent(1)[0]
      expect(record.approvedBy).toBe('human')
      expect(record.outcome).toBe('success')
    })
  })

  describe('the receipt barrier', () => {
    it('mints the intent before the effect and the result after', async () => {
      const { gate, receipts, file } = setup()
      const log: string[] = []
      const tool = runCommandTool(async () => {
        const minted = existsSync(file)
          ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).length
          : 0
        log.push(`effect with ${minted} receipt(s) already minted`)
        return { content: 'ran' }
      })

      const result = await executeGovernedTool({
        tool,
        args: { command: 'npm test' },
        rawArgs: { command: 'npm test' },
        ctx: {} as ToolContext,
        ids: ids(),
        permissionMode: 'auto',
        onSteer: async () => true,
        deps: { gate, receipts }
      })

      expect(result.executed).toBe(true)
      // The intent was durably minted before the effect ran.
      expect(log).toEqual(['effect with 1 receipt(s) already minted'])
      const entries = await ReceiptService.read(file)
      expect(entries.map((entry) => entry.kind)).toEqual(['intent', 'result'])
      expect(entries[0].ids.actionId).toBe(result.actionId)
      expect(entries[0].action).toBe('shell.exec')
      expect(entries[0].authorization.approvedBy).toBe('human')
      expect(entries[1].outcome).toBe('success')
    })

    it('mints no receipts for a low-risk read', async () => {
      const { gate, receipts, file } = setup()
      const result = await executeGovernedTool({
        tool: readFileTool(async () => ({ content: 'contents' })),
        args: { path: 'a.md' },
        rawArgs: { path: 'a.md' },
        ctx: {} as ToolContext,
        ids: ids(),
        permissionMode: 'auto',
        deps: { gate, receipts }
      })

      expect(result.executed).toBe(true)
      expect(receipts.recent()).toEqual([])
      expect(existsSync(file)).toBe(false)
    })
  })

  describe('a Crew seat', () => {
    it('is denied a capability it was not delegated', async () => {
      const { gate, receipts } = setup()
      const seat = registerCrewSeat(
        'docs scout',
        [readFileTool(async () => ({ content: 'contents' })), fakeTool({ name: 'list_files' }, async () => ({ content: 'files' }))],
        { gate, receipts }
      )
      expect(seat.ok).toBe(true)
      if (!seat.ok) return
      /* Readable, and collision-safe: the slug plus a digest of the name. */
      expect(seat.agentId).toBe(crewAgentId('docs scout'))
      expect(seat.agentId).toMatch(/^crew:docs-scout-[0-9a-f]{8}$/)

      const calls: number[] = []
      const result = await executeGovernedTool({
        tool: writeFileTool(async () => {
          calls.push(1)
          return { content: 'wrote' }
        }),
        args: { path: 'a.md', content: 'x' },
        rawArgs: { path: 'a.md', content: 'x' },
        ctx: {} as ToolContext,
        ids: ids({ agentId: seat.agentId }),
        permissionMode: 'auto',
        deps: { gate, receipts }
      })

      expect(result.decision).toBe('deny')
      expect(result.rule).toBe('nomos-capability-not-granted')
      expect(result.executed).toBe(false)
      expect(calls).toEqual([])
    })

    it('runs the tools it was delegated', async () => {
      const { gate, receipts } = setup()
      const seat = registerCrewSeat('scout', [readFileTool(async () => ({ content: 'contents' }))], {
        gate,
        receipts
      })
      expect(seat.ok).toBe(true)
      if (!seat.ok) return

      const calls: number[] = []
      const result = await executeGovernedTool({
        tool: readFileTool(async () => {
          calls.push(1)
          return { content: 'contents' }
        }),
        args: { path: 'a.md' },
        rawArgs: { path: 'a.md' },
        ctx: {} as ToolContext,
        ids: ids({ agentId: seat.agentId }),
        permissionMode: 'auto',
        deps: { gate, receipts }
      })

      expect(result.decision).toBe('allow')
      expect(result.executed).toBe(true)
      expect(calls).toHaveLength(1)
    })
  })

  it('turns a throwing tool into a failure receipt, not a thrown error', async () => {
    const { gate, receipts, file } = setup()
    const tool = runCommandTool(async () => {
      throw new Error('disk on fire')
    })

    const result = await executeGovernedTool({
      tool,
      args: { command: 'false' },
      rawArgs: { command: 'false' },
      ctx: {} as ToolContext,
      ids: ids(),
      permissionMode: 'auto',
      onSteer: async () => true,
      deps: { gate, receipts }
    })

    expect(result.executed).toBe(true)
    expect(result.isError).toBe(true)
    expect(result.content).toBe('Tool error: disk on fire')
    const entries = await ReceiptService.read(file)
    expect(entries.map((entry) => entry.kind)).toEqual(['intent', 'result'])
    expect(entries[1].outcome).toBe('failure')
    expect(gate.recent(1)[0].outcome).toBe('failure')
  })

  describe('the durable decision journal', () => {
    it('refuses the tool when the decision cannot be written', async () => {
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
      /* A journal whose write fails: the decision is not durable, so the
       * effectful action must not happen. */
      const brokenJournal: GovernanceJournalSink = {
        append: async () => {
          throw new Error('disk full')
        }
      }
      const gate = new GovernanceGate({
        identities,
        trust: new TrustEngine(),
        kill: new KillSwitch(),
        journal: brokenJournal
      })
      const receipts = new ReceiptService({ signer: ephemeralSigner(), file })
      const calls: string[] = []
      const target = join(dir, 'must-not-exist.txt')
      const tool = fakeTool({ name: 'write_file', sideEffect: 'write', risk: 'medium', approval: 'policy' }, async () => {
        calls.push('execute')
        writeFileSync(target, 'written', 'utf8')
        return { content: 'wrote the file' }
      })

      const result = await executeGovernedTool({
        tool,
        args: { path: target },
        rawArgs: { path: target },
        ctx: {} as ToolContext,
        ids: ids(),
        permissionMode: 'auto',
        deps: { gate, receipts }
      })

      expect(result.decision).toBe('deny')
      expect(result.rule).toBe('governance-journal-unavailable')
      expect(result.executed).toBe(false)
      expect(result.isError).toBe(true)
      expect(result.content).toContain('could not be written to the journal')
      expect(calls).toEqual([])
      expect(existsSync(target)).toBe(false)
      expect(receipts.recent()).toEqual([])
      expect(gate.recent(1)[0].decision).toBe('deny')
    })

    it('runs the effect only after the decision is on disk', async () => {
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
      const journalFile = join(dir, 'nomos', 'governance.jsonl')
      const gate = new GovernanceGate({
        identities,
        trust: new TrustEngine(),
        kill: new KillSwitch(),
        journal: new GovernanceJournal(journalFile)
      })
      const receipts = new ReceiptService({ signer: ephemeralSigner(), file })
      const seenAtEffect: number[] = []
      const tool = writeFileTool(async () => {
        const lines = existsSync(journalFile)
          ? readFileSync(journalFile, 'utf8').trim().split('\n').filter(Boolean).length
          : 0
        seenAtEffect.push(lines)
        return { content: 'wrote' }
      })

      const result = await executeGovernedTool({
        tool,
        args: { path: 'a.md', content: 'x' },
        rawArgs: { path: 'a.md', content: 'x' },
        ctx: {} as ToolContext,
        ids: ids(),
        permissionMode: 'auto',
        deps: { gate, receipts }
      })

      expect(result.executed).toBe(true)
      /* Exactly the one decision line was durable before the effect ran. */
      expect(seenAtEffect).toEqual([1])
    })
  })

  describe('Crew identity', () => {
    it('does not let two similarly named seats share one identity', () => {
      const { gate, receipts } = setup()
      const a = registerCrewSeat('Docs Scout', [readFileTool(async () => ({ content: 'x' }))], { gate, receipts })
      const b = registerCrewSeat('Docs-Scout', [writeFileTool(async () => ({ content: 'x' }))], { gate, receipts })
      expect(a.ok && b.ok).toBe(true)
      if (!a.ok || !b.ok) return
      expect(a.agentId).not.toBe(b.agentId)
      /* Each seat kept exactly the scopes it was delegated — no swap. */
      expect(gate.identities.getAgent(a.agentId)?.scopes).toEqual(['fs.read'])
      expect(gate.identities.getAgent(b.agentId)?.scopes).toEqual(['fs.write'])
    })

    it('replaces a re-delegated seat instead of accumulating scopes', () => {
      const { gate, receipts } = setup()
      const first = registerCrewSeat('scout', [readFileTool(async () => ({ content: 'x' })), writeFileTool(async () => ({ content: 'x' }))], {
        gate,
        receipts
      })
      const second = registerCrewSeat('scout', [readFileTool(async () => ({ content: 'x' }))], { gate, receipts })
      expect(first.ok && second.ok).toBe(true)
      if (!first.ok || !second.ok) return
      expect(second.agentId).toBe(first.agentId)
      expect(gate.identities.getAgent(second.agentId)?.scopes).toEqual(['fs.read'])
      /* The Captain plus one seat: re-delegation did not spawn a second. */
      expect(gate.identities.activeAgents()).toHaveLength(2)
    })
  })
})
