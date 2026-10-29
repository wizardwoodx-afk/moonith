import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, Circle } from 'lucide-react'
import type { PlanItem } from '@shared/types'
import { cn } from '../lib/utils'
import { AnimatedCheck } from '../motion/AnimatedCheck'
import { TaskOrb } from '../motion/TaskOrb'

export function PlanCard({ plan, live }: { plan: PlanItem[]; live: boolean }) {
  const [collapsed, setCollapsed] = useState(false)
  if (!plan.length) return null
  const done = plan.filter((item) => item.status === 'done').length
  const percent = Math.round((done / plan.length) * 100)

  return (
    <motion.section layout className="mb-7 overflow-hidden rounded-2xl border border-line bg-surface/65">
      <button
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Expand plan' : 'Collapse plan'}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <motion.div
          layout
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-lg',
            done === plan.length ? 'bg-positive/10 text-positive' : 'bg-accent-soft text-accent-ink'
          )}
        >
          {done === plan.length ? <AnimatedCheck size={13} /> : <Check size={13} strokeWidth={2.2} />}
        </motion.div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] font-semibold tracking-[-0.01em]">Plan</span>
            <span className="whitespace-nowrap text-[11px] text-faint">{done} of {plan.length} done</span>
          </div>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-2">
            <motion.div
              className="h-full rounded-full bg-accent/80"
              initial={false}
              animate={{ width: `${percent}%` }}
              transition={{ type: 'spring', stiffness: 170, damping: 24 }}
            />
          </div>
        </div>
        <motion.span animate={{ rotate: collapsed ? -90 : 0 }}>
          <ChevronDown size={14} className="text-faint" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {!collapsed ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ height: { duration: 0.24 }, opacity: { duration: 0.16 } }}
            className="overflow-hidden"
          >
            <motion.div layout className="space-y-0.5 px-3.5 pb-3">
              {plan.map((item, index) => (
                <motion.div
                  layout
                  key={item.id}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index, 8) * 0.025 }}
                  className={cn(
                    'flex items-start gap-2.5 rounded-lg px-1.5 py-1.5 text-[12.5px]',
                    item.status === 'active' && 'bg-accent-soft/40'
                  )}
                >
                  <span className="mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center">
                    {item.status === 'done' ? (
                      <AnimatedCheck size={12} className="text-positive" />
                    ) : item.status === 'active' ? (
                      live ? <TaskOrb state="solving" label="Current plan step" /> : <Circle size={8} className="fill-accent text-accent" />
                    ) : (
                      <Circle size={9} className="text-faint/70" />
                    )}
                  </span>
                  <motion.span
                    animate={{ opacity: item.status === 'done' ? 0.62 : 1 }}
                    className={cn(
                      'leading-snug',
                      item.status === 'done'
                        ? 'text-muted line-through decoration-line-strong'
                        : item.status === 'active'
                          ? 'font-medium text-ink'
                          : 'text-muted'
                    )}
                  >
                    {item.text}
                  </motion.span>
                </motion.div>
              ))}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.section>
  )
}
