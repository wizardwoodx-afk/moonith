import { agentName } from '../lib/localProfile'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  Loader2,
  MessageCircle,
  Minimize2,
  MoreHorizontal,
  PanelRightOpen,
  Trash2,
  MonitorUp,
  Pencil,
  X
} from 'lucide-react'
import { Icon } from '../components/icons'
import { BrandMark } from '../components/BrandMarks'
import { confirmDialog } from '../components/Confirm'
import { TaskChanges } from '../components/TaskChanges'
import { OversightPanel } from '../features/oversight/OversightPanel'
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
import { WorkTrail } from '../components/WorkTrail'
import { ArtifactChip, ArtifactPreview, InlineArtifactCard } from '../components/Artifacts'
import { TaskPanel } from '../components/TaskPanel'
import { Button, Elev, ElevShadow, IconButton, Popover } from '../components/ui'
import { ReactionPicker } from '../motion/ReactionPicker'
import { MessageFeedback } from '../components/MessageFeedback'
import { ActionNodeCard } from '../motion/ActionNodeCard'
import { setModeTheme } from '../lib/themes'

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
  if (status === 'paused') return <Icon name="pause" size="xs" />
  if (status === 'done') return <Icon name="confirm" size="xs" />
  if (status === 'error') return <Icon name="alert" size="xs" />
  return <Circle size={7} />
}

function AttachmentChips({ message }: { message: ChatMessage }) {
  if (!message.attachments?.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {message.attachments.map((file) => (
        <span
          key={file.id}
          className={cn(
            'inline-flex max-w-[230px] items-center gap-1.5 rounded-lg bg-surface px-2 py-1 text-[length:var(--text-micro)] text-muted',
            Elev.hairline
          )}
          title={file.path}
        >
          <Icon name="folderOpen" size="xs" className="text-accent" />
          <span className="min-w-0 truncate">{file.name}</span>
          {file.size ? <span className="text-faint">{formatBytes(file.size)}</span> : null}
        </span>
      ))}
    </div>
  )
}

/** A provider failure arrives as quoted JSON. The reader gets one sentence; the
 * payload stays available, untouched, behind the disclosure. */
function providerSentence(payload: Record<string, unknown>): string {
  const retry = findRetryDelay(payload)
  if (retry) return `Rate limit reached — try again in ${retry}.`
  const status = findStatus(payload)
  if (status === 401) return 'The provider rejected this API key.'
  if (status === 403) return 'This key is not allowed to use that model.'
  if (status === 404) return 'That model or endpoint was not found.'
  if (status === 429) return 'Rate limit reached — try again shortly.'
  if (status !== null && status >= 500) return 'The model provider is unavailable right now.'
  return 'The model provider rejected this request.'
}

/** Balanced-brace scan so a JSON body glued to prose still parses. */
function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index++) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{' || char === '[') depth++
    else if (char === '}' || char === ']') {
      depth--
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, index + 1))
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function walkValues(payload: unknown, visit: (key: string, value: unknown) => boolean): boolean {
  if (Array.isArray(payload)) return payload.some((item) => walkValues(item, visit))
  if (!payload || typeof payload !== 'object') return false
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (visit(key, value)) return true
    if (walkValues(value, visit)) return true
  }
  return false
}

function findRetryDelay(payload: Record<string, unknown>): string | null {
  let found: string | null = null
  walkValues(payload, (key, value) => {
    if (found) return true
    if (!/retrydelay|retry_after|retry-after/i.test(key)) return false
    const raw = typeof value === 'number' ? `${value}s` : typeof value === 'string' ? value : ''
    const match = raw.match(/^\s*(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds)?\s*$/i)
    if (!match) return false
    found = `${match[1]} ${Number(match[1]) === 1 ? 'second' : 'seconds'}`
    return true
  })
  return found
}

function findStatus(payload: Record<string, unknown>): number | null {
  let found: number | null = null
  walkValues(payload, (key, value) => {
    if (found !== null) return true
    if (!/^(code|status|statuscode|http_status)$/i.test(key)) return false
    const numeric = typeof value === 'number' ? value : Number(value)
    if (Number.isFinite(numeric) && numeric >= 100 && numeric < 600) found = numeric
    return found !== null
  })
  return found
}

