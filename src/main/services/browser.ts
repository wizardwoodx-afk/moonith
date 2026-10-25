import { BrowserWindow, session } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { BrowserState } from '@shared/types'
import { getPaths } from '../paths'
import { atomicWriteFileSync } from '../atomic'
import { assertSafeNavigation, inspectNavigationTarget } from '../selfimpulse/coworker/navigation'
import { taskIdForBrowserScope } from '../selfimpulse/coworker/scope'
import { store } from '../store'
import {
  StagehandBrowserEngine,
  type BrowserActResult,
  type BrowserObservation
} from '../browser/stagehand'
import { asBrowserError, BrowserError, browserErrorMessage, isNavigationBlocked, sanitizeBrowserText } from '../browser/errors'

interface BrowserEntry {
  win: BrowserWindow
  lastAction: string
  screenshotRelPath?: string
  notice?: string
  startedAt: string
}

interface ScopeRegistry {
  version: 1
  scopes: Record<string, string[]>
}

const NETWORK_URLS = ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*']

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function jsString(value: string): string {
  return JSON.stringify(value)
}

/** Native per-actor Chromium browser; no helper service or remote runtime. */
export class BrowserService {
  private readonly entries = new Map<string, BrowserEntry>()
  private readonly knownScopes = new Map<string, Set<string>>()
  private readonly configuredSessions = new WeakSet<Electron.Session>()
  private readonly blockedBySession = new WeakMap<Electron.Session, number>()
  private readonly stagehand = new StagehandBrowserEngine()
  private readonly activeEngines = new Map<string, 'stagehand' | 'chromium'>()
  private registryLoaded = false
  private legacyClear: Promise<void> | null = null

  private preferences(): { engine: 'stagehand' | 'chromium'; headless: boolean } {
    return store.getPublicSettings().browser
  }

  private registryFile(): string {
    return join(getPaths().root, 'browser-scopes.json')
  }

  private loadRegistry(): void {
    if (this.registryLoaded) return
    this.registryLoaded = true
    try {
      const parsed = JSON.parse(readFileSync(this.registryFile(), 'utf8')) as Partial<ScopeRegistry>
      if (parsed.version !== 1 || !parsed.scopes || typeof parsed.scopes !== 'object') return
      for (const [taskId, values] of Object.entries(parsed.scopes)) {
        if (!Array.isArray(values)) continue
        const valid = values.filter(
          (value): value is string => typeof value === 'string' && taskIdForBrowserScope(value) === taskId
        )
        if (valid.length) this.knownScopes.set(taskId, new Set(valid))
      }
    } catch {
      // Missing registry is normal; active windows are registered as used.
    }
  }

  private saveRegistry(): void {
    const scopes: Record<string, string[]> = {}
    for (const [taskId, values] of this.knownScopes) {
      if (values.size) scopes[taskId] = [...values].sort()
    }
    atomicWriteFileSync(this.registryFile(), JSON.stringify({ version: 1, scopes } satisfies ScopeRegistry))
  }

  private rememberScope(scope: string): void {
    this.loadRegistry()
    const taskId = taskIdForBrowserScope(scope)
    if (!taskId) throw new Error('Invalid browser scope.')
    const scopes = this.knownScopes.get(taskId) ?? new Set<string>()
    if (scopes.has(scope)) return
    scopes.add(scope)
    this.knownScopes.set(taskId, scopes)
    this.saveRegistry()
  }

  private partition(scope: string): string {
    return `persist:selfimpulse-browser-${createHash('sha256').update(scope).digest('hex').slice(0, 32)}`
  }

  private configureSession(browserSession: Electron.Session): void {
    if (this.configuredSessions.has(browserSession)) return
    this.configuredSessions.add(browserSession)
    browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    browserSession.setPermissionCheckHandler(() => false)
    browserSession.on('will-download', (event) => event.preventDefault())
    // Check redirects and subresources too, not only the initial URL.
    browserSession.webRequest.onBeforeRequest({ urls: NETWORK_URLS }, (details, callback) => {
      const block = (): void => {
        this.blockedBySession.set(browserSession, (this.blockedBySession.get(browserSession) ?? 0) + 1)
        callback({ cancel: true })
      }
      try {
        inspectNavigationTarget(details.url)
      } catch {
        block()
        return
      }
      void assertSafeNavigation(details.url).then(
        () => callback({}),
        block
      )
    })
  }

