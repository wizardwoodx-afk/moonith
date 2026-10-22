import { useMemo, useState } from 'react'
import {
  AlertCircle,
  CalendarClock,
  Check,
  ChevronRight,
  Circle,
  Loader2,
  Pause,
  Plus,
  Search,
  Settings,
  X
} from 'lucide-react'
import type { TaskStatus } from '@shared/types'
import { useApp } from '../store'
import { cn, taskGroup, timeAgo } from '../lib/utils'
import { Kbd } from './ui'

function StatusGlyph({ status }: { status: TaskStatus }) {
  if (status === 'running') return <Loader2 size={12} className="animate-spin text-accent" />
  if (status === 'waiting') return <Circle size={9} className="fill-warn text-warn" />
  if (status === 'paused') return <Pause size={11} className="text-muted" />
  if (status === 'done') return <Check size={12} className="text-positive" />
  if (status === 'error') return <AlertCircle size={12} className="text-danger" />
  return <Circle size={8} className="text-faint" />
}

const GROUP_ORDER = ['Today', 'Yesterday', 'Previous 7 days', 'Older'] as const

export function Sidebar() {
  const tasks = useApp((state) => state.tasks)
  const view = useApp((state) => state.view)
  const currentTask = useApp((state) => state.currentTask)
  const settings = useApp((state) => state.settings)
  const goHome = useApp((state) => state.goHome)
  const openTask = useApp((state) => state.openTask)
  const openSchedules = useApp((state) => state.openSchedules)
  const openSettings = useApp((state) => state.openSettings)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return tasks
    return tasks.filter(
      (task) =>
        task.title.toLowerCase().includes(normalized) ||
        task.objective.toLowerCase().includes(normalized)
    )
  }, [tasks, query])

  const groups = useMemo(() => {
    const map = new Map<string, typeof filtered>()
    for (const task of filtered) {
      const group = taskGroup(task.updatedAt)
      const existing = map.get(group) ?? []
      existing.push(task)
      map.set(group, existing)
    }
    return GROUP_ORDER.filter((group) => map.has(group)).map((group) => ({
      group,
      items: map.get(group) ?? []
    }))
  }, [filtered])

  const activeTaskId = view.kind === 'task' ? view.taskId : currentTask?.id
  const providerCount = settings?.providers.filter((provider) => provider.enabled).length ?? 0

  return (
    <aside className="flex w-[266px] shrink-0 flex-col border-r border-line bg-canvas-deep/45">
      <div className="px-3 pt-3">
        <button
          onClick={goHome}
          className="group flex h-10 w-full items-center gap-2.5 rounded-xl bg-ink-button px-3 text-[13px] font-medium text-on-ink transition-opacity hover:opacity-90"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white/10">
            <Plus size={13} strokeWidth={2.2} />
          </span>
          <span className="flex-1 text-left">New task</span>
          <span className="rounded border border-white/15 px-1.5 py-0.5 text-[9.5px] font-medium text-white/55">
            Ctrl N
          </span>
        </button>
      </div>

      <div className="px-3 pt-3">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tasks"
            className="h-8 w-full rounded-lg border border-transparent bg-transparent pl-7.5 pr-7 text-[12.5px] text-ink outline-none transition-colors placeholder:text-faint hover:bg-surface-2/60 focus:border-line focus:bg-surface"
          />
          {query ? (
            <button
              onClick={() => setQuery('')}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-faint hover:text-ink"
              aria-label="Clear search"
            >
              <X size={12} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="px-3 pt-1.5">
        <button
          onClick={openSchedules}
          className={cn(
            'flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-[12.5px] font-medium transition-colors',
            view.kind === 'schedules'
              ? 'bg-surface text-ink shadow-[0_1px_0_rgba(30,24,18,0.04)]'
              : 'text-muted hover:bg-surface-2/60 hover:text-ink'
          )}
        >
          <CalendarClock size={14} strokeWidth={1.8} />
          <span className="flex-1 text-left">Scheduled</span>
          <ChevronRight size={13} className="text-faint" />
        </button>
      </div>

      <div className="flex items-center justify-between px-4 pt-5 pb-1.5">
        <span className="text-[10px] font-semibold tracking-[0.14em] text-faint uppercase">
          Recents
        </span>
        <span className="text-[10px] text-faint">{filtered.length}</span>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        {groups.length === 0 ? (
          <div className="px-2 py-6 text-center text-[12px] leading-relaxed text-faint">
            {query ? 'No tasks match your search.' : 'Your tasks will appear here.'}
          </div>
        ) : (
          groups.map(({ group, items }) => (
            <div key={group} className="mb-3">
              <div className="px-1.5 pt-2 pb-1 text-[10px] font-medium tracking-wide text-faint/80">
                {group}
              </div>
              <div className="space-y-0.5">
                {items.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => void openTask(task.id)}
                    className={cn(
                      'group flex w-full items-start gap-2.5 rounded-lg px-2 py-[7px] text-left transition-colors',
                      activeTaskId === task.id
                        ? 'bg-surface shadow-[0_1px_0_rgba(30,24,18,0.05)]'
                        : 'hover:bg-surface-2/60'
                    )}
                  >
                    <span className="mt-[3px] flex h-3 w-3 shrink-0 items-center justify-center">
                      <StatusGlyph status={task.status} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block truncate text-[12.5px] leading-[1.35]',
                          activeTaskId === task.id ? 'font-medium text-ink' : 'text-ink/85'
                        )}
                      >
                        {task.title}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-faint">
                        <span>{timeAgo(task.updatedAt)}</span>
                        {task.artifactsCount > 0 ? (
                          <>
                            <span className="text-line-strong">·</span>
                            <span>{task.artifactsCount} file{task.artifactsCount === 1 ? '' : 's'}</span>
                          </>
                        ) : null}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-line p-2.5">
        <button
          onClick={() => openSettings('general')}
          className={cn(
            'flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-[12.5px] font-medium transition-colors',
            view.kind === 'settings'
              ? 'bg-surface text-ink'
              : 'text-muted hover:bg-surface-2/60 hover:text-ink'
          )}
        >
          <Settings size={14} strokeWidth={1.8} />
          <span>Settings</span>
        </button>
        <button
          onClick={() => openSettings(providerCount ? 'general' : 'providers')}
          className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[10.5px] text-faint transition-colors hover:bg-surface-2/50 hover:text-muted"
        >
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              providerCount ? 'bg-positive/80' : 'bg-warn/80'
            )}
          />
          <span className="flex-1">
            {providerCount
              ? `${providerCount} model source${providerCount === 1 ? '' : 's'} connected`
              : 'No model connected'}
          </span>
          <Kbd>{providerCount ? 'Ready' : 'Set up'}</Kbd>
        </button>
      </div>
    </aside>
  )
}