const MAX_SENTENCE = 180

function describeTaskError(error: string): { sentence: string; raw: string | null } {
  const text = error.trim()
  const json = parseJsonObject(text)
  if (json) return { sentence: providerSentence(json), raw: text }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const first = lines[0] ?? ''
  if (!first) return { sentence: 'This task failed.', raw: text || null }
  if (first.length > MAX_SENTENCE) {
    return { sentence: `${first.slice(0, MAX_SENTENCE).trimEnd()}…`, raw: text }
  }
  const rest = lines.slice(1).join('\n')
  return { sentence: first, raw: rest || null }
}

function TaskErrorBanner({
  error,
  onRetry,
  onOpenSettings
}: {
  error: string
  onRetry: () => void
  onOpenSettings: () => void
}) {
  const [showRaw, setShowRaw] = useState(false)
  const { sentence, raw } = describeTaskError(error)
  return (
    <div
      role="alert"
      className={cn(
        'mb-3 rounded-[var(--r-card)] bg-danger/5 px-4 py-3',
        ElevShadow.raised,
        'border border-danger/30'
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="alert" size="md" className="text-danger" />
        <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-danger">{sentence}</p>
        {raw ? (
          <button
            type="button"
            onClick={() => setShowRaw((value) => !value)}
            aria-expanded={showRaw}
            className="whitespace-nowrap text-[11px] font-medium text-muted underline underline-offset-2"
          >
            {showRaw ? 'Hide details' : 'Details'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onRetry}
          className="whitespace-nowrap text-[11px] font-medium text-ink underline underline-offset-2"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="whitespace-nowrap text-[11px] font-medium text-muted underline underline-offset-2"
        >
          Settings
        </button>
      </div>
      {showRaw && raw ? (
        <pre className="scroll-thin mt-2 max-h-40 overflow-auto rounded-lg border border-danger/20 bg-canvas/70 px-3 py-2 font-mono text-[10px] leading-relaxed break-words whitespace-pre-wrap text-danger/90">
          {raw}
        </pre>
      ) : null}
    </div>
  )
}

/** Copies a whole reply as plain text, with a visible confirmation. */
function CopyMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  if (!text.trim()) return null
  const copy = (): void => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      })
      .catch(() => toast.error('Could not copy. Select the text and copy it yourself.'))
  }
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy reply"
      aria-label="Copy this reply"
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-faint transition-colors hover:bg-surface-2 hover:text-ink"
    >
      {copied ? <Icon name="confirm" size="xs" /> : <Icon name="copy" size="xs" />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  )
}

/** Density rule shared by TaskView, LibraryView, PairingPanel and the surfaces
 * in components/ui: a 4px grid, with one set value per role — rails and rows
 * pad 8px vertically / 12px horizontally, cards and banners 16px horizontally
 * and 12px vertically, chrome bands 24px, main content columns 32px, and one
 * 24px gap between transcript turns. Elevation comes from the `Elev` ladder;
 * state colours may replace the neutral hairline but never the shadow level.
 * The two deliberate breaks are noted where they occur. */
