import { useEffect, useState } from 'react'
import { CalendarClock, FolderPlus, Loader2, Pencil, Trash2 } from 'lucide-react'
import { Icon } from '../components/icons'
import { toast } from 'sonner'
import type {
  CreateScheduleInput,
  PermissionMode,
  ScheduleRecord
} from '@shared/types'
import { useApp } from '../store'
import { cn, errorMessage, folderName, timeAgo } from '../lib/utils'
import { cronTimeMinutes, replaceCronTime } from '../lib/cron'
import { TimeScrubber } from '../motion/TimeScrubber'
import { PERMISSION_CHOICES } from '../lib/composerChoices'
import { Button, FieldGroup, IconButton, Modal, Segmented, Toggle } from '../components/ui'
import { confirmDialog } from '../components/Confirm'

const CUSTOM = 'custom'

const CRON_PRESETS = [
  { value: '0 9 * * *', label: 'Every day at 09:00' },
  { value: '0 9 * * 1-5', label: 'Weekdays at 09:00' },
  { value: '0 17 * * 1-5', label: 'Weekdays at 17:00' },
  { value: '0 9 * * 1', label: 'Every Monday at 09:00' },
  { value: '0 * * * *', label: 'Every hour' },
  { value: '*/30 * * * *', label: 'Every 30 minutes' },
  { value: '0 8 1 * *', label: 'First of the month at 08:00' }
]

const PERMISSION_LABEL = Object.fromEntries(
  PERMISSION_CHOICES.map((choice) => [choice.value, choice.label])
) as Record<PermissionMode, string>

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function formatClock(hour: number, minute: number): string {
  const displayHour = hour % 12 || 12
  const period = hour < 12 ? 'AM' : 'PM'
  return `${displayHour}:${String(minute).padStart(2, '0')} ${period}`
}

