import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GOVERNANCE_SETTINGS,
  normalizeAgentRole,
  normalizeGovernanceSettings
} from './governance'

describe('governance settings boundary', () => {
  it('preserves compatibility defaults', () => {
    expect(normalizeGovernanceSettings(undefined)).toEqual(DEFAULT_GOVERNANCE_SETTINGS)
    expect(normalizeAgentRole(undefined)).toBe('executor')
  })

  it('drops unknown roles, capabilities, detectors, and malformed lists', () => {
    const normalized = normalizeGovernanceSettings({
      defaultRole: 'superuser',
      custom: {
        capabilities: ['read', 'read', 'admin', 42],
        maxRisk: 'catastrophic',
        toolAllowlist: [' read_file ', '', 42, 'read_file'],
        toolDenylist: 'run_command'
      },
      dlp: { mode: 'exfiltrate', categories: ['email', 'unknown', 'email'] }
    })
    expect(normalized.defaultRole).toBe('executor')
    expect(normalized.custom.capabilities).toEqual(['read'])
    expect(normalized.custom.maxRisk).toBe('high')
    expect(normalized.custom.toolAllowlist).toEqual(['read_file'])
    expect(normalized.custom.toolDenylist).toEqual([])
    expect(normalized.dlp.mode).toBe('off')
    expect(normalized.dlp.categories).toEqual(['email'])
  })

  it('does not share mutable arrays with the defaults', () => {
    const normalized = normalizeGovernanceSettings(undefined)
    normalized.custom.capabilities.length = 0
    normalized.dlp.categories.length = 0
    expect(DEFAULT_GOVERNANCE_SETTINGS.custom.capabilities.length).toBeGreaterThan(0)
    expect(DEFAULT_GOVERNANCE_SETTINGS.dlp.categories.length).toBeGreaterThan(0)
  })
})