/** Compacted context summary card (Qoder-style context compression) */
function CompactedContextCard({ message }: { message: ChatMessage }) {
  const [expanded, setExpanded] = useState(false)
  const folded = message.foldedMessages || []

  return (
    <div
      className={cn(
        'my-4 overflow-hidden rounded-[var(--r-card)] border border-line bg-surface/85 transition-all',
        ElevShadow.raised
      )}
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5 bg-surface-2/70">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-accent-soft text-accent">
            <Minimize2 size={11} strokeWidth={2.4} />
          </div>
          <span className="text-[12px] font-semibold tracking-[-0.01em] text-ink">
            Context Compacted
          </span>
          <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-medium text-faint border border-line">
            Folded {message.foldedCount ?? folded.length} turns · Saved ~{(message.savedTokens ?? 0).toLocaleString()} tokens
          </span>
        </div>
        {folded.length > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-muted hover:text-ink hover:bg-surface-3 transition-colors cursor-pointer"
          >
            <span>{expanded ? 'Hide original turns' : 'View folded turns'}</span>
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        ) : null}
      </div>

      <div className="px-4 py-3 text-[13px] leading-relaxed text-ink/90">
        <Markdown content={message.compactedSummary || message.content} />
      </div>

      {expanded && folded.length > 0 ? (
        <div className="border-t border-line bg-canvas/60 p-4 space-y-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-faint">
            Folded History ({folded.length} messages)
          </div>
          <div className="max-h-[360px] overflow-y-auto space-y-2 pr-1 scroll-thin">
            {folded.map((fm, idx) => (
              <div
                key={fm.id || idx}
                className={cn(
                  'rounded-lg p-2.5 text-[12px] border border-line-subtle',
                  fm.role === 'user' ? 'bg-surface-2 ml-8' : 'bg-surface mr-8'
                )}
              >
                <div className="flex items-center justify-between mb-1 text-[10px] font-semibold text-faint uppercase">
                  <span>{fm.role === 'user' ? 'User' : 'Self/Cowork'}</span>
                  <span>{fm.createdAt ? timeAgo(fm.createdAt) : ''}</span>
                </div>
                <div className="text-ink/80 whitespace-pre-wrap">{fm.content}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
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
  const openPanelTab = useApp((state) => state.openPanelTab)
  const panelTab = useApp((state) => state.panelTab)
  const liveCrew = useApp(
    (state) => state.subagents.filter((run) => run.taskId === task.id && run.status === 'running').length
  )
  const goHome = useApp((state) => state.goHome)
  const deleteTask = useApp((state) => state.deleteTask)
  const resumeCurrent = useApp((state) => state.resumeCurrent)
  const stopCurrent = useApp((state) => state.stopCurrent)
  const updateCurrent = useApp((state) => state.updateCurrent)
  const compactTask = useApp((state) => state.compactTask)
  const [isCompacting, setIsCompacting] = useState(false)

  const estimatedTokens = useMemo(() => {
    const chars = task.messages.reduce(
      (acc, m) => acc + (m.content?.length || 0) + (m.thinking?.length || 0),
      0
    )
    return Math.ceil(chars / 4)
  }, [task.messages])
  const budgetTokens = 48000
  const usagePercent = Math.min(100, Math.round((estimatedTokens / budgetTokens) * 100))
  const canCompact = task.messages.length > 2

  const handleCompact = async () => {
    if (isCompacting || !canCompact) return
    setIsCompacting(true)
    try {
      await compactTask(task.id, true)
    } finally {
      setIsCompacting(false)
    }
  }

  const provider = task.providerId
    ? settings?.providers.find((item) => item.id === task.providerId)
    : settings?.providers.find((item) => item.id === settings?.defaultProviderId)
  const model = task.model || settings?.defaultModel || provider?.models[0]
  const running = task.status === 'running' || task.status === 'waiting'
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(task.title)

  const handleSaveTitle = async () => {
    const trimmed = titleDraft.trim()
    if (!trimmed || trimmed === task.title) {
      setIsEditingTitle(false)
      return
    }
    await updateCurrent({ title: trimmed })
    setIsEditingTitle(false)
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-canvas px-6">
      <IconButton onClick={goHome} aria-label="Back to home">
        <Icon name="arrowLeft" size="md" />
      </IconButton>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {isEditingTitle ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void handleSaveTitle()
              }}
              className="flex items-center gap-1.5"
            >
              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setTitleDraft(task.title)
                    setIsEditingTitle(false)
                  }
                }}
                className="h-7 rounded-md border border-line-strong bg-surface px-2 text-[13px] font-semibold text-ink outline-none"
                autoFocus
              />
              <button
                type="submit"
                title="Save title"
                className="flex h-6 w-6 items-center justify-center rounded text-accent hover:bg-surface-2 transition-colors cursor-pointer"
              >
                <Check size={13} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setTitleDraft(task.title)
                  setIsEditingTitle(false)
                }}
                title="Cancel"
                className="flex h-6 w-6 items-center justify-center rounded text-faint hover:text-ink hover:bg-surface-2 transition-colors cursor-pointer"
              >
                <X size={13} />
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-1.5 min-w-0">
              <h1 className="truncate text-[13px] font-semibold tracking-[-0.01em]" title={task.title}>
                {task.title}
              </h1>
              <button
                type="button"
                onClick={() => {
                  setTitleDraft(task.title)
                  setIsEditingTitle(true)
                }}
                title="Rename chat"
                aria-label="Rename chat"
                className="flex h-5 w-5 items-center justify-center rounded text-faint hover:text-ink hover:bg-surface-2 transition-colors cursor-pointer"
              >
                <Pencil size={11} />
              </button>
            </div>
          )}
          <span
            role="status"
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[length:var(--text-micro)] font-medium',
              STATUS_STYLE[task.status]
            )}
          >
            <StatusIcon status={task.status} />
            {statusLabel(task.status)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 truncate text-[length:var(--text-micro)] text-faint">
          <button
            type="button"
            onClick={() => {
              const next = task.mode === 'cowork' ? 'chat' : 'cowork'
              void updateCurrent({ mode: next })
              setModeTheme(next)
            }}
            title={`Switch to ${task.mode === 'cowork' ? 'Self' : 'Cowork'} mode`}
            className="inline-flex items-center gap-1 hover:text-ink transition-colors cursor-pointer rounded px-1 py-0.5 hover:bg-surface-2"
          >
            {task.mode === 'cowork' ? <BrandMark size={10} /> : <MessageCircle size={10} />}
            <span className="font-medium underline decoration-dotted underline-offset-2">
              {task.mode === 'cowork' ? 'Cowork' : 'Self'}
            </span>
          </button>
          <span>·</span>
          <span className="min-w-0 truncate" title={model || 'No model'}>{model || 'No model'}</span>
          <span>·</span>
          <span className="inline-flex items-center gap-1">
            <Icon name="shield" size="xs" />
            {AGENT_ROLE_LABELS[task.agentRole ?? 'executor']}
          </span>
          <span>·</span>
          <span className="min-w-0 truncate" title={task.folders[0] || 'Task workspace'}>
            {task.folders[0] ? folderName(task.folders[0]) : 'Task workspace'}
          </span>
        </div>
      </div>

      {running ? (
        <Button variant="secondary" size="sm" onClick={() => void stopCurrent()}>
          <Icon name="pause" size="md" />
          Stop
        </Button>
      ) : task.status === 'paused' || task.status === 'error' ? (
        <Button variant="primary" size="sm" onClick={() => void resumeCurrent()}>
          <Icon name="play" size="md" />
          Resume
        </Button>
      ) : null}

      {/* Qoder-style Context Token Budget Meter */}
      <div
        className={cn(
          'hidden md:inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[length:var(--text-micro)] font-mono transition-colors',
          Elev.hairline,
          'bg-surface text-muted'
        )}
        title={`Context token budget: ${estimatedTokens.toLocaleString()} / ${budgetTokens.toLocaleString()} tokens (${usagePercent}%). Compact older turns to free context window.`}
      >
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full shrink-0',
            usagePercent >= 80 ? 'bg-rose-500' : usagePercent >= 50 ? 'bg-amber-500' : 'bg-emerald-500'
          )}
        />
        <span>
          {estimatedTokens >= 1000 ? `${(estimatedTokens / 1000).toFixed(1)}k` : estimatedTokens} / {budgetTokens / 1000}k
        </span>
      </div>

      {/* Qoder-style Compact Context Button */}
      <button
        type="button"
        onClick={() => void handleCompact()}
        disabled={isCompacting || !canCompact}
        title="Compact context (Fold older turns into summary to free tokens)"
        aria-label="Compact context"
        className={cn(
          'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium transition-colors cursor-pointer',
          Elev.hairline,
          'text-muted hover:text-ink hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed'
        )}
      >
        {isCompacting ? (
          <Loader2 size={12} className="animate-spin text-accent" />
        ) : (
          <Minimize2 size={12} />
        )}
        <span className="hidden sm:inline">Compact</span>
      </button>

      {/* Qoder-style Skills, Sub-agents, and MCP capability buttons */}
      <div className="hidden lg:flex items-center gap-1">
        <button
          type="button"
          onClick={() => openPanelTab('crew')}
          title="Open Sub-agents & Delegated Runs"
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] font-medium transition-colors cursor-pointer',
            panelOpen && panelTab === 'crew'
              ? 'bg-accent/15 text-accent border border-accent/30'
              : 'border border-line bg-surface/50 text-muted hover:text-ink hover:bg-surface-2'
          )}
        >
          <Icon name="crew" size="xs" />
          <span>Sub-agents</span>
          {liveCrew > 0 ? (
            <span className="flex items-center gap-1 text-[9.5px] text-accent font-mono font-semibold">
              <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
              {liveCrew}
            </span>
          ) : null}
        </button>

        <button
          type="button"
          onClick={() => openPanelTab('skills')}
          title="Open Impulse Skills & Playbooks"
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] font-medium transition-colors cursor-pointer',
            panelOpen && panelTab === 'skills'
              ? 'bg-accent/15 text-accent border border-accent/30'
              : 'border border-line bg-surface/50 text-muted hover:text-ink hover:bg-surface-2'
          )}
        >
          <Icon name="spark" size="xs" active />
          <span>Skills</span>
        </button>

        <button
          type="button"
          onClick={() => openPanelTab('mcp')}
          title="Open MCP Services & Tools"
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] font-medium transition-colors cursor-pointer',
            panelOpen && panelTab === 'mcp'
              ? 'bg-accent/15 text-accent border border-accent/30'
              : 'border border-line bg-surface/50 text-muted hover:text-ink hover:bg-surface-2'
          )}
        >
          <Icon name="connector" size="xs" active />
          <span>MCPs</span>
        </button>
      </div>

      <button
        onClick={onTogglePanel}
        aria-pressed={panelOpen}
        aria-label="Workspace panel"
        className={cn(
          'flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] font-medium transition-colors',
          panelOpen
            ? cn(Elev.raised, 'bg-surface text-ink')
            : cn(Elev.hairline, 'bg-transparent text-muted hover:bg-surface-2 hover:text-ink')
        )}
      >
        <PanelRightOpen size={13} />
        <span className="hidden sm:inline">Workspace</span>
        {liveCrew > 0 ? (
          <span className="flex items-center gap-1 text-[length:var(--text-micro)] text-accent">
            <span className="breathing h-1 w-1 rounded-full bg-accent" />
            {liveCrew}
          </span>
        ) : task.artifacts.length > 0 ? (
          <span className="rounded-full bg-accent-soft px-1.5 text-[length:var(--text-micro)] text-accent-ink">
            {task.artifacts.length}
          </span>
        ) : null}
      </button>

      <Popover
        align="right"
        side="bottom"
        trigger={(props) => (
          <IconButton {...props} aria-label="Task menu">
            <MoreHorizontal size={14} />
          </IconButton>
        )}
      >
        {(close) => (
          <div className="w-[230px]">
            <div className="border-b border-line px-2 py-2">
              <RolePicker
                value={task.agentRole ?? 'executor'}
                onChange={(agentRole) => void updateCurrent({ agentRole })}
              />
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
              disabled={isCompacting || !canCompact}
              onClick={() => {
                close()
                void handleCompact()
              }}
            >
              <Minimize2 size={13} />
              Compact context
            </button>
            <button
              className="menu-item"
              onClick={() => {
                close()
                setTitleDraft(task.title)
                setIsEditingTitle(true)
              }}
            >
              <Pencil size={13} />
              Rename chat
            </button>
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
                void (async () => {
                  const confirmed = await confirmDialog({
                    title: 'Delete this task?',
                    body: 'The transcript and the files it wrote into the task workspace go with it. This cannot be undone.',
                    confirmLabel: 'Delete task',
                    danger: true
                  })
                  if (confirmed) await deleteTask(task.id)
                })()
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
  const openPanelTab = useApp((state) => state.openPanelTab)
  const panelTab = useApp((state) => state.panelTab)
  const sendToCurrent = useApp((state) => state.sendToCurrent)
  const reactToMessage = useApp((state) => state.reactToMessage)
  const rateMessage = useApp((state) => state.rateMessage)
  const editMessage = useApp((state) => state.editMessage)
  const stopCurrent = useApp((state) => state.stopCurrent)
  const resumeCurrent = useApp((state) => state.resumeCurrent)
  const updateCurrent = useApp((state) => state.updateCurrent)
  const addFolderToCurrent = useApp((state) => state.addFolderToCurrent)
  const openSettings = useApp((state) => state.openSettings)

  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<AttachmentRef[]>([])
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<string>('')
  const [isSavingEdit, setIsSavingEdit] = useState(false)

  useEffect(() => {
    if (task?.mode) {
      setModeTheme(task.mode === 'cowork' ? 'cowork' : 'chat')
    }
  }, [task?.id, task?.mode])

  const handleStartEdit = (msg: ChatMessage) => {
    setEditingMessageId(msg.id)
    setEditDraft(msg.content)
  }

  const handleSaveEdit = async (messageId: string) => {
    if (!editDraft.trim() || isSavingEdit) return
    setIsSavingEdit(true)
    try {
      await editMessage(messageId, editDraft.trim())
      setEditingMessageId(null)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setIsSavingEdit(false)
    }
  }

  const handleCancelEdit = () => {
    setEditingMessageId(null)
    setEditDraft('')
  }

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
          <div className="mx-auto w-full max-w-[860px] px-8 pt-6 pb-8">
            <ActionNodeCard task={task} />
            {/* The plan is the work surface, so it belongs to Cowork. A Chat task
                stays a conversation. */}
            {task.mode === 'cowork' ? <PlanCard plan={task.plan} live={running} /> : null}

            {visible.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div
                  className={cn(
                    'flex h-11 w-11 items-center justify-center rounded-[var(--r-card)] bg-surface text-accent',
                    Elev.raised
                  )}
                >
                  <BrandMark size={19} />
                </div>
                <p className="mt-3 text-[13px] font-medium">Getting ready</p>
                {task.objective ? (
                  <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-faint">{task.objective}</p>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-6">
              {visible.map((message, index) => {
                if (message.isCompacted) {
                  return <CompactedContextCard key={message.id} message={message} />
                }

                if (message.role === 'user') {
                  const isEditing = editingMessageId === message.id
                  return (
                    <div key={message.id} className="message-in group/msg flex flex-col items-end">
                      <div
                        className={cn(
                          'max-w-[85%] sm:max-w-[80%] bg-surface-2 px-4 py-3 transition-all',
                          /* Deliberate break from the radius scale: the bubble
                           * takes --r-composer so it matches the box it was
                           * typed in, and only the tail corner tightens, which
                           * is what says "spoken by you". */
                          Elev.hairline,
                          'rounded-[var(--r-composer)] rounded-br-md'
                        )}
                      >
                        {isEditing ? (
                          <div className="flex min-w-[280px] sm:min-w-[420px] flex-col gap-3">
                            <textarea
                              value={editDraft}
                              onChange={(e) => setEditDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                  e.preventDefault()
                                  void handleSaveEdit(message.id)
                                } else if (e.key === 'Escape') {
                                  e.preventDefault()
                                  handleCancelEdit()
                                }
                              }}
                              autoFocus
                              rows={Math.min(8, Math.max(2, editDraft.split('\n').length))}
                              aria-label="Edit your message"
                              className={cn(
                                'w-full resize-none rounded-lg bg-canvas px-3 py-2 text-[13px] leading-relaxed text-ink outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/40',
                                Elev.hairline
                              )}
                              placeholder="Edit your message..."
                            />
                            <div className="flex items-center justify-between text-[11px] text-faint">
                              <span>Ctrl+Enter to save & retry · Esc to cancel</span>
                              <div className="flex items-center gap-1.5">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={handleCancelEdit}
                                  disabled={isSavingEdit}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => void handleSaveEdit(message.id)}
                                  disabled={isSavingEdit || !editDraft.trim()}
                                >
                                  {isSavingEdit ? (
                                    <>
                                      <Loader2 size={11} className="animate-spin" />
                                      Saving
                                    </>
                                  ) : (
                                    'Save & Retry'
                                  )}
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <>
                            {message.content ? (
                              <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink">
                                {message.content}
                              </p>
                            ) : null}
                            <AttachmentChips message={message} />
                          </>
                        )}
                      </div>

                      {!isEditing && (
                        <div className="flex items-center gap-1 mt-1 opacity-80 group-hover/msg:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => handleStartEdit(message)}
                            title="Edit message"
                            aria-label="Edit this message"
                            className="inline-flex items-center gap-1 text-[11px] text-faint hover:text-ink px-1.5 py-0.5 rounded hover:bg-surface-2 transition-colors cursor-pointer"
                          >
                            <Pencil size={11} />
                            <span>Edit</span>
                          </button>
                          <ReactionPicker
                            message={message}
                            align="right"
                            onReact={(emoji) => reactToMessage(message.id, emoji)}
                          />
                        </div>
                      )}
                    </div>
                  )
                }

                if (message.role !== 'assistant') return null

                const steps = task.steps.filter((step) => step.messageId === message.id)
                const isLast = index === visible.length - 1
                const messageText = (message.content || '').toLowerCase()
                const stepText = steps
                  .map((s) => `${s.output ?? ''} ${JSON.stringify(s.args ?? '')}`)
                  .join(' ')
                  .toLowerCase()

                const directArtifacts = task.artifacts.filter((artifact) => artifact.messageId === message.id)
                const stepArtifacts = task.artifacts.filter((artifact) => {
                  if (artifact.messageId === message.id) return false
                  const name = artifact.name.toLowerCase()
                  return stepText.includes(name) || stepText.includes(artifact.relPath.toLowerCase())
                })
                const mentionedArtifacts = task.artifacts.filter((artifact) => {
                  if (artifact.messageId === message.id) return false
                  const name = artifact.name.toLowerCase()
                  return messageText.includes(name) || messageText.includes(artifact.relPath.toLowerCase())
                })
                const unanchored = isLast ? task.artifacts.filter((artifact) => !artifact.messageId) : []

                const delivered = [
                  ...directArtifacts,
                  ...stepArtifacts,
                  ...mentionedArtifacts,
                  ...unanchored
                ].filter((item, idx, arr) => arr.findIndex((x) => x.id === item.id) === idx)
                const streaming =
                  isLast &&
                  running &&
                  !message.toolCalls?.length &&
                  lastVisible?.role === 'assistant'

                const failed = Boolean(message.error)

                return (
                  <div key={message.id} aria-busy={streaming} className="message-in flex gap-3">
                    <div
                      className={cn(
                        'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-surface',
                        failed ? 'border border-danger/40 text-danger' : cn(Elev.hairline, 'text-accent')
                      )}
                    >
                      <BrandMark size={12} />
                    </div>
                    <div className="min-w-0 flex-1 pt-0.5">
                      {/* Two states live on this line alone, and they are the two
                          that must never be confused: an answer arriving wears the
                          accent and breathes, a finished answer is quiet. */}
                      <p
                        className={cn(
                          'mb-2 flex items-center gap-1.5 text-[length:var(--text-micro)] font-medium',
                          streaming ? 'text-accent-ink' : 'text-muted'
                        )}
                      >
                        {agentName()}
                        {streaming ? (
                          <span className="breathing h-1 w-1 rounded-full bg-accent" aria-hidden />
                        ) : null}
                      </p>
                      <WorkTrail
                        thinking={message.thinking}
                        steps={steps}
                        live={running && isLast}
                        taskId={task.id}
                        taskStatus={isLast ? task.status : undefined}
                        responding={Boolean(message.content)}
                      />
                      {message.content ? (
                        <Markdown content={message.content} streaming={streaming} />
                      ) : null}
                      {failed ? (
                        <div
                          role="alert"
                          className={cn(
                            'mt-3 flex items-center gap-2 rounded-[var(--r-card)] bg-danger/5 px-4 py-3 text-[12px] font-medium text-danger',
                            ElevShadow.raised,
                            'border border-danger/30'
                          )}
                        >
                          <Icon name="alert" size="md" />
                          Response interrupted
                        </div>
                      ) : null}
                      {delivered.length ? (
                        <div className="mt-3.5 space-y-2">
                          <p className="flex items-center gap-1.5 text-[length:var(--text-micro)] font-semibold tracking-[0.1em] text-faint uppercase">
                            <Icon name="folderOpen" size="xs" />
                            Deliverables & Documents
                          </p>
                          <div className="flex flex-col gap-2">
                            {delivered.map((artifact) => (
                              <InlineArtifactCard key={artifact.id} artifact={artifact} taskId={task.id} />
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {!streaming ? (
                        <div className="mt-2 flex items-center gap-1">
                          <CopyMessage text={message.content} />
                          <MessageFeedback
                            value={message.feedback?.vote}
                            note={message.feedback?.note}
                            onVote={(vote, reason) => void rateMessage(message.id, vote, reason)}
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Fallback for any deliverables not rendered inside message turns */}
            {!running &&
            task.artifacts.some(
              (artifact) =>
                !visible.some((m) => {
                  const mText = (m.content || '').toLowerCase()
                  return m.id === artifact.messageId || mText.includes(artifact.name.toLowerCase())
                })
            ) ? (
              <div className={cn('mt-8 rounded-[var(--r-card)] bg-surface p-4', Elev.raised)}>
                <p className="mb-2 flex items-center gap-1.5 text-[length:var(--text-micro)] font-semibold tracking-[0.13em] text-faint uppercase">
                  <Icon name="folderOpen" size="xs" />
                  Delivered files
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {task.artifacts
                    .filter((artifact) => !artifact.messageId)
                    .map((artifact) => (
                      <ArtifactChip key={artifact.id} artifact={artifact} taskId={task.id} />
                    ))}
                </div>
              </div>
            ) : null}

            <TaskChanges taskId={task.id} running={running} />

            <OversightPanel task={task} />

            {!running && task.status === 'done' ? (
              <div className="mt-6 flex items-center justify-center gap-1.5 text-[length:var(--text-micro)] text-faint">
                <Icon name="confirm" size="xs" className="text-positive" />
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

        <div className="shrink-0 border-t border-line bg-canvas px-8 pt-3 pb-5">
          <div className="mx-auto w-full max-w-[860px]">
            {task.error ? (
              <TaskErrorBanner
                error={task.error}
                onRetry={() => void resumeCurrent()}
                onOpenSettings={() => openSettings('providers')}
              />
            ) : null}

            {task.status === 'paused' ? (
              <div className={cn('mb-3 flex items-center gap-2 rounded-[var(--r-card)] bg-surface px-4 py-3', Elev.raised)}>
                <Icon name="pause" size="md" className="text-muted" />
                <p className="flex-1 text-[12px] text-muted">Paused</p>
                <button
                  onClick={() => void resumeCurrent()}
                  className="whitespace-nowrap text-[11px] font-medium text-accent underline underline-offset-2"
                >
                  Resume
                </button>
              </div>
            ) : null}

            {task.status === 'waiting' && approval?.taskId !== task.id ? (
              <div
                role="status"
                className={cn(
                  'mb-3 flex items-center gap-2 rounded-[var(--r-card)] bg-warn/5 px-4 py-3 text-[12px] text-warn',
                  ElevShadow.raised,
                  'border border-warn/30'
                )}
              >
                <Circle size={8} className="fill-current animate-pulse" />
                Waiting for your approval
              </div>
            ) : null}

            <CaptainComposer
              draft={text}
              onDraftChange={setText}
              attachments={attachments}
              onAttachmentsChange={setAttachments}
              permissionMode={task.permissionMode}
              mode={task.mode}
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
            aria-hidden="true"
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
