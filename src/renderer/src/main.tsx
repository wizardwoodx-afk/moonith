import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import { App } from './App'
import { initTheme } from './lib/themes'
import { initMotion, useMotion } from './lib/motion'
import './styles.css'

initTheme()
initMotion()

/**
 * One motion mode drives both the stylesheet and Framer Motion. The OS
 * preference is only consulted when the person asked to follow it, so a
 * machine that reports "reduce" does not silently freeze the interface.
 */
function MotionShell({ children }: { children: ReactNode }) {
  const resolved = useMotion((state) => state.resolved)
  return (
    <MotionConfig reducedMotion={resolved === 'reduced' ? 'always' : 'never'}>
      {children}
    </MotionConfig>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionShell>
      <App />
    </MotionShell>
  </StrictMode>
)
