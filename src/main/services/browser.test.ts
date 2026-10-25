import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserState } from '@shared/types'

const mocks = vi.hoisted(() => ({
  settings: { browser: { engine: 'stagehand' as 'stagehand' | 'chromium', headless: true } },
  windows: [] as any[],
  session: {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    on: vi.fn(),
    webRequest: { onBeforeRequest: vi.fn() },
    clearStorageData: vi.fn(async () => undefined),
    clearCache: vi.fn(async () => undefined),
    clearAuthCache: vi.fn(async () => undefined)
  },
  stagehand: {
    open: vi.fn(),
    has: vi.fn(() => false),
    observe: vi.fn(),
    act: vi.fn(),
    extractStructured: vi.fn(),
    show: vi.fn(),
    state: vi.fn(),
    status: vi.fn(async () => ({ chromeAvailable: true, stagehandReady: true, stagehandVersion: '4.3.0' })),
    activeSessions: vi.fn(() => 0),
    disposeScope: vi.fn(async () => undefined),
    disposeAll: vi.fn(async () => undefined)
  }
}))

vi.mock('electron', () => ({
  session: { fromPartition: vi.fn(() => mocks.session) },
  BrowserWindow: class BrowserWindow {
    webContents: any
    destroyed = false
    visible = false
    private url = ''
    private listeners = new Map<string, Array<() => void>>()

    constructor() {
      this.webContents = {
        session: mocks.session,
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        isLoading: vi.fn(() => false),
        getURL: vi.fn(() => this.url),
        getTitle: vi.fn(() => 'Example')
      }
      mocks.windows.push(this)
    }

    on(event: string, listener: () => void) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    }

    async loadURL(url: string) { this.url = url }
    isDestroyed() { return this.destroyed }
    isVisible() { return this.visible }
    isMinimized() { return false }
    restore() { this.visible = true }
    show() { this.visible = true }
    focus() {}
    destroy() {
      if (this.destroyed) return
      this.destroyed = true
      for (const listener of this.listeners.get('closed') ?? []) listener()
    }
  }
}))
vi.mock('../store', () => ({ store: { getPublicSettings: () => mocks.settings } }))
vi.mock('../paths', () => ({ getPaths: () => ({ root: '/tmp/selfimpulse-browser-service-test-missing' }) }))
vi.mock('../atomic', () => ({ atomicWriteFileSync: vi.fn() }))
vi.mock('../browser/stagehand', () => ({
  StagehandBrowserEngine: class StagehandBrowserEngine {
    open = mocks.stagehand.open
    has = mocks.stagehand.has
    observe = mocks.stagehand.observe
    act = mocks.stagehand.act
    extractStructured = mocks.stagehand.extractStructured
    show = mocks.stagehand.show
    state = mocks.stagehand.state
    status = mocks.stagehand.status
    activeSessions = mocks.stagehand.activeSessions
    disposeScope = mocks.stagehand.disposeScope
    disposeAll = mocks.stagehand.disposeAll
  }
}))

import { BrowserService } from './browser'
import { BrowserError } from '../browser/errors'

const publicUrl = 'https://93.184.216.34/'
const stagehandState: BrowserState = {
  open: true,
  url: publicUrl,
  title: 'Example',
  updatedAt: new Date(0).toISOString(),
  engine: 'stagehand',
  mode: 'headless',
  aiAvailable: true
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.windows.length = 0
  mocks.settings.browser = { engine: 'stagehand', headless: true }
  mocks.stagehand.has.mockReturnValue(false)
  mocks.stagehand.activeSessions.mockReturnValue(0)
  mocks.stagehand.status.mockResolvedValue({ chromeAvailable: true, stagehandReady: true, stagehandVersion: '4.3.0' })
})

describe('BrowserService engine recovery', () => {
  it('retries a Stagehand-preferred fallback and closes it after a successful retry', async () => {
    const service = new BrowserService()
    mocks.stagehand.open.mockRejectedValueOnce(new BrowserError('BROWSER_UNAVAILABLE', 'Chrome is missing'))
    const fallback = await service.open('task-1', publicUrl)
    expect(fallback.engine).toBe('chromium')
    expect(fallback.notice).toContain('Built-in Chromium fallback')
    expect(mocks.windows).toHaveLength(1)

    await expect(service.observe('task-1')).rejects.toThrow('does not provide AI actions')
    expect(mocks.stagehand.observe).not.toHaveBeenCalled()

    mocks.stagehand.open.mockResolvedValueOnce(stagehandState)
    const recovered = await service.open('task-1', publicUrl)
    expect(recovered.engine).toBe('stagehand')
    expect(mocks.stagehand.open).toHaveBeenCalledTimes(2)
    expect(mocks.windows[0].destroyed).toBe(true)
  })

  it('respects an explicit Built-in Chromium choice for AI-only tools', async () => {
    mocks.settings.browser.engine = 'chromium'
    const service = new BrowserService()
    await expect(service.observe('task-1')).rejects.toThrow('require Stagehand')
    expect(mocks.stagehand.observe).not.toHaveBeenCalled()
  })

  it('does not invent a different live engine when takeover is requested after restart', async () => {
    const service = new BrowserService()
    await expect(service.show('task-1')).rejects.toThrow('no live browser session')
    expect(mocks.windows).toHaveLength(0)
    expect(mocks.stagehand.show).not.toHaveBeenCalled()
  })
})
