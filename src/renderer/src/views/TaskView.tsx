import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  Circle,
  FolderOpen,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  PanelRightOpen,
  Pause,
  Play,
  Trash2,
  Check,
  MonitorUp,
  ShieldCheck
} from 'lucide-react'
import { BrandMark } from '../components/BrandMark'
import { toast } from 'sonner'
import type { AttachmentRef, ChatMessage, Task, TaskStatus } from '@shared/types'
import { AGENT_ROLE_LABELS } from '@shared/governance'
import { RolePicker } from '../motion/RolePicker'
import { useApp } from '../store'
import { cn, errorMessage, folderName, formatBytes, statusLabel, timeAgo } from '../lib/utils'
import { resolveComposerModel } from '../lib/composerChoices'
import { CaptainComposer } from '../features/captain/CaptainComposer'
import { Markdown } from '../components/Markdown'
import { PlanCard } from '../components/PlanCard'
import { StepList } from '../components/Steps'
import { ArtifactChip, ArtifactPreview } from '../components/Artifacts'
import { TaskPanel } from '../components/TaskPanel'
import { Button, IconButton, Popover } from '../components/ui'
import type { OrbState } from 'thinking-orbs'
import { TaskOrb } from '../motion/TaskOrb'
import { ShimmerText } from '../motion/ShimmerText'
import { ReactionPicker } from '../motion/ReactionPicker'
import { ActionNodeCard } from '../motion/ActionNodeCard'
import { orbStateForTask } from '../motion/activityMotion'

const STATUS_STYLE: Record<TaskStatus, string> = {
  draft: 'border-line bg-surface-2 text-muted',
  running: 'border-accent/30 bg-accent-soft/60 text-accent-ink',
  waiting: 'border-warn/30 bg-warn/10 text-warn',
  paused: 'border-line bg-surface-2 text-muted',
  done: 'border-positive/25 bg-positive/10 text-positive',
  error: 'border-danger/25 bg-danger/10 text-danger'
}

function StatusIcon({ status }: { status: TaskStatus }) {
  if (status === 'running') return <Loader2 size={10} className="animate-spin" />
  if (status === 'waiting') return <Circle size={7} className="fill-current" />
  if (status === 'paused') return <Pause size={9} />
  if (status === 'done') return <Check size={10} />
  if (status === 'error') return <AlertCircle size={10} />
  return <Circle size={7} />
}

function AttachmentChips({ message }: { message: ChatMessage }) {
  if (!message.attachments?.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {message.attachments.map((file) => (
        <span
          key={file.id}
          className="inline-flex max-w-[230px] items-center gap-1.5 rounded-lg border border-line bg-surface/70 px-2 py-1 text-[10.5px] text-muted"
          title={file.path}
        >
          <FolderOpen size={11} className="shrink-0 text-accent" />
          <span className="truncate">{file.name}</span>
          {file.size ? <span className="text-faint">{formatBytes(file.size)}</span> : null}
        </span>
      ))}
    </div>
  )
}

function ThinkingDots({ label, state }: { label: string; state: OrbState }) {
  return (
    <div className="flex items-center gap-2.5 py-1 text-[12px] text-muted">
      <TaskOrb state={state} label={label} />
      <ShimmerText>{label}</ShimmerText>
    </div>
  )
}

