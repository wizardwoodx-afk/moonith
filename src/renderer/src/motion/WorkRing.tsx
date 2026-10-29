import { cn } from '../lib/utils'

/**
 * A small ring that turns once and a half while it works, with three inset
 * shadows stacked into it. Adapted from a Uiverse loader (pradip_1434) to the
 * house palette: one highlight, one accent, one soft accent.
 */
export function WorkRing({ size = 13, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      data-motion="essential"
      className={cn('work-ring', className)}
      style={{ width: `${size}px`, height: `${size}px` }}
    />
  )
}

/**
 * Letters that lift and settle one after another, so a word reads as being
 * spoken. Same Uiverse loader as the ring, letter half.
 */
export function BounceLetters({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn('inline-flex', className)}>
      {text.split('').map((character, index) => (
        <span
          key={`${character}-${index}`}
          aria-hidden
          data-motion="essential"
          className="bounce-letter"
          style={{ animationDelay: `${(index * 0.06).toFixed(2)}s` }}
        >
          {character === ' ' ? '\u00A0' : character}
        </span>
      ))}
    </span>
  )
}
