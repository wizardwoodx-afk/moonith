import { useMemo, useRef, useState } from 'react'
import {
  Building2,
  CalendarClock,
  Handshake,
  LibraryBig,
  MessageSquare,
  Plus,
  Search,
  Settings,
  X
} from 'lucide-react'
import { BrandMark } from '../components/BrandMark'
import type { TaskStatus } from '@shared/types'
import { useApp } from '../store'
import { cn, taskGroup, timeAgo } from '../lib/utils'
import { profileInitial, useLocalProfile } from '../lib/localProfile'
import { startNewTask } from '../lib/navigation'
import { SURFACES, modeForSurface, type Surface } from './surfaces'

const ICONS: Record<Surface, typeof MessageSquare> = {
  chat: MessageSquare,
  library: LibraryBig,
  company: Building2,
  table: Handshake
}

const STATUS_DOT: Record<TaskStatus, string> = {
  draft: 'bg-line-strong',
  running: 'bg-accent',
  waiting: 'bg-warn',
  paused: 'bg-faint',
  done: 'bg-positive',
  error: 'bg-danger'
}

function SwitchMode({ collapsed }: { collapsed: boolean }) {
  const view = useApp((state) => state.view)
  const openSurface = useApp((state) => state.openSurface)
  const activeSurface = view.kind === 'surface' ? view.surface : 'chat'
  const mode = modeForSurface(activeSurface)

  const switchMode = (next: 'Self' | 'Collab'): void => {
    if (next === mode) return
    openSurface(next === 'Self' ? 'chat' : 'table')
  }

  if (collapsed) {
    return (
      <button
        onClick={() => switchMode(mode === 'Self' ? 'Collab' : 'Self')}
        title={`${mode} mode — switch`}
        aria-label={`${mode} mode. Switch mode`}
        className="mx-auto flex h-8 w-8 items-center justify-center"
      >
        <span
          className={cn(
            'h-2 w-2 rounded-full transition-colors',
            mode === 'Collab' ? 'joint-marker' : 'bg-gold'
          )}
        />
      </button>
    )
  }

  return (
    <div
      className="relative flex h-[24px] items-center rounded-full bg-surface-2/70 p-[2px]"
      aria-label="Workspace mode"
    >
      <span
        className="absolute top-[2px] bottom-[2px] rounded-full bg-surface-3 shadow-[0_1px_2px_rgba(0,0,0,0.18)] transition-[left] duration-300"
        style={{ left: mode === 'Self' ? 2 : '50%', width: 'calc(50% - 2px)' }}
      />
      {(['Self', 'Collab'] as const).map((value) => (
        <button
          key={value}
          onClick={() => switchMode(value)}
          aria-pressed={mode === value}
          className={cn(
            'relative z-10 h-full rounded-full px-2.5 text-[9.5px] font-medium transition-colors',
            mode === value ? 'text-ink' : 'text-faint hover:text-muted'
          )}
        >
          {value}
        </button>
      ))}
    </div>
  )
}

function RailNavRow({
  icon: Icon,
  label,
  active,
  collapsed,
  onClick
}: {
  icon: typeof MessageSquare
  label: string
  active?: boolean
  collapsed: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex items-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/30',
        collapsed
          ? 'mx-auto h-9 w-9 justify-center rounded-xl'
          : 'h-[34px] w-full gap-2.5 rounded-[9px] px-2.5',
        active ? 'bg-surface-3/80 text-ink' : 'text-muted hover:bg-surface-2/60 hover:text-ink'
      )}
    >
      <Icon
        size={15}
        strokeWidth={1.7}
        className={cn('shrink-0 transition-colors', active ? 'text-accent' : 'text-faint group-hover:text-muted')}
      />
      {collapsed ? null : <span className="flex-1 truncate text-left text-[12.5px]">{label}</span>}
    </button>
  )
}

