import { useMemo, useState } from 'react'
import type { AttachmentRef, PermissionMode, TaskMode, TaskSummary } from '@shared/types'
import { cn, plural } from '../../lib/utils'
import { buildActivity, type ActivityMetric } from '../../lib/activity'
import type { ComposerModelState } from '../../lib/composerChoices'
import { CaptainComposer } from './CaptainComposer'
import { NameYourAgent } from './NameYourAgent'
import { useAgentName } from '../../lib/localProfile'
import { TaskDeck } from '../../motion/TaskDeck'

const LEVELS = [
  'bg-surface-3',
  'bg-accent/15',
  'bg-accent/30',
  'bg-accent/50',
  'bg-accent/70',
  'bg-accent'
]

function ActivityCard({ tasks }: { tasks: TaskSummary[] }) {
  const [tab, setTab] = useState<ActivityMetric>('sessions')
  const grid = useMemo(() => buildActivity(tasks, tab), [tasks, tab])

  return (
    <div className="w-fit max-w-full rounded-xl border border-line bg-surface">
      <div className="flex items-center gap-4 px-4 pt-4 pb-3">
        {(['sessions', 'receipts'] as const).map((value) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={cn(
              'text-[13px] leading-5 transition-colors',
              tab === value ? 'text-ink' : 'text-muted hover:text-ink'
            )}
          >
            {value === 'sessions' ? 'Sessions' : 'Receipts'}
          </button>
        ))}
        <span className="ml-auto whitespace-nowrap font-mono text-[10px] text-faint">
          {plural(grid.stats.total, tab === 'sessions' ? 'session' : 'receipt')} this year
        </span>
      </div>
      <div className="scroll-thin overflow-x-auto px-5 pb-3">
        <div className="w-fit">
          <div
            className="grid gap-x-[3.2px] gap-y-[4.6px]"
            style={{
              gridAutoFlow: 'column',
              gridTemplateRows: 'repeat(7, 9px)'
            }}
            role="img"
            aria-label={`${plural(grid.stats.total, tab === 'sessions' ? 'session' : 'receipt')} across the last year`}
          >
            {grid.columns.map((column, columnIndex) =>
              column.map((day, rowIndex) => (
                <span
                  key={`${columnIndex}-${rowIndex}`}
                  title={`${day.date} · ${plural(day.count, tab === 'sessions' ? 'session' : 'receipt')}`}
                  className={cn('h-[9px] w-[10.4px] rounded-[2px]', LEVELS[day.level])}
                />
              ))
            )}
          </div>
          <div className="relative mt-3 h-4 text-[11px] leading-4 text-faint">
            {grid.months.map((month) => (
              <span
                key={`${month.label}-${month.index}`}
                className="absolute top-0"
                style={{ left: month.index * 13.6 }}
              >
                {month.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function CaptainWelcome({
  tasks,
  model,
  permissionMode,
  mode,
  draft,
  attachments,
  workspace,
  onDraftChange,
  onAttachmentsChange,
  onPermissionChange,
  onModeChange,
  onModelChange,
  onChooseWorkspace,
  onClearWorkspace,
  onSend,
  busy = false
}: {
  tasks: TaskSummary[]
  model: ComposerModelState
  permissionMode: PermissionMode
  mode: TaskMode
  draft: string
  attachments: AttachmentRef[]
  workspace: string | null
  onDraftChange: (value: string) => void
  onAttachmentsChange: (value: AttachmentRef[]) => void
  onPermissionChange: (value: PermissionMode) => void
  onModeChange: (value: TaskMode) => void
  onModelChange: (value: ComposerModelState) => void
  onChooseWorkspace: () => void | Promise<void>
  onClearWorkspace: () => void
  onSend: () => void
  busy?: boolean
}) {
  const name = useAgentName()

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[924px] flex-col px-6 pt-5 pb-2">
        <div className="rise flex flex-col items-center">
          <NameYourAgent />

          {tasks.length ? (
            <div className="mt-7 flex w-full justify-center">
              <div className="w-full max-w-[520px]">
                <TaskDeck tasks={tasks.slice(0, 4)} />
              </div>
            </div>
          ) : null}
        </div>

        <div className="mx-auto mt-auto w-full max-w-[768px] pt-10">
          <CaptainComposer
            draft={draft}
            onDraftChange={onDraftChange}
            attachments={attachments}
            onAttachmentsChange={onAttachmentsChange}
            permissionMode={permissionMode}
            onPermissionChange={onPermissionChange}
            mode={mode}
            onModeChange={onModeChange}
            model={model}
            onModelChange={onModelChange}
            workspace={workspace}
            onChooseWorkspace={onChooseWorkspace}
            onClearWorkspace={onClearWorkspace}
            onSubmit={onSend}
            placeholder={`Ask ${name}…`}
            busy={busy}
            autoFocus
          />
        </div>
      </div>
    </div>
  )
}
