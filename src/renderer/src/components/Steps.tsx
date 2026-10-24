import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Activity, ChevronDown, Clock, X } from 'lucide-react'
import type { StepRecord } from '@shared/types'
import { cn } from '../lib/utils'
import { TaskOrb } from '../motion/TaskOrb'
import { AnimatedCheck } from '../motion/AnimatedCheck'
import { ShimmerText } from '../motion/ShimmerText'
import { orbStateForTool } from '../motion/activityMotion'

function StepIcon({ step, live }: { step: StepRecord; live: boolean }) {
  if (step.status === 'running') {
    return <TaskOrb state={orbStateForTool(step.tool)} label={`${step.title} in progress`} paused={!live} />
  }
  if (step.status === 'waiting') return <Clock size={12} className="text-warn" />
  if (step.status === 'ok') return <AnimatedCheck size={12} className="text-positive" />
  return <X size={12} className="text-danger" />
}

export function StepList({ steps, live }: { steps: StepRecord[]; live: boolean }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [collapsed, setCollapsed] = useState(!live)
  const previousLive = useRef(live)

  useEffect(() => {
    if (previousLive.current === live) return
    previousLive.current = live
    setCollapsed(!live)
  }, [live])

  if (!steps.length) return null
  const current = [...steps].reverse().find((step) => step.status === 'running')

  return (
    <motion.div layout className="mt-3.5">
      <button
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-surface-2/35"
      >
        {live ? (
          <TaskOrb state={orbStateForTool(current?.tool)} label="Task activity in progress" />
        ) : (
          <Activity size={13} className="text-faint" />
        )}
        <span className="text-[10px] font-semibold tracking-[0.12em] text-faint uppercase">
          {live ? <ShimmerText>Working</ShimmerText> : 'Activity'}
        </span>
        <span className="h-px flex-1 bg-line" />
        <span className="text-[10px] text-faint">{steps.length}</span>
        <motion.span animate={{ rotate: collapsed ? -90 : 0 }} transition={{ duration: 0.18 }}>
          <ChevronDown size={12} className="text-faint" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {!collapsed ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ height: { duration: 0.24 }, opacity: { duration: 0.16 } }}
            className="overflow-hidden"
          >
            <motion.div layout className="space-y-1 pt-1">
              {steps.map((step, index) => {
                const hasDetails = Boolean(step.output || step.error)
                const isOpen = expanded[step.id] ?? step.status === 'error'
                return (
                  <motion.div
                    layout
                    key={step.id}
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(index, 8) * 0.025, duration: 0.2 }}
                    className={cn(
                      'overflow-hidden rounded-[10px] border bg-canvas/45 transition-colors',
                      step.status === 'running' && live
                        ? 'border-accent/30'
                        : step.status === 'error'
                          ? 'border-danger/20'
                          : 'border-line/80'
                    )}
                  >
                    <button
                      onClick={() =>
                        hasDetails && setExpanded((state) => ({ ...state, [step.id]: !isOpen }))
                      }
                      aria-expanded={hasDetails ? isOpen : undefined}
                      className={cn(
                        'flex w-full items-start gap-2.5 px-2.5 py-[7px] text-left',
                        hasDetails && 'hover:bg-surface-2/40'
                      )}
                    >
                      <span className="mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center">
                        <StepIcon step={step} live={live} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="shrink-0 text-[12px] font-medium text-ink/90">{step.title}</span>
                          {step.detail ? <span className="truncate text-[11.5px] text-faint">{step.detail}</span> : null}
                        </span>
                        {step.status === 'error' && step.error && !isOpen ? (
                          <span className="mt-0.5 block truncate text-[11px] text-danger/90">{step.error}</span>
                        ) : null}
                      </span>
                      {hasDetails ? (
                        <motion.span animate={{ rotate: isOpen ? 180 : 0 }} className="mt-[3px] shrink-0">
                          <ChevronDown size={12} className="text-faint" />
                        </motion.span>
                      ) : null}
                    </button>
                    <AnimatePresence initial={false}>
                      {isOpen && hasDetails ? (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden border-t border-line/70 bg-surface/40"
                        >
                          <pre className="scroll-thin max-h-56 overflow-auto px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted">
                            {step.error && !step.output ? step.error : step.output}
                          </pre>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </motion.div>
                )
              })}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  )
}
