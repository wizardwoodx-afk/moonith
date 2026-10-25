import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserState, Task } from '@shared/types'
import type { ToolContext } from './types'

const browserMock = vi.hoisted(() => ({
  observe: vi.fn(),
  state: vi.fn(),
  act: vi.fn(),
  screenshot: vi.fn(),
  extractStructured: vi.fn()
}))

vi.mock('../../services/browser', () => ({ browserService: browserMock }))

import {
  browserActTool,
  browserExtractStructuredTool,
  browserObserveTool,
  browserTools,
  browserTypeTool
} from './browser'
import { toolResultError } from './types'
import { BrowserError } from '../../browser/errors'

const state: BrowserState = {
  open: true,
  url: 'https://example.com',
  title: 'Example',
  updatedAt: new Date(0).toISOString(),
  engine: 'stagehand',
  aiAvailable: true
}

function context(): ToolContext {
  return {
    task: { id: 'task-1' } as Task,
    workspace: '/tmp/task-1',
    roots: ['/tmp/task-1'],
    browserLabel: 'Researcher',
    allowShell: false,
    addArtifact: vi.fn(),
    setBrowser: vi.fn(),
    setPlan: vi.fn(),
    toast: vi.fn()
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  browserMock.state.mockResolvedValue(state)
})

describe('native AI browser tool registration', () => {
  it('registers observe, act, and structured extraction once', () => {
    const names = browserTools.map((tool) => tool.name)
    expect(names).toEqual(expect.arrayContaining([
      'browser_observe',
      'browser_act',
      'browser_extract_structured'
    ]))
    expect(new Set(names).size).toBe(names.length)
  })

  it('requires individual approval for every high-risk AI action', () => {
    expect(browserActTool).toMatchObject({
      sideEffect: 'network',
      risk: 'high',
      approval: 'always',
      allowAlways: false
    })
    expect(browserActTool.schema?.safeParse({ instruction: 'x'.repeat(2001) }).success).toBe(false)
  })

  it('does not include typed text in its approval summary', () => {
    expect(browserTypeTool.summarize?.({ selector: '#password', text: 'do-not-show' })).toBe('Type into #password')
  })

  it('bounds extraction instructions and requires an object-like schema record', () => {
    expect(browserExtractStructuredTool.schema?.safeParse({
      instruction: 'x'.repeat(4001)
    }).success).toBe(false)
    expect(browserExtractStructuredTool.schema?.safeParse({
      instruction: 'Extract the title',
      schema: []
    }).success).toBe(false)
  })
})

describe('AI browser tool outcomes', () => {
  it('returns observed actions and scopes the published state to the actor', async () => {
    browserMock.observe.mockResolvedValue([{ selector: '#save', description: 'Save button' }])
    const ctx = context()
    const result = await browserObserveTool.execute({ instruction: 'Find save' }, ctx)
    expect(result.isError).not.toBe(true)
    expect(result.content).toContain('#save')
    expect(browserMock.observe).toHaveBeenCalledWith('task-1', 'Find save')
    expect(ctx.setBrowser).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'task-1',
      ownerLabel: 'Researcher'
    }))
  })

  it('surfaces an explicit AI failure instead of claiming fallback browsing used AI', async () => {
    browserMock.observe.mockRejectedValue(new BrowserError(
      'BROWSER_AI_UNAVAILABLE',
      'Built-in Chromium does not provide AI actions.'
    ))
    const result = await browserObserveTool.execute({}, context())
    expect(result).toMatchObject({ isError: true })
    expect(result.content).toContain('does not provide AI actions')
  })

  it('redacts secrets from tool failures', () => {
    const secret = 'sk-test_1234567890abcdef'
    const result = toolResultError(new Error(`Provider rejected ${secret}`))
    expect(result.isError).toBe(true)
    expect(result.content).not.toContain(secret)
    expect(result.content).toContain('[redacted:api-key]')
  })
})
