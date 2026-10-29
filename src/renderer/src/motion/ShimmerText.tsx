import type { ReactNode } from 'react'
import { cn } from '../lib/utils'

export function ShimmerText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span data-motion="essential" className={cn('shimmer-text', className)}>
      {children}
    </span>
  )
}
