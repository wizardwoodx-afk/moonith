import { describe, expect, it } from 'vitest'
import {
  assertSafeNavigation,
  inspectNavigationTarget,
  isDisallowedIp,
  NavigationBlockError
} from './navigation'

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]

describe('native coworker navigation boundary', () => {
  it.each([
    'http://127.0.0.1:3000',
    'http://127.1',
    'http://0x7f000001',
    'http://[::1]/',
    'http://10.0.0.4',
    'http://172.16.4.2',
    'http://192.168.1.10',
    'http://169.254.169.254/latest/meta-data',
    'http://100.100.100.200',
    'http://[fc00::1]',
    'http://[fe80::1]',
    'http://[::ffff:192.168.1.1]',
    'http://localhost:3000',
    'http://service.local',
    'http://metadata.google.internal',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://user:password@example.com'
  ])('blocks unsafe destination %s', (value) => {
    expect(() => inspectNavigationTarget(value)).toThrow(NavigationBlockError)
  })

  it('normalizes a safe HTTP destination without allowing credentials', () => {
    expect(inspectNavigationTarget(' https://Example.com/docs ').toString()).toBe('https://example.com/docs')
  })

  it('checks every DNS answer and fails closed on lookup errors', async () => {
    await expect(assertSafeNavigation('https://example.com', publicLookup)).resolves.toMatchObject({
      hostname: 'example.com'
    })
    await expect(
      assertSafeNavigation('https://example.com', async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 }
      ])
    ).rejects.toThrow('private or non-routable')
    await expect(
      assertSafeNavigation('https://example.com', async () => {
        throw new Error('DNS unavailable')
      })
    ).rejects.toThrow('could not be verified')
    await expect(assertSafeNavigation('https://example.com', async () => [])).rejects.toThrow(
      'did not resolve'
    )
  })

  it('blocks a hostname that resolves only to metadata or a private IPv6 address', async () => {
    await expect(
      assertSafeNavigation('https://example.com', async () => [{ address: '169.254.169.254' }])
    ).rejects.toThrow(NavigationBlockError)
    await expect(
      assertSafeNavigation('https://example.com', async () => [{ address: 'fd00::42' }])
    ).rejects.toThrow(NavigationBlockError)
  })

  it('allows public IPv4 and IPv6 addresses', () => {
    expect(isDisallowedIp('93.184.216.34')).toBe(false)
    expect(isDisallowedIp('2606:2800:220:1:248:1893:25c8:1946')).toBe(false)
    expect(isDisallowedIp('2001:db8::1')).toBe(true)
  })
})
