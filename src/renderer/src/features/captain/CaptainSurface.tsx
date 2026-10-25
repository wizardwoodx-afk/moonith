import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { AttachmentRef, PermissionMode } from '@shared/types'
import type { OutcomeTaskBindingInput } from '@shared/verifiedOutcomes'
import { useApp } from '../../store'
import { errorMessage } from '../../lib/utils'
import { resolveComposerModel, type ComposerModelState } from '../../lib/composerChoices'
import { CaptainWelcome } from './CaptainWelcome'

export function CaptainSurface() {
  const tasks = useApp((state) => state.tasks)
  const settings = useApp((state) => state.settings)
  const startTask = useApp((state) => state.startTask)
  const openSettings = useApp((state) => state.openSettings)

  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<AttachmentRef[]>([])
  const [workspace, setWorkspace] = useState<string | null>(null)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    settings?.defaultPermissionMode ?? 'manual'
  )
  const [model, setModel] = useState<ComposerModelState>(() => resolveComposerModel(settings))
  const [outcome, setOutcome] = useState<OutcomeTaskBindingInput | null>(null)
  const [sending, setSending] = useState(false)
  const hydrated = useRef(false)

  useEffect(() => {
    if (!settings) return
    if (!hydrated.current) {
      hydrated.current = true
      setPermissionMode(settings.defaultPermissionMode)
      setModel(resolveComposerModel(settings))
      return
    }
    setModel((current) => (current.providerId ? current : resolveComposerModel(settings)))
  }, [settings])

  useEffect(() => {
    const reset = (event: Event): void => {
      const prefill = (event as CustomEvent<{ draft?: string }>).detail?.draft ?? ''
      setDraft(prefill)
      setAttachments([])
      window.setTimeout(() => window.dispatchEvent(new Event('knight:focus-composer')), 30)
    }
    window.addEventListener('knight:new-task', reset)
    return () => window.removeEventListener('knight:new-task', reset)
  }, [])

  const chooseWorkspace = async (): Promise<void> => {
    try {
      const folder = await window.knight.pickFolder()
      if (folder) setWorkspace(folder)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const send = async (): Promise<void> => {
    const text = draft.trim()
    if (!text && attachments.length === 0) return
    if (!model.providerId || !model.model) {
      toast.error('Connect a model before messaging the Captain.')
      openSettings('providers')
      return
    }

    setSending(true)
    try {
      await startTask({
        text,
        mode: 'chat',
        permissionMode,
        folders: workspace ? [workspace] : [],
        attachments,
        providerId: model.providerId,
        model: model.model,
        outcome
      })
      setDraft('')
      setAttachments([])
    } catch {
      /* The store reports the failure; keep the draft so nothing is lost. */
    } finally {
      setSending(false)
    }
  }

  return (
    <CaptainWelcome
      tasks={tasks}
      model={model}
      permissionMode={permissionMode}
      draft={draft}
      attachments={attachments}
      workspace={workspace}
      outcome={outcome}
      busy={sending}
      onOutcomeChange={setOutcome}
      onDraftChange={setDraft}
      onAttachmentsChange={setAttachments}
      onPermissionChange={setPermissionMode}
      onModelChange={setModel}
      onChooseWorkspace={chooseWorkspace}
      onClearWorkspace={() => setWorkspace(null)}
      onSend={() => void send()}
    />
  )
}
