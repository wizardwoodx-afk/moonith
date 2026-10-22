import { useState } from 'react'
import { Check, ChevronDown, Clock, Loader2, X } from 'lucide-react'
import type { StepRecord } from '@shared/types'
import { cn } from '../lib/utils'

function StepIcon({ status }: { status: StepRecord['status'] }) {
  if (status === 'running') return <Loader2 size={12} className="animate-spin text-accent" />
  if (status === 'waiting') return <Clock size={12} className="text-warn" />
  if (status === 'ok') return <Check size={12} className="text-positive" />
  return <X size={12} className="text-danger" />
}

export function StepList({ steps, live }: { steps: StepRecord[]; live: boolean }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  if (!steps.length) return null

  return (
    <div className="mt-3.5 space-y-1">
      <div className="flex items-center gap-2 px-0.5 pb-0.5">
        <span className="text-[10px] font-semibold tracking-[0.13em] text-faint uppercase">
          Activity
        </span>
        <span className="h-px flex-1 bg-line" />
        <span className="text-[10px] text-faint">{steps.length}</span>
      </div>
      {steps.map((step) => {
        const hasDetails = Boolean(step.output || step.error)
        const isOpen = expanded[step.id] ?? step.status === 'error'
        return (
          <div
            key={step.id}
            className={cn(
              'overflow-hidden rounded-[10px] border bg-canvas/45 transition-colors',
              step.status === 'running' && live
                ? 'border-accent/30'
                : step.status === 'error'
                  ? 'border-danger/20'
                  : 'border-line/80'
            )}
          >
            <button
              onClick={() =>
                hasDetails && setExpanded((current) => ({ ...current, [step.id]: !isOpen }))
              }
              className={cn(
                'flex w-full items-start gap-2.5 px-2.5 py-[7px] text-left',
                hasDetails && 'hover:bg-surface-2/40'
              )}
            >
              <span className="mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center">
                <StepIcon status={step.status} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="shrink-0 text-[12px] font-medium text-ink/90">{step.title}</span>
                  {step.detail ? (
                    <span className="truncate text-[11.5px] text-faint">{step.detail}</span>
                  ) : null}
                </span>
                {step.status === 'error' && step.error && !isOpen ? (
                  <span className="mt-0.5 block truncate text-[11px] text-danger/90">
                    {step.error}
                  </span>
                ) : null}
              </span>
              {hasDetails ? (
                <ChevronDown
                  size={12}
                  className={cn(
                    'mt-[3px] shrink-0 text-faint transition-transform',
                    isOpen && 'rotate-180'
                  )}
                />
              ) : null}
            </button>
            {isOpen && hasDetails ? (
              <div className="border-t border-line/70 bg-surface/40 px-2.5 py-2">
                <pre className="scroll-thin max-h-56 overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted">
                  {step.error && !step.output ? step.error : step.output}
                </pre>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
