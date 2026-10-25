import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { BrandMark } from './components/BrandMark'
import { Toaster } from 'sonner'
import { useApp, type View } from './store'
import { cn } from './lib/utils'
import { themeById, useTheme } from './lib/themes'
import { TitleBar } from './components/TitleBar'
import { AppRail } from './shell/AppRail'
import { spaceClass } from './shell/surfaces'
import { Onboarding } from './components/Onboarding'
import { ApprovalDialog } from './components/ApprovalDialog'
import { SettingsView } from './views/SettingsView'
import { TaskView } from './views/TaskView'
import { SchedulesView } from './views/SchedulesView'
import { CaptainSurface } from './features/captain/CaptainSurface'
import { LibraryView } from './features/library/LibraryView'
import { CompanySurface } from './features/company/CompanySurface'
import { TableSurface } from './features/table/TableSurface'
import { HelpButton } from './shell/HelpButton'
import { startNewTask } from './lib/navigation'
import { Button } from './components/ui'
import { MetalSignature } from './motion/MetalAction'

function Splash() {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-canvas">
      <div className="flex h-full flex-col items-center justify-center bg-canvas">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-surface text-accent shadow-[0_40px_80px_-40px_rgba(0,0,0,0.9)]">
          <BrandMark size={22} className="breathing" />
        </div>
        <div className="mt-4 text-ink"><MetalSignature>SelfImpulse</MetalSignature></div>
        <p className="mt-1 text-[11.5px] text-faint">Opening your workspace…</p>
      </div>
    </div>
  )
}

function FatalScreen({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-canvas px-8">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-danger/10 text-danger">
          <AlertTriangle size={19} />
        </div>
        <h1 className="mt-4 text-[15px] font-semibold">SelfImpulse could not start</h1>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{message}</p>
        <Button variant="primary" className="mt-5" onClick={() => window.location.reload()}>
          <RotateCw size={13} />
          Try again
        </Button>
      </div>
    </div>
  )
}

function viewKey(view: View): string {
  if (view.kind === 'surface') return `surface:${view.surface}`
  if (view.kind === 'settings') return `settings:${view.tab}`
  if (view.kind === 'task') return `task:${view.taskId}`
  return 'schedules'
}

const COLLAPSE_KEY = 'knight.sidebar-collapsed'

export function App() {
  const ready = useApp((state) => state.ready)
  const fatalError = useApp((state) => state.fatalError)
  const view = useApp((state) => state.view)
  const bootstrap = useApp((state) => state.bootstrap)
  const handleEvent = useApp((state) => state.handleEvent)
  const setApproval = useApp((state) => state.setApproval)
  const openSurface = useApp((state) => state.openSurface)
  const openTask = useApp((state) => state.openTask)
  const openSchedules = useApp((state) => state.openSchedules)
  const openSettings = useApp((state) => state.openSettings)
  const themeId = useTheme((state) => state.themeId)
  const themeKind = themeById(themeId).kind

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })

  const [history, setHistory] = useState<{ stack: View[]; index: number }>(() => ({
    stack: [view],
    index: 0
  }))

  const activeSurface = view.kind === 'surface' ? view.surface : 'chat'
  const settingsActive = view.kind === 'settings'
  const viewMotionKey = settingsActive
    ? 'settings'
    : view.kind === 'task'
      ? `task:${view.taskId}`
      : view.kind === 'schedules'
        ? 'schedules'
        : `surface:${activeSurface}`

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    setHistory((previous) => {
      const current = previous.stack[previous.index]
      if (current && viewKey(current) === viewKey(view)) return previous
      const stack = [...previous.stack.slice(0, previous.index + 1), view]
      const trimmed = stack.length > 40 ? stack.slice(stack.length - 40) : stack
      return { stack: trimmed, index: trimmed.length - 1 }
    })
  }, [view])

  useEffect(() => {
    const offTask = window.knight.onTaskEvent(handleEvent)
    const offApproval = window.knight.onApprovalRequest(setApproval)
    return () => {
      offTask()
      offApproval()
    }
  }, [handleEvent, setApproval])

  const toggleSidebar = useCallback((): void => {
    setSidebarCollapsed((current) => {
      const next = !current
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      } catch {
        // Persistence is optional.
      }
      return next
    })
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      if (event.key === '1') {
        event.preventDefault()
        openSurface('chat')
      } else if (event.key === '2') {
        event.preventDefault()
        openSurface('company')
      } else if (event.key === '3') {
        event.preventDefault()
        openSurface('table')
      } else if (event.key === '4') {
        event.preventDefault()
        openSurface('library')
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        startNewTask()
      } else if (event.key.toLowerCase() === 'k') {
        event.preventDefault()
        openSettings('general')
        window.setTimeout(
          () => window.dispatchEvent(new Event('knight:focus-settings-search')),
          0
        )
      } else if (event.key.toLowerCase() === 'b') {
        event.preventDefault()
        toggleSidebar()
      } else if (event.key === ',') {
        event.preventDefault()
        openSettings('general')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openSurface, openSettings, toggleSidebar])

  const applyView = (target: View): void => {
    if (target.kind === 'surface') openSurface(target.surface)
    else if (target.kind === 'settings') openSettings(target.tab)
    else if (target.kind === 'schedules') openSchedules()
    else void openTask(target.taskId)
  }

  const navigateHistory = (delta: number): void => {
    const nextIndex = history.index + delta
    const target = history.stack[nextIndex]
    if (!target) return
    setHistory({ stack: history.stack, index: nextIndex })
    applyView(target)
  }

  return (
    <div className="flex h-full flex-col bg-canvas text-ink">
      <TitleBar
        canGoBack={history.index > 0}
        canGoForward={history.index < history.stack.length - 1}
        onBack={() => navigateHistory(-1)}
        onForward={() => navigateHistory(1)}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
      />

      {fatalError ? (
        <div className="min-h-0 flex-1">
          <FatalScreen message={fatalError} />
        </div>
      ) : !ready ? (
        <div className="min-h-0 flex-1">
          <Splash />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <AppRail collapsed={sidebarCollapsed} />
          <main
            className={cn(
              'relative min-w-0 flex-1 overflow-hidden bg-canvas text-ink transition-colors duration-300',
              themeId === 'moon' && 'moon-ambient',
              spaceClass(activeSurface)
            )}
          >
            <div key={viewMotionKey} className="surface-enter h-full">
              {settingsActive ? <SettingsView /> : null}
              {!settingsActive && view.kind === 'task' ? <TaskView /> : null}
              {!settingsActive && view.kind === 'schedules' ? <SchedulesView /> : null}
              {!settingsActive && view.kind === 'surface' && activeSurface === 'chat' ? (
                <CaptainSurface />
              ) : null}
              {!settingsActive && view.kind === 'surface' && activeSurface === 'library' ? (
                <LibraryView />
              ) : null}
              {!settingsActive && view.kind === 'surface' && activeSurface === 'company' ? (
                <CompanySurface />
              ) : null}
              {!settingsActive && view.kind === 'surface' && activeSurface === 'table' ? (
                <TableSurface />
              ) : null}
            </div>
          </main>
        </div>
      )}

      {ready && !fatalError ? <HelpButton /> : null}

      {ready && !fatalError ? (
        <>
          <Onboarding />
          <ApprovalDialog />
        </>
      ) : null}

      <Toaster
        position="bottom-right"
        theme={themeKind}
        closeButton={false}
        toastOptions={{
          style: {
            background: 'var(--c-surface)',
            color: 'var(--c-ink)',
            border: '1px solid var(--c-line)',
            fontSize: '12.5px'
          }
        }}
      />
    </div>
  )
}
