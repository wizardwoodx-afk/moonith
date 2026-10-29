import {
  Building2,
  ClipboardPaste,
  Handshake,
  MessageSquare,
  PanelLeft,
  Redo2,
  Scissors,
  Undo2
} from 'lucide-react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { useApp } from '../store'
import { startNewTask } from '../lib/navigation'
import { Popover } from './ui'
import { ICON_SIZES, Icon } from './icons'
import { ActiveWorkIsland } from '../motion/ActiveWorkIsland'

function MenuAction({
  icon: Glyph,
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
      <span className="flex h-4 w-4 items-center justify-center text-faint">{Glyph}</span>
      <span className="flex-1 text-[12.5px]">{label}</span>
      {hint ? <span className="ml-3 text-[10px] text-faint">{hint}</span> : null}
    </button>
  )
}

function MenuDivider() {
  return <div className="my-1 h-px bg-line" />
}

type EditCommand = 'undo' | 'redo' | 'cut' | 'copy' | 'paste'

const EDIT_FALLBACK: Record<EditCommand, string> = {
  undo: 'Nothing was undone — focus the field and press Ctrl+Z.',
  redo: 'Nothing was redone — focus the field and press Ctrl+Shift+Z.',
  cut: 'Nothing was cut — select the text and press Ctrl+X.',
  copy: 'Nothing was copied — select the text and copy it yourself.',
  paste: 'Nothing was pasted — focus the field and press Ctrl+V.'
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

  /*
   * The native menu is hidden (autoHideMenuBar), so editing commands have to be
   * replayed here. execCommand is the only synchronous route to the focused
   * field's own selection; the async clipboard API cannot reach it, and a menu
   * click is not a user gesture by the time a promise resolves. A false return
   * means the field did not act, which must not be swallowed — a menu item that
   * quietly does nothing is a broken control.
   */
  const edit = (command: EditCommand): void => {
    let applied = false
    try {
      applied = document.execCommand(command)
    } catch {
      applied = false
    }
    if (!applied) toast.error(EDIT_FALLBACK[command])
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
        <PanelLeft size={ICON_SIZES.md} strokeWidth={1.8} />
      </button>
      <button
        onClick={onBack}
        disabled={!canGoBack}
        aria-label="Back"
        title="Back"
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors outline-none hover:bg-surface-3 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <Icon name="chevronLeft" size="md" />
      </button>
      <button
        onClick={onForward}
        disabled={!canGoForward}
        aria-label="Forward"
        title="Forward"
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors outline-none hover:bg-surface-3 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <Icon name="chevronRight" size="md" />
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
                icon={<Icon name="add" size="md" />}
                label="New task"
                hint="Ctrl+N"
                onClick={newTask}
                close={close}
              />
              <MenuAction
                icon={<Icon name="settings" size="md" />}
                label="Settings"
                hint="Ctrl+,"
                onClick={() => openSettings('general')}
                close={close}
              />
              <MenuDivider />
              <MenuAction
                icon={<Icon name="users" size="md" />}
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
                icon={<Undo2 size={ICON_SIZES.md} />}
                label="Undo"
                hint="Ctrl+Z"
                onClick={() => edit('undo')}
                close={close}
              />
              <MenuAction
                icon={<Redo2 size={ICON_SIZES.md} />}
                label="Redo"
                hint="Ctrl+Shift+Z"
                onClick={() => edit('redo')}
                close={close}
              />
              <MenuDivider />
              <MenuAction
                icon={<Scissors size={ICON_SIZES.md} />}
                label="Cut"
                hint="Ctrl+X"
                onClick={() => edit('cut')}
                close={close}
              />
              <MenuAction
                icon={<Icon name="copy" size="md" />}
                label="Copy"
                hint="Ctrl+C"
                onClick={() => edit('copy')}
                close={close}
              />
              <MenuAction
                icon={<ClipboardPaste size={ICON_SIZES.md} />}
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
                icon={<MessageSquare size={ICON_SIZES.md} />}
                label="Chat"
                hint="Ctrl+1"
                onClick={() => openSurface('chat')}
                close={close}
              />
              <MenuAction
                icon={<Building2 size={ICON_SIZES.md} />}
                label="Company"
                hint="Ctrl+2"
                onClick={() => openSurface('company')}
                close={close}
              />
              <MenuAction
                icon={<Handshake size={ICON_SIZES.md} />}
                label="Table"
                hint="Ctrl+3"
                onClick={() => openSurface('table')}
                close={close}
              />
              <MenuDivider />
              <MenuAction
                icon={<Icon name="settings" size="md" />}
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
                icon={<Icon name="info" size="md" />}
                label="About SelfImpulse"
                onClick={() => openSettings('about')}
                close={close}
              />
            </div>
          )}
        </Popover>
      </nav>

      <ActiveWorkIsland />
      <div className="flex-1" />
    </header>
  )
}
