import { useEffect, useRef } from 'react'
import {
  ACCENTS,
  accentChain,
  createShader,
  playSweep,
  type ShaderController,
  type SweepHandle
} from 'glimm'
import { useReducedMotion } from 'framer-motion'
import { themeById, themeCollection, useTheme } from '../lib/themes'

const RAINBOW = accentChain([
  ACCENTS.blue,
  ACCENTS.purple,
  ACCENTS.pink,
  ACCENTS.orange,
  ACCENTS.yellow,
  ACCENTS.mint,
  ACCENTS.blue
])

/** A decorative, non-blocking iridescent sweep clipped to the composer edge. */
export function GlimmBorder({ pulse }: { pulse: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const controllerRef = useRef<ShaderController | null>(null)
  const sweepRef = useRef<SweepHandle | null>(null)
  const reduced = useReducedMotion()
  const themeId = useTheme((store) => store.themeId)
  const theme = themeById(themeId)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      controllerRef.current = createShader({
        canvas,
        palette: RAINBOW,
        bandTight: 2.1,
        direction: 'ltr',
        waveAmount: 0.28,
        rippleAmount: 0.32,
        brightness: 0.82,
        swellAmount: 0.36
      })
      controllerRef.current?.setAlpha(0)
    } catch {
      controllerRef.current = null
    }
    return () => {
      sweepRef.current?.cancel()
      controllerRef.current?.destroy()
      controllerRef.current = null
    }
  }, [])

  useEffect(() => {
    const controller = controllerRef.current
    if (!pulse || !controller) return
    sweepRef.current?.cancel()
    if (reduced) {
      controller.setAlpha(0)
      return
    }
    controller.setProgress(0)
    controller.setAlpha(0)
    const sweep = playSweep(controller, {
      sweepMs: 760,
      outroMs: 240,
      palette: RAINBOW,
      bandTight: 2.1,
      direction: 'ltr',
      easing: 'easeOutQuart',
      peakAlpha: themeCollection(themeId) === 'teams' ? 0.72 : 0.52,
      brightness: theme.kind === 'dark' ? 0.68 : 0.9,
      waveAmount: 0.28,
      rippleAmount: 0.32,
      swellAmount: 0.36,
      onComplete: () => controller.setAlpha(0)
    })
    sweepRef.current = sweep
    return () => sweep.cancel()
  }, [pulse, reduced, theme.kind, themeId])

  return <canvas ref={canvasRef} className="glimm-border" aria-hidden="true" />
}
