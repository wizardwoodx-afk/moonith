import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ThumbsDown, ThumbsUp, X } from 'lucide-react'
import type { MessageVote } from '@shared/types'
import { cn } from '../lib/utils'

/**
 * Thumbs on an assistant turn. The outline glyph is the resting state and the
 * same geometry filled is the chosen state, so the pair reads as one control
 * changing rather than two different icons swapping.
 *
 * A downvote opens for a reason: a bare dislike tells the next person nothing.
 */
export function MessageFeedback({
  value,
  note,
  onVote
}: {
  value?: MessageVote
  note?: string
  onVote: (next: MessageVote | null, note?: string) => void
}) {
  const [asking, setAsking] = useState(false)
  const [draft, setDraft] = useState('')
  const [sent, setSent] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!asking) return
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panel = dialogRef.current
    const first = panel?.querySelector<HTMLElement>('textarea, button')
    ;(first ?? panel)?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeAsk()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      returnFocus.current?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asking])

  const vote = (next: MessageVote): void => {
    if (value === next) {
      onVote(null)
      return
    }
    onVote(next)
    if (next === 'down') {
      setDraft(note ?? '')
      setSent(false)
      setAsking(true)
    }
  }

  const closeAsk = (): void => {
    setAsking(false)
    setSent(false)
    setDraft('')
  }

  const submit = (): void => {
    const reason = draft.trim()
    if (reason) onVote('down', reason)
    setSent(true)
    window.setTimeout(closeAsk, 900)
  }

  const glyph = 'inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors'

  return (
    <>
      <span className="inline-flex items-center gap-0.5">
        <button
          type="button"
          aria-label="This reply was helpful"
          aria-pressed={value === 'up'}
          onClick={() => vote('up')}
          className={cn(
            glyph,
            value === 'up' ? 'bg-accent-soft text-accent-ink' : 'text-faint hover:bg-surface-2 hover:text-ink'
          )}
        >
          <ThumbsUp size={12} fill={value === 'up' ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          aria-label="This reply was not helpful"
          aria-pressed={value === 'down'}
          onClick={() => vote('down')}
          className={cn(
            glyph,
            value === 'down' ? 'bg-accent-soft text-accent-ink' : 'text-faint hover:bg-surface-2 hover:text-ink'
          )}
        >
          <ThumbsDown size={12} fill={value === 'down' ? 'currentColor' : 'none'} />
        </button>
      </span>

      <AnimatePresence>
        {asking ? (
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-label="Tell us what went wrong"
            tabIndex={-1}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-4 outline-none sm:items-center"
            onClick={(event) => {
              if (event.target === event.currentTarget) closeAsk()
            }}
          >
            {/* The card unrolls downward from its top edge, the way a sheet of
                paper is pulled into view, rather than fading in place. */}
            <motion.div
              initial={{ clipPath: 'inset(0 0 100% 0 round 12px)', y: -4 }}
              animate={{ clipPath: 'inset(0 0 0 0 round 12px)', y: 0 }}
              transition={{ duration: 0.2, delay: 0.016, ease: [0.2, 0.8, 0.2, 1] }}
              className="w-full max-w-[420px] rounded-xl border border-line bg-panel p-4 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.7)]"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-[12.5px] font-medium text-ink">What went wrong with this reply?</p>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={closeAsk}
                  className="-mr-1 -mt-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-faint hover:bg-surface-2 hover:text-ink"
                >
                  <X size={13} />
                </button>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted">
                One line is enough. It stays on this device with the task.
              </p>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={3}
                disabled={sent}
                placeholder="It missed the point, the facts are wrong, the file is not what I asked for…"
                className="mt-3 w-full resize-none rounded-lg border border-line bg-surface px-2.5 py-2 text-[12px] text-ink outline-none placeholder:text-faint focus:border-line-strong"
              />
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeAsk}
                  className="rounded-lg px-2.5 py-1.5 text-[11.5px] text-muted hover:bg-surface-2 hover:text-ink"
                >
                  Skip
                </button>
                <button
                  type="button"
                  data-autofocus
                  disabled={sent || !draft.trim()}
                  onClick={submit}
                  className="rounded-lg bg-accent px-3 py-1.5 text-[11.5px] font-medium text-on-ink transition-transform duration-75 active:translate-y-[0.5px] active:scale-[0.985] disabled:opacity-45"
                >
                  {sent ? 'Noted' : 'Send'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}
