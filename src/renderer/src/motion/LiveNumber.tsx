import { useEffect } from 'react'
import { motion, useReducedMotion, useSpring, useTransform, type SpringOptions } from 'framer-motion'
import { cn } from '../lib/utils'

/**
 * Small real-state number transition. Technique adapted from Motion Primitives'
 * animated-number (MIT; see LICENSE.motion-primitives.txt), using the existing
 * framer-motion runtime rather than adding motion/react.
 */
export function LiveNumber({
  value,
  className,
  springOptions = { stiffness: 220, damping: 28, mass: 0.6 }
}: {
  value: number
  className?: string
  springOptions?: SpringOptions
}) {
  const reduced = useReducedMotion()
  const spring = useSpring(value, springOptions)
  const display = useTransform(spring, (current) => Math.round(current).toLocaleString())
  useEffect(() => spring.set(value), [spring, value])
  return (
    <motion.span className={cn('tabular-nums', className)} aria-label={value.toLocaleString()}>
      {reduced ? value.toLocaleString() : display}
    </motion.span>
  )
}
