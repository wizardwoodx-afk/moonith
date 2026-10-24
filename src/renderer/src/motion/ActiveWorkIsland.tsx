import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUpRight, ChevronDown, Users } from 'lucide-react'
import { useApp } from '../store'
import { cn, timeAgo } from '../lib/utils'
import { TaskOrb } from './TaskOrb'

export function ActiveWorkIsland() {
  const tasks = useApp((state) => state.tasks)
  const subagents = useApp((state) => state.subagents)
  const openTask = useApp((state) => state.openTask)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const running = tasks.filter((task) => task.status === 'running')
  const waiting = tasks.filter((task) => task.status === 'waiting')
  const active = tasks.filter((task) => task.status === 'running' || task.status === 'waiting')
  const liveCrew = subagents.filter((run) => run.status === 'running').length

  useEffect(() => {
    if (!open) return
    const pointer = (event: PointerEvent): void => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false)
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', pointer)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', pointer)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  useEffect(() => {
    if (!active.length) setOpen(false)
  }, [active.length])

  if (!active.length) return null
  const latest = active[0]

  return (
    <div ref={root} className="relative ml-3 hidden min-[1100px]:block">
      <motion.button
        layout
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cn(
          'active-work-island flex h-7 max-w-[270px] items-center gap-2 rounded-full border px-2.5 text-left transition-colors',
          open ? 'border-accent/35 bg-surface-3' : 'border-line bg-surface/70 hover:bg-surface-2'
        )}
      >
        <TaskOrb state={liveCrew ? 'weaving' : running.length ? 'working' : 'breathing'} label="Active work" />
        <span className="shrink-0 text-[10px] font-medium text-ink">
          {running.length && waiting.length
            ? `${active.length} active`
            : running.length
              ? `${running.length} working`
              : `${waiting.length} waiting`}
        </span>
        <span className="min-w-0 truncate text-[10px] text-faint">{latest.title}</span>
        {liveCrew ? (
          <span className="flex shrink-0 items-center gap-1 text-[9px] text-accent-ink">
            <Users size={9} />{liveCrew}
          </span>
        ) : null}
        <motion.span animate={{ rotate: open ? 180 : 0 }}>
          <ChevronDown size={10} className="text-faint" />
        </motion.span>
      </motion.button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -7, scaleY: 0.82, borderRadius: 20 }}
            animate={{ opacity: 1, y: 0, scaleY: 1, borderRadius: 16 }}
            exit={{ opacity: 0, y: -5, scaleY: 0.88, borderRadius: 20 }}
            transition={{ type: 'spring', stiffness: 390, damping: 31 }}
            className="dropdown-panel absolute top-full left-0 z-50 mt-2 w-[330px] origin-top overflow-hidden p-1.5"
          >
            <div className="flex items-center gap-2 px-2.5 py-2">
              <TaskOrb state={liveCrew ? 'weaving' : running.length ? 'working' : 'breathing'} size={32} label="Active work" />
              <div>
                <p className="text-[11.5px] font-medium text-ink">{running.length ? 'Work in motion' : 'Waiting for you'}</p>
                <p className="text-[9.5px] text-faint">
                  {running.length} working · {waiting.length} waiting · {liveCrew} Crew running
                </p>
              </div>
            </div>
            <div className="space-y-0.5">
              {active.slice(0, 5).map((task, index) => (
                <motion.button
                  key={task.id}
                  initial={{ opacity: 0, x: -5 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.035 }}
                  onClick={() => {
                    setOpen(false)
                    void openTask(task.id)
                  }}
                  className="menu-item py-2"
                >
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', task.status === 'waiting' ? 'bg-warn' : 'bg-accent')} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] text-ink">{task.title}</span>
                    <span className="mt-0.5 block text-[9px] text-faint">
                      {task.status === 'waiting' ? 'Waiting for you' : 'Working'} · updated {timeAgo(task.updatedAt)}
                    </span>
                  </span>
                  <ArrowUpRight size={11} className="text-faint" />
                </motion.button>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
