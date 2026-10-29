import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Check,
  ChevronRight,
  FileText,
  KeyRound,
  ListChecks,
  ShieldCheck,
  Users,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../components/ui'
import { useLocalProfile } from '../../lib/localProfile'
import { StatusLight } from '../../motion/StatusLight'
import { cn, errorMessage, kindLabel, timeAgo } from '../../lib/utils'
import { useApp } from '../../store'
import type { Task, TaskStatus } from '@shared/types'
import {
  buildActivity,
  collectArtifacts,
  engineSummary,
  groupTasks,
  type ActivityRow,
  type ArtifactRow
} from './companyView'

const TASK_STATUS: Record<
  TaskStatus,
  { label: string; dot: string; text: string }
> = {
  running: { label: 'Working', dot: 'bg-positive', text: 'text-positive' },
  waiting: { label: 'Waiting for you', dot: 'bg-warn', text: 'text-warn' },
  error: { label: 'Needs attention', dot: 'bg-danger', text: 'text-danger' },
  paused: { label: 'Paused', dot: 'bg-faint', text: 'text-faint' },
  draft: { label: 'Draft', dot: 'bg-faint', text: 'text-faint' },
  done: { label: 'Done', dot: 'bg-faint', text: 'text-faint' }
}

const ACTIVITY_TONE: Record<ActivityRow['tone'], string> = {
  active: 'bg-positive',
  waiting: 'bg-warn',
  error: 'bg-danger',
  done: 'bg-accent',
  neutral: 'bg-faint'
}

function Stat({
  label,
  value,
  icon: Icon
}: {
  label: string
  value: string
  icon: typeof Users
}) {
  return (
    <div className="card px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium text-faint">{label}</span>
        <Icon size={12.5} className="text-faint" />
      </div>
      <p className="font-data mt-1.5 text-[23px] leading-none font-semibold text-ink">{value}</p>
    </div>
  )
}

