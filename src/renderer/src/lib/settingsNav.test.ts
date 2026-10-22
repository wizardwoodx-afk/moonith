import { describe, expect, it } from 'vitest'
import {
  SETTINGS_GROUPS,
  SETTINGS_NAV,
  SETTINGS_PANES,
  groupSettingsNav,
  searchSettingsNav,
  settingsPaneLabel,
  settingsParent,
  visibleSettingsNav
} from './settingsNav'

describe('settings navigation', () => {
  it('lists every pane once, in navigation order', () => {
    expect(SETTINGS_NAV.map((item) => item.id)).toEqual([...SETTINGS_PANES])
    expect(new Set(SETTINGS_NAV.map((item) => item.id)).size).toBe(SETTINGS_NAV.length)
    expect(groupSettingsNav(SETTINGS_NAV).map((section) => section.group)).toEqual(SETTINGS_GROUPS)
  })

  it('groups agents under Agents instead of scattering them', () => {
    const groups = Object.fromEntries(
      groupSettingsNav(SETTINGS_NAV).map((section) => [
        section.group,
        section.items.map((item) => item.id)
      ])
    )
    expect(groups.Personal).toContain('profile')
    expect(groups.Personal).toContain('mode-config')
    expect(groups.Personal).toContain('task-monitor')
    expect(groups.Personal).toContain('shortcuts')
    expect(groups.Personal).toContain('appearance')
    expect(groups.Personal).toContain('colors')
    expect(groups.Personal).toContain('moon')
    expect(groups.Personal).not.toContain('agent')
    expect(groups.Agents).toEqual(['agent', 'agent-team', 'skills', 'sub-agents'])
    expect(groups.Integrations).toEqual([
      'mcp',
      'connectors',
      'channels',
      'gateway',
      'work-files',
      'desktop'
    ])
    expect(groups.SelfImpulse).toEqual(['about'])
  })

  it('ships no placeholders and no beta badges', () => {
    expect(SETTINGS_NAV.filter((item) => item.status === 'planned')).toEqual([])
    expect(SETTINGS_NAV.filter((item) => item.status === 'preview')).toEqual([])
    expect(SETTINGS_NAV.find((item) => item.id === 'agent')?.badge).toBeUndefined()
    expect(SETTINGS_NAV.find((item) => item.id === 'agent-team')?.badge).toBeUndefined()
    expect(SETTINGS_NAV.find((item) => item.id === 'moon')?.badge).toBe('Exclusive')
    expect(SETTINGS_NAV).toHaveLength(SETTINGS_PANES.length)
  })

  it('keeps Appearance sub-pages out of the sidebar but reachable', () => {
    const visible = visibleSettingsNav().map((item) => item.id)
    expect(visible).toContain('appearance')
    expect(visible).not.toContain('colors')
    expect(visible).not.toContain('moon')
    expect(settingsParent('colors')).toBe('appearance')
    expect(settingsParent('moon')).toBe('appearance')
    expect(settingsParent('general')).toBe('general')
    expect(searchSettingsNav('moon').map((item) => item.id)).toContain('moon')
  })

  it('returns every item for an empty query', () => {
    expect(searchSettingsNav('')).toHaveLength(SETTINGS_NAV.length)
    expect(searchSettingsNav('   ')).toHaveLength(SETTINGS_NAV.length)
  })

  it('matches labels case-insensitively', () => {
    expect(searchSettingsNav('PERM').map((item) => item.id)).toEqual(['permissions'])
    expect(searchSettingsNav('mcp')).toEqual([expect.objectContaining({ id: 'mcp' })])
  })

  it('matches keywords and summaries, not just labels', () => {
    expect(searchSettingsNav('stdin').map((item) => item.id)).toEqual([])
    expect(searchSettingsNav('stdio').map((item) => item.id)).toEqual(['mcp'])
    expect(searchSettingsNav('api key').map((item) => item.id)).toEqual(['providers'])
    expect(searchSettingsNav('hotkeys').map((item) => item.id)).toEqual(['shortcuts'])
    expect(searchSettingsNav('exclusive').map((item) => item.id)).toEqual(['moon'])
    expect(searchSettingsNav('grounded').map((item) => item.id)).toEqual(['desktop'])
    expect(searchSettingsNav('moonwright').map((item) => item.id)).toEqual(['gateway'])
  })

  it('returns no matches without inventing panes', () => {
    expect(searchSettingsNav('zzz-nothing')).toEqual([])
    expect(groupSettingsNav([])).toEqual([])
  })

  it('keeps grouping stable for partial results', () => {
    const groups = groupSettingsNav(searchSettingsNav('model'))
    expect(groups.map((section) => section.group)).toEqual(['Personal'])
    expect(groups.flatMap((section) => section.items.map((item) => item.id))).toEqual([
      'general',
      'providers'
    ])
  })

  it('has a label for every pane', () => {
    for (const item of SETTINGS_NAV) {
      expect(settingsPaneLabel(item.id)).toBe(item.label)
    }
  })
})
