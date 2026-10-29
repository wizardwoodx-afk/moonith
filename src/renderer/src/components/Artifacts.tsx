import { useEffect, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Code2,
  FileImage,
  FileSpreadsheet,
  Globe,
  ImageOff,
  MonitorUp,
  Presentation
} from 'lucide-react'
import { toast } from 'sonner'
import type { Artifact, ArtifactKind, Task } from '@shared/types'
import { useApp } from '../store'
import {
  cn,
  errorMessage,
  fileUrl,
  formatBytes,
  kindLabel,
  shortDate
} from '../lib/utils'
import { Button, IconButton, Modal } from './ui'
import { ICON_SIZES, Icon, type IconName, type IconSize } from './icons'

const KIND_ICON: Record<ArtifactKind, IconName | LucideIcon> = {
  document: 'fileText',
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  pdf: 'fileText',
  image: FileImage,
  text: 'fileText',
  code: Code2,
  other: 'file'
}

function ArtifactGlyph({
  kind,
  size = 'sm',
  className
}: {
  kind: ArtifactKind
  size?: IconSize
  className?: string
}) {
  const Glyph = KIND_ICON[kind] ?? 'file'
  return typeof Glyph === 'string' ? (
    <Icon name={Glyph} size={size} className={className} />
  ) : (
    <Glyph size={ICON_SIZES[size]} className={className} />
  )
}

function openArtifact(taskId: string, artifact: Artifact): void {
  window.knight.openArtifact(taskId, artifact.relPath).catch((error) => {
    toast.error(errorMessage(error))
  })
}

function revealArtifact(taskId: string, artifact: Artifact): void {
  window.knight.revealArtifact(taskId, artifact.relPath).catch((error) => {
    toast.error(errorMessage(error))
  })
}

