import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { SmilePlus } from 'lucide-react'
import { toast } from 'sonner'
import { MESSAGE_REACTIONS, type ChatMessage } from '@shared/types'
import { cn, errorMessage } from '../lib/utils'

export function ReactionPicker({
  message,
  onReact,
  align = 'left'
}: {
  message: ChatMessage
  onReact: (emoji: string) => Promise<void>
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [burst, setBurst] = useState<{ id: number; emoji: string } | null>(null)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const pointer = (event: PointerEvent): void => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false)
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', pointer)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', pointer)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  const react = async (emoji: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await onReact(emoji)
      setBurst((value) => ({ id: (value?.id ?? 0) + 1, emoji }))
      setOpen(false)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn('mt-1.5 flex items-center gap-1.5', align === 'right' && 'justify-end')}>
      <AnimatePresence initial={false}>
        {(message.reactions ?? []).map((emoji) => (
          <motion.button
            layout
            key={emoji}
            initial={{ opacity: 0, scale: 0.45, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.55 }}
            transition={{ type: 'spring', stiffness: 480, damping: 27 }}
            onClick={() => void react(emoji)}
            className="flex h-6 min-w-7 items-center justify-center rounded-full border border-accent/25 bg-accent-soft/60 px-1.5 text-[12px] shadow-sm"
            title={`Remove your ${emoji} reaction`}
            aria-label={`Remove your ${emoji} reaction`}
          >
            {emoji}
          </motion.button>
        ))}
      </AnimatePresence>
      <div ref={root} className="relative">
        <button
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label="Add a reaction"
          title="Add a reaction"
          className="flex h-6 w-6 items-center justify-center rounded-full text-faint opacity-70 transition-all hover:bg-surface-2 hover:text-ink hover:opacity-100 focus-visible:opacity-100"
        >
          <SmilePlus size={12} />
        </button>
        <AnimatePresence>
          {burst ? (
            <motion.span
              key={burst.id}
              className="pointer-events-none absolute -top-1 left-1 text-[15px]"
              initial={{ opacity: 0, y: 4, scale: 0.6 }}
              animate={{ opacity: [0, 1, 0], y: -27, scale: [0.6, 1.2, 0.9] }}
              transition={{ duration: 0.55, ease: 'easeOut' }}
              aria-hidden="true"
            >
              {burst.emoji}
            </motion.span>
          ) : null}
        </AnimatePresence>
        <AnimatePresence>
          {open ? (
            <motion.div
              initial={{ opacity: 0, y: 5, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 3, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 480, damping: 30 }}
              className={cn(
                'dropdown-panel absolute bottom-full z-50 mb-2 flex items-center gap-0.5 rounded-full p-1',
                align === 'right' ? 'right-0' : 'left-0'
              )}
              role="menu"
              aria-label="Choose a reaction"
            >
              {MESSAGE_REACTIONS.map((emoji) => (
                <motion.button
                  key={emoji}
                  whileHover={{ scale: 1.28, y: -2 }}
                  whileTap={{ scale: 0.82 }}
                  onClick={() => void react(emoji)}
                  disabled={busy}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-[15px] hover:bg-surface-3"
                  role="menuitem"
                  aria-label={`React with ${emoji}`}
                >
                  {emoji}
                </motion.button>
              ))}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
}