function TaskHeader({
  task,
  onTogglePanel,
  panelOpen
}: {
  task: Task
  onTogglePanel: () => void
  panelOpen: boolean
}) {
  const settings = useApp((state) => state.settings)
  const liveCrew = useApp(
    (state) => state.subagents.filter((run) => run.taskId === task.id && run.status === 'running').length
  )
  const goHome = useApp((state) => state.goHome)
  const deleteTask = useApp((state) => state.deleteTask)
  const resumeCurrent = useApp((state) => state.resumeCurrent)
  const stopCurrent = useApp((state) => state.stopCurrent)
  const updateCurrent = useApp((state) => state.updateCurrent)

  const provider = task.providerId
    ? settings?.providers.find((item) => item.id === task.providerId)
    : settings?.providers.find((item) => item.id === settings?.defaultProviderId)
  const model = task.model || settings?.defaultModel || provider?.models[0]
  const running = task.status === 'running' || task.status === 'waiting'

  return (
    <header className="flex h-[62px] shrink-0 items-center gap-3 border-b border-line/80 bg-canvas/85 px-5 backdrop-blur">
      <IconButton onClick={goHome} aria-label="Back to home">
        <ArrowLeft size={16} />
      </IconButton>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-[13.5px] font-semibold tracking-[-0.01em]">{task.title}</h1>
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9.5px] font-medium',
              STATUS_STYLE[task.status]
            )}
          >
            <StatusIcon status={task.status} />
            {statusLabel(task.status)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 truncate text-[10.5px] text-faint">
          <span className="inline-flex items-center gap-1">
            {task.mode === 'cowork' ? <BrandMark size={10} /> : <MessageCircle size={10} />}
            {task.mode === 'cowork' ? 'Cowork' : 'Chat'}
          </span>
          <span>·</span>
          <span className="truncate">{model || 'No model'}</span>
          <span>·</span>
          <span className="inline-flex items-center gap-1">
            <ShieldCheck size={9} />
            {AGENT_ROLE_LABELS[task.agentRole ?? 'executor']}
          </span>
          <span>·</span>
          <span>
            {task.folders.length ? folderName(task.folders[0]) : 'Task workspace'}
          </span>
        </div>
      </div>

      {running ? (
        <Button variant="secondary" size="sm" onClick={() => void stopCurrent()}>
          <Pause size={12} />
          Stop
        </Button>
      ) : task.status === 'paused' || task.status === 'error' ? (
        <Button variant="primary" size="sm" onClick={() => void resumeCurrent()}>
          <Play size={12} />
          Resume
        </Button>
      ) : null}

      <button
        onClick={onTogglePanel}
        className={cn(
          'flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px] font-medium transition-colors',
          panelOpen
            ? 'border-line-strong bg-surface text-ink'
            : 'border-line bg-transparent text-muted hover:bg-surface-2 hover:text-ink'
        )}
      >
        <PanelRightOpen size={13} />
        <span className="hidden sm:inline">Workspace</span>
        {liveCrew > 0 ? (
          <span className="flex items-center gap-1 text-[9.5px] text-accent">
            <span className="breathing h-1 w-1 rounded-full bg-accent" />
            {liveCrew}
          </span>
        ) : task.artifacts.length > 0 ? (
          <span className="rounded-full bg-accent-soft px-1.5 text-[9.5px] text-accent-ink">
            {task.artifacts.length}
          </span>
        ) : null}
      </button>

      <Popover
        align="right"
        side="bottom"
        trigger={(props) => (
          <IconButton {...props} aria-label="Task menu">
            <MoreHorizontal size={16} />
          </IconButton>
        )}
      >
        {(close) => (
          <div className="w-[230px]">
            <div className="border-b border-line px-2 py-2.5">
              <RolePicker
                value={task.agentRole ?? 'executor'}
                onChange={(agentRole) => void updateCurrent({ agentRole })}
              />
              <p className="mt-1.5 px-2 text-[9px] leading-relaxed text-faint">
                Applies to Captain and inherited Crew permissions.
              </p>
            </div>
            {task.browser ? (
              <button
                className="menu-item"
                onClick={() => {
                  close()
                  void window.knight.showBrowser(task.id, task.browser?.scope).catch((error) => {
                    toast.error(errorMessage(error))
                  })
                }}
              >
                <MonitorUp size={13} />
                Show task browser
              </button>
            ) : null}
            <button
              className="menu-item"
              onClick={() => {
                close()
                void navigator.clipboard.writeText(task.id)
                toast.success('Task ID copied.')
              }}
            >
              <Circle size={13} />
              Copy task ID
            </button>
            <div className="my-1 h-px bg-line" />
            <button
              className="menu-item text-danger"
              onClick={() => {
                close()
                if (
                  window.confirm(
                    'Delete this task and its workspace files? This cannot be undone.'
                  )
                ) {
                  void deleteTask(task.id)
                }
              }}
            >
              <Trash2 size={13} />
              Delete task
            </button>
          </div>
        )}
      </Popover>
    </header>
  )
}

