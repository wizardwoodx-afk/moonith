import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const mocks = vi.hoisted(() => {
  const paths = { root: '', tasks: '', workspaces: '', settingsFile: '', schedulesFile: '' }
  const safeStorage = {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`sealed:${value}`, 'utf8')),
    decryptString: vi.fn((buffer: Buffer) => buffer.toString('utf8').replace(/^sealed:/, ''))
  }
  return { paths, safeStorage }
})

vi.mock('electron', () => ({ app: { getPath: () => mocks.paths.root }, safeStorage: mocks.safeStorage }))
vi.mock('./paths', () => ({
  getPaths: () => mocks.paths,
  ensureTaskWorkspace: () => mocks.paths.workspaces,
  taskWorkspace: () => mocks.paths.workspaces
}))

import { openSecret, sealSecret, Store } from './store'

const legacyPlain = (value: string): string => `plain:${Buffer.from(value, 'utf8').toString('base64')}`

async function writeLegacySettings(secret: string): Promise<void> {
  await fs.writeFile(
    mocks.paths.settingsFile,
    JSON.stringify({
      providers: [
        { id: 'p1', name: 'Legacy', kind: 'openai', models: ['gpt'], enabled: true, secret }
      ]
    }),
    'utf8'
  )
}

beforeEach(async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'selfimpulse-store-'))
  mocks.paths.root = root
  mocks.paths.tasks = join(root, 'tasks')
  mocks.paths.workspaces = join(root, 'workspaces')
  mocks.paths.settingsFile = join(root, 'settings.json')
  mocks.paths.schedulesFile = join(root, 'schedules.json')
  await fs.mkdir(mocks.paths.tasks, { recursive: true })
  await fs.mkdir(mocks.paths.workspaces, { recursive: true })
  mocks.safeStorage.isEncryptionAvailable.mockReset().mockReturnValue(true)
  mocks.safeStorage.encryptString
    .mockReset()
    .mockImplementation((value: string) => Buffer.from(`sealed:${value}`, 'utf8'))
  mocks.safeStorage.decryptString
    .mockReset()
    .mockImplementation((buffer: Buffer) => buffer.toString('utf8').replace(/^sealed:/, ''))
})

afterEach(async () => {
  await fs.rm(mocks.paths.root, { recursive: true, force: true })
})

describe('secret encryption', () => {
  it('round-trips through safeStorage', () => {
    const sealed = sealSecret('sk-test-123')
    expect(sealed.startsWith('enc:')).toBe(true)
    expect(sealed).not.toContain('sk-test-123')
    expect(openSecret(sealed)).toBe('sk-test-123')
  })

  it('refuses to write a secret when safeStorage is unavailable', async () => {
    mocks.safeStorage.isEncryptionAvailable.mockReturnValue(false)
    expect(() => sealSecret('sk-test-123')).toThrow(/secure storage is unavailable/i)

    const store = new Store()
    await store.init()
    await expect(
      store.saveSettings({
        providers: [
          { id: 'p1', name: 'OpenAI', kind: 'openai', models: ['gpt'], enabled: true, apiKey: 'sk-test-123' }
        ]
      })
    ).rejects.toThrow(/secure storage is unavailable/i)

    const raw = await fs.readFile(mocks.paths.settingsFile, 'utf8').catch(() => '')
    expect(raw).not.toContain('sk-test-123')
    expect(raw).not.toContain('plain:')
  })
})

describe('legacy plaintext secrets', () => {
  it('still reads plain values when safeStorage is unavailable', () => {
    mocks.safeStorage.isEncryptionAvailable.mockReturnValue(false)
    expect(openSecret(legacyPlain('sk-legacy'))).toBe('sk-legacy')
  })

  it('migrates plain values to encrypted storage on init', async () => {
    await writeLegacySettings(legacyPlain('sk-legacy'))

    const store = new Store()
    await store.init()

    expect(store.getProviderSecret('p1')).toBe('sk-legacy')
    const raw = JSON.parse(await fs.readFile(mocks.paths.settingsFile, 'utf8')) as {
      providers: Array<{ secret: string }>
    }
    expect(raw.providers[0].secret.startsWith('enc:')).toBe(true)
    expect(raw.providers[0].secret).not.toBe(legacyPlain('sk-legacy'))
  })
})
