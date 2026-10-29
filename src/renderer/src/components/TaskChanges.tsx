import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import { toast } from 'sonner'
import type { SnapshotEntry } from '@shared/types'
import { confirmDialog } from './Confirm'
import { Button } from './ui'
import { folderName } from '../lib/utils'

/**
 * The file changes a task made, and the way back.
 *
 * Nothing here is decorative: the panel only appears when there is a trail, and
 * a change the trail cannot reverse is named instead of hidden.
 */
export function TaskChanges({ taskId, running }: { taskId: string; running: boolean }) {
  const [entries, setEntries] = useState<SnapshotEntry[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void window.knight
      .listChanges(taskId)
      .then((list) => {
        if (alive) setEntries(list)
      })
      .catch(() => {
        if (alive) setEntries([])
      })
    return () => {
      alive = false
    }
  }, [taskId, running])

  if (running || !entries.length) return null

  const reversible = entries.filter((entry) => !entry.skipped)
  const blocked = entries.filter((entry) => entry.skipped)

  const reload = async (): Promise<void> => {
    setEntries(await window.knight.listChanges(taskId))
  }

  const redo = async (): Promise<void> => {
    setBusy(true)
    try {
      const outcome = await window.knight.redoChanges(taskId)
      const applied = outcome.restored.length
      if (applied) toast.success(`Reapplied ${applied} change${applied === 1 ? '' : 's'}`)
      for (const line of outcome.left) toast.message(`${folderName(line.path)}: ${line.reason}`)
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Redo failed.')
    } finally {
      setBusy(false)
    }
  }

  const undo = async (): Promise<void> => {
    const confirmed = await confirmDialog({
      title: 'Undo the file changes?',
      body: reversible.length
        ? `Puts back ${reversible.length} path${reversible.length === 1 ? '' : 's'} the way this task found them. Files you changed yourself after this task are left alone.`
        : 'Nothing here can be put back. This clears the list of changes.',
      confirmLabel: 'Undo changes',
      danger: true
    })
    if (!confirmed) return
    setBusy(true)
    try {
      const outcome = await window.knight.revertChanges(taskId)
      const undone = outcome.restored.length + outcome.removed.length
      if (undone) toast.success(`Undid ${undone} change${undone === 1 ? '' : 's'}`)
      for (const line of outcome.left) toast.message(`${folderName(line.path)}: ${line.reason}`)
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The undo failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-8 rounded-xl border border-line bg-surface/50 p-3.5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.13em] text-faint uppercase">
          <History size={11} />
          File changes
        </p>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => void redo()} disabled={busy}>
            Redo
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void undo()} disabled={busy}>
            {busy ? 'Working…' : 'Undo'}
          </Button>
        </div>
      </div>
      <ul className="space-y-1">
        {entries.slice(0, 6).map((entry) => (
          <li key={`${entry.path}-${entry.at}`} className="flex items-baseline gap-2 text-[11.5px]">
            <span className="min-w-0 flex-1 truncate font-mono text-ink/80" title={entry.path}>
              {folderName(entry.path)}
            </span>
            <span className="shrink-0 whitespace-nowrap text-faint">
              {entry.skipped ? (entry.state === 'directory' ? 'Not recoverable' : 'No undo') : 'Undoable'}
            </span>
          </li>
        ))}
      </ul>
      {entries.length > 6 ? (
        <p className="mt-1.5 text-[10.5px] text-faint">
          {entries.length - 6} more path{entries.length - 6 === 1 ? '' : 's'} in this task.
        </p>
      ) : null}
      {blocked.length ? (
        <p className="mt-2 text-[11px] leading-relaxed text-warn">
          {blocked.length} change{blocked.length === 1 ? '' : 's'} cannot be undone:{' '}
          {blocked
            .slice(0, 2)
            .map((entry) => entry.skipped)
            .join('; ')}
          {blocked.length > 2 ? '…' : ''}
        </p>
      ) : null}
    </div>
  )
}
