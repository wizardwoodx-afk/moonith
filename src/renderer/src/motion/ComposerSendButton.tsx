import { ArrowUp, Square } from 'lucide-react'
import { cn } from '../lib/utils'
import { Spin } from '../components/ui'
import { MetalCircleButton } from './MetalAction'

export function ComposerSendButton({
  canSend,
  submitting = false,
  running = false,
  pulse,
  onSubmit,
  onStop
}: {
  canSend: boolean
  submitting?: boolean
  running?: boolean
  pulse: number
  onSubmit: () => void
  onStop?: () => void
}) {
  if (running && onStop) {
    return (
      <button
        onClick={onStop}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-ink transition-all hover:border-line-strong active:scale-90"
        title="Stop task"
        aria-label="Stop task"
      >
        <Square size={9} className="fill-current" />
      </button>
    )
  }
  return (
    <MetalCircleButton
      onClick={() => {
        if (!canSend) return
        onSubmit()
      }}
      disabled={!canSend}
      metal={canSend && !submitting}
      className={cn(
        'send-button relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-150',
        canSend
          ? 'bg-ink-button text-on-ink shadow-[0_10px_24px_-14px_rgba(0,0,0,0.65)] hover:scale-[1.04] active:scale-90'
          : 'bg-surface-2 text-faint'
      )}
      title="Send message"
      aria-label="Send message"
    >
      {pulse > 0 ? <span key={pulse} className="send-haptic" aria-hidden /> : null}
      {submitting ? <Spin size={14} /> : <ArrowUp size={15} strokeWidth={2.35} />}
    </MetalCircleButton>
  )
}
