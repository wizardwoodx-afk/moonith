import { motion } from 'framer-motion'
import { cn } from '../lib/utils'

export function AnimatedCheck({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className={cn('shrink-0', className)}
      initial="hidden"
      animate="visible"
      aria-hidden="true"
    >
      <motion.path
        d="m3 8.2 3.1 3.1L13 4.8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        variants={{ hidden: { pathLength: 0, opacity: 0 }, visible: { pathLength: 1, opacity: 1 } }}
        transition={{ duration: 0.34, ease: [0.22, 0.61, 0.36, 1] }}
      />
    </motion.svg>
  )
}
