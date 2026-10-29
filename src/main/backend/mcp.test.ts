import { describe, expect, it } from 'vitest'
import { buildMcpStdioEnv } from './mcp'

describe('mcp stdio environment scrubbing', () => {
  it('strips credentials and runtime hooks from parent process environment', () => {
    const parentEnv: NodeJS.ProcessEnv = {
      PATH: '/usr/bin:/bin',
      HOME: '/home/user',
      OPENAI_API_KEY: 'sk-proj-secret',
      ANTHROPIC_API_KEY: 'sk-ant-secret',
      GITHUB_TOKEN: 'ghp_secret',
      AWS_SECRET_ACCESS_KEY: 'secret123',
      DATABASE_PASSWORD: 'supersecretpassword',
      PRIVATE_KEY: 'my-private-key',
      BEARER_AUTHORIZATION: 'Bearer token',
      NODE_OPTIONS: '--inspect=9229',
      ELECTRON_RUN_AS_NODE: '1'
    }

    const scrubbed = buildMcpStdioEnv({}, parentEnv)

    expect(scrubbed.PATH).toBe('/usr/bin:/bin')
    expect(scrubbed.HOME).toBe('/home/user')
    expect(scrubbed.npm_config_ignore_scripts).toBe('true')

    expect(scrubbed.OPENAI_API_KEY).toBeUndefined()
    expect(scrubbed.ANTHROPIC_API_KEY).toBeUndefined()
    expect(scrubbed.GITHUB_TOKEN).toBeUndefined()
    expect(scrubbed.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(scrubbed.DATABASE_PASSWORD).toBeUndefined()
    expect(scrubbed.PRIVATE_KEY).toBeUndefined()
    expect(scrubbed.BEARER_AUTHORIZATION).toBeUndefined()
    expect(scrubbed.NODE_OPTIONS).toBeUndefined()
    expect(scrubbed.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })

  it('allows explicit user configuration to provide specific server variables', () => {
    const parentEnv: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      HOST_API_KEY: 'host-secret-do-not-leak'
    }

    const userEnv = {
      TARGET_API_KEY: 'explicit-server-key',
      DEBUG: 'true'
    }

    const scrubbed = buildMcpStdioEnv(userEnv, parentEnv)

    expect(scrubbed.HOST_API_KEY).toBeUndefined()
    expect(scrubbed.TARGET_API_KEY).toBe('explicit-server-key')
    expect(scrubbed.DEBUG).toBe('true')
  })
})
