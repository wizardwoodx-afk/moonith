import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineTool, isAllowedInPlanMode } from './types'

const make = (
  name: string,
  sideEffect: 'none' | 'read' | 'write' | 'execute' | 'network',
  approval?: 'never' | 'policy' | 'always',
  risk?: 'low' | 'medium' | 'high'
) =>
  defineTool({
    name,
    title: name,
    description: name,
    schema: z.object({}),
    sideEffect,
    approval,
    risk,
    execute: async () => ({ content: 'ok' })
  })

describe('isAllowedInPlanMode', () => {
  it('keeps the read side of the machine', () => {
    for (const tool of [
      make('read', 'read'),
      make('none', 'none'),
      make('fetch', 'network', 'never', 'low')
    ]) {
      expect(isAllowedInPlanMode(tool)).toBe(true)
    }
  })

  it('drops anything that changes a file or runs a command', () => {
    expect(isAllowedInPlanMode(make('write', 'write'))).toBe(false)
    expect(isAllowedInPlanMode(make('shell', 'execute'))).toBe(false)
  })

  /** A network call is only a read when the tool says so; the default for
   *  `network` is medium, which covers clicking into a live page or posting
   *  somewhere, and Plan mode must not be shown that at all. */
  it('drops a network action that is not marked read-only', () => {
    expect(isAllowedInPlanMode(make('stage', 'network', 'policy', 'medium'))).toBe(false)
    expect(isAllowedInPlanMode(make('unlabelled', 'network'))).toBe(false)
  })

  it('drops a tool that carries a standing-approval contract, even a read-only one', () => {
    expect(isAllowedInPlanMode(make('guarded', 'read', 'always'))).toBe(false)
    expect(isAllowedInPlanMode(make('guarded_fetch', 'network', 'always'))).toBe(false)
  })
})
