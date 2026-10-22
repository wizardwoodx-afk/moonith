import { useState } from 'react'
import {
  ArrowUpRight,
  CheckCircle2,
  ChessKnight,
  FileText,
  Presentation,
  ShieldCheck,
  Sparkles,
  Table2
} from 'lucide-react'
import type { AttachmentRef, PermissionMode, TaskMode } from '@shared/types'
import { useApp } from '../store'
import { cn, statusLabel, timeAgo } from '../lib/utils'
import { Composer } from '../components/Composer'
import { Button } from '../components/ui'

const SUGGESTIONS = [
  {
    icon: FileText,
    title: 'Write a research brief',
    description: 'Research the web and deliver a sourced .docx.',
    prompt:
      'Research the current AI productivity tool market. Identify five notable products, their positioning, and pricing, then create a concise sourced brief as a Word document.'
  },
  {
    icon: Presentation,
    title: 'Build a slide deck',
    description: 'Shape an idea into a polished .pptx.',
    prompt:
      'Create a crisp six-slide presentation introducing a plan to improve our team’s weekly reporting. Include a title slide, the problem, the approach, the rollout, and next steps. Export it as a PowerPoint file.'
  },
  {
    icon: Table2,
    title: 'Model a budget',
    description: 'Create a working .xlsx you can keep using.',
    prompt:
      'Create a practical monthly budget workbook with an assumptions sheet, a category budget, and a simple summary. Use realistic formulas and make it easy to edit.'
  }
]

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 5) return 'Still up?'
  if (hour < 12) return 'Good morning.'
  if (hour < 18) return 'Good afternoon.'
  return 'Good evening.'
}

