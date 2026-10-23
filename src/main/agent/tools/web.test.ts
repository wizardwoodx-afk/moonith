import { describe, expect, it } from 'vitest'
import { isBlockedHost } from './web'

describe('isBlockedHost', () => {
  it('blocks loopback addresses and localhost', () => {
    expect(isBlockedHost('127.0.0.1')).toBe(true)
    expect(isBlockedHost('127.9.9.9')).toBe(true)
    expect(isBlockedHost('localhost')).toBe(true)
    expect(isBlockedHost('LOCALHOST')).toBe(true)
    expect(isBlockedHost('api.localhost')).toBe(true)
  })

  it('blocks RFC1918 private ranges', () => {
    expect(isBlockedHost('10.1.2.3')).toBe(true)
    expect(isBlockedHost('192.168.1.1')).toBe(true)
    expect(isBlockedHost('172.16.0.1')).toBe(true)
    expect(isBlockedHost('172.31.255.255')).toBe(true)
  })

  it('blocks link-local and cloud metadata addresses', () => {
    expect(isBlockedHost('169.254.169.254')).toBe(true)
    expect(isBlockedHost('169.254.0.1')).toBe(true)
  })

  it('blocks IPv6 loopback, unspecified and unique-local addresses', () => {
    expect(isBlockedHost('::1')).toBe(true)
    expect(isBlockedHost('[::1]')).toBe(true)
    expect(isBlockedHost('::')).toBe(true)
    expect(isBlockedHost('fc00::1')).toBe(true)
    expect(isBlockedHost('fd12:3456:789a::1')).toBe(true)
    expect(isBlockedHost('fe80::1')).toBe(true)
  })

  it('blocks IPv4-mapped IPv6 loopback', () => {
    expect(isBlockedHost('::ffff:127.0.0.1')).toBe(true)
  })

  it('allows public hosts', () => {
    expect(isBlockedHost('example.com')).toBe(false)
    expect(isBlockedHost('8.8.8.8')).toBe(false)
    // 172.32.0.1 sits just outside 172.16.0.0/12.
    expect(isBlockedHost('172.32.0.1')).toBe(false)
    expect(isBlockedHost('172.15.0.1')).toBe(false)
    expect(isBlockedHost('2606:4700:4700::1111')).toBe(false)
  })
})
