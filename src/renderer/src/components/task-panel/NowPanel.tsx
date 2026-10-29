import { useMemo } from 'react'
import { agentName } from '../../lib/localProfile'
import { motion, useReducedMotionConfig } from 'framer-motion'
import type { Task } from '@shared/types'
import { useApp } from '../../store'
import { activeStep, orbStateForTask } from '../../motion/activityMotion'
import { ICON_SIZES, Icon, type IconName } from '../icons'
import { TaskOrb } from '../../motion/TaskOrb'
import { AnimatedCheck } from '../../motion/AnimatedCheck'
import { ArtifactChip } from '../Artifacts'
import { cn, timeAgo } from '../../lib/utils'
import { crewRunsForTask, mcpExposure } from '../../lib/taskOperations'
import { CrewRunCard, useCrewTicker } from './CrewRuns'
import type { TaskCapabilities } from './useTaskCapabilities'

/**
 * The task's own state, one glyph per state, in the app's largest icon slot. The
 * orb keeps its size from the motion layer; the static halves match it on the
 * scale so the tile reads as one mark changing.
 */
function TaskStateGlyph({ task, crewActive }: { task: Task; crewActive: boolean }) {
  if (task.status === 'running') return <TaskOrb state={orbStateForTask(task, crewActive)} size={32} label={`${agentName()} working`} />
  if (task.status === 'waiting') return <TaskOrb state="breathing" size={32} label="Waiting for input" />
  if (task.status === 'done') return <AnimatedCheck size={ICON_SIZES.xl} className="text-positive" />
  if (task.status === 'error') return <Icon name="alert" size="xl" className="text-danger" />
  if (task.status === 'paused') return <Icon name="pause" size="xl" className="text-muted" />
  return <Icon name="spark" size="xl" className="text-accent" />
}

