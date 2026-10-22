import { useEffect, useRef, useState } from 'react'
import {
  ArrowUp,
  Check,
  CheckCheck,
  ChevronDown,
  Cpu,
  FileText,
  Folder,
  Paperclip,
  Plus,
  ShieldCheck,
  Sparkles,
  Square,
  X,
  Zap
} from 'lucide-react'
import { toast } from 'sonner'
import type { AttachmentRef, PermissionMode } from '@shared/types'
import { useApp } from '../../store'
import { cn, errorMessage, folderName, formatBytes } from '../../lib/utils'
import { PERMISSION_CHOICES, type ComposerModelState } from '../../lib/composerChoices'
import { IconButton, Popover } from '../../components/ui'

function permissionIcon(mode: PermissionMode): typeof ShieldCheck {
  return mode === 'manual' ? ShieldCheck : mode === 'auto' ? Zap : CheckCheck
}

export function CaptainComposer({
  draft,
  onDraftChange,
  attachments,
  onAttachmentsChange,
  permissionMode,
  onPermissionChange,
  model,
  onModelChange,
  workspace,
  onChooseWorkspace,
  onClearWorkspace,
  onSubmit,
  placeholder = 'Ask Captain…',
  busy = false,
  running = false,
  autoFocus = false,
  onStop,
  className
}: {
  draft: string
  onDraftChange: (value: string) => void
  attachments: AttachmentRef[]
  onAttachmentsChange: (value: AttachmentRef[]) => void
  permissionMode: PermissionMode
  onPermissionChange: (value: PermissionMode) => void
  model: ComposerModelState
  onModelChange: (value: ComposerModelState) => void
  workspace?: string | null
  onChooseWorkspace?: () => void | Promise<void>
  onClearWorkspace?: () => void
  onSubmit: () => void | Promise<void>
  placeholder?: string
  busy?: boolean
  running?: boolean
  autoFocus?: boolean
  onStop?: () => void
  className?: string
}) {
  const settings = useApp((state) => state.settings)
  const openSettings = useApp((state) => state.openSettings)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [pickingFiles, setPickingFiles] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [pulse, setPulse] = useState(0)

  const providers = (settings?.providers ?? []).filter(
    (provider) => provider.enabled && provider.models.length > 0
  )
  const permission = PERMISSION_CHOICES.find((item) => item.value === permissionMode) ?? PERMISSION_CHOICES[0]
  const PermissionIcon = permissionIcon(permissionMode)
  const canSend = Boolean(draft.trim() || attachments.length) && !busy && !submitting

  useEffect(() => {
    if (!autoFocus) return
    textareaRef.current?.focus()
  }, [autoFocus])

  useEffect(() => {
    const focus = (): void => {
      textareaRef.current?.focus()
    }
    window.addEventListener('knight:focus-composer', focus)
    return () => window.removeEventListener('knight:focus-composer', focus)
  }, [])

  const submit = async (): Promise<void> => {
    if (!canSend) return
    setSubmitting(true)
    try {
      await onSubmit()
    } finally {
      setSubmitting(false)
    }
  }

  const pickFiles = async (): Promise<void> => {
    setPickingFiles(true)
    try {
      const files = await window.knight.pickFiles()
      if (files.length) onAttachmentsChange([...attachments, ...files])
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setPickingFiles(false)
    }
  }

  return (
    <div className={cn('w-full', className)}>
      <div className="rounded-xl border border-line bg-surface px-3 pt-2.5 pb-2 shadow-[0_32px_64px_-32px_rgba(0,0,0,0.9)] transition-all focus-within:border-line-strong focus-within:shadow-[0_32px_64px_-32px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.01)]">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void submit()
            }
          }}
          rows={2}
          placeholder={placeholder}
          className="scroll-thin block min-h-[58px] w-full resize-none bg-transparent px-0.5 py-1 text-[14px] leading-[1.6] text-ink outline-none placeholder:text-faint"
        />

        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-1 pb-1.5">
            {attachments.map((file) => (
              <span
                key={file.id}
                title={file.path}
                className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md border border-line bg-canvas px-2 py-1 text-[11px] text-muted"
              >
                <FileText size={11} className="shrink-0 text-accent" />
                <span className="truncate">{file.name}</span>
                {file.size ? <span className="text-[9.5px] text-faint">{formatBytes(file.size)}</span> : null}
                <button
                  onClick={() =>
                    onAttachmentsChange(attachments.filter((item) => item.id !== file.id))
                  }
                  className="rounded p-0.5 text-faint hover:text-ink"
                  aria-label={`Remove ${file.name}`}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="flex items-center gap-1.5 pt-1.5">
          <Popover
            side="top"
            align="left"
            panelClassName="w-[274px]"
            trigger={(props) => (
              <button
                {...props}
                title="Workspace and files"
                aria-label="Workspace and files"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-muted transition-colors hover:border-line-strong hover:text-ink"
              >
                <Plus size={14} />
              </button>
            )}
          >
            {(close) => (
              <div>
                <p className="px-2 py-1 text-[9.5px] font-semibold tracking-[0.13em] text-faint uppercase">
                  Workspace
                </p>
                <button
                  className="menu-item text-[12px]"
                  onClick={() => {
                    close()
                    void onChooseWorkspace?.()
                  }}
                >
                  <Folder size={13} />
                  <span className="min-w-0 flex-1 truncate">
                    {workspace ? 'Change workspace…' : 'Choose workspace (optional)'}
                  </span>
                </button>
                {workspace ? (
                  <button
                    className="menu-item text-[12px]"
                    onClick={() => {
                      close()
                      onClearWorkspace?.()
                    }}
                  >
                    <X size={13} />
                    Clear workspace
                  </button>
                ) : null}
                <div className="my-1 h-px bg-line" />
                <button
                  className="menu-item text-[12px]"
                  onClick={() => {
                    close()
                    void pickFiles()
                  }}
                >
                  <Paperclip size={13} />
                  Attach files
                </button>
              </div>
            )}
          </Popover>

          <IconButton
            onClick={() => void pickFiles()}
            disabled={pickingFiles}
            title="Attach files"
            aria-label="Attach files"
            className="h-8 w-8"
          >
            <Paperclip size={14} />
          </IconButton>

          <Popover
            side="top"
            align="left"
            panelClassName="w-[290px]"
            trigger={(props) => (
              <button
                {...props}
                title={`Permissions: ${permission.label}`}
                className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-muted transition-colors hover:bg-surface-3 hover:text-ink"
              >
                <PermissionIcon size={13} />
                <span>{permission.label}</span>
                <ChevronDown size={10} className="text-faint" />
              </button>
            )}
          >
            {(close) => (
              <div>
                <p className="px-2 py-1 text-[10.5px] font-medium text-faint">Permissions</p>
                {PERMISSION_CHOICES.map((choice) => {
                  const Icon = permissionIcon(choice.value)
                  return (
                    <button
                      key={choice.value}
                      onClick={() => {
                        onPermissionChange(choice.value)
                        close()
                      }}
                      className="menu-item items-start py-2"
                    >
                      <Icon size={13} className="mt-0.5 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-[12px] font-medium">
                          {choice.label}
                          {permissionMode === choice.value ? (
                            <Check size={11} className="text-accent" />
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-[10.5px] leading-relaxed text-muted">
                          {choice.blurb}
                        </span>
                      </span>
                    </button>
                  )
                })}
                <p className="mt-1 border-t border-line px-2 pt-2 pb-1 text-[10px] leading-relaxed text-faint">
                  Table's two-key gates ignore this setting.
                </p>
              </div>
            )}
          </Popover>

          <div className="ml-auto flex min-w-0 items-center gap-1.5">
            <Popover
              side="top"
              align="right"
              panelClassName="w-[290px]"
              trigger={(props) => (
                <button
                  {...props}
                  title="Model"
                  className="flex h-8 max-w-[220px] items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-muted transition-colors hover:bg-surface-3 hover:text-ink"
                >
                  <Sparkles size={12} className="shrink-0" />
                  <span className="truncate">{model.model || 'Choose a model'}</span>
                  <ChevronDown size={10} className="shrink-0 text-faint" />
                </button>
              )}
            >
              {(close) => (
                <div className="scroll-thin max-h-[320px] overflow-y-auto">
                  <div className="flex items-center justify-between px-2 py-1">
                    <span className="text-[9.5px] font-semibold tracking-[0.13em] text-faint uppercase">
                      Model
                    </span>
                    <span className="text-[9px] text-faint">
                      {providers.length === 0
                        ? 'None configured'
                        : `${providers.length} provider${providers.length === 1 ? '' : 's'}`}
                    </span>
                  </div>
                  {providers.length === 0 ? (
                    <div className="px-2 pt-1 pb-2 text-[11.5px] leading-relaxed text-muted">
                      Connect a provider to choose a model.
                    </div>
                  ) : (
                    providers.map((provider) => (
                      <div key={provider.id} className="mb-1">
                        <div className="px-2 pt-1.5 pb-1 text-[9.5px] font-medium text-faint">
                          {provider.name}
                        </div>
                        {provider.models.map((item) => {
                          const selected = model.providerId === provider.id && model.model === item
                          return (
                            <button
                              key={`${provider.id}-${item}`}
                              onClick={() => {
                                onModelChange({
                                  providerId: provider.id,
                                  providerName: provider.name,
                                  model: item,
                                  models: provider.models
                                })
                                close()
                              }}
                              className="menu-item"
                              data-active={selected}
                            >
                              <span className="min-w-0 flex-1 truncate text-[12px]">{item}</span>
                              {selected ? <Check size={11} className="text-accent" /> : null}
                            </button>
                          )
                        })}
                      </div>
                    ))
                  )}
                  <div className="my-1 h-px bg-line" />
                  <button
                    onClick={() => {
                      close()
                      openSettings('providers')
                    }}
                    className="menu-item text-[12px] text-muted"
                  >
                    <Cpu size={13} />
                    Manage models…
                  </button>
                </div>
              )}
            </Popover>

            <button
              onClick={() => {
                if (running) {
                  onStop?.()
                  return
                }
                setPulse((value) => value + 1)
                void submit()
              }}
              disabled={!running && !canSend}
              aria-label={running ? 'Stop' : 'Send'}
              title={running ? 'Stop' : 'Send'}
              className={cn(
                'send-button relative ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-150',
                running
                  ? 'border border-line-strong bg-surface text-ink hover:bg-surface-2 active:scale-90'
                  : canSend
                    ? 'border border-white/10 bg-[#141416] text-white shadow-[0_10px_24px_-12px_rgba(0,0,0,0.65)] hover:scale-[1.04] active:scale-90'
                    : 'bg-surface-3 text-faint'
              )}
            >
              {pulse > 0 ? <span key={pulse} className="send-haptic" aria-hidden /> : null}
              {running ? (
                <Square size={8.5} fill="currentColor" />
              ) : (
                <ArrowUp size={15} strokeWidth={2.4} />
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-1.5 flex h-5 items-center justify-between gap-3 px-1 text-[11px] text-faint">
        <button
          onClick={() => void onChooseWorkspace?.()}
          className="flex min-w-0 items-center gap-1.5 transition-colors hover:text-muted"
          title={workspace ?? 'Choose a workspace'}
        >
          <Folder size={12} />
          <span className="truncate">{workspace ? folderName(workspace) : 'No workspace selected'}</span>
        </button>
        {providers.length ? (
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="h-1 w-1 rounded-full bg-positive" />
            Local engine ready
          </span>
        ) : (
          <button
            onClick={() => openSettings('providers')}
            className="flex shrink-0 items-center gap-1.5 font-medium text-warn transition-colors hover:text-ink"
          >
            <span className="h-1 w-1 rounded-full bg-warn" />
            Connect a model
          </button>
        )}
      </div>
    </div>
  )
}
