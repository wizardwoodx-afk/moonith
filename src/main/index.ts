import {
  app,
  type BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  Notification,
  protocol,
  Tray
} from 'electron'
import { mkdirSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { getPaths, migrateLegacyUserData, taskWorkspace } from './paths'
import { portableDataDir } from './portable'
import { store } from './store'
import { initSelfImpulseEngine } from './selfimpulse/bridge/facade'
import { registerIpc } from './ipc'
import { createMainWindow, getMainWindow, showMainWindow } from './window'
import { subscribeTaskEvents } from './emitter'
import { mcpManager } from './services/mcp'
import { scheduler } from './services/scheduler'
import { browserService } from './services/browser'
import { tableService } from './services/table'
import { channelService } from './services/channels'
import { approvals } from './approvals'
import { agentRuntime } from './agent/runtime'
import { isWithin } from './security'
import { mimeForPath } from './services/documents'
import { setBackendEventTarget } from './backend/ipc'
import { setEnterpriseMissionAuthorizer } from './selfimpulse/mission/enterpriseAdmission'
import { authorizeMissionTeam } from './enterpriseControl/runtime'
import { APP_NAME, signatureLine } from '@shared/identity'

// Fixed before anything resolves `userData`, including the single-instance lock.
app.setName('SelfImpulse')

// A portable.flag beside the install folder keeps the profile inside the distribution.
const portableData = portableDataDir(process.execPath)
if (portableData) {
  mkdirSync(portableData, { recursive: true })
  app.setPath('userData', portableData)
}

let tray: Tray | null = null
let isQuitting = false
let trayNoticeShown = false
// The window that already carries the close handler, so repeated `activate`
// events cannot stack a second listener on the same instance.
let closeBehaviourWindow: BrowserWindow | null = null

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'knight-file',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
])

function iconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../resources/icon.png')
}

function setupMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open SelfImpulse',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => showMainWindow()
        },
        { type: 'separator' },
        { role: 'quit', label: 'Quit SelfImpulse' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function setupTray(): void {
  const image = nativeImage.createFromPath(iconPath())
  if (image.isEmpty()) {
    console.warn('Tray icon missing at', iconPath())
    return
  }
  tray = new Tray(image.resize({ width: 16, height: 16 }))
  tray.setToolTip('SelfImpulse')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open SelfImpulse', click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', () => showMainWindow())
  tray.on('double-click', () => showMainWindow())
}

function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title, body, icon: iconPath() })
  notification.on('click', () => showMainWindow())
  notification.show()
}

const TASK_NOTIFICATION_MEMORY = 500

function setupTaskNotifications(): void {
  const previous = new Map<string, string>()
  subscribeTaskEvents((event) => {
    if (event.type !== 'task') return
    const task = event.task
    const before = previous.get(task.id)
    previous.set(task.id, task.status)
    // Map keeps insertion order, so dropping from the front evicts the oldest
    // task ids and keeps the map bounded for the lifetime of the process.
    while (previous.size > TASK_NOTIFICATION_MEMORY) {
      const oldest = previous.keys().next()
      if (oldest.done) break
      previous.delete(oldest.value)
    }
    if (!before || before === task.status) return
    if (task.status !== 'done' && task.status !== 'error') return
    const win = getMainWindow()
    const visible = Boolean(win && win.isVisible() && win.isFocused())
    if (visible) return
    if (task.status === 'error') {
      notify('Task needs attention', task.error || task.title)
    } else {
      notify('Task complete', task.title)
    }
  })
}

function registerFileProtocol(): void {
  protocol.handle('knight-file', async (request) => {
    try {
      const url = new URL(request.url)
      const segments = url.pathname
        .split('/')
        .filter(Boolean)
        .map((segment) => decodeURIComponent(segment))
      const taskId = segments.shift()
      if (!taskId || !store.getTask(taskId)) {
        return new Response('Not found', { status: 404 })
      }
      const workspace = taskWorkspace(taskId)
      const target = join(workspace, ...segments)
      if (!isWithin(workspace, target)) {
        return new Response('Forbidden', { status: 403 })
      }
      const data = await fs.readFile(target)
      const mime = mimeForPath(target) ?? 'application/octet-stream'
      const headers: Record<string, string> = {
        'content-type': mime,
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*'
      }
      if (mime === 'text/html') {
        headers['content-security-policy'] =
          "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"
      }
      return new Response(new Uint8Array(data), { headers })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

function setupWindowCloseBehavior(): void {
  const win = getMainWindow()
  if (!win) return
  if (closeBehaviourWindow === win) return
  closeBehaviourWindow = win
  win.on('close', (event) => {
    if (isQuitting) return
    const hasSchedules = store.listSchedules().some((schedule) => schedule.enabled)
    if (hasSchedules) {
      event.preventDefault()
      win.hide()
      if (!trayNoticeShown) {
        trayNoticeShown = true
        notify(
          'SelfImpulse is still running',
          'Your scheduled tasks stay active. Open the app from the tray, or choose Quit in the tray menu.'
        )
      }
    }
  })
}

app.setAppUserModelId('com.selfimpulse.app')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())

  app.whenReady().then(async () => {
    try {
      migrateLegacyUserData()
      await store.init()
      setEnterpriseMissionAuthorizer(authorizeMissionTeam)
      console.log(`[${APP_NAME.toLowerCase()}] ${signatureLine(app.getVersion())}`)
      const engine = initSelfImpulseEngine()
      console.log(
        `[selfimpulse] engine ${engine.wired ? 'wired' : 'not wired'} · provider=${engine.providerId ?? 'none'} · model=${engine.model ?? 'none'} · tools=${engine.tools.length}` +
          (engine.reason ? ` · ${engine.reason}` : '')
      )
      registerIpc()
      registerFileProtocol()
      setupMenu()
      setupTray()
      setupTaskNotifications()

      createMainWindow()
      setupWindowCloseBehavior()
      const mainWindow = getMainWindow()
      if (mainWindow) setBackendEventTarget(mainWindow)

      scheduler.init()
      void mcpManager.startAll()
      void channelService.start()
      void agentRuntime.recoverActiveTasks().catch((error) => {
        console.error('[recovery] Active agent runs could not be recovered:', error)
      })

      app.on('activate', () => {
        if (getMainWindow()) showMainWindow()
        else createMainWindow()
        setupWindowCloseBehavior()
      })
    } catch (error) {
      console.error('[startup] SelfImpulse could not start:', error)
      await dialog.showMessageBox({
        type: 'error',
        title: 'SelfImpulse could not start',
        message: error instanceof Error ? error.message : String(error),
        detail: `Data folder: ${getPaths().root}`
      })
      app.quit()
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    isQuitting = true
    scheduler.shutdown()
    approvals.cancelAll()
    browserService.disposeAll()
    tableService.dispose()
    channelService.dispose()
    void mcpManager.closeAll()
    void agentRuntime.flushDurability().catch((error) => {
      console.error('[shutdown] Durable journals could not be flushed:', error)
    })
    tray?.destroy()
    tray = null
  })
}
