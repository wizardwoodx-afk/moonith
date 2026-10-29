import { cn } from '../lib/utils'

/**
 * A single glowing dot that breathes while work is in flight. Adapted from a
 * Uiverse loader (dexter-st): the dotted rim and layered glow are kept, the
 * size and colour follow the house palette.
 */
export function StatusLight({ className }: { className?: string }) {
  return <span aria-hidden data-motion="essential" className={cn('status-light', className)} />
}
