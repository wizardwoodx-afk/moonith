import { motion } from 'framer-motion'
import { AlertCircle, Check, GitBranch, Pause } from 'lucide-react'
import type { Task } from '@shared/types'
import { cn } from '../lib/utils'
import { activeStep, orbStateForTool } from './activityMotion'
import { TaskOrb } from './TaskOrb'

export function ActionNodeCard({ task }: { task: Task }) {
  const step = activeStep(task)
  if (!step) return null
  const complete = task.steps.filter((item) => item.status === 'ok').length
  const running = step.status === 'running' && task.status === 'running'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'relative mb-4 overflow-hidden rounded-[var(--r-card)] border bg-surface/45 px-3.5 py-3',
        step.status === 'error' ? 'border-danger/25' : running ? 'border-accent/30' : 'border-line'
      )}
    >
      <span className="absolute top-1/2 -left-[3px] h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-accent" />
      <span className="absolute top-1/2 -right-[3px] h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-line-strong" />
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--r-field)] border border-line bg-canvas">
          {running ? (
            <TaskOrb state={orbStateForTool(step.tool)} label={`${step.title} in progress`} />
          ) : step.status === 'error' ? (
            <AlertCircle size={13} className="text-danger" />
          ) : step.status === 'waiting' || task.status === 'paused' ? (
            <Pause size={12} className="text-warn" />
          ) : (
            <Check size={13} className="text-positive" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <GitBranch size={10} className="shrink-0 text-faint" />
            <span
              className="min-w-0 truncate text-[11.5px] font-medium text-ink"
              title={step.title}
            >
              {step.title}
            </span>
            <span className="ml-auto shrink-0 font-mono text-[10px] text-faint">
              {complete}/{task.steps.length}
            </span>
          </div>
          <p
            className="mt-0.5 truncate font-mono text-[10px] text-faint"
            title={`${step.tool}${step.detail ? ` · ${step.detail}` : ''}`}
          >
            {step.tool}{step.detail ? ` · ${step.detail}` : ''}
          </p>
        </div>
      </div>
      {running ? <span className="action-flow absolute inset-x-3 bottom-0 h-px" aria-hidden="true" /> : null}
    </motion.div>
  )
}
