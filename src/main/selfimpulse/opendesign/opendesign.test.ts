import { describe, expect, it } from 'vitest'
import { openDesignEngine } from './engine'

describe('OpenDesign Studio Engine', () => {
  it('compiles design tokens with expected hierarchies and colors', () => {
    const tokens = openDesignEngine.compileTokens({
      name: 'Acme Brand',
      primaryColor: '#6366f1',
      style: 'modern'
    })

    expect(tokens.name).toBe('Acme Brand')
    expect(tokens.colors.primary).toBe('#6366f1')
    expect(tokens.colors.surface).toBe('#18181b')
    expect(tokens.typography.scale.h1).toBe('32px')
  })

  it('generates a sandboxed interactive HTML prototype artifact', () => {
    const prototype = openDesignEngine.generatePrototype({
      title: 'Dashboard Widget',
      description: 'Analytics summary card',
      componentsHtml: '<div class="card"><h1>Analytics</h1></div>',
      scriptJs: 'console.log("Interactive prototype loaded");'
    })

    expect(prototype.id).toBeDefined()
    expect(prototype.html).toContain('<!DOCTYPE html>')
    expect(prototype.html).toContain('Dashboard Widget - OpenDesign Prototype')
    expect(prototype.html).toContain('Analytics summary card')
    expect(prototype.html).toContain('console.log("Interactive prototype loaded");')
  })
})
