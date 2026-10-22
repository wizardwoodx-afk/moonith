import { useState } from 'react'
import { Check, ChevronDown, Circle, Loader2 } from 'lucide-react'
import type { PlanItem } from '@shared/types'
import { cn } from '../lib/utils'

export function PlanCard({ plan, live }: { plan: PlanItem[]; live: boolean }) {
  const [collapsed, setCollapsed] = useState(false)
  if (!plan.length) return null
  const done = plan.filter((item) => item.status === 'done').length
  const percent = Math.round((done / plan.length) * 100)

  return (
    <div className="mb-7 overflow-hidden rounded-2xl border border-line bg-surface/65">
      <button
        onClick={() => setCollapsed((value) => !value)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent-soft text-accent-ink">
          <Check size={13} strokeWidth={2.4} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] font-semibold tracking-[-0.01em]">Plan</span>
            <span className="text-[11px] text-faint">
              {done} of {plan.length} done
            </span>
          </div>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent/80 transition-all duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
        <ChevronDown
          size={14}
          className={cn('text-faint transition-transform', collapsed && '-rotate-90')}
        />
      </button>
      {!collapsed ? (
        <div className="space-y-0.5 px-3.5 pb-3">
          {plan.map((item) => (
            <div
              key={item.id}
              className={cn(
                'flex items-start gap-2.5 rounded-lg px-1.5 py-1.5 text-[12.5px]',
                item.status === 'active' && 'bg-accent-soft/40'
              )}
            >
              <span className="mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center">
                {item.status === 'done' ? (
                  <Check size={12} className="text-positive" />
                ) : item.status === 'active' ? (
                  live ? (
                    <Loader2 size={12} className="animate-spin text-accent" />
                  ) : (
                    <Circle size={8} className="fill-accent text-accent" />
                  )
                ) : (
                  <Circle size={9} className="text-faint/70" />
                )}
              </span>
              <span
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
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
