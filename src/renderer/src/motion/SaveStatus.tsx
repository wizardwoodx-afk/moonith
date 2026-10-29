import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion'
import { AlertTriangle, Check, CircleDashed, Loader2, PencilLine } from 'lucide-react'
import { cn } from '../lib/utils'

export type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error'

const CONTENT: Record<SaveState, { label: string; className: string }> = {
  saved: { label: 'Saved locally', className: 'text-faint' },
  dirty: { label: 'Unsaved changes', className: 'text-muted' },
  saving: { label: 'Saving…', className: 'text-muted' },
  conflict: { label: 'Revision conflict', className: 'text-warn' },
  error: { label: 'Save needs attention', className: 'text-danger' }
}

/** Status-button transition adapted from Animata (MIT), driven only by actual
 * editor/service state—there are no demo timers or simulated completions. */
export function SaveStatus({ state, className }: { state: SaveState; className?: string }) {
  const reduced = useReducedMotionConfig()
  const content = CONTENT[state]
  const Icon = state === 'saved' ? Check : state === 'saving' ? Loader2 : state === 'conflict' || state === 'error' ? AlertTriangle : state === 'dirty' ? PencilLine : CircleDashed
  return (
    <span className={cn('inline-flex min-w-[112px] items-center justify-end text-[10.5px]', content.className, className)} aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={state}
          initial={reduced ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 1 } : { opacity: 0, y: 4 }}
          transition={{ duration: reduced ? 0 : 0.12 }}
          className="inline-flex items-center gap-1.5"
        >
          <Icon size={11} className={cn(state === 'saving' && 'animate-spin')} aria-hidden />
          {content.label}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
