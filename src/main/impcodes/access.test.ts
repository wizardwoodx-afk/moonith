import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildImportedProviders,
  buildImportedServers,
  mergeImportedServers,
  parseImpCodesConfig,
  scanImpCodesAccess,
  toPublicAccess,
  type ImpCodesConfig,
  type ImpCodesProviderConfig,
  type ImpCodesServerConfig
} from './access'
import type { McpServerConfig, ProviderPublic } from '@shared/types'
import { REA_PRESET_TOOLS } from '@shared/constants'

const FAKE_SECRET = 'test-secret-value'

const SAMPLE_CONFIG = `{
  // The coding engine's access file.
  "model": "someprovider/Some-Model",
  "provider": {
    "someprovider": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Some Provider",
      "options": {
        "baseURL": "https://api.example.com/v1", /* endpoint */
        "apiKey": "${FAKE_SECRET}",
      },
      "models": {
        "Some-Model": { "name": "Some Model" },
        "Other-Model": {},
      },
    },
  },
  "mcp": {
    "rea": {
      "type": "local",
      "command": ["cmd.exe", "/d", "/c", "npx", "-y", "rea-agents@6.7.0", "mcp"],
      "enabled": true,
      "environment": {
        "GHIDRA_INSTALL_DIR": "C:\\\\tools\\\\ghidra",
        "MCP_API_TOKEN": "${FAKE_SECRET}",
      },
    },
    "remoteThing": {
      "type": "remote",
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer ${FAKE_SECRET}" },
      "enabled": true,
    },
  },
}`

function provider(overrides: Partial<ImpCodesProviderConfig> = {}): ImpCodesProviderConfig {
  return {
    key: 'someprovider',
    name: 'Some Provider',
    baseUrl: 'https://api.example.com/v1',
    models: ['Some-Model'],
    ...overrides
  }
}

function server(overrides: Partial<ImpCodesServerConfig> = {}): ImpCodesServerConfig {
  return {
    name: 'files',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'some-files-mcp'],
    enabled: true,
    ...overrides
  }
}

function config(overrides: Partial<ImpCodesConfig> = {}): ImpCodesConfig {
  return { providers: [], servers: [], ...overrides }
}

function existingProvider(overrides: Partial<ProviderPublic> = {}): ProviderPublic {
  return {
    id: 'p-existing',
    name: 'ImpCodes',
    kind: 'compatible',
    baseUrl: 'https://api.example.com/v1',
    models: ['Old-Model'],
    enabled: true,
    hasKey: true,
    ...overrides
  }
}

function existingServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'mcp-rea',
    name: 'rea',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'rea-agents@6.7.0', 'mcp'],
    enabled: true,
    preset: 'rea',
    toolAllowlist: ['open_binary', 'read_bytes'],
    ...overrides
  }
}

const tempDirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'selfimpulse-impcodes-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

/* ── parse ───────────────────────────────────────────────────────────────── */

describe('parseImpCodesConfig', () => {
  it('parses JSONC comments and trailing commas without mangling strings', () => {
    const parsed = parseImpCodesConfig(SAMPLE_CONFIG)

    expect(parsed.providers).toHaveLength(1)
    expect(parsed.providers[0]).toMatchObject({
      key: 'someprovider',
      name: 'Some Provider',
      npm: '@ai-sdk/openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: FAKE_SECRET
    })
    expect(parsed.providers[0].models).toEqual(['Some-Model', 'Other-Model'])
    expect(parsed.defaultModel).toBe('someprovider/Some-Model')
  })

  it('shapes local and remote servers from the access file', () => {
    const parsed = parseImpCodesConfig(SAMPLE_CONFIG)
    const [local, remote] = parsed.servers

    expect(local).toMatchObject({
      name: 'rea',
      transport: 'stdio',
      command: 'cmd.exe',
      args: ['/d', '/c', 'npx', '-y', 'rea-agents@6.7.0', 'mcp'],
      enabled: true
    })
    expect(local.env?.GHIDRA_INSTALL_DIR).toBe('C:\\tools\\ghidra')
    expect(local.env?.MCP_API_TOKEN).toBe(FAKE_SECRET)

    expect(remote).toMatchObject({
      name: 'remoteThing',
      transport: 'http',
      command: '',
      args: [],
      url: 'https://example.com/mcp',
      enabled: true
    })
    expect(remote.headers?.Authorization).toContain(FAKE_SECRET)
  })

  it('keeps URLs through the comment stripper', () => {
    const parsed = parseImpCodesConfig(`{
      // comment
      "provider": { "p": { "options": { "baseURL": "https://api.example.com/v1" } } }
    }`)
    expect(parsed.providers[0].baseUrl).toBe('https://api.example.com/v1')
  })

  it('rejects invalid JSON with a friendly, content-free error', () => {
    expect(() => parseImpCodesConfig('{ "provider": ')).toThrow(/not valid JSON/i)
    expect(() => parseImpCodesConfig('')).toThrow(/empty/i)
  })

  it('rejects a non-object root', () => {
    expect(() => parseImpCodesConfig('[]')).toThrow(/JSON object/i)
    expect(() => parseImpCodesConfig('"nope"')).toThrow(/JSON object/i)
  })
})

