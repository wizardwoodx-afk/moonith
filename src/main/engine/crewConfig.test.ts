import { describe, expect, it } from 'vitest'
import { buildEngineConfig } from './config'
import { engineCrewAgents } from '../services/subagents'

/**
 * The crew is only real if the roster the app defines reaches the engine as
 * spawnable agents AND as permitted sub-agent ids. Both halves are asserted
 * from the same source so a rename in one cannot silently break the other.
 */
describe('crew reaches the engine configuration', () => {
  const agents = engineCrewAgents()

  it('defines every specialist as an engine sub-agent', () => {
    const { config } = buildEngineConfig({
      providers: [],
      permissionMode: 'auto',
      subagents: agents,
      crew: { allowed: true, agentIds: agents.map((agent) => agent.id) }
    })
    const defined = config.agents as Record<string, { mode?: string; system?: string }>
    for (const agent of agents) {
      expect(defined[agent.id]?.mode).toBe('subagent')
      expect(defined[agent.id]?.system).toContain('no emoji')
    }
  })

  it('permits exactly the roster ids and nothing else', () => {
    const { config } = buildEngineConfig({
      providers: [],
      permissionMode: 'auto',
      subagents: agents,
      crew: { allowed: true, agentIds: agents.map((agent) => agent.id) }
    })
    const rules = (config.permissions as Array<{ action: string; resource: string; effect: string }>).filter(
      (rule) => rule.action === 'subagent'
    )
    expect(rules[0]).toEqual({ action: 'subagent', resource: '*', effect: 'deny' })
    expect(rules.slice(1).map((rule) => rule.resource)).toEqual(agents.map((agent) => agent.id))
    // The last matching rule decides visibility: it must not be the blanket deny.
    expect(rules[rules.length - 1].effect).toBe('allow')
  })

  it('hides the whole tool when the role denies delegation', () => {
    const { config } = buildEngineConfig({
      providers: [],
      permissionMode: 'auto',
      subagents: agents,
      crew: { allowed: false, agentIds: agents.map((agent) => agent.id) }
    })
    const rules = (config.permissions as Array<{ action: string; resource: string; effect: string }>).filter(
      (rule) => rule.action === 'subagent'
    )
    expect(rules).toEqual([{ action: 'subagent', resource: '*', effect: 'deny' }])
  })
})

/**
 * A specialist runs in its own session and inherits none of the caller's
 * instructions, so the installed skills have to be handed over explicitly or
 * the crew silently loses the one thing the main agent can use.
 */
describe('crew receives the installed skills', () => {
  it('writes the skill index into every specialist', () => {
    const withSkills = engineCrewAgents('competitive-brief — one line about it\nsecrets-audit-checklist — another')
    expect(withSkills.length).toBeGreaterThan(0)
    for (const agent of withSkills) {
      expect(agent.system).toContain('competitive-brief')
      expect(agent.system).toContain('read_skill')
    }
  })

  it('tells a specialist when nothing is installed', () => {
    const bare = engineCrewAgents()
    for (const agent of bare) {
      expect(agent.system).toContain('No skill bundles are installed')
    }
  })
})