export function TaskView() {
  const task = useApp((state) => state.currentTask)
  const panelOpen = useApp((state) => state.panelOpen)
  const setPanelOpen = useApp((state) => state.setPanelOpen)
  const approval = useApp((state) => state.approval)
  const settings = useApp((state) => state.settings)
  const sendToCurrent = useApp((state) => state.sendToCurrent)
  const reactToMessage = useApp((state) => state.reactToMessage)
  const stopCurrent = useApp((state) => state.stopCurrent)
  const resumeCurrent = useApp((state) => state.resumeCurrent)
  const updateCurrent = useApp((state) => state.updateCurrent)
  const addFolderToCurrent = useApp((state) => state.addFolderToCurrent)
  const openSettings = useApp((state) => state.openSettings)

  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<AttachmentRef[]>([])

  const messages = task?.messages ?? []
  const visible = messages.filter(
    (message) => !message.hidden && message.role !== 'tool' && (message.content.trim() || message.attachments?.length || message.role === 'assistant')
  )
  const lastVisible = visible[visible.length - 1]
  const running = task?.status === 'running' || task?.status === 'waiting'

  const scrollSignature = `${messages.length}:${lastVisible?.content.length ?? 0}:${task?.steps.length ?? 0}:${task?.status ?? ''}`

  useEffect(() => {
    stickRef.current = true
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [task?.id])

  useEffect(() => {
    if (!stickRef.current) return
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight })
  }, [scrollSignature])

  if (!task) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Loader2 size={16} className="animate-spin" />
      </div>
    )
  }

  const onSubmit = async (): Promise<void> => {
    if (!text.trim() && !attachments.length) return
    try {
      await sendToCurrent(text.trim(), attachments)
      setText('')
      setAttachments([])
    } catch {
      /* Store reports the error. */
    }
  }

  const composerModel = resolveComposerModel(settings, {
    providerId: task.providerId,
    model: task.model
  })

  return (
    <div className="relative flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <TaskHeader
          task={task}
          panelOpen={panelOpen}
          onTogglePanel={() => setPanelOpen(!panelOpen)}
        />

        <div
          ref={scrollRef}
          onScroll={(event) => {
            const el = event.currentTarget
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160
          }}
          className="scroll-thin relative min-h-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto w-full max-w-[860px] px-8 pt-7 pb-8">
            <ActionNodeCard task={task} />
            <PlanCard plan={task.plan} live={running} />

            {visible.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-line bg-surface text-accent">
                  <BrandMark size={19} />
                </div>
                <p className="mt-3 text-[13px] font-medium">SelfImpulse is getting ready</p>
                <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-faint">
                  {task.objective || 'Send a message to begin this task.'}
                </p>
              </div>
            ) : null}

            <div className="space-y-7">
              {visible.map((message, index) => {
                if (message.role === 'user') {
                  return (
                    <div key={message.id} className="message-in flex flex-col items-end">
                      <div className="max-w-[80%] rounded-[18px] rounded-br-md border border-line/80 bg-surface-2/85 px-4 py-2.5">
                        {message.content ? (
                          <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink">
                            {message.content}
                          </p>
                        ) : null}
                        <AttachmentChips message={message} />
                      </div>
                      <ReactionPicker
                        message={message}
                        align="right"
                        onReact={(emoji) => reactToMessage(message.id, emoji)}
                      />
                    </div>
                  )
                }

                if (message.role !== 'assistant') return null

                const steps = task.steps.filter((step) => step.messageId === message.id)
                const isLast = index === visible.length - 1
                const streaming =
                  isLast &&
                  running &&
                  !message.toolCalls?.length &&
                  lastVisible?.role === 'assistant'

                return (
                  <div key={message.id} className="message-in flex gap-3">
                    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-accent">
                      <BrandMark size={12} />
                    </div>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p className="mb-1.5 text-[10.5px] font-medium text-muted">Captain</p>
                      {message.content ? (
                        <Markdown content={message.content} streaming={streaming} />
                      ) : streaming ? (
                        <ThinkingDots
                          state={orbStateForTask(task)}
                          label={
                            task.status === 'waiting'
                              ? 'Waiting for your approval'
                              : 'Captain is working through the task'
                          }
                        />
                      ) : null}
                      <StepList steps={steps} live={running} />
                      {message.error ? (
                        <p className="mt-2 text-[11.5px] text-danger">This response was interrupted.</p>
                      ) : null}
                      <ReactionPicker
                        message={message}
                        onReact={(emoji) => reactToMessage(message.id, emoji)}
                      />
                    </div>
                  </div>
                )
              })}
            </div>

            {!running && task.artifacts.length > 0 ? (
              <div className="mt-8 rounded-xl border border-line bg-surface/50 p-3.5">
                <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.13em] text-faint uppercase">
                  <FolderOpen size={11} />
                  Delivered files
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {task.artifacts.map((artifact) => (
                    <ArtifactChip key={artifact.id} artifact={artifact} taskId={task.id} />
                  ))}
                </div>
              </div>
            ) : null}

            {!running && task.status === 'done' ? (
              <div className="mt-6 flex items-center justify-center gap-1.5 text-[10.5px] text-faint">
                <Check size={11} className="text-positive" />
                Finished {timeAgo(task.completedAt ?? task.updatedAt)}
                {task.usage ? (
                  <>
                    <span>·</span>
                    <span>{task.usage.total.toLocaleString()} tokens</span>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="shrink-0 border-t border-line/60 bg-canvas px-8 pt-3 pb-5">
          <div className="mx-auto w-full max-w-[860px]">
            {task.error ? (
              <div className="mb-2.5 flex flex-wrap items-center gap-2 rounded-xl border border-danger/25 bg-danger/5 px-3 py-2">
                <AlertCircle size={13} className="shrink-0 text-danger" />
                <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-danger/90">
                  {task.error}
                </p>
                <button
                  onClick={() => void resumeCurrent()}
                  className="text-[11px] font-medium text-ink underline underline-offset-2"
                >
                  Try again
                </button>
                <button
                  onClick={() => openSettings('providers')}
                  className="text-[11px] font-medium text-muted underline underline-offset-2"
                >
                  Settings
                </button>
              </div>
            ) : null}

            {task.status === 'paused' ? (
              <div className="mb-2.5 flex items-center gap-2 rounded-xl border border-line bg-surface/60 px-3 py-2">
                <Pause size={12} className="text-muted" />
                <p className="flex-1 text-[11.5px] text-muted">
                  This task is paused. Resume when you are ready.
                </p>
                <button
                  onClick={() => void resumeCurrent()}
                  className="text-[11px] font-medium text-accent underline underline-offset-2"
                >
                  Resume
                </button>
              </div>
            ) : null}

            {task.status === 'waiting' && approval?.taskId !== task.id ? (
              <div className="mb-2.5 flex items-center gap-2 rounded-xl border border-warn/25 bg-warn/5 px-3 py-2 text-[11.5px] text-warn">
                <Circle size={8} className="fill-current animate-pulse" />
                Waiting for your permission to continue.
              </div>
            ) : null}

            <CaptainComposer
              draft={text}
              onDraftChange={setText}
              attachments={attachments}
              onAttachmentsChange={setAttachments}
              permissionMode={task.permissionMode}
              onPermissionChange={(mode) => void updateCurrent({ permissionMode: mode })}
              model={composerModel}
              onModelChange={(next) =>
                void updateCurrent({ providerId: next.providerId, model: next.model })
              }
              workspace={task.folders[0] ?? null}
              onChooseWorkspace={() => void addFolderToCurrent()}
              onSubmit={onSubmit}
              running={running}
              onStop={() => void stopCurrent()}
              placeholder={
                running
                  ? 'Steer the task with new instructions…'
                  : task.status === 'done'
                    ? 'Ask a follow-up or refine the result…'
                    : 'Continue the task…'
              }
            />
          </div>
        </div>
      </div>

      {panelOpen ? (
        <>
          <div
            className="absolute inset-0 z-20 bg-black/15 backdrop-blur-[1px] xl:hidden"
            onClick={() => setPanelOpen(false)}
          />
          <div className="absolute inset-y-0 right-0 z-30 shadow-[-20px_0_60px_-40px_rgba(20,15,10,0.4)] xl:static xl:shadow-none">
            <TaskPanel task={task} onClose={() => setPanelOpen(false)} />
          </div>
        </>
      ) : null}

      <ArtifactPreview />
    </div>
  )
}