/* ── scan ────────────────────────────────────────────────────────────────── */

describe('scanImpCodesAccess', () => {
  it('returns sanitized provider and server data', async () => {
    const dir = await tempDir()
    const file = join(dir, 'opencode.jsonc')
    await writeFile(file, SAMPLE_CONFIG, 'utf8')

    const result = await scanImpCodesAccess({ configPath: file })

    expect(result.available).toBe(true)
    expect(result.providers).toEqual([
      {
        name: 'Some Provider',
        baseUrl: 'https://api.example.com/v1',
        models: ['Some-Model', 'Other-Model'],
        hasKey: true
      }
    ])
    expect(result.servers[0]).toEqual({
      name: 'rea',
      transport: 'stdio',
      command: 'cmd.exe',
      args: ['/d', '/c', 'npx', '-y', 'rea-agents@6.7.0', 'mcp']
    })
    expect(result.servers[1]).toEqual({
      name: 'remoteThing',
      transport: 'http',
      command: '',
      args: [],
      url: 'https://example.com/mcp'
    })
    expect(result.defaultModel).toBe('Some-Model')
  })

  it('never exposes the key, env values, or headers', async () => {
    const dir = await tempDir()
    const file = join(dir, 'opencode.jsonc')
    await writeFile(file, SAMPLE_CONFIG, 'utf8')

    const serialized = JSON.stringify(await scanImpCodesAccess({ configPath: file }))

    expect(serialized).not.toContain(FAKE_SECRET)
    expect(serialized).not.toContain('Authorization')
    expect(serialized).not.toContain('ghidra')
    expect(serialized).not.toContain('GHIDRA_INSTALL_DIR')
  })

  it('reports a missing file without a stack trace', async () => {
    const dir = await tempDir()
    const result = await scanImpCodesAccess({ configPath: join(dir, 'missing.jsonc') })

    expect(result.available).toBe(false)
    expect(result.providers).toEqual([])
    expect(result.servers).toEqual([])
    expect(result.error).toMatch(/no impcodes access file/i)
    expect(result.error).not.toMatch(/\n\s+at /)
  })

  it('reports invalid JSON through the scan instead of throwing', async () => {
    const dir = await tempDir()
    const broken = join(dir, 'broken.jsonc')
    await writeFile(broken, '{ "provider": {', 'utf8')

    const result = await scanImpCodesAccess({ configPath: broken })

    expect(result.available).toBe(false)
    expect(result.error).toMatch(/not valid JSON/i)
  })

  it('prefers OPENCODE_CONFIG, then XDG .jsonc/.json', async () => {
    const dir = await tempDir()
    const envFile = join(dir, 'env.jsonc')
    const otherFile = join(dir, 'other.jsonc')
    await writeFile(envFile, SAMPLE_CONFIG, 'utf8')
    await writeFile(
      otherFile,
      '{ "provider": { "p": { "name": "Other", "models": { "m": {} } } } }',
      'utf8'
    )

    const fromEnv = await scanImpCodesAccess({
      env: { OPENCODE_CONFIG: envFile, XDG_CONFIG_HOME: dir }
    })
    expect(fromEnv.providers[0].name).toBe('Some Provider')

    const xdgRoot = join(dir, 'xdg')
    const xdgDir = join(xdgRoot, 'opencode')
    await mkdir(xdgDir, { recursive: true })
    await writeFile(join(xdgDir, 'opencode.json'), SAMPLE_CONFIG, 'utf8')

    const fromXdg = await scanImpCodesAccess({ env: { XDG_CONFIG_HOME: xdgRoot } })
    expect(fromXdg.providers[0].name).toBe('Some Provider')
  })

  it('falls back to the first model when config.model names an unknown provider', () => {
    const access = toPublicAccess(
      config({
        providers: [provider({ models: ['A', 'B'] })],
        defaultModel: 'nobody/Nope'
      })
    )
    expect(access.defaultModel).toBe('A')
  })
})

