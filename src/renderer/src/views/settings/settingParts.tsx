/**
 * Setting parts in the shape Qoder uses: one card per group, one row per
 * setting, the control always in the same column on the right. Rows carry a
 * short title, one line of explanation, and nothing else — the eye should be
 * able to scan a pane and know what each switch does without reading a
 * paragraph.
 */
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export function SettingTile({
  children,
  tone = 'default'
}: {
  children: ReactNode
  tone?: 'default' | 'accent'
}) {
  return (
    <span
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] border',
        tone === 'accent'
          ? 'border-accent/25 bg-accent-soft/60 text-accent-ink'
          : 'border-line bg-surface-2/70 text-muted'
      )}
    >
      {children}
    </span>
  )
}

export function SettingRow({
  icon,
  title,
  description,
  tone = 'default',
  children
}: {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  tone?: 'default' | 'accent'
  children?: ReactNode
}) {
  return (
    <div className="flex items-start gap-[14px] px-4 py-3.5">
      {icon ? <SettingTile tone={tone}>{icon}</SettingTile> : null}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-snug font-medium text-ink">{title}</p>
        {description ? (
          <p
            className="mt-1 line-clamp-2 text-[12px] leading-[1.6] text-muted"
            title={typeof description === 'string' ? description : undefined}
          >
            {description}
          </p>
        ) : null}
      </div>
      {children ? (
        <div className="flex shrink-0 items-center justify-end gap-2 pt-px">{children}</div>
      ) : null}
    </div>
  )
}

/**
 * The rows of one group. The card comes from whatever frames the list, so a
 * list is never framed twice.
 */
export function SettingList({
  children,
  className
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={cn('divide-y divide-dashed divide-line', className)}>{children}</div>
}

/** A row list that carries its own card, for groups outside a settings section. */
export function SettingCard({
  children,
  className
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('card overflow-hidden divide-y divide-dashed divide-line', className)}>
      {children}
    </div>
  )
}

/** A chip that reports a state with a coloured dot, the way Qoder labels agents. */
export function StatusChip({
  children,
  tone = 'neutral'
}: {
  children: ReactNode
  tone?: 'neutral' | 'positive' | 'warn' | 'danger' | 'accent'
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
        tone === 'neutral' && 'border-line bg-surface-2/60 text-muted',
        tone === 'positive' && 'border-positive/25 bg-positive/10 text-positive',
        tone === 'warn' && 'border-warn/25 bg-warn/10 text-warn',
        tone === 'danger' && 'border-danger/25 bg-danger/10 text-danger',
        tone === 'accent' && 'border-accent/25 bg-accent-soft/70 text-accent-ink'
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          tone === 'positive' && 'bg-positive',
          tone === 'warn' && 'bg-warn',
          tone === 'danger' && 'bg-danger',
          tone === 'accent' && 'bg-accent',
          tone === 'neutral' && 'bg-faint'
        )}
      />
      {children}
    </span>
  )
}

/** A strip of filter tabs with counts, the way Qoder lists installed extensions. */
export function CountTabs<T extends string>({
  value,
  onChange,
  tabs
}: {
  value: T
  onChange: (value: T) => void
  tabs: { value: T; label: string; count?: number }[]
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-[10px] border border-line bg-surface-2/60 p-0.5">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          aria-pressed={value === tab.value}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] transition-colors',
            value === tab.value
              ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.18)]'
              : 'text-muted hover:text-ink'
          )}
        >
          {tab.label}
          {tab.count === undefined ? null : (
            <span
              className={cn(
                'font-data text-[11px]',
                value === tab.value ? 'text-muted' : 'text-faint'
              )}
            >
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/** The empty state Qoder shows: a glyph, one line, and the way out. */
export function EmptyPanel({
  icon,
  title,
  children,
  action,
  className
}: {
  icon: ReactNode
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 pt-20 pb-16 text-center', className)}>
      <div className="flex h-[60px] w-[60px] items-center justify-center rounded-[16px] bg-surface-2/70 text-ink shadow-[0_8px_28px_rgba(0,0,0,0.45)]">
        {icon}
      </div>
      <p className="mt-4 max-w-[520px] text-[15px] leading-[1.45] font-semibold text-ink">{title}</p>
      {children ? (
        <p className="mx-auto mt-2 max-w-[440px] text-[11.5px] leading-[1.6] text-muted/85">
          {children}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

/** The one word in an empty state that tells you what to press. */
export function ActionWord({ children }: { children: ReactNode }) {
  return <span className="text-positive">{children}</span>
}

export function Chip({
  children,
  tone = 'neutral'
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'positive' | 'warn'
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium',
        tone === 'accent' && 'border-accent/30 bg-accent-soft text-accent-ink',
        tone === 'positive' && 'border-positive/25 bg-positive/10 text-positive',
        tone === 'warn' && 'border-warn/30 bg-warn/10 text-warn',
        tone === 'neutral' && 'border-line bg-surface/70 text-muted'
      )}
    >
      {children}
    </span>
  )
}
