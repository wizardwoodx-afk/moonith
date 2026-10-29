import { useCallback, useEffect, useState } from 'react'
import { agentName } from '../../lib/localProfile'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion'
import { Check, Download, Eye, FilePlus2, Palette, Search, ShieldCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { MarketspaceCreateInput, MarketspaceDetail, MarketspaceEntry } from '@shared/marketspace'
import type { TaskSummary } from '@shared/types'
import { Button, FieldGroup, IconButton, Modal, Spin } from '../../components/ui'
import { cn, errorMessage } from '../../lib/utils'
import { SettingsSection } from './SettingsSection'

const inputClass = 'h-9 w-full rounded-lg border border-line bg-canvas px-3 text-[12.5px] text-ink outline-none transition-colors placeholder:text-faint focus:border-accent/45'
const textareaClass = 'w-full resize-y rounded-lg border border-line bg-canvas px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-ink outline-none transition-colors placeholder:text-faint focus:border-accent/45'

function TrustChip({ entry }: { entry: MarketspaceEntry }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]',
      entry.trust === 'reviewed' ? 'border-positive/25 bg-positive/10 text-positive' : 'border-line bg-surface/60 text-muted'
    )}>
      {entry.trust === 'reviewed' ? <ShieldCheck size={10} /> : <Palette size={10} />}
      {entry.trust === 'reviewed' ? 'Reviewed' : 'Local'}
    </span>
  )
}

