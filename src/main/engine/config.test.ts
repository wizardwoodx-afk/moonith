import { describe, expect, it } from 'vitest'
import { buildEngineConfig, permissionRules } from './config'

describe('engine permissions', () => {
  it('denies every engine tool that would touch the machine outside the governed belt', () => {
    const denied = permissionRules('auto').map((rule) => rule.action)
    for (const action of [
      'edit',
      'write',
      'patch',
      'shell',
      'read',
      'glob',
      'grep',
      'webfetch',
      'websearch',
      'skill',
      'subagent',
      'question'
    ]) {
      expect(denied).toContain(action)
    }
  })

  it('denies the code-mode umbrella so the model cannot run code inside the engine', () => {
    const denied = permissionRules('auto').map((rule) => rule.action)
    expect(denied).toContain('execute')
  })

  it('keeps every denial on every resource', () => {
    for (const rule of permissionRules('skip')) {
      expect(rule.resource).toBe('*')
      expect(rule.effect).toBe('deny')
    }
  })

  it('emits subagent:* deny followed by allowed specialist ids when delegation is granted', () => {
    const rules = permissionRules('auto', { allowed: true, agentIds: ['archon', 'techne'] })
    const subagentRules = rules.filter((r) => r.action === 'subagent')
    expect(subagentRules).toEqual([
      { action: 'subagent', resource: '*', effect: 'deny' },
      { action: 'subagent', resource: 'archon', effect: 'allow' },
      { action: 'subagent', resource: 'techne', effect: 'allow' }
    ])
  })

  it('produces only the blanket deny on subagent:* when delegation is disabled', () => {
    const rules = permissionRules('auto', { allowed: false, agentIds: ['archon'] })
    const subagentRules = rules.filter((r) => r.action === 'subagent')
    expect(subagentRules).toEqual([
      { action: 'subagent', resource: '*', effect: 'deny' }
    ])
  })
})

describe('engine configuration', () => {
  it('emits subagent definitions under config.agents when subagents are provided', () => {
    const { config } = buildEngineConfig({
      providers: [],
      permissionMode: 'auto',
      subagents: [
        { id: 'archon', description: 'File Navigator', system: 'You are Archon.' },
        { id: 'techne', description: 'Coding Specialist', system: 'You are Techne.' }
      ]
    })
    const agents = config.agents as Record<string, Record<string, unknown>>
    expect(agents).toBeDefined()
    expect(agents.archon).toEqual({
      description: 'File Navigator',
      mode: 'subagent',
      system: 'You are Archon.'
    })
    expect(agents.techne).toEqual({
      description: 'Coding Specialist',
      mode: 'subagent',
      system: 'You are Techne.'
    })
  })

  it('writes the provider keys as environment references, never as values', () => {
    const { config, env } = buildEngineConfig({
      providers: [
        {
          id: 'provider-1',
          name: 'Gemini',
          kind: 'compatible',
          baseUrl: 'https://example.test/v1',
          models: ['model-a'],
          apiKey: 'secret-value',
          enabled: true
        }
      ],
      permissionMode: 'auto'
    })
    const provider = (config.providers as Record<string, Record<string, unknown>>)['provider-1']
    expect(provider.settings).toEqual({
      baseURL: 'https://example.test/v1',
      apiKey: '{env:SI_ENGINE_KEY_PROVIDER_1}'
    })
    expect(env.SI_ENGINE_KEY_PROVIDER_1).toBe('secret-value')
    expect(JSON.stringify(config)).not.toContain('secret-value')
  })

  it('points the bridge at the local server and keeps code mode off for it', () => {
    const { config } = buildEngineConfig({
      providers: [],
      permissionMode: 'auto',
      bridge: { command: ['node', 'bridge.cjs'], environment: { SI_ENGINE_PIPE: 'pipe' } }
    })
    const server = (config.mcp as { servers: Record<string, Record<string, unknown>> }).servers.selfimpulse
    expect(server.command).toEqual(['node', 'bridge.cjs'])
    expect(server.codemode).toBe(false)
  })
})
