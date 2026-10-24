import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const mocks = vi.hoisted(() => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`sealed:${value}`, 'utf8')),
    decryptString: vi.fn((buffer: Buffer) => buffer.toString('utf8').replace(/^sealed:/, ''))
  }
}))

vi.mock('electron', () => ({ safeStorage: mocks.safeStorage }))

import { GatewayToken, SecretStore } from './security'

type RawSecrets = Record<string, { enc?: string; plain?: string }>

let root = ''
let file = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'selfimpulse-secrets-'))
  file = join(root, 'secrets.json')
  mocks.safeStorage.isEncryptionAvailable.mockReset().mockReturnValue(true)
  mocks.safeStorage.encryptString
    .mockReset()
    .mockImplementation((value: string) => Buffer.from(`sealed:${value}`, 'utf8'))
  mocks.safeStorage.decryptString
    .mockReset()
    .mockImplementation((buffer: Buffer) => buffer.toString('utf8').replace(/^sealed:/, ''))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function raw(): RawSecrets {
  return JSON.parse(readFileSync(file, 'utf8')) as RawSecrets
}

describe('backend secret store', () => {
  it('encrypts values at rest and reads them back', () => {
    const store = new SecretStore(file)
    store.put('apiKey', 'sk-test-123')
    expect(store.get('apiKey')).toBe('sk-test-123')

    expect(raw().apiKey.plain).toBeUndefined()
    expect(raw().apiKey.enc).toBeTruthy()
    expect(readFileSync(file, 'utf8')).not.toContain('sk-test-123')
  })

  it('refuses to persist plaintext when the keychain is unavailable', () => {
    mocks.safeStorage.isEncryptionAvailable.mockReturnValue(false)
    const store = new SecretStore(file)

    expect(() => store.put('apiKey', 'sk-test-123')).toThrow(/secure storage is unavailable/i)
    expect(store.get('apiKey')).toBe('')
  })

  it('migrates a legacy plain value once the keychain is available', () => {
    writeFileSync(file, JSON.stringify({ apiKey: { plain: 'legacy-key' } }), 'utf8')
    const store = new SecretStore(file)

    expect(store.get('apiKey')).toBe('legacy-key')
    expect(raw().apiKey.plain).toBeUndefined()
    expect(raw().apiKey.enc).toBeTruthy()
    expect(readFileSync(file, 'utf8')).not.toContain('legacy-key')
  })

  it('keeps a gateway token usable in memory when it cannot be sealed', () => {
    mocks.safeStorage.isEncryptionAvailable.mockReturnValue(false)
    const secrets = new SecretStore(file)
    const gateway = new GatewayToken(secrets)

    const token = gateway.ensure()
    expect(token.length).toBeGreaterThan(20)
    expect(gateway.ensure()).toBe(token)
    expect(secrets.get('gatewayToken')).toBe('')
  })
})
