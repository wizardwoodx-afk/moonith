import { BrowserWindow, session } from 'electron'
import { createHash } from 'node:crypto'
import { promises as fs, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { BrowserState } from '@shared/types'
import { getPaths } from '../paths'
import { atomicWriteFileSync } from '../atomic'
import { assertPublicHttpTarget, syncBlockedHostReason } from '../egressGuard'
import { taskIdForBrowserScope } from '../selfimpulse/coworker/scope'
import { camoufoxEngine } from './stealthBrowser/camoufoxEngine'

interface BrowserEntry {
  win: BrowserWindow
  lastAction: string
  screenshotRelPath?: string
}

interface ScopeRegistry {
  version: 1
  scopes: Record<string, string[]>
}

const ALLOWED_PROTOCOL = /^https?:/i

const NETWORK_URLS = ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*']

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function jsString(value: string): string {
  return JSON.stringify(value)
}

/**
 * The egress guard only speaks http(s). WebSocket requests share the same host
 * policy, so they are checked through the equivalent http(s) origin.
 */
function guardUrl(value: string): string | null {
  try {
    const parsed = new URL(value)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href
    if (parsed.protocol === 'ws:') {
      parsed.protocol = 'http:'
      return parsed.href
    }
    if (parsed.protocol === 'wss:') {
      parsed.protocol = 'https:'
      return parsed.href
    }
    return null
  } catch {
    return null
  }
}

/** Native per-actor Chromium browser; no helper service or remote runtime. */
class BrowserService {
  private readonly entries = new Map<string, BrowserEntry>()
  private readonly knownScopes = new Map<string, Set<string>>()
  private readonly configuredSessions = new WeakSet<Electron.Session>()
  private registryLoaded = false
  private legacyClear: Promise<void> | null = null

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
    browserSession.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0'
    )
    browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    browserSession.setPermissionCheckHandler(() => false)
    browserSession.on('will-download', (event) => event.preventDefault())
    // Redirects and subresources go through the same egress policy as the
    // initial navigation, so a public page cannot turn the browser into a
    // proxy for loopback, private, link-local or metadata addresses.
    browserSession.webRequest.onBeforeRequest({ urls: NETWORK_URLS }, (details, callback) => {
      const checked = guardUrl(details.url)
      if (!checked) {
        callback({ cancel: true })
        return
      }
      if (syncBlockedHostReason(checked)) {
        callback({ cancel: true })
        return
      }
      void assertPublicHttpTarget(checked).then(
        () => callback({}),
        () => callback({ cancel: true })
      )
    })
  }

  private guardNavigation(window: BrowserWindow, scope: string): void {
    const check = (event: Electron.Event, url: string): void => {
      const reason = syncBlockedHostReason(url)
      if (!reason) return
      event.preventDefault()
      const current = this.entries.get(scope)
      if (current) current.lastAction = `Blocked navigation: ${reason}`
    }
    window.webContents.on('will-navigate', check)
    window.webContents.on('will-redirect', check)
    window.webContents.setWindowOpenHandler(({ url }) => {
      // Popups go through the same guarded navigation as `browser_open`, so a
      // page cannot escape the egress guard by calling window.open.
      const reason = syncBlockedHostReason(url)
      if (reason) {
        const current = this.entries.get(scope)
        if (current) current.lastAction = `Blocked popup: ${reason}`
        return { action: 'deny' }
      }
      void assertPublicHttpTarget(url).then(
        (target) => {
          if (!window.isDestroyed()) void window.loadURL(target.url).catch(() => undefined)
        },
        () => undefined
      )
      return { action: 'deny' }
    })
  }

  private ensureWindow(scope: string): BrowserEntry {
    this.rememberScope(scope)
    const existing = this.entries.get(scope)
    if (existing && !existing.win.isDestroyed()) return existing

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
    this.guardNavigation(win, scope)
    win.webContents.on('did-finish-load', () => {
      win.webContents.executeJavaScript(camoufoxEngine.getStealthInjectionScript()).catch(() => undefined)
    })
    win.on('closed', () => {
      const entry = this.entries.get(scope)
      if (entry?.win === win) this.entries.delete(scope)
    })

    const entry: BrowserEntry = { win, lastAction: 'Opened browser' }
    this.entries.set(scope, entry)
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

  /**
   * Re-check the URL the window actually ended up on, after Chromium has
   * followed any redirects. `webRequest` already refuses every request to a
   * non-public host; this is the final content boundary if a Chromium path
   * bypasses that listener.
   */
  private async assertLoadedUrlIsPublic(entry: BrowserEntry): Promise<void> {
    if (entry.win.isDestroyed()) return
    const finalUrl = entry.win.webContents.getURL()
    if (!finalUrl || finalUrl === 'about:blank' || finalUrl.startsWith('chrome-error://')) return
    try {
      await assertPublicHttpTarget(finalUrl)
    } catch (error) {
      entry.lastAction = `Blocked: ${error instanceof Error ? error.message : String(error)}`
      await entry.win.loadURL('about:blank')
      throw error
    }
  }

  async open(scope: string, url: string): Promise<BrowserState> {
    await this.clearLegacySharedProfile()
    // The egress guard runs here, at the service boundary, not in the tool, so
    // `browser_open`, popups, the panel and any future caller are covered by
    // construction. Throws `EgressBlockedError`; tools turn it into a tool error.
    const target = await assertPublicHttpTarget(url)
    const entry = this.ensureWindow(scope)
    entry.lastAction = `Navigated to ${target.url}`
    await entry.win.loadURL(target.url)
    await this.waitForLoad(entry.win)
    await this.assertLoadedUrlIsPublic(entry)
    return this.state(scope)
  }

  async back(scope: string): Promise<BrowserState> {
    const entry = this.ensureWindow(scope)
    if (entry.win.webContents.canGoBack()) {
      entry.win.webContents.goBack()
      await this.waitForLoad(entry.win, 15000)
      entry.lastAction = 'Went back'
      await this.assertLoadedUrlIsPublic(entry)
    }
    return this.state(scope)
  }

  async forward(scope: string): Promise<BrowserState> {
    const entry = this.ensureWindow(scope)
    if (entry.win.webContents.canGoForward()) {
      entry.win.webContents.goForward()
      await this.waitForLoad(entry.win, 15000)
      entry.lastAction = 'Went forward'
      await this.assertLoadedUrlIsPublic(entry)
    }
    return this.state(scope)
  }

  async reload(scope: string): Promise<BrowserState> {
    const entry = this.ensureWindow(scope)
    entry.win.webContents.reload()
    await this.waitForLoad(entry.win, 20000)
    entry.lastAction = 'Reloaded page'
    await this.assertLoadedUrlIsPublic(entry)
    return this.state(scope)
  }

  async click(scope: string, selector: string): Promise<BrowserState> {
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

  async type(
    scope: string,
    selector: string,
    text: string,
    submit = false
  ): Promise<BrowserState> {
    const entry = this.ensureWindow(scope)
    const result = (await entry.win.webContents.executeJavaScript(
      `(() => {
        const el = document.querySelector(${jsString(selector)});
        if (!el) return { ok: false, error: 'Element not found' };
        el.scrollIntoView({ block: 'center' });
        if (el.focus) el.focus();
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, ${jsString(text)});
        else if (el.isContentEditable) el.innerText = ${jsString(text)};
        else el.value = ${jsString(text)};
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
    const entry = this.ensureWindow(scope)
    entry.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key })
    if (key.length === 1) {
      entry.win.webContents.sendInputEvent({ type: 'char', keyCode: key })
    } else {
      entry.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key })
    }
    entry.lastAction = `Pressed ${key}`
    await sleep(200)
    return this.state(scope)
  }

  async scroll(scope: string, direction: 'up' | 'down' = 'down', amount = 700): Promise<BrowserState> {
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
    const entry = this.ensureWindow(scope)
    // Reading is guarded too, because a page can arrive here without going
    // through `open()`: a link click the synchronous navigation pass could not
    // decide (a name that needs resolution) still loads. Refusing to hand back
    // text from a private host closes that path.
    await this.assertLoadedUrlIsPublic(entry)
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
    return {
      text: result.text || '(no readable text)',
      state: await this.state(scope)
    }
  }

  async wait(scope: string, selector?: string, timeoutMs = 10000): Promise<BrowserState> {
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

  async evaluate<T>(scope: string, script: string): Promise<T> {
    const entry = this.ensureWindow(scope)
    return (await entry.win.webContents.executeJavaScript(script, true)) as T
  }

  async screenshot(
    scope: string,
    workspace: string
  ): Promise<BrowserState & { screenshotPath: string }> {
    const entry = this.ensureWindow(scope)
    const image = await entry.win.webContents.capturePage()
    const dir = join(workspace, 'browser')
    await fs.mkdir(dir, { recursive: true })
    const file = join(dir, `screenshot-${Date.now()}.png`)
    await fs.writeFile(file, image.toPNG())
    entry.screenshotRelPath = relative(workspace, file)
    return { ...(await this.state(scope)), screenshotPath: file }
  }

  async state(scope: string): Promise<BrowserState> {
    const entry = this.ensureWindow(scope)
    let url = ''
    let title = ''
    if (!entry.win.isDestroyed()) {
      url = entry.win.webContents.getURL()
      title = entry.win.webContents.getTitle()
    }
    return {
      open: !entry.win.isDestroyed(),
      url,
      title,
      screenshotRelPath: entry.screenshotRelPath,
      lastAction: entry.lastAction,
      updatedAt: new Date().toISOString(),
      scope
    }
  }

  show(scope: string): void {
    const entry = this.ensureWindow(scope)
    if (entry.win.isMinimized()) entry.win.restore()
    entry.win.show()
    entry.win.focus()
  }

  dispose(scope: string): void {
    const entry = this.entries.get(scope)
    if (!entry) return
    this.entries.delete(scope)
    if (!entry.win.isDestroyed()) entry.win.destroy()
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
      await this.clearScope(scope)
    }
    this.knownScopes.delete(taskId)
    this.saveRegistry()
  }

  disposeAll(): void {
    for (const entry of this.entries.values()) {
      if (!entry.win.isDestroyed()) entry.win.destroy()
    }
    this.entries.clear()
  }

  getBrowserDataDir(): string {
    return getPaths().root
  }
}

export const browserService = new BrowserService()