  private guardNavigation(window: BrowserWindow): void {
    const check = (event: Electron.Event, url: string): void => {
      event.preventDefault()
      void assertSafeNavigation(url).then(
        (safe) => {
          if (!window.isDestroyed()) void window.loadURL(safe.toString()).catch(() => undefined)
        },
        () => undefined
      )
    }
    window.webContents.on('will-navigate', check)
    window.webContents.on('will-redirect', check)
    window.webContents.setWindowOpenHandler(({ url }) => {
      void assertSafeNavigation(url).then(
        (safe) => {
          if (!window.isDestroyed()) void window.loadURL(safe.toString()).catch(() => undefined)
        },
        () => undefined
      )
      return { action: 'deny' }
    })
  }

  private ensureWindow(scope: string): BrowserEntry {
    this.rememberScope(scope)
    const existing = this.entries.get(scope)
    if (existing && !existing.win.isDestroyed()) {
      this.activeEngines.set(scope, 'chromium')
      return existing
    }

    const partition = this.partition(scope)
    const browserSession = session.fromPartition(partition)
    this.configureSession(browserSession)
    const win = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      title: 'SelfImpulse Browser',
      backgroundColor: '#f7f4ee',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition,
        backgroundThrottling: false,
        spellcheck: false,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    })
    this.guardNavigation(win)
    win.on('closed', () => {
      const entry = this.entries.get(scope)
      if (entry?.win === win) this.entries.delete(scope)
      if (this.activeEngines.get(scope) === 'chromium') this.activeEngines.delete(scope)
    })
    const entry: BrowserEntry = {
      win,
      lastAction: 'Built-in Chromium ready',
      startedAt: new Date().toISOString()
    }
    this.entries.set(scope, entry)
    this.activeEngines.set(scope, 'chromium')
    return entry
  }

  private async waitForLoad(win: BrowserWindow, timeoutMs = 30000): Promise<void> {
    if (!win.webContents.isLoading() && win.webContents.getURL()) return
    await Promise.race([
      new Promise<void>((resolve) => {
        const done = (): void => {
          win.webContents.removeListener('did-finish-load', done)
          win.webContents.removeListener('did-fail-load', done)
          resolve()
        }
        win.webContents.once('did-finish-load', done)
        win.webContents.once('did-fail-load', done)
      }),
      sleep(timeoutMs)
    ])
  }

  private async clearLegacySharedProfile(): Promise<void> {
    if (!this.legacyClear) {
      this.legacyClear = (async () => {
        const legacy = session.fromPartition('persist:knight-browser')
        await Promise.all([
          legacy.clearStorageData().catch(() => undefined),
          legacy.clearCache().catch(() => undefined)
        ])
      })().catch(() => undefined)
    }
    await this.legacyClear
  }

  private async clearScope(scope: string): Promise<void> {
    const browserSession = session.fromPartition(this.partition(scope))
    await Promise.all([
      browserSession.clearStorageData().catch(() => undefined),
      browserSession.clearCache().catch(() => undefined),
      browserSession.clearAuthCache().catch(() => undefined)
    ])
  }

  async open(scope: string, url: string): Promise<BrowserState> {
    this.rememberScope(scope)
    const preferences = this.preferences()
    const active = this.activeEngines.get(scope)
    const retryFallback = preferences.engine === 'stagehand' &&
      active === 'chromium' && Boolean(this.entries.get(scope)?.notice)
    const engine = retryFallback ? 'stagehand' : active ?? preferences.engine
    if (engine === 'stagehand') {
      try {
        const state = await this.stagehand.open(scope, url, preferences.headless)
        const fallback = this.entries.get(scope)
        if (fallback && !fallback.win.isDestroyed()) fallback.win.destroy()
        this.entries.delete(scope)
        this.activeEngines.set(scope, 'stagehand')
        return state
      } catch (error) {
        if (this.stagehand.has(scope)) {
          this.activeEngines.set(scope, 'stagehand')
          const fallback = this.entries.get(scope)
          if (fallback && !fallback.win.isDestroyed()) fallback.win.destroy()
          this.entries.delete(scope)
        }
        if (this.activeEngines.get(scope) === 'stagehand' || isNavigationBlocked(error)) throw error
        // Deterministic browsing remains available when local Chrome or the
        // Stagehand runtime cannot start. AI methods never use this fallback.
        const fallback = await this.openChromium(scope, url)
        const entry = this.entries.get(scope)
        if (entry) entry.notice = `Built-in Chromium fallback: ${browserErrorMessage(error)}`
        return { ...fallback, notice: entry?.notice }
      }
    }
    return this.openChromium(scope, url)
  }

  private async openChromium(scope: string, url: string): Promise<BrowserState> {
    await this.clearLegacySharedProfile()
    const safe = await assertSafeNavigation(url)
    const entry = this.ensureWindow(scope)
    entry.lastAction = `Navigated to ${safe.toString()}`
    const blockedBefore = this.blockedBySession.get(entry.win.webContents.session) ?? 0
    try {
      await entry.win.loadURL(safe.toString())
      await this.waitForLoad(entry.win)
      return await this.state(scope)
    } catch (error) {
      const blockedAfter = this.blockedBySession.get(entry.win.webContents.session) ?? 0
      if (blockedAfter > blockedBefore) {
        throw new BrowserError(
          'BROWSER_SECURITY',
          'Navigation or a required page request was blocked by browser network policy. Use a verified public HTTP(S) destination.'
        )
      }
      throw asBrowserError(error, 'BROWSER_NAVIGATION_FAILED')
    }
  }

  async back(scope: string): Promise<BrowserState> {
    if (this.activeEngines.get(scope) === 'stagehand') return this.stagehand.back(scope)
    const entry = this.ensureWindow(scope)
    if (entry.win.webContents.canGoBack()) {
      entry.win.webContents.goBack()
      await this.waitForLoad(entry.win, 15000)
      entry.lastAction = 'Went back'
    }
    return this.state(scope)
  }

  async forward(scope: string): Promise<BrowserState> {
    if (this.activeEngines.get(scope) === 'stagehand') return this.stagehand.forward(scope)
    const entry = this.ensureWindow(scope)
    if (entry.win.webContents.canGoForward()) {
      entry.win.webContents.goForward()
      await this.waitForLoad(entry.win, 15000)
      entry.lastAction = 'Went forward'
    }
    return this.state(scope)
  }

  async reload(scope: string): Promise<BrowserState> {
    if (this.activeEngines.get(scope) === 'stagehand') return this.stagehand.reload(scope)
    const entry = this.ensureWindow(scope)
    entry.win.webContents.reload()
    await this.waitForLoad(entry.win, 20000)
    entry.lastAction = 'Reloaded page'
    return this.state(scope)
  }

  async click(scope: string, selector: string): Promise<BrowserState> {
    if (this.activeEngines.get(scope) === 'stagehand') return this.stagehand.click(scope, selector)
    const entry = this.ensureWindow(scope)
    const result = (await entry.win.webContents.executeJavaScript(
      `(() => {
        const el = document.querySelector(${jsString(selector)});
        if (!el) return { ok: false, error: 'Element not found' };
        el.scrollIntoView({ block: 'center' });
        el.click();
        return { ok: true };
      })()`,
      true
    )) as { ok: boolean; error?: string }
    if (!result.ok) throw new Error(result.error ?? 'Click failed')
    entry.lastAction = `Clicked ${selector}`
    await sleep(250)
    return this.state(scope)
  }

  async type(scope: string, selector: string, text: string, submit = false): Promise<BrowserState> {
    if (this.activeEngines.get(scope) === 'stagehand') return this.stagehand.type(scope, selector, text, submit)
    const entry = this.ensureWindow(scope)
    const result = (await entry.win.webContents.executeJavaScript(
      `(() => {
        const el = document.querySelector(${jsString(selector)});
        if (!el) return { ok: false, error: 'Element not found' };
        el.scrollIntoView({ block: 'center' });
        if (el.focus) el.focus();
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) setter.call(el, ${jsString(text)});
          else el.value = ${jsString(text)};
        } else if (el.isContentEditable) {
          el.innerText = ${jsString(text)};
        } else {
          return { ok: false, error: 'Element is not editable' };
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        if (${submit ? 'true' : 'false'}) {
          const form = el.form;
          if (form && form.requestSubmit) form.requestSubmit();
          else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        }
        return { ok: true };
      })()`,
      true
    )) as { ok: boolean; error?: string }
    if (!result.ok) throw new Error(result.error ?? 'Typing failed')
    entry.lastAction = `Typed into ${selector}`
    await sleep(250)
    return this.state(scope)
  }

  async select(scope: string, selector: string, value: string): Promise<BrowserState> {
    if (this.activeEngines.get(scope) === 'stagehand') return this.stagehand.select(scope, selector, value)
    const entry = this.ensureWindow(scope)
    const result = (await entry.win.webContents.executeJavaScript(
      `(() => {
        const el = document.querySelector(${jsString(selector)});
        if (!el) return { ok: false, error: 'Element not found' };
        el.value = ${jsString(value)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true };
      })()`,
      true
    )) as { ok: boolean; error?: string }
    if (!result.ok) throw new Error(result.error ?? 'Select failed')
    entry.lastAction = `Selected ${value} in ${selector}`
    await sleep(200)
    return this.state(scope)
  }

  async press(scope: string, key: string): Promise<BrowserState> {
    if (this.activeEngines.get(scope) === 'stagehand') return this.stagehand.press(scope, key)
    const entry = this.ensureWindow(scope)
    entry.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key })
    if (key.length === 1) entry.win.webContents.sendInputEvent({ type: 'char', keyCode: key })
    entry.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key })
    entry.lastAction = `Pressed ${key}`
    await sleep(200)
    return this.state(scope)
  }

  async scroll(scope: string, direction: 'up' | 'down' = 'down', amount = 700): Promise<BrowserState> {
    if (this.activeEngines.get(scope) === 'stagehand') return this.stagehand.scroll(scope, direction, amount)
    const entry = this.ensureWindow(scope)
    await entry.win.webContents.executeJavaScript(
      `window.scrollBy({ top: ${direction === 'down' ? amount : -amount}, behavior: 'smooth' }); true`,
      true
    )
    entry.lastAction = `Scrolled ${direction}`
    await sleep(350)
    return this.state(scope)
  }

  async extract(scope: string, selector?: string): Promise<{ text: string; state: BrowserState }> {
    if (this.activeEngines.get(scope) === 'stagehand') return this.stagehand.extract(scope, selector)
    const entry = this.ensureWindow(scope)
    const result = (await entry.win.webContents.executeJavaScript(
      `(() => {
        const el = ${selector ? `document.querySelector(${jsString(selector)})` : 'document.body'};
        if (!el) return { error: 'Element not found' };
        return {
          url: location.href,
          title: document.title,
          text: (el.innerText || el.textContent || '').trim().slice(0, 30000)
        };
      })()`,
      true
    )) as { text?: string; title?: string; url?: string; error?: string }
    if (result.error) throw new Error(result.error)
    entry.lastAction = selector ? `Read ${selector}` : 'Read page'
    return { text: result.text || '(no readable text)', state: await this.state(scope) }
  }

  async wait(scope: string, selector?: string, timeoutMs = 10000): Promise<BrowserState> {
    if (this.activeEngines.get(scope) === 'stagehand') return this.stagehand.wait(scope, selector, timeoutMs)
    const entry = this.ensureWindow(scope)
    if (selector) {
      await entry.win.webContents.executeJavaScript(
        `new Promise((resolve) => {
          const started = Date.now();
          const tick = () => {
            if (document.querySelector(${jsString(selector)})) return resolve(true);
            if (Date.now() - started > ${timeoutMs}) return resolve(false);
            setTimeout(tick, 120);
          };
          tick();
        })`,
        true
      )
      entry.lastAction = `Waited for ${selector}`
    } else {
      await sleep(timeoutMs)
      entry.lastAction = `Waited ${timeoutMs}ms`
    }
    return this.state(scope)
  }

  async screenshot(scope: string, workspace: string): Promise<BrowserState & { screenshotPath: string }> {
    if (this.activeEngines.get(scope) === 'stagehand') return this.stagehand.screenshot(scope, workspace)
    const entry = this.ensureWindow(scope)
    const image = await entry.win.webContents.capturePage()
    const dir = join(workspace, 'browser')
    await fs.mkdir(dir, { recursive: true })
    const file = join(dir, `screenshot-${randomUUID()}.png`)
    await fs.writeFile(file, image.toPNG(), { flag: 'wx', mode: 0o600 })
    entry.screenshotRelPath = relative(workspace, file)
    return { ...(await this.state(scope)), screenshotPath: file }
  }

  async state(scope: string): Promise<BrowserState> {
    if (this.activeEngines.get(scope) === 'stagehand') return this.stagehand.state(scope)
    const entry = this.ensureWindow(scope)
    let url = ''
    let title = ''
    if (!entry.win.isDestroyed()) {
      url = entry.win.webContents.getURL()
      title = entry.win.webContents.getTitle()
    }
    const browserSession = session.fromPartition(this.partition(scope))
    return {
      open: !entry.win.isDestroyed(),
      url: sanitizeBrowserText(url),
      title: sanitizeBrowserText(title).slice(0, 2000),
      screenshotRelPath: entry.screenshotRelPath,
      lastAction: sanitizeBrowserText(entry.lastAction).slice(0, 1000),
      updatedAt: new Date().toISOString(),
      scope,
      engine: 'chromium',
      mode: entry.win.isVisible() ? 'visible' : 'headless',
      aiAvailable: false,
      blockedRequests: this.blockedBySession.get(browserSession) ?? 0,
      notice: entry.notice,
      startedAt: entry.startedAt
    }
  }

  async show(scope: string): Promise<BrowserState> {
    if (this.activeEngines.get(scope) === 'stagehand') return this.stagehand.show(scope)
    if (!this.entries.has(scope)) {
      throw new BrowserError(
        'BROWSER_CLOSED',
        'This task has no live browser session. Reopen the page before asking to take over.'
      )
    }
    const entry = this.ensureWindow(scope)
    if (entry.win.isMinimized()) entry.win.restore()
    entry.win.show()
    entry.win.focus()
    return this.state(scope)
  }

  private async ai<T>(scope: string, operation: () => Promise<T>): Promise<T> {
    this.rememberScope(scope)
    if (this.preferences().engine === 'chromium' && this.activeEngines.get(scope) !== 'stagehand') {
      throw new BrowserError(
        'BROWSER_AI_UNAVAILABLE',
        'AI browser actions require Stagehand. Choose Stagehand in Settings → Browser, or continue with selector-based Built-in Chromium tools.'
      )
    }
    if (this.activeEngines.get(scope) === 'chromium' && this.entries.has(scope)) {
      throw new BrowserError(
        'BROWSER_AI_UNAVAILABLE',
        'This page is open in Built-in Chromium, which does not provide AI actions. Reopen it with Stagehand after installing Chrome, or continue with selector-based browser tools.'
      )
    }
    try {
      const result = await operation()
      this.activeEngines.set(scope, 'stagehand')
      return result
    } catch (error) {
      if (this.stagehand.has(scope)) this.activeEngines.set(scope, 'stagehand')
      throw error
    }
  }

  async observe(scope: string, instruction?: string): Promise<BrowserObservation[]> {
    return this.ai(scope, () => this.stagehand.observe(scope, instruction, this.preferences().headless))
  }

  async act(scope: string, instruction: string): Promise<BrowserActResult> {
    return this.ai(scope, () => this.stagehand.act(scope, instruction, this.preferences().headless))
  }

  async extractStructured(
    scope: string,
    instruction: string,
    schema?: Record<string, unknown>
  ): Promise<unknown> {
    return this.ai(scope, () =>
      this.stagehand.extractStructured(scope, instruction, schema, this.preferences().headless)
    )
  }

  async status() {
    const preferences = this.preferences()
    const runtime = await this.stagehand.status()
    const chromiumSessions = [...this.entries.values()].filter((entry) => !entry.win.isDestroyed()).length
    return {
      engine: preferences.engine,
      headless: preferences.headless,
      ...runtime,
      activeSessions: chromiumSessions + this.stagehand.activeSessions()
    }
  }

  /** Close and erase every Captain/Crew browser profile belonging to a task. */
  async disposeTask(taskId: string): Promise<void> {
    this.loadRegistry()
    const scopes = new Set<string>([taskId, ...(this.knownScopes.get(taskId) ?? [])])
    for (const scope of this.entries.keys()) {
      if (taskIdForBrowserScope(scope) === taskId) scopes.add(scope)
    }
    for (const scope of scopes) {
      const entry = this.entries.get(scope)
      if (entry && !entry.win.isDestroyed()) entry.win.destroy()
      this.entries.delete(scope)
      await this.stagehand.disposeScope(scope, true)
      this.activeEngines.delete(scope)
      await this.clearScope(scope)
    }
    this.knownScopes.delete(taskId)
    this.saveRegistry()
  }

  async disposeAll(): Promise<void> {
    for (const entry of this.entries.values()) {
      if (!entry.win.isDestroyed()) entry.win.destroy()
    }
    this.entries.clear()
    this.activeEngines.clear()
    await this.stagehand.disposeAll()
  }

  getBrowserDataDir(): string {
    return getPaths().root
  }
}

export const browserService = new BrowserService()