function describeDays(dayOfWeek: string): string | null {
  const days: number[] = []
  for (const part of dayOfWeek.split(',')) {
    const range = /^([0-6])-([0-6])$/.exec(part)
    if (range) {
      for (let day = Number(range[1]); day <= Number(range[2]); day += 1) days.push(day)
      continue
    }
    if (/^[0-7]$/.test(part)) {
      days.push(Number(part) % 7)
      continue
    }
    return null
  }
  const unique = [...new Set(days)].sort((a, b) => a - b)
  if (!unique.length) return null
  const key = unique.join(',')
  if (key === '0,1,2,3,4,5,6') return 'Every day'
  if (key === '1,2,3,4,5') return 'Weekdays'
  if (key === '0,6') return 'Weekends'
  if (unique.length === 1) return `Every ${DAY_NAMES[unique[0]]}`
  const names = unique.map((day) => `${DAY_NAMES[day]}s`)
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

// Turns a cron expression into the human phrase the picker should lead with.
// Falls back to 'Custom schedule' when the shape is not one we can phrase.
function describeCron(cron: string): string {
  const trimmed = cron.trim()
  const preset = CRON_PRESETS.find((option) => option.value === trimmed)
  if (preset) return preset.label
  const fields = trimmed.split(/\s+/)
  if (fields.length < 5) return 'Custom schedule'
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields
  const everyMinutes = /^\*\/([0-9]+)$/.exec(minute)
  if (everyMinutes && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Every ${Number(everyMinutes[1])} minutes`
  }
  const everyHours = /^\*\/([0-9]+)$/.exec(hour)
  if (everyHours && /^\d{1,2}$/.test(minute) && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Every ${Number(everyHours[1])} hours at :${minute.padStart(2, '0')}`
  }
  if (/^\d{1,2}$/.test(minute) && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Every hour at :${minute.padStart(2, '0')}`
  }
  if (/^\d{1,2}$/.test(minute) && /^\d{1,2}$/.test(hour)) {
    const minuteValue = Number(minute)
    const hourValue = Number(hour)
    if (minuteValue <= 59 && hourValue <= 23) {
      const clock = formatClock(hourValue, minuteValue)
      if (dayOfWeek === '*' && dayOfMonth === '*' && month === '*') return `Every day at ${clock}`
      if (dayOfWeek !== '*' && dayOfMonth === '*' && month === '*') {
        const days = describeDays(dayOfWeek)
        if (days) return `${days} at ${clock}`
      }
      if (dayOfWeek === '*' && /^\d{1,2}$/.test(dayOfMonth) && month === '*') {
        return `Monthly on day ${Number(dayOfMonth)} at ${clock}`
      }
    }
  }
  return 'Custom schedule'
}

export function SchedulesView() {
  const settings = useApp((state) => state.settings)
  const openTask = useApp((state) => state.openTask)
  const openSettings = useApp((state) => state.openSettings)
  const [schedules, setSchedules] = useState<ScheduleRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ScheduleRecord | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    const list = await window.knight.listSchedules()
    setSchedules(list)
  }

  useEffect(() => {
    let alive = true
    void window.knight
      .listSchedules()
      .then((list) => {
        if (alive) setSchedules(list)
      })
      .catch((caught) => {
        if (alive) toast.error(errorMessage(caught))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const openCreate = (): void => {
    setEditing(null)
    setModalOpen(true)
  }

  const openEdit = (record: ScheduleRecord): void => {
    setEditing(record)
    setModalOpen(true)
  }

  const toggle = async (record: ScheduleRecord, enabled: boolean): Promise<void> => {
    setBusyId(record.id)
    try {
      const updated = await window.knight.updateSchedule(record.id, { enabled })
      setSchedules((current) =>
        current.map((item) => (item.id === record.id ? updated : item))
      )
    } catch (caught) {
      toast.error(errorMessage(caught))
    } finally {
      setBusyId(null)
    }
  }

  const runNow = async (record: ScheduleRecord): Promise<void> => {
    setRunningId(record.id)
    try {
      await window.knight.runScheduleNow(record.id)
      await refresh()
    } catch (caught) {
      toast.error(errorMessage(caught))
    } finally {
      setRunningId(null)
    }
  }

  const remove = async (record: ScheduleRecord): Promise<void> => {
    const confirmed = await confirmDialog({
      title: `Delete “${record.title}”?`,
      body: 'The schedule stops firing. Task runs it already started are kept.',
      confirmLabel: 'Delete schedule',
      danger: true
    })
    if (!confirmed) {
      return
    }
    try {
      await window.knight.deleteSchedule(record.id)
      setSchedules((current) => current.filter((item) => item.id !== record.id))
      toast.success('Schedule deleted.')
    } catch (caught) {
      toast.error(errorMessage(caught))
    }
  }

  const hasProviders = (settings?.providers ?? []).some(
    (provider) => provider.enabled && provider.models.length > 0
  )

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[920px] px-9 pt-9 pb-16">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-[22px] font-semibold leading-none tracking-[-0.01em] text-ink">
            Schedules
          </h1>
          <Button variant="primary" size="md" onClick={openCreate}>
            <Icon name="add" size="md" />
            New schedule
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <p className="flex items-center gap-1.5 text-[11px] text-muted">
            <Icon name="info" size="xs" />
            Fires while SelfImpulse is running.
          </p>
          {!hasProviders ? (
            <Button variant="secondary" size="sm" onClick={() => openSettings('providers')}>
              Connect a model
            </Button>
          ) : null}
        </div>

        {loading ? (
          <div className="card mt-5 flex items-center justify-center gap-2 py-16 text-[12px] text-faint">
            <Loader2 size={14} className="animate-spin" />
            Loading schedules…
          </div>
        ) : schedules.length === 0 ? (
          <div className="card mt-5 flex flex-col items-center px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink">
              <CalendarClock size={20} />
            </div>
            <p className="mt-4 text-[14px] font-medium">Nothing scheduled</p>
          </div>
        ) : (
          <div className="mt-5 space-y-2.5">
            {schedules.map((record) => {
              const cronLabel = describeCron(record.cron)
              const busy = busyId === record.id
              const running = runningId === record.id
              return (
                <div key={record.id} className="card overflow-hidden">
                  <div className="flex items-start gap-3 p-4">
                    <div
                      className={cn(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border',
                        record.enabled
                          ? 'border-accent/25 bg-accent-soft/60 text-accent-ink'
                          : 'border-line bg-surface-2 text-faint'
                      )}
                    >
                      <Icon name="clock" size="xl" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="truncate text-[13px] font-semibold">{record.title}</h3>
                        {!record.enabled ? (
                          <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-faint">
                            Paused
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-muted">
                        {record.prompt}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10.5px] text-faint">
                        <span className="inline-flex items-center gap-1 rounded-md border border-line bg-canvas px-1.5 py-0.5">
                          <CalendarClock size={10} />
                          {cronLabel}
                        </span>
                        <span className="rounded-md border border-line bg-canvas px-1.5 py-0.5 font-mono text-[10px]">
                          {record.cron}
                        </span>
                        <span className="rounded-md border border-line bg-canvas px-1.5 py-0.5">
                          {PERMISSION_LABEL[record.permissionMode]}
                        </span>
                        {record.folders.length ? (
                          <span className="inline-flex max-w-[220px] items-center gap-1 rounded-md border border-line bg-canvas px-1.5 py-0.5">
                            <Icon name="folder" size="xs" />
                            <span className="truncate">
                              {folderName(record.folders[0])}
                              {record.folders.length > 1
                                ? ` +${record.folders.length - 1}`
                                : ''}
                            </span>
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Toggle
                        checked={record.enabled}
                        onChange={(enabled) => void toggle(record, enabled)}
                        disabled={busy}
                        label={`Enable ${record.title}`}
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-canvas/40 px-4 py-2">
                    <div className="flex items-center gap-2 text-[10.5px] text-faint">
                      <Icon name="spark" size="xs" />
                      {record.lastRunAt ? (
                        <span>
                          Last run {timeAgo(record.lastRunAt)}
                          {record.lastTaskId ? (
                            <button
                              onClick={() => void openTask(record.lastTaskId!)}
                              className="ml-1 inline-flex items-center gap-0.5 font-medium text-muted underline underline-offset-2 hover:text-ink"
                            >
                              Open task
                              <Icon name="arrowUpRight" size="xs" />
                            </button>
                          ) : null}
                        </span>
                      ) : (
                        <span>Not run yet · starts fresh tasks</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={running}
                        disabled={!hasProviders}
                        onClick={() => void runNow(record)}
                      >
                        {!running ? <Icon name="play" size="md" /> : null}
                        Run now
                      </Button>
                      <IconButton onClick={() => openEdit(record)} aria-label="Edit schedule">
                        <Pencil size={13} />
                      </IconButton>
                      <IconButton
                        onClick={() => void remove(record)}
                        aria-label="Delete schedule"
                        className="hover:text-danger"
                      >
                        <Trash2 size={13} />
                      </IconButton>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {modalOpen ? (
        <ScheduleModal
          record={editing}
          onClose={() => {
            setModalOpen(false)
            setEditing(null)
          }}
          onSaved={() => {
            void refresh()
            setModalOpen(false)
            setEditing(null)
          }}
        />
      ) : null}
    </div>
  )
}

function ScheduleModal({
  record,
  onClose,
  onSaved
}: {
  record: ScheduleRecord | null
  onClose: () => void
  onSaved: () => void
}) {
  const settings = useApp((state) => state.settings)
  const providers = (settings?.providers ?? []).filter(
    (provider) => provider.enabled && provider.models.length > 0
  )
  const initialProvider =
    providers.find((provider) => provider.id === record?.providerId) ??
    providers.find((provider) => provider.id === settings?.defaultProviderId) ??
    providers[0]

  const [title, setTitle] = useState(record?.title ?? '')
  const [prompt, setPrompt] = useState(record?.prompt ?? '')
  const [preset, setPreset] = useState(() => {
    if (!record) return '0 9 * * 1-5'
    return CRON_PRESETS.some((option) => option.value === record.cron) ? record.cron : CUSTOM
  })
  const [customCron, setCustomCron] = useState(
    record && !CRON_PRESETS.some((option) => option.value === record.cron)
      ? record.cron
      : ''
  )
  const [providerId, setProviderId] = useState<string | undefined>(initialProvider?.id)
  const [model, setModel] = useState<string>(
    record?.model ??
      (initialProvider?.id === settings?.defaultProviderId
        ? settings?.defaultModel
        : undefined) ??
      initialProvider?.models[0] ??
      ''
  )
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    record?.permissionMode ?? settings?.defaultPermissionMode ?? 'manual'
  )
  const [folders, setFolders] = useState<string[]>(record?.folders ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeProvider = providers.find((provider) => provider.id === providerId) ?? providers[0]
  const cronValue = preset === CUSTOM ? customCron.trim() : preset
  const fixedTime = cronTimeMinutes(cronValue)

  const changeTime = (minutes: number): void => {
    const next = replaceCronTime(cronValue, minutes)
    if (preset === CUSTOM) setCustomCron(next)
    else setPreset(next)
  }

  const addFolder = async (): Promise<void> => {
    const folder = await window.knight.pickFolder()
    if (folder && !folders.includes(folder)) {
      setFolders((current) => [...current, folder])
    }
  }

  const submit = async (): Promise<void> => {
    setError(null)
    if (!prompt.trim()) {
      setError('Describe what SelfImpulse should do each time this runs.')
      return
    }
    const fields = cronValue.split(/\s+/).filter(Boolean)
    if (!cronValue || fields.length < 5 || fields.length > 6) {
      setError('Enter a cron expression with 5 fields, such as 0 9 * * 1-5.')
      return
    }
    if (!activeProvider) {
      setError('Connect a model provider first.')
      return
    }

    setSaving(true)
    try {
      const input: CreateScheduleInput = {
        title: title.trim(),
        prompt: prompt.trim(),
        cron: cronValue,
        enabled: record?.enabled ?? true,
        providerId,
        model,
        permissionMode,
        folders
      }
      if (record) await window.knight.updateSchedule(record.id, input)
      else await window.knight.createSchedule(input)
      toast.success(record ? 'Schedule updated.' : 'Schedule created.')
      onSaved()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-[600px]"
      icon={<CalendarClock size={17} />}
      title={record ? 'Edit schedule' : 'New schedule'}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" loading={saving} onClick={() => void submit()}>
            {record ? 'Save changes' : 'Create schedule'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FieldGroup label="Name" hint="Optional">
          <input
            className="field"
            aria-label="Schedule name"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Monday research brief"
            autoFocus
          />
        </FieldGroup>

        <FieldGroup label="Prompt">
          <textarea
            className="field min-h-[110px]"
            aria-label="Prompt for each run"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Research the top three developments in our market this week. Write a short sourced brief as a Word document and save it to the workspace."
          />
        </FieldGroup>

        <div className="grid gap-4 sm:grid-cols-2">
          <FieldGroup label="Repeats">
            <select
              className="field"
              aria-label="How often the schedule repeats"
              value={preset}
              onChange={(event) => {
                const value = event.target.value
                setPreset(value)
                if (value === CUSTOM && !customCron) setCustomCron('0 9 * * 1-5')
              }}
            >
              {CRON_PRESETS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              {preset !== CUSTOM && !CRON_PRESETS.some((option) => option.value === preset) ? (
                <option value={preset} title={`Cron: ${preset}`}>{describeCron(preset)}</option>
              ) : null}
              <option value={CUSTOM}>Custom cron…</option>
            </select>
          </FieldGroup>
          {preset === CUSTOM ? (
            <FieldGroup label="Cron expression" hint="minute hour day month weekday">
              <input
                className="field font-mono text-[12px]"
                aria-label="Cron expression"
                value={customCron}
                onChange={(event) => setCustomCron(event.target.value)}
                placeholder="0 9 * * 1-5"
                spellCheck={false}
              />
            </FieldGroup>
          ) : (
            <div className="flex flex-col justify-end gap-0.5 pb-1">
              <p className="flex items-center gap-1.5 text-[11px] text-muted">
                <Icon name="clock" size="xs" />
                {describeCron(preset)}
              </p>
              <p className="pl-[18px] font-mono text-[10px] text-faint" title={`Cron expression · ${preset}`}>
                {preset}
              </p>
            </div>
          )}
        </div>

        {fixedTime !== null ? (
          <TimeScrubber minutes={fixedTime} onChange={changeTime} />
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FieldGroup label="Provider">
            <select
              className="field"
              aria-label="Model provider"
              value={activeProvider?.id ?? ''}
              disabled={!providers.length}
              onChange={(event) => {
                const provider = providers.find((item) => item.id === event.target.value)
                if (!provider) return
                setProviderId(provider.id)
                setModel(provider.models[0] ?? '')
              }}
            >
              {providers.length === 0 ? (
                <option value="">No provider connected</option>
              ) : (
                providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))
              )}
            </select>
          </FieldGroup>
          <FieldGroup label="Model">
            <select
              className="field"
              value={model}
              disabled={!activeProvider?.models.length}
              onChange={(event) => {
                setModel(event.target.value)
                if (activeProvider) setProviderId(activeProvider.id)
              }}
            >
              {(activeProvider?.models.length ?? 0) === 0 ? (
                <option value="">No models</option>
              ) : (
                activeProvider?.models.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))
              )}
            </select>
          </FieldGroup>
        </div>

        <FieldGroup label="Permissions">
          <Segmented
            value={permissionMode}
            onChange={setPermissionMode}
            options={PERMISSION_CHOICES.map((choice) => ({
              value: choice.value,
              label: choice.label
            }))}
          />
          <p className="mt-2 text-[10.5px] leading-relaxed text-faint">
            {permissionMode === 'plan'
              ? 'Each run reads and leaves you a plan. Nothing is written and no command runs.'
              : permissionMode === 'manual'
                ? 'Each run pauses for your approval on file changes and commands.'
                : permissionMode === 'auto'
                  ? 'Routine actions run freely; high-risk actions wait for approval.'
                  : 'Each step is accepted without prompting. Shell commands still wait for approval.'}
          </p>
        </FieldGroup>

        <FieldGroup label="Working folders" hint="Optional">
          <div className="flex flex-wrap items-center gap-1.5">
            {folders.map((folder) => (
              <span
                key={folder}
                className="inline-flex max-w-[280px] items-center gap-1.5 rounded-lg border border-line bg-canvas px-2 py-1 text-[11px] text-muted"
                title={folder}
              >
                <Icon name="folder" size="xs" className="text-accent" />
                <span className="truncate">{folderName(folder)}</span>
                <button
                  onClick={() => setFolders((current) => current.filter((item) => item !== folder))}
                  className="text-faint hover:text-danger"
                  aria-label={`Remove ${folder}`}
                >
                  <Icon name="close" size="xs" />
                </button>
              </span>
            ))}
            <button
              onClick={() => void addFolder()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line px-2 py-1 text-[11px] text-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              <FolderPlus size={12} />
              Add folder
            </button>
          </div>
        </FieldGroup>

        {error ? (
          <div className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/5 px-3 py-2 text-[11.5px] leading-relaxed text-danger">
            <Icon name="caution" size="sm" className="mt-0.5" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="flex items-center gap-2 rounded-xl border border-line bg-canvas/50 px-3.5 py-2 text-[10.5px] text-faint">
          <Icon name="info" size="xs" />
          Each run creates a new task in Recents.
        </div>
      </div>
    </Modal>
  )
}
