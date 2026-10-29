import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, CircleCheck, CircleX, Clock } from 'lucide-react'
import type { StepRecord, TaskStatus } from '@shared/types'
import { deriveAgentActivity } from '../lib/agentActivity'
import { useMotion } from '../lib/motion'
import { AgentActivity } from '../motion/AgentActivity'
import { createBatchOrder, DURATION, EASE_ENTER, EASE_EXIT } from '../motion/timing'
import { useApp } from '../store'

function StepMark({ step }: { step: StepRecord }) {
  if (step.status === 'running') return <Clock size={12} className="text-faint" />
  if (step.status === 'waiting') return <Clock size={12} className="text-warn" />
  if (step.status === 'ok') return <CircleCheck size={13} className="text-positive" />
  return <CircleX size={13} className="text-danger" />
}

/* The row height is fixed, so both marks can sit in the same slot and trade
   places. A status flip is the one change in this list that means something, so
   it crossfades instead of swapping: the old mark leaves while the new one
   arrives, and the line underneath never moves. */
function StepIcon({ step, reduced }: { step: StepRecord; reduced: boolean }) {
  return (
    <span className="relative mt-[1px] flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      <AnimatePresence initial={false}>
        <motion.span
          key={step.status}
          className="absolute inset-0 flex items-center justify-center"
          initial={{ opacity: 0, scale: reduced ? 1 : 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: reduced ? 1 : 1.05 }}
          transition={{
            opacity: { duration: DURATION.enter, ease: EASE_ENTER },
            scale: { duration: reduced ? 0 : DURATION.enter, ease: EASE_ENTER }
          }}
        >
          <StepMark step={step} />
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

interface WorkTrailProps {
  thinking?: string
  steps: StepRecord[]
  live: boolean
  taskId?: string
  taskStatus?: TaskStatus
  responding?: boolean
}

/**
 * The work trail of a single assistant turn: how long it has been running, the
 * model's reasoning when there is any, which tools it touched, and one line
 * saying what is happening right now. It stays folded once the turn is over, so
 * a finished conversation reads as a short list of steps rather than a wall of
 * machinery.
 */
export function WorkTrail({ thinking, steps, live, taskId, taskStatus, responding }: WorkTrailProps) {
  const subagents = useApp((state) => state.subagents)
  const reduced = useMotion((state) => state.resolved) === 'reduced'
  const activeAgents = live && taskId
    ? subagents.filter((run) => run.taskId === taskId && run.status === 'running').length
    : 0
  const activity = deriveAgentActivity({ live, thinking, responding, taskStatus, steps, activeAgents })
  const inFlight = live && !['complete', 'error', 'paused'].includes(activity.state)

  /* The trail follows the turn: it opens while the turn runs and folds when
   * the turn ends. A click by the reader wins until the next turn starts. */
  const [override, setOverride] = useState<boolean | null>(null)
  const [thoughtOpen, setThoughtOpen] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const open = override ?? live

  useEffect(() => {
    if (live) {
      setOverride(null)
      setThoughtOpen(false)
    }
  }, [live, taskId])

  useEffect(() => {
    if (!inFlight) return
    setElapsed(0)
    const started = Date.now()
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [inFlight, taskId])

  /* Rows that appear in the same frame cascade by position; a row the agent
   * adds on its own gets no delay, because it is the only thing that changed.
   * The cache is per id, so a re-render of a list that is already on screen
   * restates the same positions and nothing restarts. */
  const batch = useRef(createBatchOrder())
  useEffect(() => {
    batch.current.reset()
  }, [taskId])
  const stepPosition = (id: string): number => batch.current.positionFor(id)

  const reasoning = thinking?.trim() ?? ''
  const hasTrail = reasoning !== '' || steps.length > 0
  if (!hasTrail && !live) return null

  const preview = reasoning.replace(/\s+/g, ' ')

  return (
    <div className="mb-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOverride(!open)}
          aria-expanded={open}
          aria-label={open ? 'Fold the work trail' : 'Open the work trail'}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-faint transition-colors duration-100 hover:border-line-strong hover:text-ink"
        >
          <motion.span
            animate={{ rotate: open ? 0 : -90 }}
            transition={{ duration: reduced ? 0 : DURATION.enter, ease: EASE_ENTER }}
          >
            <ChevronDown size={12} />
          </motion.span>
        </button>
        <AgentActivity activity={activity} />
        {inFlight ? (
          <span className="shrink-0 text-[12px] text-muted" aria-live="off">· {elapsed}s</span>
        ) : null}
      </div>

      {/* Opening is the reader asking, so it decelerates into place. Closing is
          them discarding, so it accelerates and gets out faster. Height is
          layout and drops to zero in reduced mode; opacity is not layout and
          stays, so folding never hard-cuts. */}
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{
              height: 'auto',
              opacity: 1,
              transition: reduced
                ? { height: { duration: 0 }, opacity: { duration: DURATION.enter, ease: EASE_ENTER } }
                : {
                    height: { duration: DURATION.pop, ease: EASE_ENTER },
                    opacity: { duration: DURATION.enter, ease: EASE_ENTER }
                  }
            }}
            exit={
              reduced
                ? { opacity: 0, height: 0, transition: { opacity: { duration: DURATION.exit }, height: { duration: 0 } } }
                : { opacity: 0, height: 0, transition: { duration: DURATION.exit, ease: EASE_EXIT } }
            }
            className="overflow-hidden"
          >
            <div className="ml-5 mt-1.5 space-y-1.5 border-l border-line/70 pl-3.5">
              {reasoning !== '' ? (
                <div>
                  <button
                    type="button"
                    onClick={() => setThoughtOpen((value) => !value)}
                    aria-expanded={thoughtOpen}
                    className="flex w-full items-center gap-2 text-left"
                  >
                    <Clock size={12} className="text-faint" aria-hidden="true" />
                    <span className="shrink-0 text-[12px] font-semibold text-ink">Reasoning</span>
                    <span className="shrink-0 text-[12px] text-faint">·</span>
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">
                      {preview}
                    </span>
                  </button>
                  {thoughtOpen ? (
                    <p
                      data-motion="state"
                      className="trail-note-in mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap pr-2 text-[11.5px] leading-relaxed text-muted"
                    >
                      {reasoning}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {steps.map((step) => (
                <div
                  key={step.id}
                  data-motion="state"
                  className="trail-step-in flex items-start gap-2"
                  style={{ '--stagger-index': stepPosition(step.id) } as CSSProperties}
                >
                  <StepIcon step={step} reduced={reduced} />
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">
                    {step.title}
                    {step.detail ? (
                      <span className="ml-1.5 text-faint">{step.detail}</span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