function Workboard() {
  const tasks = useApp((state) => state.tasks)
  const openTask = useApp((state) => state.openTask)
  const groups = useMemo(() => groupTasks(tasks), [tasks])

  return (
    <section className="card overflow-hidden">
      <div className="flex items-end justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="text-[12.5px] font-semibold tracking-[-0.01em] text-ink">Workboard</h2>
        <span className="font-mono text-[10px] text-faint">{tasks.length}</span>
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center px-5 py-12 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-[var(--r-card)] border border-line bg-canvas text-faint">
            <ListChecks size={17} />
          </div>
          <p className="mt-3 max-w-[300px] text-[12px] leading-relaxed text-muted">
            Nothing is running yet. Ask for something in chat and it appears here.
          </p>
        </div>
      ) : (
        <div className="scroll-thin max-h-[520px] overflow-y-auto">
          {groups.map((group) => {
            const meta = TASK_STATUS[group.status]
            return (
              <div key={group.status} className="border-b border-line/60 last:border-b-0">
                <div className="flex items-center gap-2 bg-canvas/40 px-4 py-1.5">
                  {group.status === 'running' ? (
                    <StatusLight />
                  ) : (
                    <span className={cn('h-1 w-1 rounded-full', meta.dot)} />
                  )}
                  <span className={cn('text-[10px] font-medium', meta.text)}>{meta.label}</span>
                  <span className="font-mono text-[10px] text-faint">{group.tasks.length}</span>
                </div>
                {group.tasks.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => void openTask(task.id)}
                    className="group flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-surface-2/40"
                  >
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', meta.dot)} />
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-[11.5px]',
                        task.status === 'done' ? 'text-faint line-through' : 'text-ink/90'
                      )}
                      title={task.title}
                    >
                      {task.title}
                    </span>
                    <span className="hidden shrink-0 rounded-md border border-line bg-canvas px-1.5 py-0.5 text-[10px] text-muted sm:inline">
                      {task.mode === 'cowork' ? 'Cowork' : 'Chat'}
                    </span>
                    {task.artifactsCount > 0 ? (
                      <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-faint">
                        <FileText size={9} />
                        {task.artifactsCount}
                      </span>
                    ) : null}
                    <span className="w-16 shrink-0 text-right font-mono text-[10px] text-faint">
                      {timeAgo(task.updatedAt)}
                    </span>
                    <ChevronRight
                      size={11}
                      className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function PlanCard({ tasks }: { tasks: Task[] }) {
  const openTask = useApp((state) => state.openTask)
  const task =
    tasks.find(
      (item) =>
        item.plan.length > 0 &&
        (item.status === 'running' || item.status === 'waiting' || item.status === 'paused')
    ) ?? tasks.find((item) => item.plan.length > 0)
  const done = task?.plan.filter((item) => item.status === 'done').length ?? 0
  const total = task?.plan.length ?? 0
  const width = total ? Math.round((done / total) * 100) : 0

  return (
    <section className="card p-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[12.5px] font-semibold tracking-[-0.01em] text-ink">Plan</h2>
          {task ? (
            <p className="mt-0.5 text-[10.5px] text-faint">{task.title}</p>
          ) : null}
        </div>
        {task ? (
          <span className="font-mono text-[10px] text-faint">
            {done}/{total}
          </span>
        ) : null}
      </div>

      {task ? (
        <>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line/50">
            <div
              className="h-full rounded-full bg-accent transition-all duration-500"
              style={{ width: `${width}%` }}
            />
          </div>
          <ul className="mt-3 space-y-1.5">
            {task.plan.slice(0, 6).map((item) => (
              <li key={item.id} className="flex items-start gap-2 text-[10.5px] leading-relaxed">
                <span
                  className={cn(
                    'mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
                    item.status === 'done'
                      ? 'border-positive/40 bg-positive/10 text-positive'
                      : item.status === 'active'
                        ? 'border-accent/40 bg-accent-soft text-accent-ink'
                        : 'border-line text-faint'
                  )}
                >
                  {item.status === 'done' ? (
                    <Check size={8} strokeWidth={3} />
                  ) : (
                    <span
                      className={cn(
                        'h-1 w-1 rounded-full',
                        item.status === 'active' ? 'bg-accent' : 'bg-faint'
                      )}
                    />
                  )}
                </span>
                <span
                  className={cn(
                    item.status === 'done' ? 'text-faint line-through' : 'text-muted'
                  )}
                >
                  {item.text}
                </span>
              </li>
            ))}
          </ul>
          {task.plan.length > 6 ? (
            <p className="mt-2 font-mono text-[10px] text-faint">
              +{task.plan.length - 6} more steps
            </p>
          ) : null}
          <button
            onClick={() => void openTask(task.id)}
            className="mt-3 flex items-center gap-1 text-[10px] font-medium text-accent-ink hover:underline"
          >
            Open task
            <ArrowRight size={10} />
          </button>
        </>
      ) : (
        <p className="mt-3 text-[10px] leading-relaxed text-faint">No plan yet.</p>
      )}
    </section>
  )
}

function FilesCard({ artifacts }: { artifacts: ArtifactRow[] }) {
  return (
    <section className="card p-4">
      <div className="flex items-end justify-between gap-3">
        <h2 className="text-[12.5px] font-semibold tracking-[-0.01em] text-ink">Recent files</h2>
        <span className="font-mono text-[10px] text-faint">{artifacts.length}</span>
      </div>

      {artifacts.length === 0 ? (
        <p className="mt-3 text-[10px] leading-relaxed text-faint">Files appear here.</p>
      ) : (
        <div className="mt-2.5 space-y-1">
          {artifacts.slice(0, 5).map((artifact) => (
            <button
              key={artifact.id}
              onClick={() => {
                void window.knight
                  .openArtifact(artifact.taskId, artifact.relPath)
                  .catch((error) => toast.error(errorMessage(error)))
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2/50"
              title="Open file"
            >
              <FileText size={12} className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[10px] text-ink" title={artifact.name}>
                  {artifact.name}
                </span>
                <span className="block truncate text-[10px] text-faint" title={`${kindLabel(artifact.kind)} · ${artifact.taskTitle}`}>
                  {kindLabel(artifact.kind)} · {artifact.taskTitle}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[10px] text-faint">
                {timeAgo(artifact.createdAt)}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function EngineCard() {
  const settings = useApp((state) => state.settings)
  const openSettings = useApp((state) => state.openSettings)
  const engine = useMemo(() => engineSummary(settings), [settings])

  const rows: Array<[string, string]> = [
    ['Provider', engine.provider ?? 'Not selected'],
    ['Model', engine.model ?? 'Not selected'],
    ['Permissions', engine.permission],
    ['Extensions', `${engine.servers} MCP ${engine.servers === 1 ? 'server' : 'servers'}`]
  ]

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck size={13} className="text-accent" />
          <h2 className="text-[12.5px] font-semibold tracking-[-0.01em] text-ink">The engine</h2>
        </div>
        <span
          className={cn(
            'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium',
            engine.ready
              ? 'border-positive/30 bg-positive/10 text-positive'
              : 'border-warn/30 bg-warn/10 text-warn'
          )}
        >
          {engine.ready ? <BadgeCheck size={9} /> : <X size={9} />}
          {engine.ready ? 'ready' : 'needs a model'}
        </span>
      </div>

      <dl className="mt-3 space-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <dt className="text-[10px] text-faint">{label}</dt>
            <dd className="min-w-0 truncate text-right font-mono text-[10px] text-ink" title={value}>{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
        <Button variant="secondary" size="sm" onClick={() => openSettings('providers')}>
          Providers
        </Button>
        <Button variant="ghost" size="sm" onClick={() => openSettings('agent')}>
          Agent settings
        </Button>
      </div>
    </section>
  )
}

function GatesCard() {
  const approval = useApp((state) => state.approval)
  const tasks = useApp((state) => state.tasks)
  const respondApproval = useApp((state) => state.respondApproval)
  const openTask = useApp((state) => state.openTask)
  const taskTitle = approval
    ? (tasks.find((task) => task.id === approval.taskId)?.title ?? 'A task')
    : null

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <KeyRound size={13} className="text-accent" />
          <h2 className="text-[12.5px] font-semibold tracking-[-0.01em] text-ink">Gates</h2>
        </div>
        {approval ? (
          <span className="rounded-full border border-warn/30 bg-warn/10 px-2 py-0.5 text-[10px] font-medium text-warn">
            Needs your key
          </span>
        ) : null}
      </div>

      {approval ? (
        <>
          <p className="mt-2.5 text-[11px] font-medium text-ink">{approval.title}</p>
          <p className="mt-0.5 text-[10px] text-faint">
            {approval.risk} risk · {taskTitle} · {approval.tool}
          </p>
          <p className="mt-1.5 line-clamp-3 text-[10px] leading-relaxed text-muted">
            {approval.summary}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Button size="sm" variant="primary" onClick={() => void respondApproval(true)}>
              <Check size={11} />
              Approve
            </Button>
            {approval.allowAlways ? (
              <Button size="sm" variant="secondary" onClick={() => void respondApproval(true, true)}>
                Always allow
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => void respondApproval(false)}>
              Deny
            </Button>
          </div>
          <button
            onClick={() => void openTask(approval.taskId)}
            className="mt-2 flex items-center gap-1 text-[10px] font-medium text-muted hover:text-ink"
          >
            Open task
            <ArrowRight size={9} />
          </button>
        </>
      ) : (
        <p className="mt-2.5 text-[10px] leading-relaxed text-faint">
          Nothing is waiting.
        </p>
      )}
    </section>
  )
}

function ActivityCard({ rows }: { rows: ActivityRow[] }) {
  const openTask = useApp((state) => state.openTask)

  return (
    <section className="card overflow-hidden">
      <div className="flex items-end justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Activity size={13} className="text-accent" />
          <h2 className="text-[12.5px] font-semibold tracking-[-0.01em] text-ink">Activity</h2>
        </div>
        <span className="font-mono text-[10px] text-faint">{rows.length ? rows.length : null}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-[10px] text-faint">Nothing yet.</p>
      ) : (
        <div className="divide-y divide-line/60">
          {rows.map((row) => (
            <button
              key={row.id}
              onClick={() => void openTask(row.taskId)}
              className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-surface-2/40"
            >
              <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', ACTIVITY_TONE[row.tone])} />
              <span className="min-w-0 flex-1">
                <span className="block text-[10.5px] leading-snug text-muted">{row.text}</span>
                <span className="mt-0.5 block font-mono text-[10px] text-faint">
                  {timeAgo(row.at)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

export function CompanySurface() {
  const tasks = useApp((state) => state.tasks)
  const settings = useApp((state) => state.settings)
  const approval = useApp((state) => state.approval)
  const refreshTasks = useApp((state) => state.refreshTasks)
  const openSurface = useApp((state) => state.openSurface)
  const openSettings = useApp((state) => state.openSettings)
  const profile = useLocalProfile()

  const [details, setDetails] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const signature = tasks
    .slice(0, 10)
    .map((task) => `${task.id}:${task.updatedAt}`)
    .join('|')

  useEffect(() => {
    void refreshTasks()
  }, [refreshTasks])

  useEffect(() => {
    let active = true
    const ids = tasks.slice(0, 10).map((task) => task.id)
    if (ids.length === 0) {
      setDetails([])
      setLoading(false)
      return
    }
    setLoading(true)
    void Promise.all(ids.map((id) => window.knight.getTask(id)))
      .then((loaded) => {
        if (!active) return
        setDetails(loaded.filter((task): task is Task => Boolean(task)))
        setLoading(false)
      })
      .catch(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [signature])

  const artifacts = useMemo(() => collectArtifacts(details), [details])
  const activity = useMemo(() => buildActivity(tasks, artifacts), [tasks, artifacts])
  const engine = useMemo(() => engineSummary(settings), [settings])
  const inFlight = tasks.filter(
    (task) => task.status === 'running' || task.status === 'waiting' || task.status === 'paused'
  ).length
  const finished = tasks.filter((task) => task.status === 'done').length
  const openGates = approval ? 1 : 0

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="surface-enter mx-auto w-full max-w-[1280px] px-8 pt-8 pb-14">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold leading-none tracking-[-0.01em] text-ink">
              Company
            </h1>
            <p className="mt-2 max-w-[560px] text-[12px] leading-relaxed text-muted">
              Everything {profile.name} is working on, and what it needs from you.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!engine.ready ? (
              <Button variant="secondary" size="sm" onClick={() => openSettings('providers')}>
                Connect a model
              </Button>
            ) : null}
            <Button variant="primary" size="sm" onClick={() => openSurface('chat')}>
              Open chat
              <ArrowRight size={12} />
            </Button>
          </div>
        </header>

        <div className="mt-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Stat label="In flight" value={String(inFlight)} icon={Activity} />
          <Stat label="Needs approval" value={String(openGates)} icon={KeyRound} />
          <Stat label="Finished" value={String(finished)} icon={BadgeCheck} />
          <Stat label="Files" value={loading ? '—' : String(artifacts.length)} icon={FileText} />
        </div>

        <div className="mt-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_332px]">
          <div className="space-y-4">
            <Workboard />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <PlanCard tasks={details} />
              <FilesCard artifacts={artifacts} />
            </div>
          </div>
          <div className="space-y-4">
            <EngineCard />
            <GatesCard />
            <ActivityCard rows={activity} />
          </div>
        </div>
      </div>
    </div>
  )
}
