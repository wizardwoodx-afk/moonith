import type { Task } from '@shared/types'
import { Icon } from '../../components/icons'
import { buildOversight, type OversightEntry, type OversightKind } from './oversight'
import { PERMISSION_CHOICES } from '../../lib/composerChoices'
import { cn, plural } from '../../lib/utils'

const KIND_STYLE: Record<OversightKind, { dot: string; label: string }> = {
  decision: { dot: 'bg-danger', label: 'Refused' },
  guard: { dot: 'bg-warn', label: 'Guarded' },
  failure: { dot: 'bg-faint', label: 'Failed' },
  change: { dot: 'bg-positive', label: 'Changed' }
}

function Entry({ entry }: { entry: OversightEntry }) {
  const style = KIND_STYLE[entry.kind]
  return (
    <li className="flex gap-2.5 py-2">
      <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', style.dot)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium text-ink" title={entry.title}>
          {entry.title}
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{entry.detail}</p>
      </div>
      <span className="shrink-0 font-mono text-[10px] text-faint">{style.label}</span>
    </li>
  )
}

/**
 * The task's own record of what it was allowed to do. It sits under the answer
 * rather than in a separate screen because the question it answers — "did it do
 * what I think it did" — is asked at the moment you read the answer.
 */
export function OversightPanel({ task }: { task: Task }) {
  const report = buildOversight(task)
  if (report.empty) return null

  const permission = PERMISSION_CHOICES.find((choice) => choice.value === report.permissionMode)

  return (
    <section className="mt-8 rounded-xl border border-line bg-surface/50 p-3.5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.13em] text-faint uppercase">
          <Icon name="shield" size="xs" />
          Oversight
        </p>
        {report.stop ? <p className="text-[11px] text-warn">{report.stop}</p> : null}
      </div>

      <p className="mb-2 font-mono text-[10px] text-faint">
        {report.counts.change} changed · {report.counts.decision} refused · {report.counts.guard} guarded ·{' '}
        {report.counts.failure} failed
      </p>

      {report.entries.length ? (
        <ul className="scroll-thin max-h-[240px] divide-y divide-line overflow-y-auto">
          {report.entries.slice(0, 40).map((entry) => (
            <Entry key={entry.id} entry={entry} />
          ))}
        </ul>
      ) : null}

      {report.entries.length > 40 ? (
        <p className="mt-1.5 text-[10.5px] text-faint">{plural(report.entries.length - 40, 'earlier entry')} not shown.</p>
      ) : null}

      <p className="mt-2.5 border-t border-line pt-2 text-[10.5px] text-faint">
        {permission?.label ?? 'Permissions'} · {report.model}
        {report.usage?.total ? ` · ${report.usage.total.toLocaleString()} tokens` : ''}
      </p>
    </section>
  )
}
