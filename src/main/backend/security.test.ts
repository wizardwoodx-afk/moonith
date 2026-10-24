import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const keychain = vi.hoisted(() => ({ available: true }))
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => keychain.available,
    encryptString: (value: string) => Buffer.from(`sealed:${value}`, 'utf8'),
    decryptString: (value: Buffer) => {
      const text = value.toString('utf8')
      if (!text.startsWith('sealed:')) throw new Error('bad seal')
      return text.slice(7)
    }
  }
}))

import { SecretStore } from './security'

let directory = ''
let file = ''

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'selfimpulse-secrets-'))
  file = join(directory, 'secrets.json')
  keychain.available = true
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('fail-closed backend secrets', () => {
  it('does not write plaintext when OS encryption is unavailable', async () => {
    keychain.available = false
    const secrets = new SecretStore(file)
    expect(() => secrets.put('apiKey', 'do-not-write')).toThrow('not written')
    await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses corrupt storage without replacing it with an empty store', async () => {
    await writeFile(file, '{broken', 'utf8')
    const secrets = new SecretStore(file)
    expect(() => secrets.put('apiKey', 'replacement')).toThrow('refusing to replace it')
    expect(await readFile(file, 'utf8')).toBe('{broken')
  })

  it('rejects legacy plaintext and supports encrypted round trips', async () => {
    await writeFile(file, JSON.stringify({ apiKey: { plain: 'legacy' } }), 'utf8')
    expect(() => new SecretStore(file).get('apiKey')).toThrow('plaintext or invalid')
    const secrets = new SecretStore(join(directory, 'new.json'))
    expect(secrets.put('apiKey', 'encrypted-value')).toBe(true)
    expect(new SecretStore(join(directory, 'new.json')).get('apiKey')).toBe('encrypted-value')
    expect(await readFile(join(directory, 'new.json'), 'utf8')).not.toContain('encrypted-value')
  })
})
