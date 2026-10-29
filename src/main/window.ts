import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'

let mainWindow: BrowserWindow | null = null

/* Window presentation ------------------------------------------------------------
 * Whether the window can actually be seen decides a few things upstream, most
 * importantly the out-of-window signal for an approval nobody has answered yet. */

export type WindowPresentation = 'visible' | 'minimized' | 'hidden' | 'none'

type PresentationListener = () => void
const presentationListeners = new Set<PresentationListener>()

export function getWindowPresentation(): WindowPresentation {
  const win = getMainWindow()
  if (!win) return 'none'
  if (win.isMinimized()) return 'minimized'
  if (!win.isVisible()) return 'hidden'
  return 'visible'
}

export function isMainWindowFocused(): boolean {
  return Boolean(getMainWindow()?.isFocused())
}

/**
 * Subscribe to anything that changes whether the window can be seen. The
 * listener is kept here rather than on a per-window basis so a window recreated
 * after `activate` cannot stack a second handler on the same event.
 */
export function onMainWindowPresentationChange(listener: PresentationListener): () => void {
  presentationListeners.add(listener)
  return () => {
    presentationListeners.delete(listener)
  }
}

function announcePresentationChange(): void {
  for (const listener of presentationListeners) {
    try {
      listener()
    } catch {
      // A failing listener must not take the window down with it.
    }
  }
}

export interface ApprovalAttentionState {
  hasPendingApproval: boolean
  presentation: WindowPresentation
  focused: boolean
}

export interface ApprovalAttentionPlan {
  tooltipWaiting: boolean
  flash: boolean
  showWindow: boolean
  balloon: boolean
}

function noAttention(): ApprovalAttentionPlan {
  return { tooltipWaiting: false, flash: false, showWindow: false, balloon: false }
}

/**
 * The approval dialog only exists once the renderer paints it, so a window that
 * is minimized or hidden in the tray leaves the task blocked with nothing on
 * screen to answer. Each state gets the loudest native signal it can actually
 * deliver: an unfocused but visible window flashes, a hidden window has no
 * taskbar button to flash so it comes back, and a minimized one keeps its place
 * in the taskbar and talks through the tray instead.
 */
export function planApprovalAttention(
  state: ApprovalAttentionState
): ApprovalAttentionPlan {
  if (!state.hasPendingApproval) return noAttention()

  if (state.presentation === 'visible') {
    // The dialog is already on screen; ask for attention without stealing focus.
    if (state.focused) return noAttention()
    return { tooltipWaiting: true, flash: true, showWindow: false, balloon: false }
  }

  if (state.presentation === 'hidden') {
    return { tooltipWaiting: true, flash: true, showWindow: true, balloon: false }
  }

  if (state.presentation === 'minimized') {
    return { tooltipWaiting: true, flash: true, showWindow: false, balloon: true }
  }

  // No window to show or flash: the tray is the only thing left that can speak.
  return { tooltipWaiting: true, flash: false, showWindow: false, balloon: true }
}

function resolveIcon(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../resources/icon.png')
}

function titleBarColors(): { color: string; symbolColor: string } {
  return { color: '#242624', symbolColor: '#D9DCD9' }
}

export function applyTitleBarTheme(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    mainWindow.setTitleBarOverlay({
      ...titleBarColors(),
      height: 44
    })
  } catch {
    // Title bar overlays are not available on every platform.
  }
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#191B1A',
    icon: resolveIcon(),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      ...titleBarColors(),
      height: 44
    },
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // Safety fallback: if ready-to-show is delayed by GPU or background throttling,
  // ensure the window is still presented so the process never runs invisibly.
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show()
    }
  }, 1500)

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[window] Failed to load renderer: ${errorDescription} (${errorCode}) at ${validatedURL}`)
  })

  /* Electron installs no default right-click menu, so in a frameless window a
   * right-click did nothing at all: no Copy on selected text, no Paste in the
   * composer, no spelling suggestions even though spellcheck is on. The edit
   * roles go through webContents, so they share the native undo stack rather
   * than the deprecated renderer-side commands. */
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    const items: MenuItemConstructorOptions[] = []
    if (params.isEditable) {
      for (const suggestion of (params.dictionarySuggestions ?? []).slice(0, 4)) {
        items.push({
          label: suggestion,
          click: () => win.webContents.replaceMisspelling(suggestion)
        })
      }
      if (items.length) items.push({ type: 'separator' })
      items.push(
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { role: 'selectAll' }
      )
    } else if (params.selectionText) {
      items.push({ role: 'copy', enabled: params.editFlags.canCopy })
    }
    if (!items.length) return
    Menu.buildFromTemplate(items).popup({ window: win })
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[window] Renderer process gone:', details.reason, details.exitCode)
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL() ?? ''
    if (url !== current) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  /* Whether the window can be seen is load-bearing for the approval signal, so
   * every way of losing or regaining the screen is reported. Each handler takes
   * no arguments and is idempotent on the receiving side. */
  mainWindow.on('show', announcePresentationChange)
  mainWindow.on('hide', announcePresentationChange)
  mainWindow.on('minimize', announcePresentationChange)
  mainWindow.on('restore', announcePresentationChange)
  mainWindow.on('focus', announcePresentationChange)
  mainWindow.on('blur', announcePresentationChange)

  mainWindow.on('closed', () => {
    mainWindow = null
    announcePresentationChange()
  })

  return mainWindow
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function showMainWindow(): BrowserWindow {
  let win = getMainWindow()
  if (!win || win.isDestroyed()) {
    win = createMainWindow()
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.setAlwaysOnTop(true)
  win.focus()
  win.setAlwaysOnTop(false)
  return win
}