export function MarketspaceSection({ actionHost }: { actionHost: HTMLElement | null }) {
  const reduced = useReducedMotionConfig()
  const [entries, setEntries] = useState<MarketspaceEntry[]>([])
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [detail, setDetail] = useState<MarketspaceDetail | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<MarketspaceCreateInput>({ name: '', description: '', design: '' })
  const [removeTarget, setRemoveTarget] = useState<MarketspaceEntry | null>(null)
  const [applyOpen, setApplyOpen] = useState(false)
  const [applyTask, setApplyTask] = useState('')

  const load = useCallback(async (search = '') => {
    try {
      const [nextEntries, nextTasks] = await Promise.all([
        window.knight.marketspaceList(search),
        window.knight.listTasks()
      ])
      setEntries(nextEntries)
      setTasks(nextTasks)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(query)
    }, 220)
    return () => window.clearTimeout(timer)
  }, [load, query])

  const inspect = async (id: string): Promise<void> => {
    setBusy(`read:${id}`)
    try {
      const next = await window.knight.marketspaceRead(id)
      if (next) setDetail(next)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const install = async (id: string): Promise<void> => {
    setBusy(`install:${id}`)
    try {
      await window.knight.marketspaceInstall(id)
      await load(query)
      toast.success(`Installed in the native Marketspace. ${agentName()} can apply it after approval.`)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const create = async (): Promise<void> => {
    setBusy('create')
    try {
      const next = await window.knight.marketspaceCreate(draft)
      setCreating(false)
      setDraft({ name: '', description: '', design: '' })
      await load(query)
      setDetail(next)
      toast.success('Local design system saved.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const remove = async (): Promise<void> => {
    if (!removeTarget) return
    setBusy(`remove:${removeTarget.id}`)
    try {
      setEntries(await window.knight.marketspaceRemove(removeTarget.id))
      setRemoveTarget(null)
      if (detail?.id === removeTarget.id) setDetail(null)
      toast.success('Removed from this device.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const apply = async (): Promise<void> => {
    if (!detail || !applyTask) return
    setBusy(`apply:${detail.id}`)
    try {
      const result = await window.knight.marketspaceApply(applyTask, detail.id)
      toast.success(`Applied to ${result.directory}; the files are in the task artifacts.`)
      setApplyOpen(false)
      setDetail(null)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <SettingsSection title="Native Marketspace">
      {actionHost
        ? createPortal(
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              <FilePlus2 size={13} /> New system
            </Button>,
            actionHost
          )
        : null}
      <div className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search native design systems"
            aria-label="Search native design systems"
            className={cn(inputClass, 'pl-8')}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8 text-muted"><Spin size={17} /></div>
      ) : entries.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-[12px] text-muted">No native systems match.</p>
          <p className="mt-1 text-[11px] text-faint">
            Try another search or create a local DESIGN.md system.
          </p>
        </div>
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2">
          <AnimatePresence initial={false}>
            {entries.map((entry, index) => (
              <motion.article
                key={entry.id}
                layout
                initial={reduced ? false : { opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: reduced ? 0 : 0.16, delay: reduced ? 0 : Math.min(index, 5) * 0.025 }}
                className="rounded-xl border border-line bg-canvas/45 p-3.5"
              >
                <div className="flex items-start gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-ink"><Palette size={14} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="min-w-0 truncate text-[12px] font-medium text-ink" title={entry.name}>{entry.name}</p>
                      <TrustChip entry={entry} />
                    </div>
                    <p className="mt-1 line-clamp-2 text-[10.5px] leading-relaxed text-muted">{entry.description}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-1.5 border-t border-line/70 pt-2.5">
                  <span className="mr-auto text-[10px] text-faint whitespace-nowrap">{entry.installed ? <><Check size={10} className="mr-1 inline text-positive" />Installed</> : 'Available'}</span>
                  <Button size="sm" variant="ghost" loading={busy === `read:${entry.id}`} onClick={() => void inspect(entry.id)}><Eye size={12} /> Inspect</Button>
                  {!entry.installed ? <Button size="sm" variant="secondary" loading={busy === `install:${entry.id}`} disabled={Boolean(busy)} onClick={() => void install(entry.id)}><Download size={12} /> Install</Button> : <IconButton aria-label={`Remove ${entry.name}`} className="hover:text-danger" onClick={() => setRemoveTarget(entry)}><Trash2 size={12} /></IconButton>}
                </div>
              </motion.article>
            ))}
          </AnimatePresence>
        </div>
      )}

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.name}
        subtitle={detail ? `${detail.id} · ${detail.trust === 'reviewed' ? 'Reviewed native entry' : 'Local entry'} · static preview` : undefined}
        width="max-w-3xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>
            {detail?.installed ? <Button variant="primary" onClick={() => { setApplyTask(tasks[0]?.id ?? ''); setApplyOpen(true) }}>Apply to task</Button> : <Button variant="primary" onClick={() => { const id = detail?.id; setDetail(null); if (id) void install(id) }}><Download size={13} /> Install</Button>}
          </>
        }
      >
        {detail ? (
          <div className="space-y-4">
            <iframe
              title={`${detail.name} static preview`}
              srcDoc={detail.preview}
              sandbox=""
              referrerPolicy="no-referrer"
              className="h-[280px] w-full rounded-xl border border-line bg-white"
            />
            <p className="text-[10.5px] leading-relaxed text-faint">The preview runs isolated, without scripts or network. The specification below is what {agentName()} reads.</p>
            <pre className="scroll-thin max-h-[32vh] overflow-auto rounded-xl border border-line bg-canvas px-4 py-3 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap text-ink/85">{detail.design}</pre>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New local design system"
        subtitle="A portable DESIGN.md specification with a generated static preview."
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button><Button variant="primary" loading={busy === 'create'} onClick={() => void create()}>Save system</Button></>}
      >
        <div className="space-y-4">
          <FieldGroup label="Name"><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className={inputClass} autoFocus /></FieldGroup>
          <FieldGroup label="When to use it"><input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className={inputClass} /></FieldGroup>
          <FieldGroup label="DESIGN.md" hint="Tokens, components, accessibility, and agent handoff guidance"><textarea value={draft.design} onChange={(event) => setDraft({ ...draft, design: event.target.value })} rows={12} className={textareaClass} placeholder={'# My system\n\n## Tokens\n…\n\n## Components\n…'} /></FieldGroup>
        </div>
      </Modal>

      <Modal
        open={applyOpen}
        onClose={() => setApplyOpen(false)}
        title={`Apply ${detail?.name ?? 'design system'}`}
        subtitle="Copies DESIGN.md and preview.html into the selected task. Existing destinations are not overwritten."
        footer={<><Button variant="ghost" onClick={() => setApplyOpen(false)}>Cancel</Button><Button variant="primary" loading={busy === `apply:${detail?.id}`} disabled={!applyTask || !tasks.length} onClick={() => void apply()}>Apply to task</Button></>}
      >
        {tasks.length ? <FieldGroup label="Destination task"><select value={applyTask} onChange={(event) => setApplyTask(event.target.value)} className={inputClass}>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></FieldGroup> : <p className="text-[12px] leading-relaxed text-muted">Create a task first, then apply this system from its native Marketspace.</p>}
      </Modal>

      <Modal
        open={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        title={`Remove ${removeTarget?.name ?? 'system'}?`}
        subtitle="This removes the local installed copy. Reviewed built-in entries remain available to install again."
        footer={<><Button variant="ghost" onClick={() => setRemoveTarget(null)}>Keep it</Button><Button variant="danger" loading={busy === `remove:${removeTarget?.id}`} onClick={() => void remove()}>Remove</Button></>}
      >
        <p className="text-[12px] leading-relaxed text-muted">Files already applied to a task are left untouched.</p>
      </Modal>
    </SettingsSection>
  )
}
