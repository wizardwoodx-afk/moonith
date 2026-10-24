import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { MetalBadge, MetalFx, MetalText } from 'metal-fx'
import { useReducedMotion } from 'framer-motion'
import { themeById, themeCollection, useTheme } from '../lib/themes'
import { cn } from '../lib/utils'

export function MetalCircleButton({
  children,
  className,
  disabled,
  metal = true,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { metal?: boolean }) {
  const reduced = useReducedMotion()
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

export function MetalSignature({
  children,
  className,
  size = 20
}: {
  children: string
  className?: string
  size?: number
}) {
  const reduced = useReducedMotion()
  const themeId = useTheme((store) => store.themeId)
  const theme = themeById(themeId)
  if (reduced) {
    return (
      <span className={className} style={{ fontFamily: '"Fraunces Variable", Georgia, serif', fontSize: size }}>
        {children}
      </span>
    )
  }
  return (
    <MetalText
      font={`400 ${size}px "Fraunces Variable", Georgia, serif`}
      color={theme.tokens['--c-ink']}
      strength={0.34}
      metalOpacity={0.5}
      glow={false}
      theme={theme.kind}
      className={className}
    >
      {children}
    </MetalText>
  )
}

export function NewCollectionBadge({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion()
  const themeId = useTheme((store) => store.themeId)
  const theme = themeById(themeId)
  if (reduced || typeof children !== 'string') {
    return <span className={cn('atelier-badge')}>{children}</span>
  }
  return (
    <MetalBadge
      strength={0.38}
      metalOpacity={0.42}
      theme={theme.kind}
      scale={0.72}
      glow={0.18}
      textColor={theme.kind === 'dark' ? '#111114' : '#1D1D1F'}
    >
      {children}
    </MetalBadge>
  )
}
