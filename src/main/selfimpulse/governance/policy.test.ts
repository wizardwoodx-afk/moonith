import { describe, expect, it } from 'vitest'
import { DEFAULT_GOVERNANCE_SETTINGS } from '@shared/governance'
import { authorizeTool, permittedTools, resolveTaskRole } from './policy'

const settings = structuredClone(DEFAULT_GOVERNANCE_SETTINGS)
const read = { name: 'read_file', sideEffect: 'read', risk: 'low' } as const
const write = { name: 'write_file', sideEffect: 'write', risk: 'medium' } as const
const shell = { name: 'run_command', sideEffect: 'execute', risk: 'high' } as const
const web = { name: 'web_fetch', sideEffect: 'network', risk: 'medium' } as const
const crew = { name: 'delegate_to_crew', sideEffect: 'network', risk: 'low' } as const

 describe('agent role policy', () => {
  it('keeps legacy and new-task defaults compatible', () => {
    expect(resolveTaskRole(undefined)).toBe('executor')
    expect(settings.defaultRole).toBe('executor')
    expect(authorizeTool(undefined, settings, shell).allowed).toBe(true)
  })

  it('enforces Researcher capabilities and risk at action time', () => {
    expect(authorizeTool('researcher', settings, read).allowed).toBe(true)
    expect(authorizeTool('researcher', settings, web).allowed).toBe(true)
    expect(authorizeTool('researcher', settings, crew).allowed).toBe(true)
    expect(authorizeTool('researcher', settings, write)).toMatchObject({
      allowed: false,
      capability: 'write'
    })
    expect(authorizeTool('researcher', settings, shell).allowed).toBe(false)
  })

  it('makes Viewer local-read-only and prevents delegation', () => {
    expect(permittedTools('viewer', settings, [read, write, shell, web, crew])).toEqual([read])
    expect(authorizeTool('viewer', settings, crew).reason).toContain('delegate')
  })

  it('gives Custom deny rules precedence over allow rules', () => {
    const custom = structuredClone(settings)
    custom.custom.toolAllowlist = ['mcp__docs__*']
    custom.custom.toolDenylist = ['*__delete']
    expect(
      authorizeTool('custom', custom, {
        name: 'mcp__docs__search',
        sideEffect: 'read',
        risk: 'low'
      }).allowed
    ).toBe(true)
    expect(
      authorizeTool('custom', custom, {
        name: 'mcp__docs__delete',
        sideEffect: 'write',
        risk: 'medium'
      }).allowed
    ).toBe(false)
    expect(authorizeTool('custom', custom, read).allowed).toBe(false)
  })

  it('enforces a Custom risk ceiling independently of capabilities', () => {
    const custom = structuredClone(settings)
    custom.custom.maxRisk = 'low'
    expect(authorizeTool('custom', custom, read).allowed).toBe(true)
    expect(authorizeTool('custom', custom, write).allowed).toBe(false)
  })
})
