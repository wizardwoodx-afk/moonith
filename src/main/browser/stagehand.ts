import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, relative } from 'node:path'
import { z } from 'zod'
import type {
  ClientLLM,
  Page,
  Stagehand,
  StagehandBrowser
} from '@browserbasehq/stagehand'
import type { BrowserState } from '@shared/types'
import { getPaths } from '../paths'
import { store } from '../store'
import { taskIdForBrowserScope } from '../selfimpulse/coworker/scope'
import { assertSafeNavigation } from '../selfimpulse/coworker/navigation'
import { createBrowserModel, type BrowserModelConfig } from './model'
import {
  assertStagehandSandboxSupported,
  findChromeExecutable,
  readDevToolsEndpoint
} from './chrome'
import { asBrowserError, BrowserError, browserErrorMessage, sanitizeBrowserText } from './errors'
import { BrowserRequestGuard, WebSocketCdpTransport } from './requestGuard'

interface StagehandEntry {
  browser: StagehandBrowser
  client: Stagehand
  guard: BrowserRequestGuard
  profileDir: string
  headless: boolean
  lastAction: string
  screenshotRelPath?: string
  notice?: string
  startedAt: string
  actionCount: number
}

export interface BrowserObservation {
  selector: string
  description: string
  method?: string
  arguments?: string[]
}

export interface BrowserActResult {
  message: string
  actionDescription: string
  actions: number
}

const STAGEHAND_VERSION = '4.3.0'
const MAX_SCHEMA_BYTES = 64_000

function profileDir(scope: string): string {
  const id = createHash('sha256').update(scope).digest('hex').slice(0, 32)
  return join(getPaths().root, 'browser-ai', id)
}

function schemaFromJson(input: Record<string, unknown>): z.ZodType {
  if (input.type !== 'object') {
    throw new BrowserError('BROWSER_MODEL_INVALID', 'A browser extraction schema must have "type": "object".')
  }
  let serialized: string
  try {
    serialized = JSON.stringify(input)
  } catch (error) {
    throw new BrowserError('BROWSER_MODEL_INVALID', 'The extraction schema is not serializable.', { cause: error })
  }
  if (serialized.length > MAX_SCHEMA_BYTES) {
    throw new BrowserError('BROWSER_MODEL_INVALID', 'The extraction schema exceeds the 64 KB limit.')
  }
  try {
    return z.fromJSONSchema(input as Parameters<typeof z.fromJSONSchema>[0])
  } catch (error) {
    throw new BrowserError(
      'BROWSER_MODEL_INVALID',
      `The extraction schema is unsupported: ${browserErrorMessage(error)}`,
      { cause: error }
    )
  }
}

function resolveModel(scope: string): BrowserModelConfig {
  const taskId = taskIdForBrowserScope(scope)
  const task = taskId ? store.getTask(taskId) : undefined
  if (!task) {
    throw new BrowserError('BROWSER_MODEL_UNAVAILABLE', 'The task owning this browser session no longer exists.')
  }
  const settings = store.getPublicSettings()
  const providerId = task.providerId || settings.defaultProviderId
  const provider = providerId ? store.getProvider(providerId) : undefined
  if (!provider || !provider.enabled) {
    throw new BrowserError(
      'BROWSER_MODEL_UNAVAILABLE',
      'Enable the task’s AI provider before using AI browser actions.'
    )
  }
  const apiKey = store.getProviderSecret(provider.id)
  if (!apiKey) {
    throw new BrowserError(
      'BROWSER_MODEL_UNAVAILABLE',
      `Add an API key for ${provider.name} before using AI browser actions.`
    )
  }
  const model = task.model || settings.defaultModel || provider.models[0]
  if (!model) {
    throw new BrowserError('BROWSER_MODEL_UNAVAILABLE', 'Choose a model for this task before using AI browser actions.')
  }
  return {
    kind: provider.kind,
    providerId: provider.id,
    apiKey,
    baseUrl: provider.baseUrl,
    model
  }
}

function modelForScope(scope: string): ClientLLM {
  return createBrowserModel(() => resolveModel(scope), {
    protectMessages: async (messages) => {
      const taskId = taskIdForBrowserScope(scope)
      const task = taskId ? store.getTask(taskId) : undefined
      if (!task || !taskId) throw new BrowserError('BROWSER_MODEL_UNAVAILABLE', 'The browser task no longer exists.')
      const { governanceService } = await import('../services/governance')
      return governanceService.protectBrowserMessages(task, {
        actor: scope === taskId ? 'captain' : 'crew',
        actorId: scope === taskId ? 'Captain' : scope,
        runId: `browser:${scope}`
      }, messages)
    },
    recordUsage: async (config, usage) => {
      const { usageService } = await import('../services/usage')
      await usageService.record({
        agentId: scope === taskIdForBrowserScope(scope) ? 'Captain · AI Browser' : `Crew · AI Browser`,
        providerId: config.providerId,
        model: config.model,
        usage
      })
    }
  })
}

