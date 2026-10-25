import { describe, expect, it } from 'vitest'
import { maskSecret, redactBackendSecrets } from './publicSettings'
import { sameProviderEndpoint } from './provider'

describe('backend public settings projection', () => {
  it('redacts nested credentials without changing ordinary settings', () => {
    const result = redactBackendSecrets({
      baseUrl: 'https://provider.example/v1',
      apiKey: 'top-secret-value',
      subscriptionToken: 'subscription-secret',
      groundedActions: { enabled: true, apiKey: 'grounded-secret', model: 'vision' },
      extraHeaders: { Authorization: 'Bearer secret', 'X-Team': 'design' },
      nested: [{ clientSecret: 'client-secret', label: 'keep' }]
    }) as Record<string, any>

    expect(result.apiKey).not.toContain('top-secret-value')
    expect(result.subscriptionToken).not.toContain('subscription-secret')
    expect(result.groundedActions.apiKey).not.toContain('grounded-secret')
    expect(result.groundedActions).toMatchObject({ enabled: true, model: 'vision' })
    expect(result.extraHeaders.Authorization).not.toContain('secret')
    expect(result.extraHeaders['X-Team']).toBe('design')
    expect(result.nested[0].clientSecret).not.toContain('client-secret')
    expect(result.nested[0].label).toBe('keep')
    expect(JSON.stringify(result)).not.toMatch(/top-secret-value|subscription-secret|grounded-secret|client-secret/)
  })

  it('does not expose short secrets through the mask', () => {
    expect(maskSecret('abc')).toBe('••••••••')
    expect(maskSecret('')).toBe('')
  })
})

describe('endpoint-bound provider credentials', () => {
  it('treats trailing slash and case-only URL changes as the same endpoint', () => {
    expect(sameProviderEndpoint('HTTPS://Example.com/v1/', 'https://example.com/v1')).toBe(true)
  })

  it('rejects origin and path changes', () => {
    expect(sameProviderEndpoint('https://example.com/v1', 'https://attacker.example/v1')).toBe(false)
    expect(sameProviderEndpoint('https://example.com/v1', 'https://example.com/v2')).toBe(false)
    expect(sameProviderEndpoint('https://example.com/v1', 'http://example.com/v1')).toBe(false)
  })
})
