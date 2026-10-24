import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { FileUp, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { AttachmentRef } from '@shared/types'
import { errorMessage } from '../lib/utils'

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files')
}

export function ComposerDropzone({
  children,
  onFiles,
  disabled = false
}: {
  children: ReactNode
  onFiles: (files: AttachmentRef[]) => void
  disabled?: boolean
}) {
  const depth = useRef(0)
  const [active, setActive] = useState(false)
  const [busy, setBusy] = useState(false)

  const drop = async (event: DragEvent): Promise<void> => {
    if (!hasFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    depth.current = 0
    setActive(false)
    if (disabled || busy) return
    const files = Array.from(event.dataTransfer.files)
    if (!files.length) return
    setBusy(true)
    try {
      const attachments = await window.knight.attachDroppedFiles(files)
      if (!attachments.length) {
        toast.error('No attachable files were found. Folders can be granted separately.')
      } else {
        onFiles(attachments)
      }
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="relative w-full"
      onDragEnter={(event) => {
        if (!hasFiles(event) || disabled) return
        event.preventDefault()
        depth.current += 1
        setActive(true)
      }}
      onDragOver={(event) => {
        if (!hasFiles(event) || disabled) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(event) => {
        if (!hasFiles(event)) return
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setActive(false)
      }}
      onDrop={(event) => void drop(event)}
    >
      {children}
      <AnimatePresence>
        {active || busy ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.99 }}
            transition={{ duration: 0.16 }}
            className="dropzone-veil pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-[inherit] border border-accent/45 bg-canvas/85 backdrop-blur-md"
            aria-hidden="true"
          >
            <motion.div
              initial={{ y: 5 }}
              animate={{ y: 0 }}
              className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 text-[12px] font-medium text-ink shadow-xl"
            >
              {busy ? <Loader2 size={14} className="animate-spin text-accent" /> : <FileUp size={14} className="text-accent" />}
              {busy ? 'Reading dropped files…' : 'Drop files to attach'}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