/** Native local Stagehand runtime. No Browserbase, MCP server, CLI, or hosted browser. */
export class StagehandBrowserEngine {
  private readonly entries = new Map<string, StagehandEntry>()
  private readonly ensuring = new Map<string, Promise<StagehandEntry>>()

  has(scope: string): boolean {
    return this.entries.has(scope) || this.ensuring.has(scope)
  }

  activeSessions(): number {
    return this.entries.size
  }

  async status(): Promise<{
    chromeAvailable: boolean
    stagehandReady: boolean
    stagehandVersion: string
    notice?: string
  }> {
    let chromeAvailable = false
    try {
      await findChromeExecutable()
      chromeAvailable = true
      assertStagehandSandboxSupported()
      return { chromeAvailable, stagehandReady: true, stagehandVersion: STAGEHAND_VERSION }
    } catch (error) {
      return {
        chromeAvailable,
        stagehandReady: false,
        stagehandVersion: STAGEHAND_VERSION,
        notice: browserErrorMessage(error)
      }
    }
  }

  private async ensure(scope: string, headless: boolean): Promise<StagehandEntry> {
    const existing = this.entries.get(scope)
    // Visibility changes apply to new sessions. An active page must not fail
    // repeatedly just because a setting changed; show() performs the explicit
    // headed relaunch when the user asks to take over.
    if (existing) return existing
    const pending = this.ensuring.get(scope)
    if (pending) return pending
    const created = this.create(scope, headless)
    this.ensuring.set(scope, created)
    try {
      return await created
    } finally {
      this.ensuring.delete(scope)
    }
  }

  private async create(scope: string, headless: boolean): Promise<StagehandEntry> {
    if (!taskIdForBrowserScope(scope)) throw new BrowserError('BROWSER_SECURITY', 'Invalid browser scope.')
    assertStagehandSandboxSupported()
    const executablePath = await findChromeExecutable()
    const directory = profileDir(scope)
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    if (process.platform !== 'win32') await fs.chmod(directory, 0o700)

    let browser: StagehandBrowser | undefined
    let client: Stagehand | undefined
    let guard: BrowserRequestGuard | undefined
    try {
      const { localBrowser, Stagehand: LocalStagehand } = await import('@browserbasehq/stagehand')
      browser = await localBrowser.launch({
        executablePath,
        headless,
        userDataDir: directory,
        preserveUserDataDir: true,
        chromiumSandbox: true,
        acceptDownloads: false,
        keepAlive: false,
        viewport: { width: 1280, height: 900 },
        // Do not permit arbitrary web origins to attach to the loopback CDP
        // socket. Node's private control connection does not need this waiver.
        ignoreDefaultArgs: ['--remote-allow-origins=*', '--enable-unsafe-extension-debugging']
      })
      const endpoint = await readDevToolsEndpoint(directory)
      const transport = await WebSocketCdpTransport.connect(endpoint.webSocketUrl)
      guard = new BrowserRequestGuard(transport, {
        onFatal: () => {
          this.entries.delete(scope)
          void browser?.close().catch(() => undefined)
        }
      })
      await guard.start()
      client = await LocalStagehand.create({
        browser,
        model: modelForScope(scope),
        logging: { level: 'off', format: 'json' }
      })
      const pages = await browser.context.pages()
      if (!pages.length) await browser.context.newPage()
      const entry: StagehandEntry = {
        browser,
        client,
        guard,
        profileDir: directory,
        headless,
        lastAction: 'AI browser ready',
        startedAt: new Date().toISOString(),
        actionCount: 0
      }
      this.entries.set(scope, entry)
      return entry
    } catch (error) {
      guard?.close()
      if (client) await client.close().catch(() => undefined)
      if (browser) await browser.close().catch(() => undefined)
      this.entries.delete(scope)
      throw asBrowserError(error, 'BROWSER_UNAVAILABLE')
    }
  }

  private async entry(scope: string): Promise<StagehandEntry> {
    const entry = this.entries.get(scope)
    if (!entry) throw new BrowserError('BROWSER_AI_UNAVAILABLE', 'The AI browser session is not running. Open a page first.')
    return entry
  }

  private async page(scope: string): Promise<{ entry: StagehandEntry; page: Page }> {
    const entry = await this.entry(scope)
    const page = await entry.browser.context.activePage() ?? await entry.browser.context.newPage()
    return { entry, page }
  }

  private note(entry: StagehandEntry, action: string): void {
    // AI-provided action labels become persistent task state and renderer UI.
    // Keep them bounded and never mirror a detected credential into that state.
    entry.lastAction = sanitizeBrowserText(action).slice(0, 1000)
    entry.actionCount += 1
  }

