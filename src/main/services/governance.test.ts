import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_GOVERNANCE_SETTINGS } from '@shared/governance'
import type { Task } from '@shared/types'
import type { AgentTool } from '../agent/tools/types'

const mocks = vi.hoisted(() => ({
  settings: null as unknown as import('@shared/governance').GovernanceSettings,
  record: vi.fn(async (_event: unknown) => true)
}))

vi.mock('../store', () => ({
  store: {
    getPublicSettings: () => ({ governance: mocks.settings })
  }
}))
vi.mock('../audit/runtime', () => ({
  runtimeAudit: { record: mocks.record }
}))

import { GovernanceService } from './governance'
import { DataPolicyError } from '../selfimpulse/governance/dlp'

const task = {
  id: 'task-governance',
  agentRole: 'viewer'
} as unknown as Task
const actor = { actor: 'captain', actorId: 'Captain' } as const

function tool(name: string, sideEffect: AgentTool['sideEffect']): AgentTool {
  return {
    name,
    title: name,
    description: name,
    inputSchema: {},
    sideEffect,
    risk: sideEffect === 'execute' ? 'high' : 'medium',
    approval: 'policy',
    execute: vi.fn(async () => ({ content: 'ok' }))
  }
}

beforeEach(() => {
  mocks.settings = structuredClone(DEFAULT_GOVERNANCE_SETTINGS)
  mocks.record.mockClear()
})

describe('GovernanceService', () => {
  it('records an authoritative role denial with no tool execution', async () => {
    const service = new GovernanceService()
    const write = tool('write_file', 'write')
    const decision = service.authorize(task, actor, write)
    expect(decision.allowed).toBe(false)
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'policy.check',
        outcome: 'denied',
        target: 'write_file',
        taskId: task.id
      })
    )
    expect(write.execute).not.toHaveBeenCalled()
  })

  it('redacts the complete nested provider payload and records categories only', () => {
    mocks.settings.dlp = { mode: 'redact', categories: ['email', 'secret', 'api-key'] }
    const service = new GovernanceService()
    const messages = service.protectModelMessages(task, actor, [
      {
        role: 'user',
        content: 'Contact person@example.com',
        toolCalls: [
          {
            id: 'call-1',
            name: 'connector',
            args: {
              authorization: 'confidential',
              token: 'sk-test_1234567890abcdef'
            }
          }
        ]
      }
    ])
    expect(JSON.stringify(messages)).not.toContain('person@example.com')
    expect(JSON.stringify(messages)).not.toContain('confidential')
    expect(JSON.stringify(messages)).not.toContain('sk-test_')
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dlp.model', outcome: 'redacted' })
    )
    expect(JSON.stringify(mocks.record.mock.calls[0][0])).not.toContain('person@example.com')
  })

  it('fails closed before returning a provider payload in block mode', () => {
    mocks.settings.dlp = { mode: 'block', categories: ['email'] }
    const service = new GovernanceService()
    expect(() =>
      service.protectModelMessages(task, actor, [
        { role: 'user', content: 'person@example.com' }
      ])
    ).toThrow(DataPolicyError)
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dlp.model', outcome: 'blocked' })
    )
  })

  it('protects network and execute arguments but leaves local writes in scope', () => {
    mocks.settings.dlp = { mode: 'redact', categories: ['email'] }
    const service = new GovernanceService()
    const network = service.protectToolArguments(task, actor, tool('web_fetch', 'network'), {
      url: 'https://example.test/?owner=person@example.com'
    })
    expect(network.args.url).toBe('https://example.test/?owner=[redacted:email]')
    const local = service.protectToolArguments(task, actor, tool('write_file', 'write'), {
      content: 'person@example.com'
    })
    expect(local.args.content).toBe('person@example.com')
    expect(local.total).toBe(0)
  })
})
