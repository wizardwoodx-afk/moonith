import { beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const electron = vi.hoisted(() => ({
  openExternal: vi.fn(async () => undefined),
  openPath: vi.fn(async () => '')
}))

vi.mock('electron', () => ({ shell: electron }))

import { GroundedActions, resolveAppExecutable, safeUrl } from './grounded'

const actions = new GroundedActions({ settings: {} })

beforeEach(() => {
  electron.openExternal.mockClear()
  electron.openPath.mockClear()
})

describe('safeUrl', () => {
  it('accepts http and https URLs', () => {
    expect(safeUrl('https://example.com')).toBe('https://example.com/')
    expect(safeUrl('http://127.0.0.1:8080/path?q=1&x=2')).toContain('http://127.0.0.1:8080/path')
  })

  it('rejects other protocols and malformed input', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull()
    expect(safeUrl('file:///C:/Windows/System32/calc.exe')).toBeNull()
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(safeUrl('example.com')).toBeNull()
    expect(safeUrl('')).toBeNull()
    expect(safeUrl('https://example.com\n& calc')).toBeNull()
    expect(safeUrl(42)).toBeNull()
  })
})

describe('resolveAppExecutable', () => {
  it('resolves an absolute executable path', () => {
    expect(resolveAppExecutable(process.execPath)).toBe(process.execPath)
  })

  it('refuses names carrying shell metacharacters or arguments', () => {
    expect(resolveAppExecutable('notepad & calc')).toBeNull()
    expect(resolveAppExecutable('cmd.exe /c calc')).toBeNull()
    expect(resolveAppExecutable('')).toBeNull()
  })

  it('refuses .cmd/.bat shims on Windows', async () => {
    if (process.platform !== 'win32') return
    const dir = await fs.mkdtemp(join(tmpdir(), 'selfimpulse-shim-'))
    await fs.writeFile(join(dir, 'selfimpulse-shim.bat'), '@echo off')
    const savedPath = process.env.PATH
    const savedExt = process.env.PATHEXT
    process.env.PATH = `${dir};${savedPath}`
    process.env.PATHEXT = '.BAT;.EXE'
    try {
      expect(resolveAppExecutable('selfimpulse-shim')).toBeNull()
    } finally {
      process.env.PATH = savedPath
      if (savedExt === undefined) delete process.env.PATHEXT
      else process.env.PATHEXT = savedExt
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('finds a bare executable on PATH', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'selfimpulse-app-'))
    const name = process.platform === 'win32' ? 'selfimpulse-fake.exe' : 'selfimpulse-fake'
    const file = join(dir, name)
    await fs.writeFile(file, '')
    if (process.platform !== 'win32') await fs.chmod(file, 0o755)
    const savedPath = process.env.PATH
    const savedExt = process.env.PATHEXT
    process.env.PATH = `${dir}${process.platform === 'win32' ? ';' : ':'}${savedPath}`
    if (process.platform === 'win32') process.env.PATHEXT = '.EXE'
    try {
      expect(resolveAppExecutable('selfimpulse-fake')).toBe(file)
    } finally {
      process.env.PATH = savedPath
      if (savedExt === undefined) delete process.env.PATHEXT
      else process.env.PATHEXT = savedExt
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('GroundedActions.act navigation', () => {
  it('opens http(s) URLs through shell.openExternal', async () => {
    const result = await actions.act('navigate', { url: 'https://example.com/docs' })
    expect(result).toMatchObject({ ok: true, action: 'navigate', url: 'https://example.com/docs' })
    expect(electron.openExternal).toHaveBeenCalledWith('https://example.com/docs')
  })

  it('refuses non-http(s) URLs without touching the shell', async () => {
    const result = await actions.act('navigate', { url: 'javascript:alert(1)' })
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
    expect(electron.openExternal).not.toHaveBeenCalled()
  })
})

describe('GroundedActions.act open_app', () => {
  it('rejects an empty target', async () => {
    const result = await actions.act('open_app', { app: '' })
    expect(result).toMatchObject({ ok: false, action: 'open_app', app: '' })
  })

  it('rejects injected command lines instead of launching them', async () => {
    const result = await actions.act('open_app', { app: 'notepad & calc' })
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('never hands a script file to the OS shell', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'selfimpulse-script-'))
    const file = join(dir, 'payload.bat')
    await fs.writeFile(file, 'calc')
    try {
      const result = await actions.act('open_app', { app: file })
      expect(result.ok).toBe(false)
      expect(electron.openPath).not.toHaveBeenCalled()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
