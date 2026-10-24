import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'

const execFileMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ execFile: execFileMock }))
vi.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false, encryptString: vi.fn(), decryptString: vi.fn() }
}))

import { ExternalAgent } from './external-agent'
import { npxCommand } from './npx'
import type { BackendStore } from './store'

const PROMPT = 'summarise this & calc " | whoami %USERPROFILE%'

beforeEach(() => {
  execFileMock.mockReset()
  execFileMock.mockImplementation(
    (_file: string, _args: string[], _options: unknown, callback: (...args: unknown[]) => void) => {
      callback(null, 'ok', '')
      return {}
    }
  )
})

describe('npxCommand', () => {
  it('keeps npx arguments in an argv array instead of a shell command line', () => {
    const invocation = npxCommand(['-y', 'openclaw@latest', 'agent', '--prompt', PROMPT])
    expect(Array.isArray(invocation.args)).toBe(true)
    expect(invocation.args).toContain(PROMPT)
    expect(invocation.command).not.toMatch(/cmd(\.exe)?$/i)
    if (process.platform === 'win32') {
      expect(invocation.command).toBe(process.execPath)
      expect(invocation.args[0]).toMatch(/npx-cli\.js$/)
    }
  })
})

describe('ExternalAgent.agent', () => {
  it('passes the prompt as a single argv element and never spawns a shell', async () => {
    const agent = new ExternalAgent({} as BackendStore, tmpdir())
    const result = await agent.agent(PROMPT)

    expect(result).toEqual({ ok: true, output: 'ok', code: 0 })
    expect(execFileMock).toHaveBeenCalledTimes(1)

    const [file, args, options] = execFileMock.mock.calls[0] as [string, string[], Record<string, unknown>]
    expect(file).not.toMatch(/cmd(\.exe)?$/i)
    expect(Array.isArray(args)).toBe(true)
    expect(args.filter((arg) => arg === PROMPT)).toHaveLength(1)
    expect(args.some((arg) => arg === `agent --prompt ${PROMPT} --no-input`)).toBe(false)
    expect(file).not.toContain(PROMPT)
    expect(options.shell).toBe(false)
    expect(options.shell).not.toBeTruthy()
  })

  it('reports a spawn failure without rejecting', async () => {
    execFileMock.mockImplementation(
      (_file: string, _args: string[], _options: unknown, callback: (...args: unknown[]) => void) => {
        callback(Object.assign(new Error('nope'), { code: 127 }), '', 'nope')
        return {}
      }
    )
    const agent = new ExternalAgent({} as BackendStore, tmpdir())
    const result = await agent.agent('hello')
    expect(result).toMatchObject({ ok: false, code: 127 })
  })
})
