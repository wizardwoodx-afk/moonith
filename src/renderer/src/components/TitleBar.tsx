import {
  Building2,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Handshake,
  Info,
  MessageSquare,
  PanelLeft,
  Plus,
  Redo2,
  Scissors,
  Settings,
  Undo2,
  Users
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useApp } from '../store'
import { startNewTask } from '../lib/navigation'
import { Popover } from './ui'

function MenuAction({
  icon: Icon,
  label,
  hint,
  onClick,
  close
}: {
  icon: ReactNode
  label: string
  hint?: string
  onClick: () => void
  close: () => void
}) {
  return (
    <button
      onClick={() => {
        onClick()
        close()
      }}
      className="menu-item"
    >
      <span className="flex h-4 w-4 items-center justify-center text-faint">{Icon}</span>
      <span className="flex-1 text-[12.5px]">{label}</span>
      {hint ? <span className="ml-3 text-[9.5px] text-faint">{hint}</span> : null}
    </button>
  )
}

function MenuDivider() {
  return <div className="my-1 h-px bg-line" />
}

export function TitleBar({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  sidebarCollapsed,
  onToggleSidebar
}: {
  canGoBack: boolean
  canGoForward: boolean
  onBack: () => void
  onForward: () => void
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
}) {
  const openSurface = useApp((state) => state.openSurface)
  const openSettings = useApp((state) => state.openSettings)

  const newTask = (): void => {
    startNewTask()
  }

  const edit = (command: 'undo' | 'redo' | 'cut' | 'copy' | 'paste'): void => {
    try {
      document.execCommand(command)
    } catch {
      // The focused element may not support the command.
    }
  }

  const menuTrigger = (label: string) => (props: Record<string, unknown>) => (
    <button
      {...props}
      className="flex h-6 items-center rounded-md px-1.5 text-[12.5px] text-muted transition-colors outline-none hover:bg-surface-3 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      {label}
    </button>
  )

  return (
    <header className="titlebar-drag relative flex h-11 shrink-0 items-center gap-1 border-b border-line bg-sidebar px-3 pr-[150px] select-none">
      <button
        onClick={onToggleSidebar}
        aria-label={sidebarCollapsed ? 'Expand left sidebar' : 'Collapse left sidebar'}
        title={sidebarCollapsed ? 'Expand left sidebar' : 'Collapse left sidebar'}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors outline-none hover:bg-surface-3 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <PanelLeft size={15} strokeWidth={1.8} />
      </button>
      <button
        onClick={onBack}
        disabled={!canGoBack}
        aria-label="Back"
        title="Back"
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors outline-none hover:bg-surface-3 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <ChevronLeft size={15} strokeWidth={1.8} />
      </button>
      <button
        onClick={onForward}
        disabled={!canGoForward}
        aria-label="Forward"
        title="Forward"
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors outline-none hover:bg-surface-3 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <ChevronRight size={15} strokeWidth={1.8} />
      </button>

      <nav aria-label="Application menu" className="ml-2 flex items-center gap-0.5">
        <Popover
          align="left"
          panelClassName="w-[228px]"
          trigger={menuTrigger('File')}
        >
          {(close) => (
            <div>
              <MenuAction
                icon={<Plus size={13} />}
                label="New task"
                hint="Ctrl+N"
                onClick={newTask}
                close={close}
              />
              <MenuAction
                icon={<Settings size={13} />}
                label="Settings"
                hint="Ctrl+,"
                onClick={() => openSettings('general')}
                close={close}
              />
              <MenuDivider />
              <MenuAction
                icon={<Users size={13} />}
                label="Agents & Teams"
                onClick={() => openSettings('agent-team')}
                close={close}
              />
            </div>
          )}
        </Popover>

        <Popover
          align="left"
          panelClassName="w-[216px]"
          trigger={menuTrigger('Edit')}
        >
          {(close) => (
            <div>
              <MenuAction
                icon={<Undo2 size={13} />}
                label="Undo"
                hint="Ctrl+Z"
                onClick={() => edit('undo')}
                close={close}
              />
              <MenuAction
                icon={<Redo2 size={13} />}
                label="Redo"
                hint="Ctrl+Shift+Z"
                onClick={() => edit('redo')}
                close={close}
              />
              <MenuDivider />
              <MenuAction
                icon={<Scissors size={13} />}
                label="Cut"
                hint="Ctrl+X"
                onClick={() => edit('cut')}
                close={close}
              />
              <MenuAction
                icon={<Copy size={13} />}
                label="Copy"
                hint="Ctrl+C"
                onClick={() => edit('copy')}
                close={close}
              />
              <MenuAction
                icon={<ClipboardPaste size={13} />}
                label="Paste"
                hint="Ctrl+V"
                onClick={() => edit('paste')}
                close={close}
              />
            </div>
          )}
        </Popover>

        <Popover
          align="left"
          panelClassName="w-[210px]"
          trigger={menuTrigger('View')}
        >
          {(close) => (
            <div>
              <MenuAction
                icon={<MessageSquare size={13} />}
                label="Chat"
                hint="Ctrl+1"
                onClick={() => openSurface('chat')}
                close={close}
              />
              <MenuAction
                icon={<Building2 size={13} />}
                label="Company"
                hint="Ctrl+2"
                onClick={() => openSurface('company')}
                close={close}
              />
              <MenuAction
                icon={<Handshake size={13} />}
                label="Table"
                hint="Ctrl+3"
                onClick={() => openSurface('table')}
                close={close}
              />
              <MenuDivider />
              <MenuAction
                icon={<Settings size={13} />}
                label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                onClick={onToggleSidebar}
                close={close}
              />
            </div>
          )}
        </Popover>

        <Popover
          align="left"
          panelClassName="w-[232px]"
          trigger={menuTrigger('Help')}
        >
          {(close) => (
            <div>
              <MenuAction
                icon={<Info size={13} />}
                label="About Knight Cowork"
                onClick={() => openSettings('about')}
                close={close}
              />
            </div>
          )}
        </Popover>
      </nav>

      <div className="flex-1" />
    </header>
  )
}
