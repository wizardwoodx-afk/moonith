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
import {
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
  watch,
  type FSWatcher
} from 'node:fs'
import { join } from 'node:path'
import { getPaths, migrateLegacyUserData, taskWorkspace } from './paths'
import { portableDataDir } from './portable'
import { store } from './store'
import { initSelfImpulseEngine } from './selfimpulse/bridge/facade'
import { registerIpc } from './ipc'
import {
  createMainWindow,
  getMainWindow,
  getWindowPresentation,
  isMainWindowFocused,
  onMainWindowPresentationChange,
  planApprovalAttention,
  showMainWindow
} from './window'
import { subscribeTaskEvents } from './emitter'
import { mcpManager } from './services/mcp'
import { agentRuntime } from './agent/runtime'
import { scheduler } from './services/scheduler'
import { browserService } from './services/browser'
import { tableService } from './services/table'
import { channelService } from './services/channels'
import { approvals } from './approvals'
import {
  KNIGHT_FILE_PRIVILEGES,
  handleKnightFileRequest,
  knightFileAllowedOrigins
} from './fileProtocol'
import { mimeForPath } from './services/documents'
import { setBackendEventTarget } from './backend/ipc'
import { aionOrchestrator } from './aion'
import { kardiaHeartbeat } from './services/kardia'
import { actionJournal } from './agent/gateway/actionJournal'
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

const TRAY_TOOLTIP_IDLE = APP_NAME
const TRAY_TOOLTIP_WAITING = `${APP_NAME} - approval waiting`
/* One balloon per pending request: the same decision re-reported by a stray
 * focus or blur event must not nag. Cleared whenever the balloon is not the
 * signal in play. */
let balloonApprovalId: string | null = null

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'knight-file',
    privileges: KNIGHT_FILE_PRIVILEGES
  },
  {
    scheme: 'selfimpulse-file',
    privileges: KNIGHT_FILE_PRIVILEGES
  }
])

/**
 * The full brand lockup. It carries readable lettering, so it is only legible
 * down to about 48px; anything drawn smaller wants `glyphIconPath()`.
 */
function iconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../resources/icon.png')
}

/**
 * The orbit glyph on its own, generated alongside the lockup by
 * `scripts/brand-assets.mjs`. The tray and notifications draw at ~16px, where
 * shrinking the lockup turns the wordmark into an unreadable smear.
 */
function glyphIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'tray.png')
    : join(__dirname, '../../resources/tray.png')
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
  try {
    const iconFile = glyphIconPath()
    if (!existsSync(iconFile)) {
      console.warn('Tray icon missing at', iconFile)
      return
    }
    const image = nativeImage.createFromPath(iconFile)
    if (image.isEmpty()) {
      console.warn('Tray icon missing or empty at', iconFile)
      return
    }
    // tray.png is authored at 32px, twice the 1x tray cell, so the notification
    // area downsamples from a source that still has detail in it.
    tray = new Tray(image)
    setTrayToolTip(TRAY_TOOLTIP_IDLE)
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
  } catch (err) {
    console.warn('Could not initialize system tray:', err)
    tray = null
  }
}

function setTrayToolTip(text: string): void {
  try {
    tray?.setToolTip(text)
  } catch {
    // Not every desktop environment gives the tray somewhere to put a tooltip.
  }
}

function flashMainWindow(on: boolean): void {
  const win = getMainWindow()
  if (!win) return
  try {
    win.flashFrame(on)
  } catch {
    // Taskbar flashing is not implemented on every platform.
  }
}

function showTrayBalloon(content: string): void {
  /* Inline tray notifications are a Windows affordance and the call throws
   * elsewhere, so the other platforms keep the tooltip and the flash alone. */
  if (!tray || process.platform !== 'win32') return
  try {
    tray.displayBalloon({ title: 'Approval waiting', content, iconType: 'info' })
  } catch {
    // A notification area that is missing or full is not worth failing a task over.
  }
}

/**
 * The approval dialog lives in the renderer, so a window nobody can see leaves
 * the task blocked with nothing on screen to answer it — and closing to the
 * tray is a normal state here, not an edge case. This puts whatever the platform
 * does have onto the pending request and drops all of it again the moment the
 * decision lands or the window comes back.
 */
function applyApprovalAttention(): void {
  if (isQuitting) return
  const pending = approvals.listPending()
  const plan = planApprovalAttention({
    hasPendingApproval: pending.length > 0,
    presentation: getWindowPresentation(),
    focused: isMainWindowFocused()
  })

  setTrayToolTip(plan.tooltipWaiting ? TRAY_TOOLTIP_WAITING : TRAY_TOOLTIP_IDLE)
  flashMainWindow(plan.flash)

  if (plan.balloon) {
    const first = pending[0]
    if (first && first.id !== balloonApprovalId) {
      showTrayBalloon('Open SelfImpulse to answer')
      balloonApprovalId = first.id
    }
  } else {
    balloonApprovalId = null
  }

  // Last, so the dialog is painted against the window the user lands on.
  if (plan.showWindow) showMainWindow()
}

/**
 * The signal this process raised has to come down even after the quit flag has
 * muted `applyApprovalAttention`, so quitting clears it by hand.
 */
function clearApprovalAttention(): void {
  balloonApprovalId = null
  setTrayToolTip(TRAY_TOOLTIP_IDLE)
  flashMainWindow(false)
}

function setupApprovalAttention(): void {
  approvals.onPendingChanged(applyApprovalAttention)
  onMainWindowPresentationChange(applyApprovalAttention)
  // A request left pending by an earlier state of the window is picked up here.
  applyApprovalAttention()
}