/* ── providers ───────────────────────────────────────────────────────────── */

describe('buildImportedProviders', () => {
  it('names the first provider ImpCodes and suffixes the rest', () => {
    const built = buildImportedProviders(
      config({
        providers: [
          provider(),
          provider({ key: 'second', name: 'Second Co', baseUrl: 'https://second.example/v1' })
        ]
      }),
      []
    )

    expect(built.map((entry) => entry.name)).toEqual(['ImpCodes', 'ImpCodes · Second Co'])
    expect(built[0].id).toBeUndefined()
    expect(built[0].enabled).toBe(true)
    expect(built[0].kind).toBe('compatible')
    expect(built[0].baseUrl).toBe('https://api.example.com/v1')
  })

  it('reuses an existing ImpCodes id when the base URL matches', () => {
    const built = buildImportedProviders(
      config({ providers: [provider({ baseUrl: 'https://api.example.com/v1/' })] }),
      [existingProvider({ baseUrl: 'https://api.example.com/v1' })]
    )

    expect(built[0].id).toBe('p-existing')
    expect(built[0].name).toBe('ImpCodes')
  })

  it('does not reuse the id when the base URL or name differs', () => {
    const otherUrl = buildImportedProviders(
      config({ providers: [provider()] }),
      [existingProvider({ baseUrl: 'https://elsewhere.example/v1' })]
    )
    expect(otherUrl[0].id).toBeUndefined()

    const otherName = buildImportedProviders(
      config({ providers: [provider()] }),
      [existingProvider({ name: 'Someone Else' })]
    )
    expect(otherName[0].id).toBeUndefined()
  })

  it('maps kinds from npm, key, and endpoint', () => {
    const [anthropic, openai, compatible] = buildImportedProviders(
      config({
        providers: [
          provider({ key: 'anthropic', npm: '@ai-sdk/anthropic' }),
          provider({ key: 'openai', npm: '@ai-sdk/openai', baseUrl: 'https://api.openai.com/v1' }),
          provider({ key: 'local', npm: '@ai-sdk/openai-compatible' })
        ]
      }),
      []
    )

    expect(anthropic.kind).toBe('anthropic')
    expect(openai.kind).toBe('openai')
    expect(compatible.kind).toBe('compatible')
  })

  it('preserves the existing models when the config lists none', () => {
    const built = buildImportedProviders(
      config({ providers: [provider({ models: [] })] }),
      [existingProvider({ models: ['kept-model'] })]
    )
    expect(built[0].models).toEqual(['kept-model'])
  })

  it('carries the api key so the store can seal it', () => {
    const built = buildImportedProviders(
      config({ providers: [provider({ apiKey: FAKE_SECRET })] }),
      []
    )
    expect(built[0].apiKey).toBe(FAKE_SECRET)
    expect(built[0].baseUrl).toBe('https://api.example.com/v1')
    expect(JSON.stringify(buildImportedProviders(config({ providers: [provider()] }), []))).not.toContain(
      'apiKey'
    )
  })
})

/* ── servers ─────────────────────────────────────────────────────────────── */