  async open(scope: string, url: string, headless = true): Promise<BrowserState> {
    const safe = await assertSafeNavigation(url)
    const entry = await this.ensure(scope, headless)
    const blockedBefore = entry.guard.stats().blockedRequests
    try {
      const page = await entry.browser.context.activePage() ?? await entry.browser.context.newPage()
      await page.goto(safe.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await assertSafeNavigation(await page.url())
      this.note(entry, `Navigated to ${safe.toString()}`)
      return this.state(scope)
    } catch (error) {
      if (entry.guard.stats().blockedRequests > blockedBefore) {
        throw new BrowserError(
          'BROWSER_SECURITY',
          'Navigation or a required page request was blocked by browser network policy. Use a verified public HTTP(S) destination.'
        )
      }
      throw asBrowserError(error, 'BROWSER_NAVIGATION_FAILED')
    }
  }

  async back(scope: string): Promise<BrowserState> {
    const { entry, page } = await this.page(scope)
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch((error) => {
      throw asBrowserError(error, 'BROWSER_NAVIGATION_FAILED')
    })
    this.note(entry, 'Went back')
    return this.state(scope)
  }

  async forward(scope: string): Promise<BrowserState> {
    const { entry, page } = await this.page(scope)
    await page.goForward({ waitUntil: 'domcontentloaded', timeout: 20_000 })
    this.note(entry, 'Went forward')
    return this.state(scope)
  }

  async reload(scope: string): Promise<BrowserState> {
    const { entry, page } = await this.page(scope)
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 })
    this.note(entry, 'Reloaded page')
    return this.state(scope)
  }

  async click(scope: string, selector: string): Promise<BrowserState> {
    const { entry, page } = await this.page(scope)
    await page.locator(selector).click().catch((error) => {
      throw asBrowserError(error, 'BROWSER_ACTION_FAILED')
    })
    this.note(entry, `Clicked ${selector}`)
    return this.state(scope)
  }

  async type(scope: string, selector: string, text: string, submit = false): Promise<BrowserState> {
    const { entry, page } = await this.page(scope)
    await page.locator(selector).fill(text).catch((error) => {
      throw asBrowserError(error, 'BROWSER_ACTION_FAILED')
    })
    if (submit) await page.keyPress('Enter')
    this.note(entry, `Typed into ${selector}`)
    return this.state(scope)
  }

  async select(scope: string, selector: string, value: string): Promise<BrowserState> {
    const { entry, page } = await this.page(scope)
    await page.locator(selector).selectOption([value])
    this.note(entry, `Selected an option in ${selector}`)
    return this.state(scope)
  }

  async press(scope: string, key: string): Promise<BrowserState> {
    const { entry, page } = await this.page(scope)
    await page.keyPress(key)
    this.note(entry, `Pressed ${key}`)
    return this.state(scope)
  }

  async scroll(scope: string, direction: 'up' | 'down', amount: number): Promise<BrowserState> {
    const { entry, page } = await this.page(scope)
    await page.evaluate(({ direction: way, amount: distance }) => {
      window.scrollBy({ top: way === 'down' ? distance : -distance, behavior: 'smooth' })
    }, { direction, amount })
    await page.waitForTimeout(250)
    this.note(entry, `Scrolled ${direction}`)
    return this.state(scope)
  }

  async extract(scope: string, selector?: string): Promise<{ text: string; state: BrowserState }> {
    const { entry, page } = await this.page(scope)
    const result = await page.evaluate((requested) => {
      const element = requested ? document.querySelector(requested) : document.body
      if (!element) return { error: 'Element not found' }
      return {
        text: ((element as HTMLElement).innerText || element.textContent || '').trim().slice(0, 30_000)
      }
    }, selector ?? null)
    if (result.error) throw new BrowserError('BROWSER_ACTION_FAILED', result.error)
    this.note(entry, selector ? `Read ${selector}` : 'Read page')
    return { text: result.text || '(no readable text)', state: await this.state(scope) }
  }

  async wait(scope: string, selector: string | undefined, timeoutMs: number): Promise<BrowserState> {
    const { entry, page } = await this.page(scope)
    if (selector) {
      const found = await page.waitForSelector(selector, { timeout: timeoutMs })
      if (!found) throw new BrowserError('BROWSER_TIMEOUT', `Element did not appear: ${selector}`)
      this.note(entry, `Waited for ${selector}`)
    } else {
      await page.waitForTimeout(timeoutMs)
      this.note(entry, `Waited ${timeoutMs}ms`)
    }
    return this.state(scope)
  }

  async observe(scope: string, instruction?: string, headless = true): Promise<BrowserObservation[]> {
    await this.ensure(scope, headless)
    const entry = await this.entry(scope)
    const result = await entry.client.observe(instruction).catch((error) => {
      throw asBrowserError(error, 'BROWSER_ACTION_FAILED')
    })
    this.note(entry, 'Observed actionable elements')
    return result.data.slice(0, 20).map((action) => ({
      selector: action.selector,
      description: action.description,
      method: action.method,
      arguments: action.arguments
    }))
  }

  async act(scope: string, instruction: string, headless = true): Promise<BrowserActResult> {
    await this.ensure(scope, headless)
    const entry = await this.entry(scope)
    const result = await entry.client.act(instruction).catch((error) => {
      throw asBrowserError(error, 'BROWSER_ACTION_FAILED')
    })
    if (!result.data.success) {
      throw new BrowserError('BROWSER_ACTION_FAILED', result.data.message || 'Stagehand could not complete the action.')
    }
    this.note(entry, result.data.actionDescription || 'Completed AI browser action')
    return {
      message: result.data.message,
      actionDescription: result.data.actionDescription,
      actions: result.data.actions.length
    }
  }

  async extractStructured(
    scope: string,
    instruction: string,
    schema?: Record<string, unknown>,
    headless = true
  ): Promise<unknown> {
    await this.ensure(scope, headless)
    const entry = await this.entry(scope)
    const result = schema
      ? await entry.client.extract(instruction, schemaFromJson(schema))
      : await entry.client.extract(instruction)
    this.note(entry, 'Extracted structured page data')
    return result.data
  }

  async screenshot(scope: string, workspace: string): Promise<BrowserState & { screenshotPath: string }> {
    const { entry, page } = await this.page(scope)
    const bytes = await page.screenshot()
    const directory = join(workspace, 'browser')
    await fs.mkdir(directory, { recursive: true })
    const file = join(directory, `screenshot-${randomUUID()}.png`)
    await fs.writeFile(file, Buffer.from(bytes), { flag: 'wx', mode: 0o600 })
    entry.screenshotRelPath = relative(workspace, file)
    return { ...(await this.state(scope)), screenshotPath: file }
  }

  async state(scope: string): Promise<BrowserState> {
    const entry = await this.entry(scope)
    try {
      const page = await entry.browser.context.activePage()
      const [url, title] = page ? await Promise.all([page.url(), page.title()]) : ['', '']
      return {
        open: !entry.browser.closed,
        url: sanitizeBrowserText(url),
        title: sanitizeBrowserText(title).slice(0, 2000),
        screenshotRelPath: entry.screenshotRelPath,
        lastAction: sanitizeBrowserText(entry.lastAction).slice(0, 1000),
        updatedAt: new Date().toISOString(),
        scope,
        engine: 'stagehand',
        mode: entry.headless ? 'headless' : 'visible',
        aiAvailable: true,
        actionCount: entry.actionCount,
        blockedRequests: entry.guard.stats().blockedRequests,
        notice: entry.notice,
        startedAt: entry.startedAt
      }
    } catch (error) {
      throw asBrowserError(error, 'BROWSER_CLOSED')
    }
  }

  /** Relaunch the same isolated profile headed so the user can take over. */
  async show(scope: string): Promise<BrowserState> {
    const current = await this.entry(scope)
    if (!current.headless) {
      const { page } = await this.page(scope)
      await page.evaluate(() => window.focus()).catch(() => undefined)
      return this.state(scope)
    }
    const page = await current.browser.context.activePage()
    const url = page ? await page.url() : ''
    const previousCount = current.actionCount
    await this.closeScope(scope, false)
    const entry = await this.ensure(scope, false)
    entry.actionCount = previousCount
    if (url && url !== 'about:blank') await this.open(scope, url, false)
    const visible = await this.entry(scope)
    visible.notice = 'Visible takeover reopened the current URL. Persistent site data was retained, but unsaved page state may have been reset.'
    this.note(visible, 'Shown in a visible browser window')
    return this.state(scope)
  }

  private async closeScope(scope: string, erase: boolean): Promise<void> {
    const entry = this.entries.get(scope)
    this.entries.delete(scope)
    if (!entry) {
      if (erase) await fs.rm(profileDir(scope), { recursive: true, force: true })
      return
    }
    entry.guard.close()
    await entry.client.close().catch(() => undefined)
    await entry.browser.close().catch(() => undefined)
    if (erase) await fs.rm(entry.profileDir, { recursive: true, force: true })
  }

  async disposeScope(scope: string, erase = true): Promise<void> {
    const pending = this.ensuring.get(scope)
    if (pending) await pending.catch(() => undefined)
    await this.closeScope(scope, erase)
  }

  async disposeAll(): Promise<void> {
    await Promise.allSettled([...this.ensuring.values()])
    const scopes = [...this.entries.keys()]
    await Promise.allSettled(scopes.map((scope) => this.closeScope(scope, false)))
  }
}
