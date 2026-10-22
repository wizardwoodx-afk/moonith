import { useEffect, useState } from 'react'
import {
  AlertCircle,
  Bot,
  Check,
  ChevronDown,
  FolderOpen,
  Loader2,
  Minus,
  PanelRightClose
} from 'lucide-react'
import type { SubAgentRun, Task } from '@shared/types'
import { useApp } from '../store'
import { cn } from '../lib/utils'
import { IconButton } from './ui'
import { ArtifactPanelBody } from './Artifacts'

type PanelTab = 'work' | 'crew'

const STATUS_DOT: Record<SubAgentRun['status'], string> = {
  running: 'bg-accent',
  done: 'bg-positive',
  error: 'bg-danger',
  stopped: 'bg-faint'
}

function formatElapsed(run: SubAgentRun, now: number): string {
  const start = Date.parse(run.startedAt)
  const end = run.endedAt ? Date.parse(run.endedAt) : now
  const seconds = Math.max(0, Math.round((end - start) / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

function RunGlyph({ status }: { status: SubAgentRun['status'] }) {
  if (status === 'running') return <Loader2 size={13} className="animate-spin text-accent" />
  if (status === 'done') return <Check size={13} className="text-positive" />
  if (status === 'error') return <AlertCircle size={13} className="text-danger" />
  return <Minus size={13} className="text-faint" />
}

function RunCard({ run, now, index }: { run: SubAgentRun; now: number; index: number }) {
  const [open, setOpen] = useState(run.status === 'running')
  const current = run.steps.find((step) => step.status === 'running') ?? run.steps[run.steps.length - 1]
  const headline =
    run.status === 'running'
      ? (current?.title ?? 'Preparing')
      : run.status === 'done'
        ? `${run.steps.length} step${run.steps.length === 1 ? '' : 's'} finished`
        : run.status === 'error'
          ? 'Run failed'
          : 'Stopped'

  return (
    <div
      className="run-in overflow-hidden rounded-xl border border-line bg-surface/40"
      style={{ animationDelay: `${Math.min(index, 5) * 30}ms` }}
    >
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-2/40"
      >
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line bg-canvas">
          <RunGlyph status={run.status} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[11.5px] font-medium text-ink">{run.name}</span>
            <span className={cn('h-1 w-1 shrink-0 rounded-full', STATUS_DOT[run.status])} />
            <span className="ml-auto shrink-0 font-mono text-[9px] text-faint">
              {formatElapsed(run, now)}
            </span>
          </span>
          <span
            className={cn(
              'mt-0.5 block truncate text-[10.5px]',
              run.status === 'running' ? 'text-muted' : 'text-faint'
            )}
          >
            {headline}
          </span>
        </span>
        <ChevronDown
          size={12}
          className={cn(
            'mt-1 shrink-0 text-faint transition-transform duration-200',
            open && 'rotate-180'
          )}
        />
      </button>

      {open ? (
        <div className="border-t border-line/70 px-3 pt-2.5 pb-3">
          <p className="line-clamp-3 text-[10.5px] leading-[1.6] text-muted">{run.instruction}</p>

          {run.steps.length ? (
            <ol className="mt-2.5 space-y-1.5">
              {run.steps.map((step) => (
                <li key={step.id} className="flex items-start gap-2">
                  <span
                    className={cn(
                      'mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full',
                      step.status === 'running'
                        ? 'bg-accent breathing'
                        : step.status === 'ok'
                          ? 'bg-positive/80'
                          : 'bg-danger'
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[10.5px] leading-tight text-ink/85">
                      {step.title}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[8.5px] text-faint">
                      {step.tool}
                      {step.detail ? ` · ${step.detail}` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          ) : run.status === 'running' ? (
            <p className="mt-2.5 flex items-center gap-1.5 text-[10px] text-faint">
              <span className="breathing h-1 w-1 rounded-full bg-accent" />
              Starting up
            </p>
          ) : null}

          {run.summary ? (
            <p className="mt-2.5 rounded-lg bg-canvas/70 px-2.5 py-2 text-[10.5px] leading-[1.6] text-muted">
              {run.summary}
            </p>
          ) : null}
          {run.error ? (
            <p className="mt-2.5 text-[10px] leading-relaxed text-danger/90">{run.error}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function CrewBody({ task }: { task: Task }) {
  const runs = useApp((state) => state.subagents)
    .filter((run) => run.taskId === task.id)
    .sort((a, b) => {
      const live = Number(b.status === 'running') - Number(a.status === 'running')
      return live || b.startedAt.localeCompare(a.startedAt)
    })
  const live = runs.some((run) => run.status === 'running')
  const now = useTicker(live)

  if (!runs.length) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface text-faint">
          <Bot size={16} />
        </div>
        <p className="mt-3 text-[12px] font-medium text-ink">No Crew yet</p>
        <p className="mt-1 max-w-[200px] text-[10.5px] leading-relaxed text-faint">
          Work the Captain delegates shows up here as it runs.
        </p>
      </div>
    )
  }

  return (
    <div className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
      {runs.map((run, index) => (
        <RunCard key={run.id} run={run} now={now} index={index} />
      ))}
    </div>
  )
}

export function TaskPanel({ task, onClose }: { task: Task; onClose: () => void }) {
  const liveCrew = useApp(
    (state) => state.subagents.filter((run) => run.taskId === task.id && run.status === 'running').length
  )
  const crewCount = useApp(
    (state) => state.subagents.filter((run) => run.taskId === task.id).length
  )
  const [tab, setTab] = useState<PanelTab>(() => (liveCrew > 0 ? 'crew' : 'work'))

  return (
    <aside className="panel-in flex h-full w-[352px] shrink-0 flex-col border-l border-line bg-canvas-deep/65">
      <div className="flex h-[54px] shrink-0 items-center gap-1 border-b border-line px-2.5">
        <button
          onClick={() => setTab('work')}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-medium transition-colors',
            tab === 'work' ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink'
          )}
        >
          <FolderOpen size={12} />
          Work
          {task.artifacts.length ? (
            <span className="text-[9.5px] text-faint">{task.artifacts.length}</span>
          ) : null}
        </button>
        <button
          onClick={() => setTab('crew')}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-medium transition-colors',
            tab === 'crew' ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink'
          )}
        >
          <Bot size={12} />
          Crew
          {liveCrew > 0 ? (
            <span className="flex items-center gap-1 text-[9.5px] text-accent">
              <span className="breathing h-1 w-1 rounded-full bg-accent" />
              {liveCrew}
            </span>
          ) : crewCount ? (
            <span className="text-[9.5px] text-faint">{crewCount}</span>
          ) : null}
        </button>
        <div className="flex-1" />
        <IconButton onClick={onClose} aria-label="Close panel">
          <PanelRightClose size={14} />
        </IconButton>
      </div>

      {tab === 'work' ? <ArtifactPanelBody task={task} /> : <CrewBody task={task} />}

      <div className="shrink-0 border-t border-line px-4 py-2.5 text-[10px] leading-relaxed text-faint">
        {tab === 'crew' ? 'Crew runs stay on this device.' : 'Files stay in this task.'}
      </div>
    </aside>
  )
}
