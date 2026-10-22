import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  ArrowUp,
  Check,
  ChevronDown,
  Cpu,
  FileText,
  Folder,
  FolderPlus,
  MessageCircle,
  Paperclip,
  Shield,
  CheckCheck,
  Square,
  X,
  Zap
} from 'lucide-react'
import { BrandMark } from './BrandMark'
import { toast } from 'sonner'
import type { AttachmentRef, PermissionMode, TaskMode } from '@shared/types'
import { useApp } from '../store'
import { cn, errorMessage, folderName, formatBytes } from '../lib/utils'
import { IconButton, Popover, Segmented, Spin } from './ui'

interface ComposerProps {
  mode: TaskMode
  onModeChange?: (mode: TaskMode) => void
  allowModeSwitch?: boolean
  text: string
  onTextChange: (text: string) => void
  attachments: AttachmentRef[]
  onAttachmentsChange: (attachments: AttachmentRef[]) => void
  folders: string[]
  onAddFolder: () => void | Promise<void>
  onRemoveFolder?: (folder: string) => void
  permissionMode: PermissionMode
  onPermissionChange: (mode: PermissionMode) => void
  providerId?: string
  model?: string
  onModelChange: (providerId: string, model: string) => void
  onSubmit: () => void | Promise<void>
  submitting?: boolean
  running?: boolean
  onStop?: () => void
  placeholder?: string
  autoFocus?: boolean
  variant?: 'home' | 'task'
}

const PERMISSIONS: {
  value: PermissionMode
  label: string
  icon: typeof Shield
  description: string
}[] = [
  {
    value: 'manual',
    label: 'Manual',
    icon: Shield,
    description: 'SelfImpulse asks before actions that change files or run commands.'
  },
  {
    value: 'auto',
    label: 'Auto',
    icon: Zap,
    description: 'Routine work runs freely. High-risk actions still need approval.'
  },
  {
    value: 'skip',
    label: 'Integrated acceptance',
    icon: CheckCheck,
    description: 'Accepts every step in this task without asking.'
  }
]