export function AppRail({ collapsed = false }: { collapsed?: boolean }) {
  const view = useApp((state) => state.view)
  const tasks = useApp((state) => state.tasks)
  const goHome = useApp((state) => state.goHome)
  const openSurface = useApp((state) => state.openSurface)
  const openTask = useApp((state) => state.openTask)
  const openSchedules = useApp((state) => state.openSchedules)
  const openSettings = useApp((state) => state.openSettings)
  const profile = useLocalProfile()
  const searchRef = useRef<HTMLInputElement>(null)

  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)

  const activeSurface = view.kind === 'surface' ? view.surface : null
  const mode = modeForSurface(activeSurface ?? 'chat')

  const recent = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const filtered = normalized
      ? tasks.filter(
          (task) =>
            task.title.toLowerCase().includes(normalized) ||
            task.objective.toLowerCase().includes(normalized)
        )
      : tasks
    return filtered.slice(0, 40)
  }, [tasks, query])

  const openSearch = (): void => {
    setSearching(true)
    window.setTimeout(() => searchRef.current?.focus(), 20)
  }

  const closeSearch = (): void => {
    setSearching(false)
    setQuery('')
  }

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col border-r border-line/70 bg-sidebar transition-[width] duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)]',
        collapsed ? 'w-[62px]' : 'w-[252px]'
      )}
    >
      {collapsed ? (
        <div className="flex flex-col items-center pt-3">
          <button
            onClick={goHome}
            title="SelfImpulse"
            aria-label="Home"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-ink transition-colors hover:bg-surface-3/60"
          >
            <BrandMark size={18} strokeWidth={1.7} />
          </button>
          <div className="mt-1">
            <SwitchMode collapsed />
          </div>
          <div className="my-2 h-px w-6 bg-line" />
          <button
            onClick={startNewTask}
            title="New task (Ctrl+N)"
            aria-label="New task"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink-button text-on-ink transition-transform active:scale-95"
          >
            <Plus size={16} strokeWidth={2} />
          </button>
          <button
            onClick={() => {
              closeSearch()
              openSettings('general')
              window.setTimeout(
                () => window.dispatchEvent(new Event('knight:focus-settings-search')),
                0
              )
            }}
            title="Search settings (Ctrl+K)"
            aria-label="Search settings"
            className="mt-2 flex h-9 w-9 items-center justify-center rounded-xl text-faint transition-colors hover:bg-surface-3/60 hover:text-ink"
          >
            <Search size={15} />
          </button>

          <nav className="mt-4 flex flex-col items-center gap-1" aria-label="Spaces">
            {SURFACES.map((item) => (
              <RailNavRow
                key={item.id}
                icon={ICONS[item.id]}
                label={item.label}
                active={activeSurface === item.id}
                collapsed
                onClick={() => openSurface(item.id)}
              />
            ))}
            <RailNavRow
              icon={CalendarClock}
              label="Schedules"
              active={view.kind === 'schedules'}
              collapsed
              onClick={openSchedules}
            />
          </nav>

          {tasks.length ? (
            <>
              <div className="my-2 h-px w-6 bg-line" />
              <div className="flex flex-col items-center gap-0.5">
                {tasks.slice(0, 6).map((task) => (
                  <button
                    key={task.id}
                    onClick={() => void openTask(task.id)}
                    title={task.title}
                    aria-label={task.title}
                    className={cn(
                      'flex h-7 w-8 items-center justify-center rounded-lg transition-colors hover:bg-surface-3/60',
                      view.kind === 'task' && view.taskId === task.id && 'bg-surface-3/80'
                    )}
                  >
                    <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[task.status])} />
                  </button>
                ))}
              </div>
            </>
          ) : null}

          <div className="mt-auto flex flex-col items-center gap-1 pb-3">
            <button
              onClick={() => openSettings('profile')}
              title={profile.name}
              aria-label="Profile"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface-2 text-[10px] font-semibold text-accent-ink transition-colors hover:border-line-strong"
            >
              {profileInitial(profile)}
            </button>
            <button
              onClick={() => openSettings('general')}
              title="Settings (Ctrl+,)"
              aria-label="Settings"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-faint transition-colors hover:bg-surface-3/60 hover:text-ink"
            >
              <Settings size={14} />
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between px-4 pt-4 pb-1">
            <button
              onClick={goHome}
              className="flex min-w-0 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
              aria-label="SelfImpulse home"
            >
              <BrandMark size={16} strokeWidth={1.8} className="shrink-0 text-ink" />
              <span className="truncate text-[13px] font-semibold tracking-[-0.015em] text-ink">
                SelfImpulse
              </span>
            </button>
            <SwitchMode collapsed={false} />
          </div>

          <div className="px-3 pt-3">
            <button
              onClick={startNewTask}
              className="group flex h-[36px] w-full items-center gap-2 rounded-[10px] bg-ink-button px-3 text-[12.5px] font-medium text-on-ink transition-all duration-150 hover:brightness-110 active:scale-[0.985]"
            >
              <Plus size={15} strokeWidth={2.1} />
              <span className="flex-1 text-left">New task</span>
              <span className="text-[9.5px] text-on-ink/45 transition-opacity group-hover:text-on-ink/65">
                Ctrl N
              </span>
            </button>
          </div>

          <nav className="mt-2.5 px-2" aria-label="Spaces">
            {SURFACES.map((item) => (
              <RailNavRow
                key={item.id}
                icon={ICONS[item.id]}
                label={item.label}
                active={activeSurface === item.id}
                collapsed={false}
                onClick={() => openSurface(item.id)}
              />
            ))}
            <RailNavRow
              icon={CalendarClock}
              label="Schedules"
              active={view.kind === 'schedules'}
              collapsed={false}
              onClick={openSchedules}
            />
          </nav>

          <div className="mt-5 flex items-center justify-between px-4 pb-1">
            <span className="text-[10px] font-medium text-faint">Recent</span>
            <div className="flex items-center gap-1">
              {searching ? (
                <button
                  onClick={closeSearch}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-faint transition-colors hover:bg-surface-2 hover:text-ink"
                  aria-label="Close search"
                >
                  <X size={12} />
                </button>
              ) : (
                <button
                  onClick={openSearch}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-faint transition-colors hover:bg-surface-2 hover:text-ink"
                  aria-label="Search tasks"
                  title="Search tasks"
                >
                  <Search size={12} />
                </button>
              )}
            </div>
          </div>

          {searching ? (
            <div className="px-3 pb-1.5">
              <div className="relative">
                <Search
                  size={12}
                  className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint"
                />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') closeSearch()
                    if (event.key === 'Enter' && recent[0]) {
                      void openTask(recent[0].id)
                      closeSearch()
                    }
                  }}
                  placeholder="Filter tasks"
                  aria-label="Filter tasks"
                  className="h-8 w-full rounded-lg border border-line/70 bg-canvas/60 pr-2.5 pl-8 text-[12px] text-ink outline-none placeholder:text-faint focus:border-line-strong"
                />
              </div>
            </div>
          ) : null}

          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pt-0.5 pb-3">
            {recent.length === 0 ? (
              <p className="px-2.5 pt-2 text-[11.5px] text-faint">
                {query.trim() ? 'Nothing matches.' : 'No tasks yet.'}
              </p>
            ) : (
              <div className="space-y-px">
                {recent.map((task, index) => {
                  const active = view.kind === 'task' && view.taskId === task.id
                  const group = taskGroup(task.updatedAt)
                  const showGroup =
                    !query.trim() &&
                    (index === 0 || taskGroup(recent[index - 1].updatedAt) !== group)
                  return (
                    <div key={task.id}>
                      {showGroup ? (
                        <p
                          className={cn(
                            'px-2.5 pb-1 text-[9.5px] text-faint/70',
                            index === 0 ? 'pt-1' : 'pt-3'
                          )}
                        >
                          {group}
                        </p>
                      ) : null}
                      <button
                        onClick={() => void openTask(task.id)}
                        title={`${task.title} · ${timeAgo(task.updatedAt)}`}
                        aria-current={active ? 'page' : undefined}
                        style={{ animationDelay: `${Math.min(index, 8) * 18}ms` }}
                        className={cn(
                          'rail-in group flex h-[30px] w-full items-center gap-2 rounded-[7px] px-2.5 text-left transition-colors',
                          active ? 'bg-surface-3/80' : 'hover:bg-surface-2/55'
                        )}
                      >
                        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[task.status])} />
                        <span
                          className={cn(
                            'min-w-0 flex-1 truncate text-[12px]',
                            active ? 'font-medium text-ink' : 'text-ink/80 group-hover:text-ink'
                          )}
                        >
                          {task.title}
                        </span>
                        <span className="shrink-0 text-[9.5px] text-faint opacity-0 transition-opacity group-hover:opacity-100">
                          {timeAgo(task.updatedAt)}
                        </span>
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="border-t border-line/60 p-2.5">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => openSettings('profile')}
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-surface-2/55"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-[10px] font-semibold text-accent-ink">
                  {profileInitial(profile)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px] leading-4 font-medium text-ink">
                    {profile.name}
                  </span>
                  <span className="block truncate text-[9.5px] leading-3.5 text-faint">
                    {mode} · local
                  </span>
                </span>
              </button>
              <button
                onClick={() => openSettings('general')}
                title="Settings (Ctrl+,)"
                aria-label="Settings"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-surface-3 hover:text-ink"
              >
                <Settings size={13} />
              </button>
            </div>
          </div>
        </>
      )}
    </aside>
  )
}
