import { agentName } from '../../lib/localProfile'
import { useEffect, useRef, useState, type ClipboardEvent } from 'react'
import { motion } from 'framer-motion'
import { Check, CheckCheck, ListChecks, ShieldCheck, Zap } from 'lucide-react'
import { Icon } from '../../components/icons'
import { BrandMark } from '../../components/BrandMarks'
import { toast } from 'sonner'
import type { AttachmentRef, PermissionMode, TaskMode } from '@shared/types'
import { useApp } from '../../store'
import { cn, errorMessage, folderName } from '../../lib/utils'
import { PERMISSION_CHOICES, type ComposerModelState } from '../../lib/composerChoices'
import { Popover } from '../../components/ui'
import { ComposerAttachments, mergeAttachments } from '../../motion/ComposerAttachments'
import { ComposerDropzone } from '../../motion/ComposerDropzone'
import { ComposerSendButton } from '../../motion/ComposerSendButton'
import { useComposerCommands, type ComposerCommand } from '../../motion/ComposerCommands'
import { BounceLetters } from '../../motion/WorkRing'
import { ShimmerText } from '../../motion/ShimmerText'

function permissionIcon(mode: PermissionMode): typeof ShieldCheck {
  return mode === 'plan'
    ? ListChecks
    : mode === 'manual'
      ? ShieldCheck
      : mode === 'auto'
        ? Zap
        : CheckCheck
}

/**
 * `ClipboardEvent` hands a Print Screen grab to Blink as an image `File`, which
 * only exists in renderer memory. The sandboxed renderer has no fs, so the
 * bytes travel as base64 and the main process writes the file.
 */
function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('The clipboard image could not be read.'))
    reader.readAsDataURL(file)
  })
}

