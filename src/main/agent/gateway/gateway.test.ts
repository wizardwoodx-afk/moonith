import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { toolExecutionGateway } from './gateway'
import { idempotencyStore } from './idempotency'
import { actionJournal } from './actionJournal'
import { resourceVersionGuard } from './versionLock'

describe('Tool Execution Gateway', () => {
  it('deduplicates identical executions using idempotency keys', async () => {
    idempotencyStore.clear()
    let executionCount = 0

    const req = {
      ids: {
        actionId: 'act-1',
        agentId: 'captain',
        principalId: 'user',
        taskId: 'task-1',
        runId: 'run-1'
      },
      tool: {
        name: 'test_tool',
        sideEffect: 'read' as const,
        risk: 'low' as const,
        approval: 'never' as const
      },
      args: { param: 'value-1' },
      idempotencyKey: 'idem-key-100',
      execute: async () => {
        executionCount++
        return { content: 'Executed successfully' }
      }
    }

    const first = await toolExecutionGateway.execute(req)
    expect(first.content).toBe('Executed successfully')
    expect(first.cached).toBeUndefined()
    expect(executionCount).toBe(1)

    // Second call with identical idempotency key
    const second = await toolExecutionGateway.execute(req)
    expect(second.content).toBe('Executed successfully')
    expect(second.cached).toBe(true)
    expect(executionCount).toBe(1) // did not re-execute!
  })

  it('rejects execution when resource version check fails', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'version-test-'))
    const filePath = join(dir, 'test.txt')
    await fs.writeFile(filePath, 'Initial content', 'utf8')

    try {
      const realVersion = await resourceVersionGuard.getFileVersion(filePath)
      expect(realVersion).toBeDefined()

      const req = {
        ids: {
          actionId: 'act-2',
          agentId: 'captain',
          principalId: 'user',
          taskId: 'task-1',
          runId: 'run-1'
        },
        tool: {
          name: 'write_file',
          sideEffect: 'write' as const,
          risk: 'high' as const,
          approval: 'never' as const
        },
        args: { path: filePath, content: 'Updated' },
        versionCheck: {
          resourcePath: filePath,
          expectedVersion: 'outdated-hash-12345'
        },
        execute: async () => ({ content: 'Should not run' })
      }

      const res = await toolExecutionGateway.execute(req)
      expect(res.isError).toBe(true)
      expect(res.content).toContain('Resource version conflict')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('blocks tool call containing sensitive plaintext secrets via guardrails', async () => {
    const req = {
      ids: {
        actionId: 'act-3',
        agentId: 'captain',
        principalId: 'user',
        taskId: 'task-1',
        runId: 'run-1'
      },
      tool: {
        name: 'curl_tool',
        sideEffect: 'execute' as const,
        risk: 'high' as const,
        approval: 'never' as const
      },
      args: { token: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890' },
      execute: async () => ({ content: 'sent' })
    }

    const res = await toolExecutionGateway.execute(req)
    expect(res.isError).toBe(true)
    expect(res.content).toContain('Tool execution blocked by safety guardrails')
    expect(res.content).toContain('Plaintext credential detected')
  })
})
