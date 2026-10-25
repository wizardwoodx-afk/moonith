import { useEffect, useRef, useState } from 'react'
import { ThinkingOrb, type OrbState } from 'thinking-orbs'
import { useReducedMotion } from 'framer-motion'
import { themeById, useTheme } from '../lib/themes'
import { cn } from '../lib/utils'

export function TaskOrb({
  state = 'working',
  size = 20,
  label,
  className,
  paused = false
}: {
  state?: OrbState
  size?: 20 | 32 | 64
  label?: string
  className?: string
  paused?: boolean
}) {
  const themeId = useTheme((store) => store.themeId)
  const theme = themeById(themeId)
  const reduced = useReducedMotion()
  const ref = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(true)
  const [documentVisible, setDocumentVisible] = useState(() => !document.hidden)

  useEffect(() => {
    const element = ref.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: '80px'
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const update = (): void => setDocumentVisible(!document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  return (
    <span
      ref={ref}
      className={cn('inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <ThinkingOrb
        state={state}
        size={size}
        theme={theme.kind}
        color={theme.tokens['--c-accent-ink']}
        paused={paused || Boolean(reduced) || !visible || !documentVisible}
        aria-label={label ?? `${state} activity`}
      />
    </span>
  )
}