export function Home() {
  const settings = useApp((state) => state.settings)
  const tasks = useApp((state) => state.tasks)
  const startTask = useApp((state) => state.startTask)
  const openTask = useApp((state) => state.openTask)
  const openSettings = useApp((state) => state.openSettings)

  const defaults = settings?.providers.filter((provider) => provider.enabled) ?? []
  const initialProvider =
    defaults.find((provider) => provider.id === settings?.defaultProviderId) ?? defaults[0]
  const initialModel =
    (initialProvider?.id === settings?.defaultProviderId ? settings?.defaultModel : undefined) ??
    initialProvider?.models[0] ??
    ''

  const [text, setText] = useState('')
  const [mode, setMode] = useState<TaskMode>('cowork')
  const [attachments, setAttachments] = useState<AttachmentRef[]>([])
  const [folders, setFolders] = useState<string[]>([])
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    settings?.defaultPermissionMode ?? 'manual'
  )
  const [providerId, setProviderId] = useState<string | undefined>(initialProvider?.id)
  const [model, setModel] = useState<string>(initialModel)
  const [submitting, setSubmitting] = useState(false)

  const noModel = !defaults.some((provider) => provider.models.length > 0)
  const recent = tasks.slice(0, 4)

  const submit = async (): Promise<void> => {
    if (!text.trim() && attachments.length === 0) return
    setSubmitting(true)
    try {
      await startTask({
        text: text.trim() || 'Take a look at the attached files.',
        mode,
        permissionMode,
        folders,
        attachments,
        providerId,
        model
      })
      setText('')
      setAttachments([])
    } catch {
      /* The store reports the error. */
    } finally {
      setSubmitting(false)
    }
  }

  const addFolder = async (): Promise<void> => {
    const folder = await window.knight.pickFolder()
    if (folder && !folders.includes(folder)) setFolders((current) => [...current, folder])
  }

  return (
    <div className="scroll-thin relative h-full overflow-y-auto">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-50"
        style={{
          background:
            'radial-gradient(ellipse 70% 100% at 50% 0%, var(--c-accent-soft) 0%, transparent 70%)'
        }}
      />
      <div className="relative mx-auto w-full max-w-[820px] px-8 pt-[9vh] pb-16">
        <div className="rise">
          <div className="mb-5 flex items-center gap-2.5 text-[11.5px] font-medium text-muted">
            <span className="flex h-7 w-7 items-center justify-center rounded-[9px] border border-line bg-surface/70 text-accent-ink">
              <ChessKnight size={14} />
            </span>
            {greeting()}
          </div>
          <h1 className="display max-w-[640px] text-[clamp(36px,4vw,50px)] leading-[1.06] font-normal text-ink">
            What should we <span className="italic text-accent">work</span> on?
          </h1>
          <p className="mt-3 max-w-[520px] text-[13.5px] leading-relaxed text-muted">
            Describe an outcome. Knight plans it, does the work with real tools, and leaves finished
            files in your folder.
          </p>
        </div>

        {noModel ? (
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-accent/25 bg-accent-soft/40 px-4 py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface text-accent">
              <Sparkles size={15} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-medium text-ink">Connect a model to get started</p>
              <p className="text-[11.5px] text-muted">
                Add a model endpoint in Settings.
              </p>
            </div>
            <Button variant="primary" size="sm" onClick={() => openSettings('providers')}>
              Add provider
            </Button>
          </div>
        ) : null}

        <div className="mt-7">
          <Composer
            mode={mode}
            onModeChange={setMode}
            text={text}
            onTextChange={setText}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            folders={folders}
            onAddFolder={addFolder}
            onRemoveFolder={(folder) => setFolders((current) => current.filter((f) => f !== folder))}
            permissionMode={permissionMode}
            onPermissionChange={setPermissionMode}
            providerId={providerId}
            model={model}
            onModelChange={(nextProvider, nextModel) => {
              setProviderId(nextProvider)
              setModel(nextModel)
            }}
            onSubmit={submit}
            submitting={submitting}
            autoFocus
            variant="home"
          />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {SUGGESTIONS.map((suggestion) => {
            const Icon = suggestion.icon
            return (
              <button
                key={suggestion.title}
                onClick={() => setText(suggestion.prompt)}
                className="group rounded-xl border border-line bg-surface/55 p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-line-strong hover:bg-surface hover:shadow-[0_10px_30px_-24px_rgba(30,24,18,0.5)]"
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft/80 text-accent-ink">
                    <Icon size={14} />
                  </span>
                  <ArrowUpRight
                    size={13}
                    className="text-faint opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </div>
                <p className="mt-2.5 text-[12px] font-medium text-ink">{suggestion.title}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-faint">
                  {suggestion.description}
                </p>
              </button>
            )
          })}
        </div>

        {recent.length > 0 ? (
          <div className="mt-11">
            <div className="flex items-center justify-between pb-3">
              <h2 className="text-[11px] font-semibold tracking-[0.13em] text-faint uppercase">
                Pick up where you left off
              </h2>
              <span className="text-[10.5px] text-faint">{tasks.length} tasks</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {recent.map((task) => (
                <button
                  key={task.id}
                  onClick={() => void openTask(task.id)}
                  className={cn(
                    'group flex items-start gap-3 rounded-xl border border-line bg-surface/50 px-3.5 py-3 text-left transition-colors hover:bg-surface'
                  )}
                >
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
                    {task.status === 'done' ? (
                      <CheckCircle2 size={14} className="text-positive" />
                    ) : (
                      <ChessKnight size={14} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-ink">
                      {task.title}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-faint">
                      <span>{statusLabel(task.status)}</span>
                      <span>·</span>
                      <span>{timeAgo(task.updatedAt)}</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line/70 pt-4 text-[10.5px] text-faint">
          <span className="flex items-center gap-1.5">
            <ShieldCheck size={12} />
            Files stay local. Keys are encrypted on this device.
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-line px-1.5 py-0.5">Ctrl</kbd> +{' '}
            <kbd className="rounded border border-line px-1.5 py-0.5">N</kbd> for a new task
          </span>
        </div>
      </div>
    </div>
  )
}
