/**
 * Shared primitives for the trust panes.
 *
 * The audit pane grew from one section into four — the audit log itself, the
 * governance gate, the receipt chain and the durable missions. They all show
 * the same kind of thing: a few counts, a list of recent things that happened,
 * and a control that either reads state back or asks for a human decision.
 * Keeping those three shapes in one place is what stops them drifting apart.
 */
import type { ReactNode } from 'react'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { cn } from '../../lib/utils'
import { EmptyPanel } from './settingParts'

/* ── outcomes ─────────────────────────────────────────────────────────────── */

export type Outcome =
  | { tone: 'positive'; message: string }
  | { tone: 'danger'; message: string }
  | { tone: 'neutral'; message: string }

export function OutcomeBanner({ outcome }: { outcome: Outcome }) {
  const positive = outcome.tone === 'positive'
  const danger = outcome.tone === 'danger'
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-xl border px-3.5 py-3',
        positive && 'border-positive/25 bg-positive/10',
        danger && 'border-danger/25 bg-danger/10',
        !positive && !danger && 'border-line bg-surface-2/50'
      )}
    >
      {positive ? (
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-positive" />
      ) : danger ? (
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
      ) : null}
      <p
        className={cn(
          'text-[11.5px] leading-relaxed',
          positive ? 'text-positive' : danger ? 'text-danger' : 'text-muted'
        )}
      >
        {outcome.message}
      </p>
    </div>
  )
}

/* ── counts ───────────────────────────────────────────────────────────────── */

export function Stat({
  label,
  value,
  hint,
  tone = 'default'
}: {
  label: string
  value: ReactNode
  hint?: string
  tone?: 'default' | 'positive' | 'warn' | 'danger' | 'accent'
}) {
  return (
    <div className="rounded-[var(--r-card)] border border-line bg-canvas/50 px-4 py-3">
      <p
        className={cn(
          'font-data text-[22px] leading-none font-semibold',
          tone === 'positive' && 'text-positive',
          tone === 'warn' && 'text-warn',
          tone === 'danger' && 'text-danger',
          tone === 'accent' && 'text-accent-ink',
          tone === 'default' && 'text-ink'
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-[10.5px] text-muted">{label}</p>
      {hint ? <p className="mt-0.5 text-[10px] text-faint">{hint}</p> : null}
    </div>
  )
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</div>
}

/* ── empty states ─────────────────────────────────────────────────────────── */

export function EmptyState({
  icon,
  title,
  children
}: {
  icon: ReactNode
  title: string
  children?: ReactNode
}) {
  return (
    <EmptyPanel icon={icon} title={title}>
      {children}
    </EmptyPanel>
  )
}

/* ── badges ───────────────────────────────────────────────────────────────── */

export function Badge({
  children,
  tone = 'default'
}: {
  children: ReactNode
  tone?: 'default' | 'positive' | 'warn' | 'danger' | 'accent'
}) {
  return (
    <span
      className={cn(
        'inline-flex whitespace-nowrap items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
        tone === 'default' && 'border-line bg-surface-2 text-muted',
        tone === 'positive' && 'border-positive/25 bg-positive/10 text-positive',
        tone === 'warn' && 'border-warn/25 bg-warn/10 text-warn',
        tone === 'danger' && 'border-danger/25 bg-danger/10 text-danger',
        tone === 'accent' && 'border-accent/25 bg-accent-soft text-accent-ink'
      )}
    >
      {children}
    </span>
  )
}

/** A small coloured dot: green allowed, amber steered, red refused. */
export function DecisionDot({ decision }: { decision: 'allow' | 'steer' | 'deny' }) {
  return (
    <span
      title={decision}
      className={cn(
        'mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full',
        decision === 'allow' && 'bg-positive',
        decision === 'steer' && 'bg-warn',
        decision === 'deny' && 'bg-danger'
      )}
    />
  )
}

/* ── rows ─────────────────────────────────────────────────────────────────── */

export function Row({
  leading,
  title,
  meta,
  trailing
}: {
  leading?: ReactNode
  title: ReactNode
  meta?: ReactNode
  trailing?: ReactNode
}) {
  /** Both lines ellipsize, so a string title or meta carries its own full text as
   *  a tooltip — ids, paths and digests must stay readable. */
  const titleHint = typeof title === 'string' ? title : undefined
  const metaHint = typeof meta === 'string' ? meta : undefined
  return (
    <div className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-surface-2/50">
      {leading}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium text-ink" title={titleHint}>{title}</p>
        {meta ? <p className="mt-0.5 truncate text-[10.5px] text-faint" title={metaHint}>{meta}</p> : null}
      </div>
      {trailing ? <div className="flex shrink-0 items-center gap-1.5">{trailing}</div> : null}
    </div>
  )
}

export function RowList({ children }: { children: ReactNode }) {
  return <div className="space-y-0.5">{children}</div>
}

/* ── prose ────────────────────────────────────────────────────────────────── */

export function PaneNote({ children }: { children: ReactNode }) {
  return <p className="text-[11.5px] leading-relaxed text-muted">{children}</p>
}

/* ── time ─────────────────────────────────────────────────────────────────── */

/** Audit data is only useful if you can tell when it happened, so this keeps
 *  the date AND the clock — a date alone hides whether something ran before
 *  or after the thing you are comparing it to. */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`
}
