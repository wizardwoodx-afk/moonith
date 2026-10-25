import { AnimatePresence, motion } from 'framer-motion'
import { FileText, X } from 'lucide-react'
import type { AttachmentRef } from '@shared/types'
import { cn, formatBytes } from '../lib/utils'

export function mergeAttachments(current: AttachmentRef[], incoming: AttachmentRef[]): AttachmentRef[] {
  const seen = new Set(current.map((file) => file.path))
  return [...current, ...incoming.filter((file) => !seen.has(file.path))]
}

export function ComposerAttachments({
  files,
  onChange,
  compact = false
}: {
  files: AttachmentRef[]
  onChange: (files: AttachmentRef[]) => void
  compact?: boolean
}) {
  if (!files.length) return null
  return (
    <motion.div layout className={cn('flex flex-wrap gap-1.5', compact ? 'pt-1 pb-1.5' : 'px-3.5 pt-2')}>
      <AnimatePresence initial={false}>
        {files.map((file) => (
          <motion.span
            layout
            key={file.id}
            initial={{ opacity: 0, y: 7, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className="inline-flex max-w-[220px] items-center gap-1.5 rounded-lg border border-line bg-canvas py-1 pr-1.5 pl-2 text-[11px] text-muted"
            title={file.path}
          >
            <FileText size={11} className="shrink-0 text-accent" />
            <span className="truncate">{file.name}</span>
            {file.size ? <span className="shrink-0 text-[9.5px] text-faint">{formatBytes(file.size)}</span> : null}
            <button
              onClick={() => onChange(files.filter((item) => item.id !== file.id))}
              className="rounded p-0.5 text-faint transition-colors hover:bg-surface-2 hover:text-ink"
              aria-label={`Remove ${file.name}`}
            >
              <X size={10} />
            </button>
          </motion.span>
        ))}
      </AnimatePresence>
    </motion.div>
  )
}