export function NowPanel({
  task,
  capabilities,
  onNavigate
}: {
  task: Task
  capabilities: TaskCapabilities
  onNavigate: (tab: 'crew' | 'tools' | 'files') => void
}) {
  const allRuns = useApp((state) => state.subagents)
  const reduced = useReducedMotionConfig()
  const approval = useApp((state) => state.approval)
  const runs = useMemo(() => crewRunsForTask(allRuns, task.id), [allRuns, task.id])
  const live = runs.filter((run) => run.status === 'running').length
  const now = useCrewTicker(live > 0)
  const current = activeStep(task)
  const ready = capabilities.statuses.filter((status) => status.status === 'ready').length
  const exposedTools = capabilities.configs.reduce(
    (total, config) => total + mcpExposure(config, capabilities.statuses.find((status) => status.id === config.id)).exposed,
    0
  )
  const planDone = task.plan.filter((item) => item.status === 'done').length
  const stepDone = task.steps.filter((step) => step.status === 'ok' || step.status === 'error').length
  const progress = task.plan.length
    ? { complete: planDone, total: task.plan.length, label: 'plan item' }
    : task.steps.length
      ? { complete: stepDone, total: task.steps.length, label: 'step' }
      : null
  const pendingApproval = approval?.taskId === task.id ? approval : null
  const capabilitiesUnavailable = Boolean(
    capabilities.error && !capabilities.skills.length && !capabilities.configs.length
  )
  const latestArtifacts = [...task.artifacts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3)

  const stateHeadline =
    task.status === 'running'
      ? current?.title ?? (live ? `Coordinating ${live} team run${live === 1 ? '' : 's'}` : `${agentName()} is working`)
      : task.status === 'waiting'
        ? pendingApproval?.title ?? 'Waiting for your input'
        : task.status === 'done'
          ? 'Task complete'
          : task.status === 'error'
            ? 'Task needs attention'
            : task.status === 'paused'
              ? 'Task paused'
              : 'Ready for your instructions'

  const metrics: { label: string; value: string | number; detail: string; icon: IconName; tab: 'crew' | 'tools' | 'files' }[] = [
    { label: 'Team', value: `${live}/${runs.length}`, detail: `${live} running`, icon: 'crew', tab: 'crew' },
    { label: 'Skills', value: capabilities.loading ? '…' : capabilitiesUnavailable ? '—' : capabilities.skills.length, detail: 'installed', icon: 'spark', tab: 'tools' },
    { label: 'MCP', value: capabilities.loading ? '…' : capabilitiesUnavailable ? '—' : `${ready}/${capabilities.configs.length}`, detail: `${exposedTools} tools`, icon: 'connector', tab: 'tools' },
    { label: 'Files', value: task.artifacts.length, detail: 'created', icon: 'output', tab: 'files' }
  ]

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2.5 pt-3 pb-4">
      <motion.section
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          'rounded-2xl border bg-surface/45 p-3.5',
          task.status === 'running' ? 'border-accent/25' : task.status === 'error' ? 'border-danger/25' : 'border-line'
        )}
      >
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-canvas">
            <TaskStateGlyph task={task} crewActive={live > 0} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="min-w-0 flex-1 truncate text-[12.5px] leading-snug font-medium text-ink" title={stateHeadline}>
                {stateHeadline}
              </h2>
              <span className="shrink-0 whitespace-nowrap text-[10px] text-faint">Updated {timeAgo(task.updatedAt)}</span>
            </div>
            {current?.detail && task.status === 'running' ? (
              <p className="mt-0.5 truncate font-mono text-[10px] text-faint" title={current.detail}>
                {current.detail}
              </p>
            ) : null}
          </div>
        </div>
        {progress ? (
          <div className="mt-3">
            <div className="flex items-center justify-between text-[10px] text-faint">
              <span>
                {progress.complete} of {progress.total} {progress.label}
                {progress.total === 1 ? '' : 's'} done
              </span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-line/70">
              <motion.div
                initial={false}
                animate={{ width: `${(progress.complete / progress.total) * 100}%` }}
                transition={{ duration: reduced ? 0 : 0.25 }}
                className="h-full rounded-full bg-accent"
              />
            </div>
          </div>
        ) : null}

        {task.mode === 'cowork' ? (
          <div className="mt-2.5 flex items-center justify-between rounded-lg border border-accent/25 bg-accent-soft/30 px-2.5 py-1 text-[10.5px]">
            <span className="font-semibold text-accent-ink">Enterprise Cowork</span>
            <span className="text-faint">Zero-Trust Passport & Attestation Active</span>
          </div>
        ) : null}
      </motion.section>

      <div className="mt-2.5 grid grid-cols-4 gap-1.5">
        {metrics.map((metric) => (
          <button
            key={metric.label}
            onClick={() => onNavigate(metric.tab)}
            className="rounded-xl border border-line bg-canvas/40 px-2 py-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-line-strong hover:bg-surface/50"
          >
            {/* A metric tile states its own count, so its glyph stays the outline. */}
            <Icon name={metric.icon} size="xs" className="text-faint" />
            <span className="mt-1.5 block font-mono text-[13px] font-medium text-ink">{metric.value}</span>
            <span className="mt-0.5 block text-[10px] font-medium text-muted">{metric.label}</span>
            <span className="mt-0.5 block truncate text-[10px] text-faint" title={metric.detail}>{metric.detail}</span>
          </button>
        ))}
      </div>

      {capabilities.error ? (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-danger/20 bg-danger/5 px-2.5 py-2 text-[10px] text-danger">
          <Icon name="alert" size="xs" />
          <span className="min-w-0 flex-1 truncate">Skills and MCP could not be read.</span>
          <button onClick={() => void capabilities.refresh()} className="shrink-0 whitespace-nowrap underline">Retry</button>
        </div>
      ) : null}

      {pendingApproval ? (
        <section className="mt-3 rounded-xl border border-warn/25 bg-warn/5 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[10.5px] font-medium text-warn">
            {/* Outline: the gate is waiting on you. The same glyph fills once the
                work is actually running under its guard. */}
            <Icon name="shield" size="sm" /> Approval requested
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-muted">{pendingApproval.summary}</p>
          <p className="mt-1 font-mono text-[10px] text-faint">{pendingApproval.tool} · {pendingApproval.risk} risk</p>
        </section>
      ) : null}

      <section className="mt-4">
        <div className="mb-2 flex items-center gap-2 px-1">
          <Icon name="crew" size="sm" active={live > 0} className="text-accent" />
          <h3 className="text-[10px] font-semibold tracking-[0.11em] text-muted uppercase">Team runs</h3>
          {runs.length ? <button onClick={() => onNavigate('crew')} className="ml-auto text-[10px] text-faint hover:text-ink">View all</button> : null}
        </div>
        {runs.length ? (
          <div className="space-y-2">
            {runs.slice(0, 3).map((run, index) => <CrewRunCard key={run.id} run={run} now={now} index={index} compact />)}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-line px-4 py-5 text-center">
            <p className="text-[10.5px] font-medium text-ink">{agentName()} is handling this task directly</p>
          </div>
        )}
      </section>

      {latestArtifacts.length ? (
        <section className="mt-4">
          <div className="mb-2 flex items-center gap-2 px-1">
            <Icon name="output" size="sm" className="text-accent" />
            <h3 className="text-[10px] font-semibold tracking-[0.11em] text-muted uppercase">Latest output</h3>
            <button onClick={() => onNavigate('files')} className="ml-auto text-[10px] text-faint hover:text-ink">All files</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {latestArtifacts.map((artifact) => <ArtifactChip key={artifact.id} artifact={artifact} taskId={task.id} />)}
          </div>
        </section>
      ) : null}
    </div>
  )
}
