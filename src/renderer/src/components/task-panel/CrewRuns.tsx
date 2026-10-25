import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { AlertCircle, Bot, Check, ChevronDown, Minus, Settings2 } from 'lucide-react'
import type { SubAgentRun } from '@shared/types'
import { useApp } from '../../store'
import {
  crewRunsForTask,
  crewStepProgress,
  currentCrewStep,
  filterCrewRuns,
  formatRunElapsed,
  type CrewFilter
} from '../../lib/taskOperations'
import { cn } from '../../lib/utils'
import { TaskOrb } from '../../motion/TaskOrb'
import { AnimatedCheck } from '../../motion/AnimatedCheck'

const STATUS_DOT: Record<SubAgentRun['status'], string> = {
  running: 'bg-accent',
  done: 'bg-positive',
  error: 'bg-danger',
  stopped: 'bg-faint'
}

export function useCrewTicker(active: boolean): number {
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
  if (status === 'running') return <TaskOrb state="weaving" label="Crew run in progress" />
  if (status === 'done') return <AnimatedCheck size={13} className="text-positive" />
  if (status === 'error') return <AlertCircle size={13} className="text-danger" />
  return <Minus size={13} className="text-faint" />
}

export function CrewRunCard({
  run,
  now,
  index = 0,
  compact = false
}: {
  run: SubAgentRun
  now: number
  index?: number
  compact?: boolean
}) {
  const [open, setOpen] = useState(run.status === 'running' && !compact)
  const reduced = useReducedMotion()
  const current = currentCrewStep(run)
  const progress = crewStepProgress(run)
  const agentPath = run.agentPath?.length ? run.agentPath.join(' / ') : `Captain / ${run.name}`
  const recentEvents = [...(run.events ?? [])].slice(-3).reverse()
  const headline =
    run.status === 'running'
      ? (current?.title ?? 'Preparing the run')
      : run.status === 'done'
        ? `${progress.completed} step${progress.completed === 1 ? '' : 's'} finished`
        : run.status === 'error'
          ? 'Run needs attention'
          : 'Stopped with the parent task'

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 7, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: Math.min(index, 5) * 0.035, duration: 0.22 }}
      className={cn(
        'overflow-hidden rounded-xl border bg-surface/45',
        run.status === 'running' ? 'border-accent/25' : 'border-line'
      )}
    >
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors outline-none hover:bg-surface-2/40 focus-visible:bg-surface-2/55"
      >
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-canvas">
          <RunGlyph status={run.status} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[11.5px] font-medium text-ink">{run.name}</span>
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[run.status])} />
            <span className="ml-auto shrink-0 font-mono text-[9px] text-faint">
              {formatRunElapsed(run, now)}
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
          {!compact ? (
            <span className="mt-1 block truncate font-mono text-[8.5px] text-faint">
              {run.runtime === 'crew-mesh' ? 'Crew Mesh' : 'Crew'} · {run.provider} · {run.model || 'default model'}
            </span>
          ) : null}
        </span>
        <ChevronDown
          size={12}
          className={cn('mt-1 shrink-0 text-faint transition-transform duration-200', open && 'rotate-180')}
        />
      </button>

      {progress.total ? (
        <div className="mx-3 h-px overflow-hidden bg-line/80" aria-hidden="true">
          <div className="h-full bg-accent/70 transition-[width] duration-300" style={{ width: `${progress.ratio * 100}%` }} />
        </div>
      ) : null}

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={reduced ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: reduced ? 0 : 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pt-2.5 pb-3">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <span className="rounded-md border border-line bg-canvas/70 px-1.5 py-0.5 font-mono text-[8.5px] text-faint">
                  {agentPath}
                </span>
                {(run.batchSize ?? 1) > 1 ? (
                  <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[8.5px] font-medium text-accent-ink">
                    Team of {run.batchSize}
                  </span>
                ) : null}
                {run.usage && run.usage.total > 0 ? (
                  <span className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[8.5px] text-faint">
                    {run.usage.total.toLocaleString()} tokens
                  </span>
                ) : null}
              </div>
              {run.purpose ? <p className="mb-1.5 text-[10px] font-medium text-ink/75">{run.purpose}</p> : null}
              <p className="text-[10.5px] leading-[1.6] whitespace-pre-wrap text-muted">{run.instruction}</p>

              {run.steps.length ? (
                <ol className="mt-3 space-y-1.5">
                  {run.steps.map((step) => (
                    <li key={step.id} className="flex items-start gap-2">
                      <span
                        className={cn(
                          'mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full',
                          step.status === 'running'
                            ? 'breathing bg-accent'
                            : step.status === 'ok'
                              ? 'bg-positive/80'
                              : 'bg-danger'
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[10.5px] leading-tight text-ink/85">{step.title}</span>
                        <span className="mt-0.5 block truncate font-mono text-[8.5px] text-faint">
                          {step.tool}{step.detail ? ` · ${step.detail}` : ''}
                        </span>
                      </span>
                      {step.status === 'ok' ? <Check size={10} className="mt-0.5 shrink-0 text-positive" /> : null}
                    </li>
                  ))}
                </ol>
              ) : run.status === 'running' ? (
                <p className="mt-2.5 flex items-center gap-1.5 text-[10px] text-faint">
                  <span className="breathing h-1 w-1 rounded-full bg-accent" /> Starting up
                </p>
              ) : null}

              {recentEvents.length ? (
                <div className="mt-3 border-t border-line/70 pt-2">
                  <p className="text-[8.5px] font-semibold tracking-[0.1em] text-faint uppercase">Forwarded activity</p>
                  <ol className="mt-1.5 space-y-1">
                    {recentEvents.map((event) => (
                      <li key={event.id} className="flex items-center gap-1.5 text-[9px] text-faint">
                        <span className="h-1 w-1 shrink-0 rounded-full bg-accent/60" />
                        <span className="truncate">{event.label}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}

              {run.summary ? (
                <div className="scroll-thin mt-3 max-h-56 overflow-y-auto rounded-lg bg-canvas/70 px-2.5 py-2">
                  <p className="text-[9px] font-semibold tracking-[0.1em] text-faint uppercase">Crew report</p>
                  <p className="mt-1 text-[10.5px] leading-[1.65] whitespace-pre-wrap text-muted">{run.summary}</p>
                </div>
              ) : null}
              {run.error ? <p className="mt-2.5 text-[10px] leading-relaxed text-danger/90">{run.error}</p> : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.article>
  )
}

export function CrewPanel({ taskId }: { taskId: string }) {
  const [filter, setFilter] = useState<CrewFilter>('all')
  const allRuns = useApp((state) => state.subagents)
  const runs = useMemo(() => crewRunsForTask(allRuns, taskId), [allRuns, taskId])
  const openSettings = useApp((state) => state.openSettings)
  const live = runs.filter((run) => run.status === 'running').length
  const now = useCrewTicker(live > 0)
  const visible = filterCrewRuns(runs, filter)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <div>
            <p className="text-[11.5px] font-medium text-ink">Crew Mesh</p>
            <p className="mt-0.5 text-[9.5px] text-faint">{live} running · {runs.length} recorded</p>
          </div>
          <button
            onClick={() => openSettings('sub-agents')}
            className="ml-auto flex h-7 items-center gap-1.5 rounded-lg border border-line px-2 text-[10px] text-muted hover:bg-surface-2 hover:text-ink"
          >
            <Settings2 size={11} /> Full history
          </button>
        </div>
        <div className="mt-2.5 flex gap-1 rounded-lg bg-surface-2/60 p-0.5" role="tablist" aria-label="Filter Crew runs">
          {(['all', 'running', 'finished'] as const).map((value) => (
            <button
              key={value}
              role="tab"
              aria-selected={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                'h-6 flex-1 rounded-md text-[9.5px] font-medium capitalize transition-colors',
                filter === value ? 'bg-surface text-ink shadow-sm' : 'text-faint hover:text-muted'
              )}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-7 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-faint"><Bot size={17} /></div>
          <p className="mt-3 text-[12px] font-medium text-ink">No Crew delegated yet</p>
          <p className="mt-1 max-w-[240px] text-[10.5px] leading-relaxed text-faint">
            When Captain delegates part of this task, the run, model, tools, elapsed time, and report appear here.
          </p>
        </div>
      ) : (
        <div className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto px-2.5 pb-3">
          {visible.length ? visible.map((run, index) => <CrewRunCard key={run.id} run={run} now={now} index={index} />) : (
            <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[10.5px] text-faint">
              No {filter} Crew runs for this task.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