export function Composer({
  mode,
  onModeChange,
  allowModeSwitch = true,
  text,
  onTextChange,
  attachments,
  onAttachmentsChange,
  folders,
  onAddFolder,
  onRemoveFolder,
  permissionMode,
  onPermissionChange,
  providerId,
  model,
  onModelChange,
  onSubmit,
  submitting,
  running,
  onStop,
  placeholder,
  autoFocus,
  variant = 'home'
}: ComposerProps) {
  const settings = useApp((state) => state.settings)
  const openSettings = useApp((state) => state.openSettings)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [picking, setPicking] = useState(false)

  const providers = (settings?.providers ?? []).filter(
    (provider) => provider.enabled && provider.models.length > 0
  )
  const activeProvider =
    providers.find((provider) => provider.id === providerId) ??
    providers.find((provider) => provider.id === settings?.defaultProviderId) ??
    providers[0]
  const activeModel =
    model ||
    (activeProvider?.id === settings?.defaultProviderId ? settings?.defaultModel : undefined) ||
    activeProvider?.models[0] ||
    ''
  const permission = PERMISSIONS.find((item) => item.value === permissionMode) ?? PERMISSIONS[0]
  const PermissionIcon = permission.icon

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, variant === 'home' ? 64 : 48), 220)}px`
  }, [text, variant])

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus()
  }, [autoFocus])

  const canSend = Boolean(text.trim() || attachments.length) && !submitting

  const submit = (): void => {
    if (!canSend) return
    void onSubmit()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  const pickAttachments = async (): Promise<void> => {
    try {
      const files = await window.knight.pickFiles()
      if (files.length) onAttachmentsChange([...attachments, ...files])
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const addFolder = async (): Promise<void> => {
    setPicking(true)
    try {
      await onAddFolder()
    } finally {
      setPicking(false)
    }
  }

  return (
    <div className="w-full">
      <div
        className={cn(
          'composer-shadow rounded-[22px] border border-line bg-surface transition-colors',
          'focus-within:border-line-strong'
        )}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            placeholder ??
            (running
              ? 'Add instructions to steer this task…'
              : mode === 'cowork'
                ? 'Describe an outcome. SelfImpulse will plan it and do the work…'
                : 'Ask a question or think something through…')
          }
          rows={1}
          className="scroll-thin block w-full resize-none overflow-y-auto bg-transparent px-4.5 pt-4 pb-1 text-[14.5px] leading-relaxed text-ink outline-none placeholder:text-faint"
        />

        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 px-3.5 pt-2">
            {attachments.map((file) => (
              <span
                key={file.id}
                className="inline-flex max-w-[220px] items-center gap-1.5 rounded-lg border border-line bg-canvas py-1 pr-1.5 pl-2 text-[11.5px] text-muted"
                title={file.path}
              >
                <FileText size={12} className="shrink-0 text-accent" />
                <span className="truncate">{file.name}</span>
                {file.size ? (
                  <span className="shrink-0 text-[10px] text-faint">{formatBytes(file.size)}</span>
                ) : null}
                <button
                  onClick={() =>
                    onAttachmentsChange(attachments.filter((item) => item.id !== file.id))
                  }
                  className="rounded p-0.5 text-faint hover:bg-surface-2 hover:text-ink"
                  aria-label={`Remove ${file.name}`}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5 px-2.5 pt-2 pb-2.5">
          {allowModeSwitch && onModeChange ? (
            <>
              <Segmented
                value={mode}
                onChange={onModeChange}
                size="sm"
                options={[
                  {
                    value: 'chat',
                    label: (
                      <>
                        <MessageCircle size={11} />
                        Chat
                      </>
                    ),
                    hint: 'Research and answer without editing files'
                  },
                  {
                    value: 'cowork',
                    label: (
                      <>
                        <BrandMark size={11} />
                        Cowork
                      </>
                    ),
                    hint: 'Plan and complete work, creating real files'
                  }
                ]}
              />
              <span className="mx-0.5 h-4 w-px bg-line" />
            </>
          ) : null}

          <IconButton
            onClick={() => void pickAttachments()}
            title="Attach files"
            aria-label="Attach files"
            className="h-7 w-7"
          >
            <Paperclip size={14} />
          </IconButton>

          <Popover
            side="top"
            align="left"
            trigger={(props) => (
              <button
                {...props}
                className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[11.5px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                title="Working folders"
              >
                <Folder size={13} />
                <span className="max-w-[110px] truncate">
                  {picking
                    ? 'Choosing…'
                    : folders.length
                      ? folderName(folders[0])
                      : 'Add folder'}
                </span>
                {folders.length > 1 ? (
                  <span className="text-[10px] text-faint">+{folders.length - 1}</span>
                ) : null}
              </button>
            )}
          >
            {(close) => (
              <div className="w-[292px]">
                <div className="px-2 py-1 text-[10px] font-semibold tracking-[0.12em] text-faint uppercase">
                  Working folders
                </div>
                {folders.length === 0 ? (
                  <div className="px-2 pt-1 pb-2 text-[12px] leading-relaxed text-muted">
                    Without a folder, SelfImpulse works in an isolated task workspace. Add a folder to
                    work on your own files.
                  </div>
                ) : (
                  <div className="max-h-52 overflow-y-auto">
                    {folders.map((folder) => (
                      <div
                        key={folder}
                        className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2"
                        title={folder}
                      >
                        <Folder size={13} className="shrink-0 text-accent" />
                        <span className="min-w-0 flex-1 truncate text-[12px]">{folder}</span>
                        {onRemoveFolder ? (
                          <button
                            onClick={() => onRemoveFolder(folder)}
                            className="rounded p-0.5 text-faint opacity-0 group-hover:opacity-100 hover:text-danger"
                            aria-label={`Remove ${folder}`}
                          >
                            <X size={12} />
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => {
                    close()
                    void addFolder()
                  }}
                  className="menu-item mt-1 border border-line border-dashed text-[12px] text-muted"
                >
                  <FolderPlus size={13} />
                  Add a folder
                </button>
              </div>
            )}
          </Popover>

          <Popover
            side="top"
            align="left"
            trigger={(props) => (
              <button
                {...props}
                className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[11.5px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                title={`Permissions: ${permission.label}`}
              >
                <PermissionIcon size={13} />
                <span className="hidden sm:inline">{permission.label}</span>
              </button>
            )}
          >
            {(close) => (
              <div className="w-[288px]">
                <div className="px-2 py-1 text-[10px] font-semibold tracking-[0.12em] text-faint uppercase">
                  Permissions
                </div>
                {PERMISSIONS.map((option) => {
                  const Icon = option.icon
                  return (
                    <button
                      key={option.value}
                      onClick={() => {
                        onPermissionChange(option.value)
                        close()
                      }}
                      className="menu-item items-start py-2"
                    >
                      <Icon size={14} className="mt-0.5 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-[12.5px] font-medium">
                          {option.label}
                          {permissionMode === option.value ? (
                            <Check size={12} className="text-accent" />
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                          {option.description}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </Popover>

          <div className="ml-auto flex items-center gap-1.5">
            <Popover
              side="top"
              align="right"
              trigger={(props) => (
                <button
                  {...props}
                  className="flex h-7 max-w-[190px] items-center gap-1.5 rounded-lg px-2 text-[11.5px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                  title="Model"
                >
                  <Cpu size={13} />
                  <span className="truncate">{activeModel || 'Choose model'}</span>
                  <ChevronDown size={11} className="shrink-0 text-faint" />
                </button>
              )}
            >
              {(close) => (
                <div className="scroll-thin max-h-[320px] w-[286px] overflow-y-auto">
                  <div className="px-2 py-1 text-[10px] font-semibold tracking-[0.12em] text-faint uppercase">
                    Model
                  </div>
                  {providers.length === 0 ? (
                    <div className="px-2 pb-2 text-[12px] leading-relaxed text-muted">
                      No models are configured yet.
                    </div>
                  ) : (
                    providers.map((provider) => (
                      <div key={provider.id} className="mb-1">
                        <div className="px-2 pt-1.5 pb-1 text-[10px] font-medium text-faint">
                          {provider.name}
                        </div>
                        {provider.models.map((item) => {
                          const selected = activeProvider?.id === provider.id && activeModel === item
                          return (
                            <button
                              key={`${provider.id}-${item}`}
                              onClick={() => {
                                onModelChange(provider.id, item)
                                close()
                              }}
                              className="menu-item"
                              data-active={selected}
                            >
                              <span className="min-w-0 flex-1 truncate text-[12px]">{item}</span>
                              {selected ? <Check size={12} className="text-accent" /> : null}
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

            {running && onStop ? (
              <button
                onClick={onStop}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface-2 text-ink transition-colors hover:border-line-strong"
                title="Stop task"
                aria-label="Stop task"
              >
                <Square size={11} className="fill-current" />
              </button>
            ) : null}

            <button
              onClick={submit}
              disabled={!canSend}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full transition-all',
                canSend
                  ? 'bg-ink-button text-on-ink hover:opacity-90'
                  : 'bg-surface-2 text-faint'
              )}
              title={running ? 'Send instructions' : 'Send'}
              aria-label="Send message"
            >
              {submitting ? <Spin size={14} /> : <ArrowUp size={15} strokeWidth={2.2} />}
            </button>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between px-2 text-[10.5px] text-faint">
        <span>
          <span className="font-medium text-muted">Enter</span> to send ·{' '}
          <span className="font-medium text-muted">Shift + Enter</span> for a new line
        </span>
        {running ? (
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-accent breathing" />
            SelfImpulse is working
          </span>
        ) : null}
      </div>
    </div>
  )
}
