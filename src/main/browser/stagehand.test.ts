import { promises as fs } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const page = {
    goto: vi.fn(),
    url: vi.fn(),
    title: vi.fn(async () => 'Example'),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    locator: vi.fn(),
    keyPress: vi.fn(),
    evaluate: vi.fn(),
    waitForSelector: vi.fn(),
    waitForTimeout: vi.fn(),
    screenshot: vi.fn()
  }
  const browser = {
    closed: false,
    context: {
      pages: vi.fn(async () => [page]),
      activePage: vi.fn(async () => page),
      newPage: vi.fn(async () => page)
    },
    close: vi.fn(async () => { browser.closed = true })
  }
  const client = {
    observe: vi.fn(async () => ({
      data: [{ selector: '#save', description: 'Save button', method: 'click', arguments: [] }]
    })),
    act: vi.fn(async () => ({
      data: { success: true, message: 'Done', actionDescription: 'Clicked Save', actions: [{}] }
    })),
    extract: vi.fn(async (_instruction: string, _schema?: unknown) => ({ data: { title: 'Example' } })),
    close: vi.fn(async () => undefined)
  }
  return {
    root: `/tmp/selfimpulse-stagehand-test-${process.pid}`,
    page,
    browser,
    client,
    launch: vi.fn(),
    create: vi.fn(),
    guardStart: vi.fn(async () => undefined),
    guardClose: vi.fn(),
    currentUrl: 'about:blank'
  }
})

vi.mock('@browserbasehq/stagehand', () => ({
  localBrowser: { launch: mocks.launch },
  Stagehand: { create: mocks.create }
}))
vi.mock('../paths', () => ({ getPaths: () => ({ root: mocks.root }) }))
vi.mock('../store', () => ({ store: {} }))
vi.mock('../selfimpulse/coworker/navigation', () => ({
  NavigationBlockError: class NavigationBlockError extends Error {},
  assertSafeNavigation: vi.fn(async (url: string) => new URL(url))
}))
vi.mock('./chrome', () => ({
  assertStagehandSandboxSupported: vi.fn(),
  findChromeExecutable: vi.fn(async () => '/opt/chrome'),
  readDevToolsEndpoint: vi.fn(async () => ({
    httpUrl: 'http://127.0.0.1:9222',
    webSocketUrl: 'ws://127.0.0.1:9222/devtools/browser/test'
  }))
}))
vi.mock('./requestGuard', () => ({
  WebSocketCdpTransport: { connect: vi.fn(async () => ({})) },
  BrowserRequestGuard: class BrowserRequestGuard {
    start = mocks.guardStart
    close = mocks.guardClose
    stats = () => ({ blockedRequests: 3, guardedSessions: 1 })
  }
}))

import { StagehandBrowserEngine } from './stagehand'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.currentUrl = 'about:blank'
  mocks.browser.closed = false
  mocks.page.url.mockImplementation(async () => mocks.currentUrl)
  mocks.page.goto.mockImplementation(async (url: string) => { mocks.currentUrl = url })
  mocks.launch.mockImplementation(async () => {
    mocks.browser.closed = false
    return mocks.browser
  })
  mocks.create.mockResolvedValue(mocks.client)
})

afterEach(async () => {
  await fs.rm(mocks.root, { recursive: true, force: true })
})

describe('StagehandBrowserEngine lifecycle', () => {
  it('launches a local headless browser and delegates real AI operations', async () => {
    const engine = new StagehandBrowserEngine()
    const opened = await engine.open('task-1', 'https://example.com', true)
    expect(opened).toMatchObject({
      engine: 'stagehand',
      mode: 'headless',
      aiAvailable: true,
      blockedRequests: 3,
      url: 'https://example.com/'
    })
    expect(mocks.launch).toHaveBeenCalledWith(expect.objectContaining({
      executablePath: '/opt/chrome',
      headless: true,
      preserveUserDataDir: true,
      acceptDownloads: false,
      chromiumSandbox: true
    }))
    expect(mocks.guardStart).toHaveBeenCalledOnce()

    await expect(engine.observe('task-1', 'Find save')).resolves.toEqual([
      { selector: '#save', description: 'Save button', method: 'click', arguments: [] }
    ])
    await expect(engine.act('task-1', 'Click save')).resolves.toMatchObject({
      actionDescription: 'Clicked Save',
      actions: 1
    })
    await expect(engine.extractStructured('task-1', 'Extract the title', {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title']
    })).resolves.toEqual({ title: 'Example' })
    const schema = mocks.client.extract.mock.calls[0][1] as {
      safeParse: (value: unknown) => { success: boolean }
    }
    expect(schema.safeParse({ title: 'Valid' }).success).toBe(true)
    expect(schema.safeParse({ title: 4 }).success).toBe(false)
    expect((await engine.state('task-1')).actionCount).toBe(4)
  })

  it('relaunches headed for explicit user takeover and preserves the isolated profile', async () => {
    const engine = new StagehandBrowserEngine()
    await engine.open('task-1', 'https://example.com', true)
    const firstProfile = mocks.launch.mock.calls[0][0].userDataDir
    const visible = await engine.show('task-1')
    expect(mocks.launch).toHaveBeenCalledTimes(2)
    expect(mocks.launch.mock.calls[1][0]).toMatchObject({
      headless: false,
      userDataDir: firstProfile
    })
    expect(visible.mode).toBe('visible')
    expect(visible.notice).toContain('unsaved page state')
    expect(mocks.client.close).toHaveBeenCalled()
    expect(mocks.browser.close).toHaveBeenCalled()
  })

  it('closes the SDK, browser, and owner-only profile on task disposal', async () => {
    const engine = new StagehandBrowserEngine()
    await engine.open('task-1', 'https://example.com', true)
    const profile = mocks.launch.mock.calls[0][0].userDataDir as string
    await engine.disposeScope('task-1', true)
    expect(mocks.guardClose).toHaveBeenCalled()
    expect(mocks.client.close).toHaveBeenCalled()
    expect(mocks.browser.close).toHaveBeenCalled()
    expect(engine.activeSessions()).toBe(0)
    await expect(fs.stat(profile)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(engine.state('task-1')).rejects.toThrow('not running')
  })
})