export function ArtifactPanelBody({ task }: { task: Task }) {
  const setPreview = useApp((state) => state.setPreview)

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
        {task.artifacts.length === 0 && !task.browser ? (
          <div className="mt-8 flex flex-col items-center rounded-xl border border-dashed border-line px-5 py-9 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent-ink">
              <Icon name="spark" size="xl" />
            </div>
            <p className="mt-3 text-[12.5px] font-medium">No files yet</p>
          </div>
        ) : null}

        {task.artifacts.length > 0 ? (
          <div className="mb-4 space-y-1.5">
            <div className="px-1 pb-1 text-[10px] font-semibold tracking-[0.13em] text-faint uppercase">
              Created files
            </div>
            {task.artifacts.map((artifact) => (
              <div
                key={artifact.id}
                className="group relative rounded-xl border border-line bg-surface p-1 shadow-[0_1px_0_rgba(30,24,18,0.03)]"
              >
                <button
                  onClick={() => setPreview(artifact)}
                  className="flex w-full items-center gap-3 rounded-lg p-2 pr-14 text-left"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent-ink">
                    <ArtifactGlyph kind={artifact.kind} size="lg" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-ink">
                      {artifact.name}
                    </span>
                    <span className="mt-0.5 block text-[10.5px] text-faint">
                      {kindLabel(artifact.kind)} · {formatBytes(artifact.size)}
                    </span>
                  </span>
                </button>
                <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <IconButton
                    onClick={() => revealArtifact(task.id, artifact)}
                    title="Show in folder"
                    aria-label={`Show ${artifact.name} in folder`}
                    className="h-7 w-7"
                  >
                    <Icon name="folderOpen" size="md" />
                  </IconButton>
                  <IconButton
                    onClick={() => openArtifact(task.id, artifact)}
                    title="Open in default app"
                    aria-label={`Open ${artifact.name} in the default app`}
                    className="h-7 w-7"
                  >
                    <Icon name="externalLink" size="md" />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {task.browser ? (
          <div>
            <div className="flex items-center gap-1.5 px-1 pb-2 text-[10px] font-semibold tracking-[0.13em] text-faint uppercase">
              <Globe size={11} />
              Browser
              <span className="ml-auto flex items-center gap-1 text-[10px] normal-case tracking-normal text-faint">
                <span className="h-1 w-1 rounded-full bg-positive" /> {task.browser.ownerLabel ?? 'Task'} session
              </span>
            </div>
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              {task.browser.screenshotRelPath ? (
                <button
                  onClick={() =>
                    setPreview({
                      id: 'browser-shot',
                      name: 'Browser screenshot',
                      relPath: task.browser!.screenshotRelPath!,
                      kind: 'image',
                      size: 0,
                      createdAt: task.browser!.updatedAt
                    })
                  }
                  className="block w-full"
                >
                  <img
                    src={fileUrl(task.id, task.browser.screenshotRelPath)}
                    alt="Task browser"
                    className="max-h-48 w-full object-cover object-top transition-opacity hover:opacity-90"
                  />
                </button>
              ) : (
                <div className="flex h-28 items-center justify-center text-faint">
                  <Globe size={ICON_SIZES.xl} />
                </div>
              )}
              <div className="p-2.5">
                <p className="truncate text-[12px] font-medium">{task.browser.title || 'Browser'}</p>
                <p className="mt-0.5 truncate text-[10.5px] text-faint">{task.browser.url}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2 w-full"
                  onClick={() =>
                    window.knight.showBrowser(task.id, task.browser?.scope).catch((error) => {
                      toast.error(errorMessage(error))
                    })
                  }
                >
                  <MonitorUp size={ICON_SIZES.md} />
                  Open browser window
                </Button>
              </div>
            </div>
          </div>
        ) : null}
    </div>
  )
}

function PreviewBody({ artifact, taskId }: { artifact: Artifact; taskId: string }) {
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const src = fileUrl(taskId, artifact.relPath)
  const previewSrc = artifact.previewRelPath ? fileUrl(taskId, artifact.previewRelPath) : null
  const isText = artifact.kind === 'text' || artifact.kind === 'code'

  useEffect(() => {
    if (!isText) return
    let alive = true
    setLoading(true)
    setText(null)
    fetch(src)
      .then((response) => {
        if (!response.ok) throw new Error(`Could not read file (${response.status}).`)
        return response.text()
      })
      .then((value) => {
        if (alive) setText(value.slice(0, 200_000))
      })
      .catch((error) => {
        if (alive) setText(`Could not load preview.\n\n${errorMessage(error)}`)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [artifact.id, isText, src])

  if (previewSrc) {
    return (
      <iframe
        key={previewSrc}
        src={previewSrc}
        title={`${artifact.name} preview`}
        sandbox=""
        className="h-[68vh] w-full border-0 bg-white"
      />
    )
  }

  if (artifact.kind === 'image') {
    return (
      <div className="flex h-[68vh] items-center justify-center overflow-auto bg-checker p-4">
        <img src={src} alt={artifact.name} className="max-h-full max-w-full rounded-lg shadow-lg" />
      </div>
    )
  }

  if (artifact.kind === 'pdf') {
    return (
      <iframe
        src={src}
        title={artifact.name}
        sandbox=""
        referrerPolicy="no-referrer"
        className="h-[68vh] w-full border-0 bg-white"
      />
    )
  }

  if (isText) {
    return (
      <div className="h-[68vh] overflow-auto bg-canvas p-5">
        {loading ? (
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            Loading preview…
          </div>
        ) : (
          <pre className="font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink/90">
            {text}
          </pre>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-[52vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-faint">
        <ImageOff size={ICON_SIZES.xl} />
      </div>
      <div>
        <p className="text-[13px] font-medium">No preview available</p>
      </div>
    </div>
  )
}

export function ArtifactPreview() {
  const artifact = useApp((state) => state.preview)
  const task = useApp((state) => state.currentTask)
  const setPreview = useApp((state) => state.setPreview)

  if (!artifact || !task) return null

  const actions: ReactNode = (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => revealArtifact(task.id, artifact)}
      >
        <Icon name="folderOpen" size="md" />
        Show in folder
      </Button>
      <Button variant="primary" size="sm" onClick={() => openArtifact(task.id, artifact)}>
        <Icon name="externalLink" size="md" />
        Open file
      </Button>
    </>
  )

  return (
    <Modal
      open
      onClose={() => setPreview(null)}
      title={artifact.name}
      subtitle={`${kindLabel(artifact.kind)}${artifact.size ? ` · ${formatBytes(artifact.size)}` : ''} · ${shortDate(artifact.createdAt)}`}
      icon={<ArtifactGlyph kind={artifact.kind} size="lg" />}
      width="max-w-5xl"
      bodyClassName="p-0 bg-canvas-deep/40"
      footer={actions}
      className="overflow-hidden"
    >
      <PreviewBody artifact={artifact} taskId={task.id} />
    </Modal>
  )
}

export function ArtifactChip({
  artifact,
  taskId,
  className
}: {
  artifact: Artifact;
  taskId: string;
  className?: string
}) {
  const setPreview = useApp((state) => state.setPreview)
  return (
    <button
      onClick={() => setPreview(artifact)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-[11px] text-muted hover:text-ink',
        className
      )}
      title={artifact.relPath}
    >
      <ArtifactGlyph kind={artifact.kind} size="sm" className="text-accent" />
      <span className="max-w-[160px] truncate">{artifact.name}</span>
      <Icon name="arrowUpRight" size="xs" className="text-faint" />
    </button>
  )
}

export function ArtifactThumbRow({
  task,
  artifacts
}: {
  task: Task;
  artifacts: Artifact[]
}) {
  if (!artifacts.length) return null
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {artifacts.map((artifact) => (
        <ArtifactChip key={artifact.id} artifact={artifact} taskId={task.id} />
      ))}
    </div>
  )
}

export { ArtifactGlyph }
