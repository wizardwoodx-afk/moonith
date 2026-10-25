import { useEffect, useRef } from 'react'
import { motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion'

/** A decorative, pointer-aware presence. No camera, screen capture, or tracking. */
export function CaptainPresence() {
  const root = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const rawX = useMotionValue(0)
  const rawY = useMotionValue(0)
  const x = useSpring(rawX, { stiffness: 190, damping: 23, mass: 0.5 })
  const y = useSpring(rawY, { stiffness: 190, damping: 23, mass: 0.5 })

  useEffect(() => {
    if (reduced) return
    const move = (event: PointerEvent): void => {
      const rect = root.current?.getBoundingClientRect()
      if (!rect) return
      const dx = event.clientX - (rect.left + rect.width / 2)
      const dy = event.clientY - (rect.top + rect.height / 2)
      const distance = Math.max(1, Math.hypot(dx, dy))
      const strength = Math.min(1, distance / 180)
      rawX.set((dx / distance) * 5 * strength)
      rawY.set((dy / distance) * 4 * strength)
    }
    const reset = (): void => {
      rawX.set(0)
      rawY.set(0)
    }
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('blur', reset)
    }
  }, [rawX, rawY, reduced])

  return (
    <motion.div
      ref={root}
      className="captain-presence relative flex h-[132px] w-[170px] items-center justify-center"
      animate={reduced ? undefined : { y: [0, -3, 0] }}
      transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
      aria-hidden="true"
    >
      <span className="presence-halo absolute h-[104px] w-[104px] rounded-full" />
      <span className="presence-orbit absolute h-[96px] w-[96px] rounded-full border border-line/70">
        <span className="presence-satellite absolute top-1/2 -left-[2px] h-1 w-1 rounded-full bg-accent" />
      </span>
      <div className="relative flex items-center gap-2">
        {[0, 1].map((eye) => (
          <span
            key={eye}
            className="presence-eye flex h-[35px] w-[42px] items-center justify-center rounded-[50%] border border-line-strong/70 bg-surface/75 shadow-sm"
          >
            <motion.span style={{ x, y }} className="h-[7px] w-[7px] rounded-full bg-accent-ink shadow-[0_0_12px_var(--c-accent-soft)]" />
          </span>
        ))}
      </div>
    </motion.div>
  )
}
