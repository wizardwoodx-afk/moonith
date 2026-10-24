/**
 * The enterprise IPC boundary.
 *
 * Two properties are under test, both about what the main process trusts:
 *
 *   - a repository scan may only be pointed at a folder a human actually
 *     granted (a native-dialog pick or a task folder / workspace), and the
 *     check runs on real paths so a symlink cannot widen it;
 *   - an approval's actor is the main process's own local identity, never the
 *     `by` string the renderer sends (kept only so the preload contract does
 *     not change).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => '') },
  safeStorage: {}
}))

import { ipcMain } from 'electron'
import { AION_IPC } from '@shared/enterprise'
import { setAionOrchestrator } from '../aion'
import { LOCAL_PRINCIPAL_ID } from '../nomos'
import { noteGrantedFolder, registerEnterpriseIpc, resolveScanRoot } from './ipc'

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()

let base = ''
let granted = ''
let outside = ''

beforeAll(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'si-enterprise-ipc-'))
  granted = join(base, 'granted')
  outside = join(base, 'outside')
  await fs.mkdir(join(granted, 'repo', 'src'), { recursive: true })
  await fs.mkdir(outside, { recursive: true })
  await fs.writeFile(join(outside, 'secret.txt'), 'secret')

  vi.mocked(ipcMain.handle).mockImplementation(((channel: string, listener: Handler) => {
    handlers.set(channel, listener)
  }) as typeof ipcMain.handle)

  registerEnterpriseIpc()
  noteGrantedFolder(granted)
})

afterAll(async () => {
  setAionOrchestrator(null)
  await fs.rm(base, { recursive: true, force: true })
})

describe('resolveScanRoot', () => {
  it('accepts a folder the user granted', async () => {
    expect(await resolveScanRoot(join(granted, 'repo'))).toBe(
      await fs.realpath(join(granted, 'repo'))
    )
  })

  it('accepts a subfolder of a granted folder', async () => {
    expect(await resolveScanRoot(join(granted, 'repo', 'src'))).toBe(
      await fs.realpath(join(granted, 'repo', 'src'))
    )
  })

  it('rejects a sibling directory that was never granted', async () => {
    await expect(resolveScanRoot(outside)).rejects.toThrow(/limited to folders you chose/)
  })

  it('rejects traversal out of a granted folder', async () => {
    await expect(resolveScanRoot(join(granted, '..', 'outside'))).rejects.toThrow(
      /limited to folders you chose/
    )
  })

  it('rejects a symlink/junction that escapes the granted folder', async () => {
    const link = join(granted, 'escape')
    try {
      await fs.symlink(outside, link, 'junction')
    } catch {
      return // symlinks are not available to this account; nothing to test
    }
    await expect(resolveScanRoot(link)).rejects.toThrow(/limited to folders you chose/)
  })

  it('rejects missing folders and null bytes with a clear error', async () => {
    await expect(resolveScanRoot(join(granted, 'missing'))).rejects.toThrow(/does not exist/)
    await expect(resolveScanRoot(`${granted}\0evil`)).rejects.toThrow(/Choose a folder/)
  })
})

describe('aion:startRepoScan', () => {
  it('refuses an ungranted root before any mission starts', async () => {
    const handler = handlers.get(AION_IPC.startRepoScan)
    expect(handler).toBeTypeOf('function')
    await expect(handler?.({}, { root: outside })).rejects.toThrow(/limited to folders you chose/)
  })
})

describe('aion:approve', () => {
  it('records the main-side local identity, ignoring the renderer-supplied by', async () => {
    const approve = vi.fn(async () => null)
    setAionOrchestrator({ approve } as never)
    const handler = handlers.get(AION_IPC.approve)
    expect(handler).toBeTypeOf('function')

    const result = await handler?.(
      {},
      { missionId: 'm-1', approve: true, by: 'mallory', note: 'ship it' }
    )

    expect(result).toBeNull()
    expect(approve).toHaveBeenCalledWith('m-1', true, LOCAL_PRINCIPAL_ID, 'ship it')
    expect(approve).toHaveBeenCalledTimes(1)
    expect(LOCAL_PRINCIPAL_ID).toBe('local-user')
  })

  it('treats only a literal true as approval', async () => {
    const approve = vi.fn(async () => null)
    setAionOrchestrator({ approve } as never)
    const handler = handlers.get(AION_IPC.approve)
    await handler?.({}, { missionId: 'm-2', approve: 'yes', by: 'mallory' })
    expect(approve).toHaveBeenCalledWith('m-2', false, LOCAL_PRINCIPAL_ID, undefined)
  })
})
