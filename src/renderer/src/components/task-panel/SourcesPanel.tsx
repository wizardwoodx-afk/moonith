import { useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronDown, File, FolderOpen, Plus, X } from 'lucide-react'
import type { Task } from '@shared/types'
import { useApp } from '../../store'
import { taskAttachmentSources } from '../../lib/taskOperations'
import { cn, folderName, formatBytes } from '../../lib/utils'
import { IconButton } from '../ui'

export function SourcesPanel({ task }: { task: Task }) {
  const [open, setOpen] = useState(true)
  const reduced = useReducedMotion()
  const addFolder = useApp((state) => state.addFolderToCurrent)
  const removeFolder = useApp((state) => state.removeFolderFromCurrent)
  const attachments = useMemo(() => taskAttachmentSources(task), [task])
  const count = task.folders.length + attachments.length

  return (
    <section className="shrink-0 border-b border-line px-2.5 pt-3 pb-2">
      <div className="flex items-center gap-2 px-1">
        <FolderOpen size={12} className="text-accent" />
        <div>
          <h3 className="text-[10px] font-semibold tracking-[0.11em] text-muted uppercase">Sources</h3>
          <p className="mt-0.5 text-[9px] text-faint">{count} explicitly attached or granted</p>
        </div>
        <button
          onClick={() => void addFolder()}
          className="ml-auto flex h-7 items-center gap-1 rounded-lg border border-line px-2 text-[9.5px] text-muted hover:bg-surface-2 hover:text-ink"
        >
          <Plus size={11} /> Add folder
        </button>
        <IconButton onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label="Toggle sources" className="h-7 w-7">
          <ChevronDown size={12} className={cn('transition-transform', !open && '-rotate-90')} />
        </IconButton>
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={reduced ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: reduced ? 0 : 0.18 }}
            className="overflow-hidden"
          >
            <div className="scroll-thin mt-2 max-h-52 space-y-1.5 overflow-y-auto pr-0.5">
              {task.folders.map((folder) => (
                <div key={folder} className="group flex items-center gap-2 rounded-lg border border-line bg-canvas/45 px-2.5 py-2">
                  <FolderOpen size={12} className="shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[10.5px] font-medium text-ink">{folderName(folder)}</p>
                    <p className="truncate font-mono text-[8px] text-faint" title={folder}>{folder}</p>
                  </div>
                  <span className="shrink-0 text-[8px] text-faint">Workspace</span>
                  <IconButton
                    onClick={() => void removeFolder(folder)}
                    aria-label={`Remove access to ${folderName(folder)}`}
                    title="Remove access · does not delete files"
                    className="h-6 w-6 opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <X size={11} />
                  </IconButton>
                </div>
              ))}
              {attachments.map((file) => (
                <div key={file.id} className="flex items-center gap-2 rounded-lg border border-line/70 bg-surface/30 px-2.5 py-2">
                  <File size={12} className="shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[10.5px] font-medium text-ink">{file.name}</p>
                    <p className="truncate font-mono text-[8px] text-faint" title={file.path}>{file.path}</p>
                  </div>
                  <span className="shrink-0 text-[8px] text-faint">{file.size ? formatBytes(file.size) : 'Attached'}</span>
                </div>
              ))}
              {!count ? (
                <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[9.5px] leading-relaxed text-faint">
                  No sources yet. Add a folder or attach files in the composer.
                </p>
              ) : null}
            </div>
            <p className="mt-1.5 px-1 text-[8.5px] leading-relaxed text-faint">Removing a folder revokes its grant; it never deletes the folder.</p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  )
}
