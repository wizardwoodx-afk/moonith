import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { MetalBadge, MetalFx } from 'metal-fx'
import { useReducedMotionConfig } from 'framer-motion'
import { themeById, themeCollection, useTheme } from '../lib/themes'
import { cn } from '../lib/utils'

export function MetalCircleButton({
  children,
  className,
  disabled,
  metal = true,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { metal?: boolean }) {
  const reduced = useReducedMotionConfig()
  const themeId = useTheme((store) => store.themeId)
  const theme = themeById(themeId)
  const button = (
    <button {...props} disabled={disabled} className={className}>
      {children}
    </button>
  )
  if (!metal || disabled || reduced) return button
  return (
    <MetalFx
      variant="circle"
      preset={themeCollection(themeId) === 'teams' ? 'chromatic' : 'silver'}
      theme={theme.kind}
      strength={theme.kind === 'dark' ? 0.58 : 0.42}
      glowGain={0.45}
      normalizeHostStyles={false}
      className="inline-flex shrink-0 rounded-full"
    >
      {button}
    </MetalFx>
  )
}

export function NewCollectionBadge({ children }: { children: ReactNode }) {
  const reduced = useReducedMotionConfig()
  const themeId = useTheme((store) => store.themeId)
  const theme = themeById(themeId)
  if (reduced || typeof children !== 'string') {
    return (
      <span className="inline-flex items-center rounded-full border border-accent/35 bg-accent-soft/70 px-2 py-0.5 text-[10px] font-semibold text-accent-ink tracking-[0.04em] uppercase">
        {children}
      </span>
    )
  }
  return (
    <MetalBadge
      strength={0.38}
      metalOpacity={0.42}
      theme={theme.kind}
      scale={0.85}
      glow={0.18}
      textColor={theme.kind === 'dark' ? '#111114' : '#1D1D1F'}
    >
      {children}
    </MetalBadge>
  )
}
