import { useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion'
import { ArrowLeft, ArrowRight, ArrowUpRight, CheckCircle2, FileText } from 'lucide-react'
import type { TaskSummary } from '@shared/types'
import { BrandMark } from '../components/BrandMarks'
import { useApp } from '../store'
import { cn, statusLabel, timeAgo } from '../lib/utils'

export function TaskDeck({ tasks }: { tasks: TaskSummary[] }) {
  const openTask = useApp((state) => state.openTask)
  const reduced = useReducedMotionConfig()
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState(1)
  const deck = useMemo(() => tasks.slice(0, 6), [tasks])
  if (!deck.length) return null
  const current = ((index % deck.length) + deck.length) % deck.length
  const ordered = [...deck.slice(current), ...deck.slice(0, current)]
  const top = ordered[0]

  const move = (delta: number): void => {
    setDirection(delta)
    setIndex((value) => value + delta)
  }

  return (
    <div>
      <div className="relative h-[174px]" aria-live="polite">
        {ordered
          .slice(1, 3)
          .reverse()
          .map((task, reverseIndex) => {
            const depth = ordered.slice(1, 3).length - reverseIndex
            return (
              <motion.div
                key={task.id}
                initial={false}
                animate={{
                  x: reduced ? 0 : depth * 8,
                  y: depth * 8,
                  scale: 1 - depth * 0.025,
                  rotate: reduced ? 0 : depth * 0.7,
                  opacity: 0.65 - depth * 0.16
                }}
                transition={{ type: 'spring', stiffness: 280, damping: 28 }}
                className="pointer-events-none absolute inset-0 rounded-2xl border border-line bg-surface/80"
                aria-hidden="true"
              />
            )
          })}
        <AnimatePresence initial={false} custom={direction}>
          <motion.button
            key={top.id}
            custom={direction}
            initial={{ opacity: 0, x: reduced ? 0 : direction * 46, rotate: reduced ? 0 : direction * 2 }}
            animate={{ opacity: 1, x: 0, rotate: 0 }}
            exit={{ opacity: 0, x: reduced ? 0 : direction * -62, rotate: reduced ? 0 : direction * -3 }}
            transition={{ type: 'spring', stiffness: 300, damping: 29 }}
            onClick={() => void openTask(top.id)}
            className="group absolute inset-0 flex w-full flex-col rounded-2xl border border-line bg-surface p-4 text-left shadow-[0_22px_48px_-34px_rgba(0,0,0,0.55)] outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-accent-soft text-accent-ink">
                {top.status === 'done' ? <CheckCircle2 size={15} className="text-positive" /> : <BrandMark size={15} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink" title={top.title}>{top.title}</p>
                <p className="mt-0.5 text-[10px] text-faint">
                  {statusLabel(top.status)} · {timeAgo(top.updatedAt)}
                </p>
              </div>
              <ArrowUpRight size={14} className="text-faint transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-ink" />
            </div>
            <p className="mt-3 line-clamp-2 text-[11.5px] leading-relaxed text-muted" title={top.objective}>{top.objective}</p>
            <div className="mt-auto flex items-center gap-2 pt-3 text-[10px] text-faint">
              <span className="rounded-md border border-line bg-canvas px-1.5 py-0.5">
                {top.mode === 'cowork' ? 'Cowork' : 'Chat'}
              </span>
              {top.artifactsCount > 0 ? (
                <span className="flex items-center gap-1"><FileText size={9} />{top.artifactsCount} files</span>
              ) : null}
              <span className="ml-auto">{current + 1} / {deck.length}</span>
            </div>
          </motion.button>
        </AnimatePresence>
      </div>
      {deck.length > 1 ? (
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {deck.map((task, taskIndex) => (
              <motion.span
                key={task.id}
                animate={{ width: taskIndex === current ? 14 : 4, opacity: taskIndex === current ? 1 : 0.35 }}
                className={cn('h-1 rounded-full', taskIndex === current ? 'bg-accent' : 'bg-faint')}
              />
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => move(-1)} className="flex h-7 w-7 items-center justify-center rounded-full border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink" aria-label="Previous recent task">
              <ArrowLeft size={12} />
            </button>
            <button onClick={() => move(1)} className="flex h-7 w-7 items-center justify-center rounded-full border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink" aria-label="Next recent task">
              <ArrowRight size={12} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