export function CaptainComposer({
  draft,
  onDraftChange,
  attachments,
  onAttachmentsChange,
  permissionMode,
  onPermissionChange,
  mode,
  onModeChange,
  model,
  onModelChange,
  workspace,
  onChooseWorkspace,
  onClearWorkspace,
  onSubmit,
  placeholder = mode === 'cowork' ? 'Collaborate on a task or outcome…' : 'Hand off a goal to your digital self…',
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
  mode?: TaskMode
  onModeChange?: (value: TaskMode) => void
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
  const currentTaskId = useApp((state) => state.currentTask?.id)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const [pulse, setPulse] = useState(0)
  const [coworkNoFolder, setCoworkNoFolder] = useState(false)
  const [capturing, setCapturing] = useState(false)

  const providers = (settings?.providers ?? []).filter(
    (provider) => provider.enabled && provider.models.length > 0
  )
  const permission = PERMISSION_CHOICES.find((item) => item.value === permissionMode) ?? PERMISSION_CHOICES[0]
  const fullAccess = PERMISSION_CHOICES.find((item) => item.value === 'skip') ?? PERMISSION_CHOICES[3]
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
    setPulse((value) => value + 1)
    setSubmitting(true)
    try {
      await onSubmit()
    } finally {
      setSubmitting(false)
    }
  }

  const pickFiles = async (): Promise<void> => {
    try {
      const files = await window.knight.pickFiles()
      if (files.length) onAttachmentsChange(mergeAttachments(attachments, files))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  /** Same `mergeAttachments` path a dropped or picked file takes, so a pasted
   *  screenshot is an ordinary attachment everywhere downstream. */
  const addAttachment = (file: AttachmentRef): void => {
    onAttachmentsChange(mergeAttachments(attachments, [file]))
  }

  const pasteImage = async (event: ClipboardEvent<HTMLTextAreaElement>): Promise<void> => {
    // Only a clipboard that actually carries an image is claimed. Plain text
    // paste, including Ctrl+Shift+V, is left completely untouched.
    const item = Array.from(event.clipboardData.items).find(
      (candidate) => candidate.kind === 'file' && candidate.type.startsWith('image/')
    )
    if (!item) return
    const file = item.getAsFile()
    if (!file || !file.size) return
    event.preventDefault()
    try {
      addAttachment(
        await window.knight.attachPastedImage({
          taskId: currentTaskId,
          mimeType: file.type || item.type,
          data: await readAsBase64(file)
        })
      )
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const captureScreen = async (): Promise<void> => {
    if (capturing) return
    setCapturing(true)
    try {
      addAttachment(await window.knight.captureScreen(currentTaskId))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setCapturing(false)
    }
  }

  const commandItems: ComposerCommand[] = [
    {
      id: 'captain-context-attach',
      kind: '@',
      label: 'Attach files',
      detail: 'Add real files to this message',
      icon: <Icon name="attach" size="md" />,
      run: () => void pickFiles()
    },
    ...(workspace
      ? [{
          id: 'captain-context-workspace',
          kind: '@' as const,
          label: folderName(workspace),
          detail: workspace,
          keywords: 'workspace folder context',
          icon: <Icon name="folder" size="md" />,
          insert: `${workspace} `
        }]
      : []),
    ...attachments.map((file) => ({
      id: `captain-context-file-${file.id}`,
      kind: '@' as const,
      label: file.name,
      detail: 'Attached to this message',
      keywords: 'attachment file context',
      icon: <Icon name="mention" size="md" />,
      insert: `${file.name} `
    })),
    ...(onChooseWorkspace
      ? [{
          id: 'captain-command-workspace',
          kind: '/' as const,
          label: workspace ? 'Change workspace' : 'Choose a workspace',
          icon: <Icon name="folder" size="md" />,
          run: () => void onChooseWorkspace()
        }]
      : []),
    {
      id: 'captain-command-rook-worker',
      kind: '/' as const,
      label: 'Run an autonomous job',
      detail: 'Long-running work that keeps going without step-by-step approvals',
      keywords: 'autonomous job agent build',
      icon: <Icon name="model" size="md" />,
      insert: 'Autonomous job: '
    },
    {
      id: 'captain-command-rook-yolo',
      kind: '/' as const,
      label: `Permissions: ${fullAccess.label}`,
      detail: fullAccess.blurb,
      keywords: 'permission approval mode',
      icon: <Icon name="quick" size="md" />,
      run: () => {
        void window.knight.rookSetPermission('yolo')
        onPermissionChange('skip')
      }
    },
    {
      id: 'captain-command-rook-research',
      kind: '/' as const,
      label: 'Research a topic',
      detail: 'Gather sources and write a brief with links',
      keywords: 'research report sources brief',
      icon: <Icon name="spark" size="md" />,
      insert: 'Research: in-depth report on '
    },
    {
      id: 'captain-command-rook-cr',
      kind: '/' as const,
      label: 'File a change request',
      detail: 'Make the changes and leave them ready for your review',
      keywords: 'cr git pull request changerequest gitops',
      icon: <Icon name="command" size="md" />,
      insert: 'Change request for '
    },
    {
      id: 'captain-command-promey-brief',
      kind: '/' as const,
      label: 'Daily brief',
      detail: 'Generate your proactive morning brief with triage items & approvals',
      keywords: 'brief morning daily summary executive promey',
      icon: <Icon name="spark" size="md" />,
      insert: 'Generate morning brief'
    },
    {
      id: 'captain-command-promey-triage',
      kind: '/' as const,
      label: 'Triage inbox & stream',
      detail: 'Sort priority tasks and surface items requiring your decision',
      keywords: 'triage inbox stream priority alerts promey',
      icon: <Icon name="command" size="md" />,
      insert: 'Triage inbox and prioritize tasks'
    },
    {
      id: 'captain-command-promey-duet',
      kind: '/' as const,
      label: 'Duet mode',
      detail: 'Proactive executive assistant co-steering and smart approvals',
      keywords: 'duet proactive copilot executive promey',
      icon: <Icon name="command" size="md" />,
      insert: 'Start duet session with Promey'
    },
    ...PERMISSION_CHOICES.map((choice) => ({
      id: `captain-command-permission-${choice.value}`,
      kind: '/' as const,
      label: `Permissions: ${choice.label}`,
      detail: choice.blurb,
      keywords: 'permission approval mode',
      icon: <Icon name="command" size="md" />,
      run: () => onPermissionChange(choice.value)
    })),
    ...providers.flatMap((provider) =>
      provider.models.map((item) => ({
        id: `captain-command-model-${provider.id}-${item}`,
        kind: '/' as const,
        label: item,
        detail: `Use ${provider.name} for this task`,
        keywords: `model provider ${provider.name}`,
        icon: <Icon name="model" size="md" />,
        run: () => onModelChange({
          providerId: provider.id,
          providerName: provider.name,
          model: item,
          models: provider.models
        })
      }))
    )
  ]
  const commands = useComposerCommands({
    textareaRef,
    text: draft,
    onTextChange: onDraftChange,
    items: commandItems
  })

  return (
    <ComposerDropzone
      onFiles={(incoming) => onAttachmentsChange(mergeAttachments(attachments, incoming))}
    >
      <div className={cn('w-full', className)}>
        <motion.div
          layout
          className="composer-shell relative px-3 pt-2.5 pb-2"
        >
          {commands.menu}
          <div className="flex items-start gap-2.5">
            {/* The head, not a name in the placeholder: Cowork wears the accent
                because it is the mode that touches files. */}
            <span
              aria-hidden
              className={cn(
                'mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border',
                mode === 'cowork'
                  ? 'border-accent/45 bg-accent-soft text-accent-ink'
                  : 'border-line bg-surface-2 text-muted'
              )}
            >
              <BrandMark size={12} />
            </span>
            <textarea
          ref={textareaRef}
          aria-label={`Message ${agentName()}`}
          value={draft}
          onChange={commands.onChange}
          onSelect={commands.onSelect}
          onPaste={(event) => void pasteImage(event)}
          onKeyDown={(event) => {
            if (commands.onKeyDown(event)) return
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void submit()
            }
          }}
          aria-autocomplete="list"
          aria-activedescendant={commands.activeId}
          rows={2}
          placeholder={placeholder}
          className="scroll-thin block min-h-[58px] w-full min-w-0 flex-1 resize-none bg-transparent px-0.5 py-1 text-[14px] leading-[1.6] text-ink outline-none placeholder:text-faint"
        />
          </div>

        <ComposerAttachments files={attachments} onChange={onAttachmentsChange} compact />

        <div className="flex items-center gap-1.5 pt-1.5">
          <Popover
            side="top"
            align="left"
            panelClassName="w-[274px]"
            trigger={(props) => (
              <button
                {...props}
                title="Attach files, capture the screen or choose a working folder"
                aria-label="Attach files, capture the screen or choose a working folder"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-muted transition-colors hover:border-line-strong hover:text-ink"
              >
                <Icon name="add" size="md" />
              </button>
            )}
          >
            {(close) => (
              <div>
                <p className="px-2 py-1 text-[10px] font-semibold tracking-[0.13em] text-faint uppercase">
                  Attachments
                </p>
                <button
                  className="menu-item text-[12px]"
                  onClick={() => {
                    close()
                    void pickFiles()
                  }}
                >
                  <Icon name="attach" size="md" />
                  <span className="min-w-0 flex-1 truncate">Attach files</span>
                </button>
                <button
                  className="menu-item text-[12px] disabled:pointer-events-none disabled:opacity-50"
                  disabled={capturing}
                  title="Add a picture of your screen to this message"
                  onClick={() => {
                    close()
                    void captureScreen()
                  }}
                >
                  <Icon name="capture" size="md" />
                  <span className="min-w-0 flex-1 truncate">
                    {capturing ? 'Capturing screen…' : 'Capture screen'}
                  </span>
                </button>
                <p className="px-2 py-1 text-[10px] font-semibold tracking-[0.13em] text-faint uppercase">
                  Workspace
                </p>
                <button
                  className="menu-item text-[12px]"
                  onClick={() => {
                    close()
                    void onChooseWorkspace?.()
                  }}
                >
                  <Icon name="folder" size="md" />
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
                    <Icon name="close" size="md" />
                    Clear workspace
                  </button>
                ) : null}
              </div>
            )}
          </Popover>

          {onModeChange ? (
            /* The mode sits with the tools that shape the task, not floating over
               the box: Assistant reads and answers, Cowork changes files. */
            <div
              className="flex h-8 shrink-0 items-center gap-0.5 rounded-full border border-line bg-canvas/60 p-0.5"
              title={
                mode === 'cowork'
                  ? 'Cowork mode: Interactive colleague pairing with live dual-ledger and shared tools.'
                  : 'Self mode: Autonomous digital twin running cyclical self-correcting loops to achieve outcomes.'
              }
            >
              {(['chat', 'cowork'] as TaskMode[]).map((value) => {
                const active = mode === value
                return (
                  <button
                    key={value}
                    onClick={() => {
                      onModeChange(value)
                      setCoworkNoFolder(value === 'cowork' && !workspace)
                    }}
                    aria-pressed={active}
                    className={cn(
                      'flex h-7 items-center gap-1 rounded-full px-2 text-[11px] font-medium transition-colors',
                      active
                        ? value === 'cowork'
                          ? 'bg-accent-soft text-accent-ink'
                          : 'bg-surface-3 text-ink'
                        : 'text-faint hover:text-muted'
                    )}
                  >
                    {value === 'cowork' ? <BrandMark size={10} /> : <Icon name="spark" size="xs" />}
                    {value === 'chat' ? 'Self' : 'Cowork'}
                  </button>
                )
              })}
            </div>
          ) : null}

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
                <Icon name="chevronDown" size="md" className="text-faint" />
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
                  Table approvals ignore this setting.
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
                  <Icon name="spark" size="md" />
                  <span className="min-w-0 truncate" title={model.model || 'Choose a model'}>{model.model || 'Choose a model'}</span>
                  <Icon name="chevronDown" size="md" className="text-faint" />
                </button>
              )}
            >
              {(close) => (
                <div className="scroll-thin max-h-[320px] overflow-y-auto">
                  <div className="flex items-center justify-between px-2 py-1">
                    <span className="text-[10px] font-semibold tracking-[0.13em] text-faint uppercase">
                      Model
                    </span>
                    <span className="text-[10px] text-faint">
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
                        <div className="px-2 pt-1.5 pb-1 text-[10px] font-medium text-faint">
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
                              <span className="min-w-0 flex-1 truncate text-[12px]" title={item}>{item}</span>
                              {selected ? <Icon name="confirm" size="md" className="text-accent" /> : null}
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
                    <Icon name="model" size="md" />
                    Manage models…
                  </button>
                </div>
              )}
            </Popover>

            <ComposerSendButton
              canSend={canSend}
              submitting={submitting || busy}
              running={running}
              pulse={pulse}
              onSubmit={() => void submit()}
              onStop={onStop}
            />
          </div>
        </div>

        {coworkNoFolder && mode === 'cowork' && !workspace ? (
          <div className="mx-3 mb-2 flex items-start gap-2 rounded-lg border border-warn/25 bg-warn/5 px-2.5 py-1.5">
            <Icon name="alert" size="xs" className="mt-0.5 text-warn" />
            <p className="min-w-0 flex-1 text-[10.5px] leading-relaxed text-warn">
              Pick a folder before Cowork writes files.
            </p>
            <button
              onClick={() => setCoworkNoFolder(false)}
              aria-label="Dismiss Cowork folder notice"
              className="shrink-0 text-faint transition-colors hover:text-ink"
            >
              <Icon name="close" size="xs" />
            </button>
          </div>
        ) : null}
        </motion.div>

        {running ? (
          <div className="mt-1.5 flex items-center gap-1.5 px-1 text-[11.5px] font-medium text-accent-ink">
            <span className="h-2 w-2 shrink-0 rounded-full bg-gradient-to-r from-sky-400 via-purple-400 to-pink-400 animate-pulse" />
            <BounceLetters text={agentName()} />
            <ShimmerText>is thinking & working…</ShimmerText>
          </div>
        ) : null}

      <div className="mt-1.5 flex h-5 items-center justify-between gap-3 px-1 text-[11px] text-faint">
        <button
          onClick={() => void onChooseWorkspace?.()}
          className="flex min-w-0 items-center gap-1.5 transition-colors hover:text-muted"
          title={workspace ?? 'Choose a workspace'}
        >
          <Icon name="folder" size="xs" />
          <span className="min-w-0 truncate">{workspace ? folderName(workspace) : 'No workspace selected'}</span>
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
    </ComposerDropzone>
  )
}
