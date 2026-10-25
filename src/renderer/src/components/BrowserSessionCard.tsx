import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  Activity,
  Eye,
  Globe2,
  MonitorUp,
  ShieldCheck,
  Sparkles,
  TriangleAlert
} from 'lucide-react'
import { toast } from 'sonner'
import type { Task } from '@shared/types'
import { useApp } from '../store'
import { cn, errorMessage, fileUrl } from '../lib/utils'
import { Button } from './ui'

export function BrowserSessionCard({ task }: { task: Task }) {
  const browser = task.browser
  const setPreview = useApp((state) => state.setPreview)
  const reduceMotion = useReducedMotion()
  const [opening, setOpening] = useState(false)
  if (!browser) return null

  const stagehand = browser.engine === 'stagehand'
  const showBrowser = async (): Promise<void> => {
    setOpening(true)
    try {
      await window.knight.showBrowser(task.id, browser.scope)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setOpening(false)
    }
  }

  return (
    <motion.section
      layout={!reduceMotion}
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.2, 0.7, 0.3, 1] }}
      aria-label="Task browser session"
      className="relative overflow-hidden rounded-xl border border-line bg-surface shadow-[0_12px_35px_-28px_rgba(0,0,0,0.65)]"
    >
      <div className="flex items-center gap-2 border-b border-line/70 px-3 py-2.5">
        <span className={cn('flex h-6 w-6 items-center justify-center rounded-md', stagehand ? 'bg-accent-soft text-accent-ink' : 'bg-surface-2 text-muted')}>
          {stagehand ? <Sparkles size={12} /> : <Globe2 size={12} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11.5px] font-semibold text-ink">
            {stagehand ? 'Stagehand AI browser' : 'Built-in Chromium'}
          </p>
          <p className="mt-0.5 truncate text-[9px] text-faint">{browser.ownerLabel ?? 'Task'} · isolated session</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-1 text-[8.5px] font-medium text-muted">
          <span className={cn('h-1.5 w-1.5 rounded-full', browser.open ? 'bg-positive' : 'bg-line-strong')} />
          {browser.mode === 'visible' ? 'Visible' : 'Headless'}
        </span>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {browser.screenshotRelPath ? (
          <motion.button
            key={browser.screenshotRelPath}
            initial={reduceMotion ? false : { opacity: 0.35 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.18 }}
            onClick={() =>
              setPreview({
                id: 'browser-shot',
                name: 'Browser screenshot',
                relPath: browser.screenshotRelPath!,
                kind: 'image',
                size: 0,
                createdAt: browser.updatedAt
              })
            }
            className="group relative block w-full overflow-hidden bg-canvas"
            aria-label="Preview latest browser screenshot"
          >
            <img
              src={fileUrl(task.id, browser.screenshotRelPath)}
              alt="Latest task browser screenshot"
              className="max-h-48 w-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.01]"
            />
            <span className="absolute right-2 bottom-2 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-1 text-[9px] text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
              <Eye size={10} /> Preview
            </span>
          </motion.button>
        ) : (
          <motion.div key="empty" className="flex h-24 items-center justify-center bg-canvas text-faint">
            <Globe2 size={22} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="p-3">
        <p className="truncate text-[12px] font-medium text-ink" title={browser.title}>{browser.title || 'Browser ready'}</p>
        <p className="mt-0.5 truncate font-mono text-[9.5px] text-faint" title={browser.url}>{browser.url || 'No page open'}</p>
        <div className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-muted" aria-live="polite">
          <Activity size={11} className="mt-0.5 shrink-0 text-accent" />
          <span className="line-clamp-2">{browser.lastAction || 'Ready'}</span>
        </div>

        <div className="mt-2.5 flex items-center gap-3 text-[9px] text-faint">
          <span>{browser.actionCount ?? 0} actions</span>
          <span className="flex items-center gap-1">
            <ShieldCheck size={10} className="text-positive" />
            {browser.blockedRequests ?? 0} blocked
          </span>
          <span className="ml-auto">{stagehand && browser.aiAvailable ? 'AI ready' : 'Deterministic'}</span>
        </div>

        <AnimatePresence initial={false}>
          {browser.notice ? (
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={reduceMotion ? { opacity: 1, height: 'auto' } : { opacity: 0, height: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.18 }}
              className="overflow-hidden"
            >
              <div className="mt-2.5 flex items-start gap-2 rounded-lg bg-warn/10 p-2 text-[9.5px] leading-relaxed text-warn">
                <TriangleAlert size={11} className="mt-0.5 shrink-0" />
                <span>{browser.notice}</span>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <Button
          size="sm"
          variant="secondary"
          className="mt-3 w-full"
          disabled={opening}
          onClick={() => void showBrowser()}
        >
          <MonitorUp size={13} />
          {opening ? 'Opening…' : browser.mode === 'visible' ? 'Focus browser window' : 'Open browser window'}
        </Button>
      </div>
    </motion.section>
  )
}