describe('buildImportedServers', () => {
  it('imports local and remote servers with safe env only', () => {
    const built = buildImportedServers(
      config({
        servers: [
          server({
            name: 'My Files',
            env: { GOOD_DIR: 'C:\\tools', MCP_API_KEY: FAKE_SECRET, AUTH_MODE: 'token' }
          }),
          server({
            name: 'remoteThing',
            transport: 'http',
            command: '',
            args: [],
            url: 'https://example.com/mcp',
            headers: { Authorization: `Bearer ${FAKE_SECRET}` },
            env: { REGION: 'eu' }
          })
        ]
      }),
      []
    )

    expect(built.map((entry) => entry.id)).toEqual(['impcodes-my-files', 'impcodes-remote-thing'])
    expect(built[0]).toMatchObject({
      name: 'My Files',
      transport: 'stdio',
      command: 'npx',
      enabled: true,
      source: 'manual'
    })
    expect(built[0].env).toEqual({ GOOD_DIR: 'C:\\tools' })
    expect(built[0].headers).toBeUndefined()
    expect(built[1]).toMatchObject({
      transport: 'http',
      url: 'https://example.com/mcp',
      command: '',
      args: []
    })
    expect(built[1].headers).toBeUndefined()
    expect(JSON.stringify(built)).not.toContain(FAKE_SECRET)
  })

  it('merges a cmd.exe-wrapped rea server into the existing preset', () => {
    const { servers, imported, updated } = mergeImportedServers(
      config({
        servers: [
          server({
            name: 'rea',
            command: 'cmd.exe',
            args: ['/d', '/c', 'npx', '-y', 'rea-agents@6.7.0', 'mcp'],
            env: { GHIDRA_INSTALL_DIR: 'C:\\tools\\ghidra', REA_TOKEN: FAKE_SECRET }
          })
        ]
      }),
      [existingServer()]
    )

    expect(imported).toBe(0)
    expect(updated).toBe(1)
    expect(servers).toHaveLength(1)
    expect(servers[0].id).toBe('mcp-rea')
    expect(servers[0].name).toBe('rea')
    expect(servers[0].preset).toBe('rea')
    expect(servers[0].toolAllowlist).toEqual(['open_binary', 'read_bytes'])
    expect(servers[0].command).toBe('npx')
    expect(servers[0].args).toEqual(['-y', 'rea-agents@6.7.0', 'mcp'])
    expect(servers[0].env).toEqual({ GHIDRA_INSTALL_DIR: 'C:\\tools\\ghidra' })
  })

  it('does not fold an unrelated local server into the rea preset', () => {
    const built = buildImportedServers(config({ servers: [server()] }), [existingServer()])
    expect(built).toHaveLength(2)
    expect(built[1].id).toBe('impcodes-files')
  })

  it('gives a newly imported rea server the curated tool list', () => {
    const built = buildImportedServers(
      config({
        servers: [
          server({
            name: 'rea',
            command: 'cmd.exe',
            args: ['/d', '/c', 'npx', '-y', 'rea-agents@6.7.0', 'mcp']
          })
        ]
      }),
      []
    )
    expect(built).toHaveLength(1)
    expect(built[0].toolAllowlist).toEqual(REA_PRESET_TOOLS)
  })

  it('curates an existing bare rea server that exposed every tool', () => {
    const bare: McpServerConfig = {
      id: 'mcp-rea',
      name: 'rea',
      command: 'cmd.exe',
      args: ['/d', '/c', 'npx', '-y', 'rea-agents@6.7.0', 'mcp'],
      enabled: true,
      source: 'manual'
    }
    const built = buildImportedServers(
      config({
        servers: [
          server({
            name: 'rea',
            command: 'cmd.exe',
            args: ['/d', '/c', 'npx', '-y', 'rea-agents@6.7.0', 'mcp']
          })
        ]
      }),
      [bare]
    )
    expect(built).toHaveLength(1)
    expect(built[0].toolAllowlist).toEqual(REA_PRESET_TOOLS)
  })

  it('updates an existing remote server by URL instead of duplicating it', () => {
    const existing: McpServerConfig = {
      id: 'mcp-remote',
      name: 'remoteThing',
      transport: 'sse',
      command: '',
      args: [],
      url: 'https://example.com/mcp/',
      enabled: true
    }

    const { servers, imported, updated } = mergeImportedServers(
      config({
        servers: [
          server({
            name: 'remoteThing',
            transport: 'http',
            command: '',
            args: [],
            url: 'https://example.com/mcp'
          })
        ]
      }),
      [existing]
    )

    expect(imported).toBe(0)
    expect(updated).toBe(1)
    expect(servers).toHaveLength(1)
    expect(servers[0].id).toBe('mcp-remote')
    expect(servers[0].transport).toBe('sse')
    expect(servers[0].url).toBe('https://example.com/mcp/')
  })

  it('is idempotent: a second pass keeps ids and does not duplicate', () => {
    const first = buildImportedServers(
      config({
        servers: [
          server(),
          server({ name: 'remoteThing', transport: 'http', command: '', args: [], url: 'https://example.com/mcp' })
        ]
      }),
      [existingServer()]
    )
    const second = buildImportedServers(
      config({
        servers: [
          server(),
          server({ name: 'remoteThing', transport: 'http', command: '', args: [], url: 'https://example.com/mcp' })
        ]
      }),
      first
    )

    expect(first).toHaveLength(3)
    expect(second.map((entry) => entry.id)).toEqual(first.map((entry) => entry.id))
  })

  it('gives duplicate names unique ids and respects enabled: false', () => {
    const built = buildImportedServers(
      config({
        servers: [
          server({ name: 'same', enabled: false }),
          server({ name: 'same', args: ['-y', 'other-mcp'] })
        ]
      }),
      []
    )

    expect(built.map((entry) => entry.id)).toEqual(['impcodes-same', 'impcodes-same-2'])
    expect(built[0].enabled).toBe(false)
    expect(built[1].enabled).toBe(true)
  })
})