function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title, body, icon: glyphIconPath() })
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
  const handler = (request: Request) =>
    handleKnightFileRequest(request, {
      taskExists: (taskId) => Boolean(store.getTask(taskId)),
      workspaceFor: taskWorkspace,
      mimeTypeFor: mimeForPath,
      allowedOrigins: () => knightFileAllowedOrigins(process.env['ELECTRON_RENDERER_URL'])
    })

  protocol.handle('knight-file', handler)
  protocol.handle('selfimpulse-file', handler)
}

function setupWindowCloseBehavior(): void {
  const win = getMainWindow()
  if (!win) return
  if (closeBehaviourWindow === win) return
  closeBehaviourWindow = win
  win.on('close', (event) => {
    if (isQuitting) return
    const hasSchedules = store.listSchedules().some((schedule) => schedule.enabled)
    // Only hide to tray if schedules are active AND the system tray was successfully created.
    // If tray is null, hiding the window would leave the process completely invisible and unreachable.
    if (hasSchedules && tray) {
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
  win.on('closed', () => {
    if (closeBehaviourWindow === win) {
      closeBehaviourWindow = null
    }
  })
}

app.setAppUserModelId('com.selfimpulse.app')

function wakeSignalPath(): string {
  try {
    return join(app.getPath('userData'), 'wake.signal')
  } catch {
    return ''
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // If lock is held (e.g. by an elevated or background instance), drop a wake signal file
  // so the running instance wakes up immediately even across Windows UIPI / elevation boundaries.
  try {
    const signal = wakeSignalPath()
    if (signal) {
      writeFileSync(signal, Date.now().toString(), 'utf8')
    }
  } catch {
    // Best-effort
  }
  app.quit()
} else {
  let wakeWatcher: FSWatcher | null = null

  function checkAndHandleWakeSignal(): void {
    const signal = wakeSignalPath()
    if (!signal) return
    try {
      if (existsSync(signal)) {
        unlinkSync(signal)
        showMainWindow()
      }
    } catch {
      // Ignore
    }
  }

  app.on('second-instance', () => showMainWindow())

  app.whenReady().then(async () => {
    try {
      const signal = wakeSignalPath()
      if (signal) {
        try {
          if (existsSync(signal)) unlinkSync(signal)
        } catch {
          // Clean stale signal
        }
        try {
          wakeWatcher = watch(app.getPath('userData'), (_eventType, filename) => {
            if (filename === 'wake.signal') {
              checkAndHandleWakeSignal()
            }
          })
        } catch {
          // Watch fallback
        }
      }
      migrateLegacyUserData()
      await store.init()
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
      setupApprovalAttention()
      const mainWindow = getMainWindow()
      if (mainWindow) setBackendEventTarget(mainWindow)

      scheduler.init()
      actionJournal.setPath(join(getPaths().root, 'action-journal.jsonl'))
      kardiaHeartbeat.setContextProvider(async () => {
        checkAndHandleWakeSignal()
        return {
          pendingApprovalsCount: approvals.listPending().length,
          enabledSchedulesCount: store.listSchedules().filter((s) => s.enabled).length,
          workspaces: store.listTasks().map((t) => taskWorkspace(t.id))
        }
      })
      kardiaHeartbeat.setNotificationHandler((evaluation) => {
        if (evaluation.summary) {
          notify('SelfImpulse Proactive Notice', evaluation.summary)
        }
      })
      kardiaHeartbeat.start()
      /* Neither service may take the app down if it fails to start: startup
       * continues, the failure is logged, and the service's own page reports
       * the state it is actually in. */
      void mcpManager.startAll().catch((error) => {
        console.error('[mcp] could not start configured servers:', error)
      })
      void channelService.start().catch((error) => {
        console.error('[channels] could not start the channel service:', error)
      })

      /* Missions left behind by the previous process come back exactly as
       * they were: parked at an approval, sleeping on a durable timer, or
       * settled by the interrupted step's own reconcile hook — and the ones
       * that cannot settle themselves come back marked for reconciliation.
       * Driven, not awaited: startup must not wait on parked work, and
       * nothing replays on its own. */
      void aionOrchestrator()
        .resumeAll()
        .then((resumed) => {
          if (resumed.length) console.log(`[aion] resumed ${resumed.length} mission(s) from the journal`)
        })
        .catch((error) => {
          console.error('[aion] could not resume missions from the journal:', error)
        })

      /* Same honesty for ordinary tasks: a turn cut short by the previous
       * process must not keep showing a live spinner. */
      void agentRuntime
        .reconcileInterrupted()
        .then((cleared) => {
          if (cleared) console.log(`[runtime] cleared ${cleared} interrupted task(s)`)
        })
        .catch((error) => {
          console.error('[runtime] could not reconcile interrupted tasks:', error)
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
  }).catch((error) => {
    /* The handler above already reports startup failures; this guard covers a
     * failure inside that reporting (the dialog itself), so the rejection can
     * never go unhandled. */
    console.error('[startup] SelfImpulse could not finish starting:', error)
    app.quit()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    isQuitting = true
    try {
      wakeWatcher?.close()
    } catch {
      // Ignore
    }
    wakeWatcher = null
    scheduler.shutdown()
    kardiaHeartbeat.stop()
    approvals.cancelAll()
    clearApprovalAttention()
    browserService.disposeAll()
    tableService.dispose()
    channelService.dispose()
    void mcpManager.closeAll().catch((error) => {
      console.error('[mcp] could not close servers on quit:', error)
    })
    tray?.destroy()
    tray = null
  })
}
