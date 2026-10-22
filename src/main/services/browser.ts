import { BrowserWindow, session } from 'electron'
import { promises as fs } from 'node:fs'
import { join, relative } from 'node:path'
import type { BrowserState } from '@shared/types'
import { getPaths } from '../paths'

interface BrowserEntry {
  win: BrowserWindow
  lastAction: string
  screenshotRelPath?: string
}

const ALLOWED_PROTOCOL = /^https?:/i

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function jsString(value: string): string {
  return JSON.stringify(value)
}

class BrowserService {
  private entries = new Map<string, BrowserEntry>()

  private ensureWindow(taskId: string): BrowserEntry {
    const existing = this.entries.get(taskId)
    if (existing && !existing.win.isDestroyed()) return existing

    const browserSession = session.fromPartition('persist:knight-browser')
    browserSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    browserSession.on('will-download', (event) => event.preventDefault())

    const win = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      title: 'Knight Browser',
      backgroundColor: '#f7f4ee',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: 'persist:knight-browser',
        backgroundThrottling: false,
        spellcheck: false
      }
    })

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (ALLOWED_PROTOCOL.test(url)) void win.loadURL(url)
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (event, url) => {
      if (!ALLOWED_PROTOCOL.test(url)) event.preventDefault()
    })
    win.on('closed', () => {
      const entry = this.entries.get(taskId)
      if (entry?.win === win) this.entries.delete(taskId)
    })

    const entry: BrowserEntry = { win, lastAction: 'Opened browser' }
    this.entries.set(taskId, entry)
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

  async open(taskId: string, url: string): Promise<BrowserState> {
    if (!ALLOWED_PROTOCOL.test(url)) throw new Error('Only http and https URLs can be opened.')
    const entry = this.ensureWindow(taskId)
    entry.lastAction = `Navigated to ${url}`
    await entry.win.loadURL(url)
    await this.waitForLoad(entry.win)
    return this.state(taskId)
  }

  async back(taskId: string): Promise<BrowserState> {
    const entry = this.ensureWindow(taskId)
    if (entry.win.webContents.canGoBack()) {
      entry.win.webContents.goBack()
      await this.waitForLoad(entry.win, 15000)
      entry.lastAction = 'Went back'
    }
    return this.state(taskId)
  }

  async forward(taskId: string): Promise<BrowserState> {
    const entry = this.ensureWindow(taskId)
    if (entry.win.webContents.canGoForward()) {
      entry.win.webContents.goForward()
      await this.waitForLoad(entry.win, 15000)
      entry.lastAction = 'Went forward'
    }
    return this.state(taskId)
  }

  async reload(taskId: string): Promise<BrowserState> {
    const entry = this.ensureWindow(taskId)
    entry.win.webContents.reload()
    await this.waitForLoad(entry.win, 20000)
    entry.lastAction = 'Reloaded page'
    return this.state(taskId)
  }

  async click(taskId: string, selector: string): Promise<BrowserState> {
    const entry = this.ensureWindow(taskId)
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
    return this.state(taskId)
  }

  async type(
    taskId: string,
    selector: string,
    text: string,
    submit = false
  ): Promise<BrowserState> {
    const entry = this.ensureWindow(taskId)
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
    return this.state(taskId)
  }

  async select(
    taskId: string,
    selector: string,
    value: string
  ): Promise<BrowserState> {
    const entry = this.ensureWindow(taskId)
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
    return this.state(taskId)
  }

  async press(taskId: string, key: string): Promise<BrowserState> {
    const entry = this.ensureWindow(taskId)
    entry.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key })
    if (key.length === 1) {
      entry.win.webContents.sendInputEvent({ type: 'char', keyCode: key })
    } else {
      entry.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key })
    }
    entry.lastAction = `Pressed ${key}`
    await sleep(200)
    return this.state(taskId)
  }

  async scroll(taskId: string, direction: 'up' | 'down' = 'down', amount = 700): Promise<BrowserState> {
    const entry = this.ensureWindow(taskId)
    await entry.win.webContents.executeJavaScript(
      `window.scrollBy({ top: ${direction === 'down' ? amount : -amount}, behavior: 'smooth' }); true`,
      true
    )
    entry.lastAction = `Scrolled ${direction}`
    await sleep(350)
    return this.state(taskId)
  }

  async extract(taskId: string, selector?: string): Promise<{ text: string; state: BrowserState }> {
    const entry = this.ensureWindow(taskId)
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
      state: await this.state(taskId)
    }
  }

  async wait(taskId: string, selector?: string, timeoutMs = 10000): Promise<BrowserState> {
    const entry = this.ensureWindow(taskId)
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
    return this.state(taskId)
  }

  async screenshot(taskId: string, workspace: string): Promise<BrowserState> {
    const entry = this.ensureWindow(taskId)
    const image = await entry.win.webContents.capturePage()
    const dir = join(workspace, 'browser')
    await fs.mkdir(dir, { recursive: true })
    const file = join(dir, `screenshot-${Date.now()}.png`)
    await fs.writeFile(file, image.toPNG())
    entry.screenshotRelPath = relative(workspace, file)
    return this.state(taskId)
  }

  async state(taskId: string): Promise<BrowserState> {
    const entry = this.ensureWindow(taskId)
    let url = ''
    let title = ''
    if (!entry.win.isDestroyed()) {
      url = entry.win.webContents.getURL()
      title = entry.win.webContents.getTitle()
    }
    return {
      url,
      title,
      screenshotRelPath: entry.screenshotRelPath,
      lastAction: entry.lastAction,
      updatedAt: new Date().toISOString()
    }
  }

  show(taskId: string): void {
    const entry = this.ensureWindow(taskId)
    entry.win.show()
    entry.win.focus()
  }

  dispose(taskId: string): void {
    const entry = this.entries.get(taskId)
    if (!entry) return
    this.entries.delete(taskId)
    if (!entry.win.isDestroyed()) entry.win.destroy()
  }

  disposeAll(): void {
    for (const taskId of [...this.entries.keys()]) this.dispose(taskId)
  }

  getBrowserDataDir(): string {
    return getPaths().root
  }
}

export const browserService = new BrowserService()
