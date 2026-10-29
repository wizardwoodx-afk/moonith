import { agentName } from '../../lib/localProfile'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BookmarkCheck,
  BookOpen,
  Check,
  Copy,
  Download,
  FileCheck2,
  KeyRound,
  LockKeyhole,
  PenLine,
  Play,
  Plus,
  Radio,
  ScrollText,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
  Users2,
  Wifi,
  WifiOff,
  X
} from 'lucide-react'
import { Button } from '../../components/ui'
import { confirmDialog } from '../../components/Confirm'
import { cn, timeAgo } from '../../lib/utils'
import { TABLE_MAX_PEERS, allDone, ownSeat, proposalSeats } from '@shared/table'
import { useApp } from '../../store'
import type {
  ProofOfWorkCertificate,
  ProofOfWorkRecord,
  TableGoal,
  TableLedgerEntry,
  TablePeer,
  TableProposal,
  TableSeat,
  TableState,
  Task,
  TaskStatus,
  TeamPlaybook
} from '@shared/types'
import { useTableStore } from './tableStore'
import { HarmoniaFeed } from '../harmonia/HarmoniaFeed'
import { TrustDashboard } from '../trust/TrustDashboard'

const SEAT_DOT: Record<TableSeat, string> = {
  a: 'bg-identity-a',
  b: 'bg-identity-b',
  c: 'bg-identity-c',
  d: 'bg-identity-d'
}

const SEAT_AVATAR: Record<TableSeat, string> = {
  a: 'border-identity-a/30 bg-identity-a/10 text-identity-a',
  b: 'border-identity-b/30 bg-identity-b/10 text-identity-b',
  c: 'border-identity-c/30 bg-identity-c/10 text-identity-c',
  d: 'border-identity-d/30 bg-identity-d/10 text-identity-d'
}

const PROPOSAL_STATUS: Record<
  TableProposal['status'],
  { label: string; className: string }
> = {
  pending: { label: 'Keys needed', className: 'border-warn/30 bg-warn/10 text-warn' },
  approved: { label: 'Co-signed', className: 'border-positive/30 bg-positive/10 text-positive' },
  withdrawn: { label: 'Withdrawn', className: 'border-danger/30 bg-danger/10 text-danger' },
  published: { label: 'Published', className: 'border-line bg-canvas text-muted' }
}

const TASK_STATUS: Record<TaskStatus, { label: string; tone: string }> = {
  draft: { label: 'Not started yet', tone: 'text-faint' },
  running: { label: 'Working on it now', tone: 'text-accent-ink' },
  waiting: { label: 'Waiting for your approval', tone: 'text-warn' },
  paused: { label: 'Paused', tone: 'text-muted' },
  done: { label: 'Finished', tone: 'text-positive' },
  error: { label: 'Hit a problem', tone: 'text-danger' }
}

function seatName(peers: TablePeer[], seat: TableSeat): string {
  return peers.find((peer) => peer.seat === seat)?.name ?? agentName()
}

function seatInitial(peers: TablePeer[], seat: TableSeat): string {
  return seatName(peers, seat).trim().charAt(0).toUpperCase() || '?'
}

function stamp(iso: string | undefined): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return ''
  }
}

function SeatAvatar({
  seat,
  peers,
  className
}: {
  seat: TableSeat | 'joint'
  peers: TablePeer[]
  className?: string
}) {
  if (seat === 'joint') {
    return <span className={cn('joint-marker h-7 w-7 shrink-0 rounded-full', className)} />
  }
  return (
    <span
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold',
        SEAT_AVATAR[seat],
        className
      )}
    >
      {seatInitial(peers, seat)}
    </span>
  )
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1_600)
          })
          .catch(() => undefined)
      }}
      className="rounded-md border border-line bg-surface p-1.5 text-muted transition-colors hover:text-ink"
      aria-label={label}
      title={label}
    >
      {copied ? <Check size={11} className="text-positive" /> : <Copy size={11} />}
    </button>
  )
}

/* ── The goal, read like a channel topic ─────────────────────────────────── */

function GoalTopic({
  goal,
  peers,
  busy,
  onSave
}: {
  goal: TableGoal | null
  peers: TablePeer[]
  busy: boolean
  onSave: (input: { title: string; detail?: string; due?: string }) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(!goal)
  const [title, setTitle] = useState(goal?.title ?? '')
  const [detail, setDetail] = useState(goal?.detail ?? '')
  const [due, setDue] = useState(goal?.due ?? '')

  return (
    <section className="rounded-2xl border border-line bg-canvas/60 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-faint uppercase">
            Shared goal
          </p>
          {goal && !editing ? (
            <>
              <p className="mt-1 text-[13px] font-semibold leading-snug text-ink">{goal.title}</p>
              {goal.detail ? (
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{goal.detail}</p>
              ) : null}
              <p className="mt-1 font-mono text-[10px] text-faint">
                set by {seatName(peers, goal.setBy)} · updated {timeAgo(goal.updatedAt)}
                {goal.due ? ` · due ${goal.due}` : ''}
              </p>
            </>
          ) : (
            <p className="mt-1 text-[12px] font-medium text-muted">
              {goal ? 'Edit what this table is for' : 'Set what this table is for'}
            </p>
          )}
        </div>
        {goal && !editing ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <PenLine size={11} />
            Edit
          </Button>
        ) : null}
      </div>

      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!title.trim() || busy) return
            void onSave({ title: title.trim(), detail: detail.trim(), due: due.trim() }).then(
              (ok) => {
                if (ok) setEditing(false)
              }
            )
          }}
          className="mt-3 border-t border-line pt-3"
        >
          <label className="sr-only" htmlFor="table-goal-title">
            Goal
          </label>
          <input
            id="table-goal-title"
            className="field"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
            placeholder="What is this table for?"
            autoFocus={!goal}
          />
          <label className="sr-only" htmlFor="table-goal-detail">
            Notes
          </label>
          <textarea
            id="table-goal-detail"
            className="field mt-1.5 min-h-[52px] resize-none py-2"
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            maxLength={600}
            placeholder="Notes, optional"
          />
          <div className="mt-2 flex items-center gap-2">
            <label className="sr-only" htmlFor="table-goal-due">
              Due
            </label>
            <input
              id="table-goal-due"
              className="field w-[160px]"
              value={due}
              onChange={(event) => setDue(event.target.value)}
              maxLength={40}
              placeholder="Due, optional"
            />
            <div className="ml-auto flex items-center gap-1.5">
              {goal ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              ) : null}
              <Button type="submit" variant="primary" size="sm" disabled={busy || !title.trim()}>
                {goal ? 'Save' : 'Set the goal'}
              </Button>
            </div>
          </div>
        </form>
      ) : null}
    </section>
  )
}

/* ── Proposals as chat cards ─────────────────────────────────────────────── */

function useLocalTask(taskId: string | undefined): Task | null {
  const [task, setTask] = useState<Task | null>(null)
  useEffect(() => {
    if (!taskId) return
    let alive = true
    let timer: number | undefined
    const read = async (): Promise<void> => {
      try {
        const next = await window.knight.getTask(taskId)
        if (!alive) return
        if (next) setTask(next)
        if (next && (next.status === 'running' || next.status === 'waiting')) {
          timer = window.setTimeout(() => void read(), 2_500)
        }
      } catch {
        /* the work has not started on this desk yet */
      }
    }
    void read()
    return () => {
      alive = false
      if (timer) window.clearTimeout(timer)
    }
  }, [taskId])
  return task
}

function ProposalMessage({
  proposal,
  state,
  me,
  busy,
  onTurnKey,
  onWithdraw,
  onPublish,
  onMarkDone,
  onOpenTask
}: {
  proposal: TableProposal
  state: TableState
  me: TableSeat
  busy: boolean
  onTurnKey: () => void
  onWithdraw: () => void
  onPublish: () => void
  onMarkDone: () => void
  onOpenTask: () => void
}) {
  const peers = state.peers
  const seats = proposalSeats(proposal)
  const status = PROPOSAL_STATUS[proposal.status]
  const pending = proposal.status === 'pending'
  const approved = proposal.status === 'approved'
  const published = proposal.status === 'published'
  const withdrawn = proposal.status === 'withdrawn'
  const ownKey = proposal.keys[me] === true
  const waitingFor = seats.filter((seat) => seat !== me && !proposal.keys[seat])
  const waitingSeats = seats.filter((seat) => !peers.some((peer) => peer.seat === seat))
  const finishedBy = seats.filter((seat) => proposal.done?.[seat])
  const taskId = proposal.taskIds?.[me]
  const task = useLocalTask(published ? taskId : undefined)
  const work = TASK_STATUS[task?.status ?? 'draft']
  const [copied, setCopied] = useState(false)

  const receipt = [
    `Joint action receipt — ${proposal.title}`,
    state.code ? `Table code: ${state.code}` : null,
    `Proposed by ${seatName(peers, proposal.proposedBy)} at ${stamp(proposal.createdAt)}`,
    ...seats
      .filter((seat) => proposal.keys[seat])
      .map((seat) => `Key turned by ${seatName(peers, seat)}`),
    proposal.approvedAt ? `All keys on at ${stamp(proposal.approvedAt)}` : null,
    proposal.publishedAt ? `Published at ${stamp(proposal.publishedAt)}` : null,
    `Work started on ${seats.length} desk${seats.length === 1 ? '' : 's'}`,
    finishedBy.length
      ? `Finished by ${finishedBy.map((seat) => seatName(peers, seat)).join(', ')}`
      : 'No desk has finished yet'
  ]
    .filter(Boolean)
    .join('\n')

  const copyReceipt = (): void => {
    void navigator.clipboard
      .writeText(receipt)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1_600)
      })
      .catch(() => undefined)
  }

  return (
    <div className="flex gap-2.5">
      <SeatAvatar seat={proposal.proposedBy} peers={peers} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-[10px] text-faint">
          <span className="font-medium text-muted">
            {proposal.proposedBy === me ? 'You' : seatName(peers, proposal.proposedBy)}
          </span>
          <span>proposed a joint action</span>
          <span className="font-mono text-[10px]">{stamp(proposal.createdAt)}</span>
        </p>

        <div className="mt-1 rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 text-[12.5px] font-semibold text-ink">{proposal.title}</p>
            <span
              className={cn(
                'shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
                status.className
              )}
            >
              {status.label}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">{proposal.summary}</p>

          <div className="mt-2.5 flex h-1 overflow-hidden rounded-full bg-line/60">
            {seats.map((seat) => (
              <span
                key={seat}
                className={cn('h-full transition-all duration-300', SEAT_DOT[seat])}
                style={{ width: proposal.keys[seat] ? `${100 / seats.length}%` : '0%' }}
              />
            ))}
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {seats.map((seat) => {
              const finished = proposal.done?.[seat] === true
              const turned = proposal.keys[seat] === true
              return (
                <span
                  key={seat}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px]',
                    published
                      ? finished
                        ? 'border-positive/25 bg-positive/5 text-positive'
                        : 'border-line bg-canvas/60 text-faint'
                      : turned
                        ? 'border-positive/25 bg-positive/5 text-positive'
                        : 'border-line bg-canvas/60 text-faint'
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', SEAT_DOT[seat])} />
                  {seatName(peers, seat)}
                  {seat === me ? ' (you)' : ''}
                  {published ? (
                    finished ? (
                      <Check size={9} />
                    ) : (
                      <Activity size={9} />
                    )
                  ) : turned ? (
                    <KeyRound size={9} />
                  ) : (
                    <LockKeyhole size={9} />
                  )}
                </span>
              )
            })}
          </div>

          {pending ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Button size="sm" variant="primary" disabled={busy || ownKey} onClick={onTurnKey}>
                <KeyRound size={11} />
                {ownKey ? 'Your key is on' : 'Turn your key'}
              </Button>
              {ownKey && waitingFor.length ? (
                <span className="text-[10px] text-faint">
                  Waiting for{' '}
                  {waitingFor.length === 1 ? 'one key' : `${waitingFor.length} keys`} from the
                  others.
                </span>
              ) : null}
              {waitingSeats.length ? (
                <span className="text-[10px] text-faint">
                  {waitingSeats.length === 1 ? 'One seat is' : `${waitingSeats.length} seats are`}{' '}
                  empty; they will need a key when someone sits down.
                </span>
              ) : null}
              {proposal.proposedBy === me ? (
                <Button size="sm" variant="ghost" disabled={busy} onClick={onWithdraw}>
                  <Undo2 size={11} />
                  Withdraw
                </Button>
              ) : null}
            </div>
          ) : null}

          {approved ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[10px] text-positive">
                <BadgeCheck size={12} />
                Every seated agent has turned a key.
              </p>
              <Button size="sm" variant="accent" disabled={busy} onClick={onPublish}>
                Publish to the table
                <ArrowRight size={11} />
              </Button>
            </div>
          ) : null}

          {published ? (
            <>
              <p
                className={cn(
                  'mt-2.5 flex items-center gap-1.5 text-[10.5px] font-medium',
                  work.tone
                )}
              >
                <Activity size={11} />
                Your desk: {work.label.toLowerCase()}
                {task?.steps?.length ? (
                  <span className="font-mono text-[10px] text-faint">
                    {task.steps.length} steps
                  </span>
                ) : null}
              </p>
              {allDone(proposal) ? (
                <p className="mt-1.5 flex items-center gap-1.5 text-[10px] text-positive">
                  <BadgeCheck size={11} />
                  Complete on all desks. This record is closed.
                </p>
              ) : null}
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {proposal.done?.[me] ? null : (
                  <Button size="sm" variant="primary" disabled={busy} onClick={onMarkDone}>
                    <BadgeCheck size={11} />
                    Mark my side done
                  </Button>
                )}
                {taskId ? (
                  <Button size="sm" variant="ghost" onClick={onOpenTask}>
                    <ArrowRight size={11} />
                    Open the work
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={copyReceipt}>
                  <ScrollText size={11} />
                  {copied ? 'Copied' : 'Copy receipt'}
                </Button>
              </div>
            </>
          ) : null}

          {withdrawn ? (
            <p className="mt-2.5 flex items-center gap-1.5 text-[10px] text-danger">
              <ShieldAlert size={11} />
              Withdrawn by {seatName(peers, proposal.proposedBy)}. Nothing was published.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/* ── Ledger events as plain chat lines ───────────────────────────────────── */

function LedgerMessage({ entry, peers }: { entry: TableLedgerEntry; peers: TablePeer[] }) {
  return (
    <div className="flex gap-2.5">
      <SeatAvatar seat={entry.actor} peers={peers} />
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="flex flex-wrap items-baseline gap-x-2 text-[10px] text-faint">
          <span className="font-medium text-muted">
            {entry.actor === 'joint' ? 'Joint' : seatName(peers, entry.actor as TableSeat)}
          </span>
          <span className="font-mono text-[10px]">{stamp(entry.at)}</span>
        </p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink/90">{entry.text}</p>
      </div>
    </div>
  )
}

/* ── Team Playbooks Section ──────────────────────────────────────────────── */

function PlaybooksSection({
  state,
  onOpenTask
}: {
  state: TableState
  onOpenTask: (taskId: string) => void
}) {
  const [playbooks, setPlaybooks] = useState<TeamPlaybook[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [instantiating, setInstantiating] = useState<string | null>(null)
  const [title, setTitle] = useState(state.goal?.title ? `Playbook: ${state.goal.title}` : 'Team Feature Sprint')
  const [desc, setDesc] = useState('')

  const loadPlaybooks = async () => {
    try {
      const list = await window.knight.teamPlaybookList()
      setPlaybooks(list)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadPlaybooks()
  }, [])

  const handleSnapshot = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || saving) return
    setSaving(true)
    try {
      await window.knight.teamPlaybookSnapshot({
        sessionId: state.code ?? 'table_session',
        title: title.trim(),
        description: desc.trim() || undefined
      })
      setTitle('')
      setDesc('')
      await loadPlaybooks()
    } finally {
      setSaving(false)
    }
  }

  const handleRun = async (playbookId: string) => {
    setInstantiating(playbookId)
    try {
      const res = await window.knight.teamPlaybookInstantiate({
        playbookId,
        workspacePath: ''
      })
      if (res.taskIds && res.taskIds[0]) {
        onOpenTask(res.taskIds[0])
      }
    } finally {
      setInstantiating(null)
    }
  }

  const handleDelete = async (id: string) => {
    const ok = await confirmDialog({
      title: 'Delete Playbook?',
      body: 'This removes the saved team workflow blueprint.',
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    await window.knight.teamPlaybookDelete(id)
    await loadPlaybooks()
  }

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-6 py-6">
      {/* Save Current Session Card */}
      <section className="rounded-2xl border border-accent/25 bg-accent-soft/10 p-5">
        <div className="flex items-center gap-2.5">
          <Sparkles className="text-accent-ink" size={18} />
          <div>
            <h2 className="text-[13.5px] font-semibold text-ink">Save Squad Working as Playbook</h2>
            <p className="text-[11px] text-muted">Capture current team roles, prompts, and steps into a reusable blueprint.</p>
          </div>
        </div>

        <form onSubmit={handleSnapshot} className="mt-4 flex flex-col gap-2.5">
          <input
            className="field w-full text-[12px]"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Playbook Title (e.g. Full-Stack Feature Sprint)"
            maxLength={100}
            required
          />
          <input
            className="field w-full text-[11.5px]"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Description or mission goals (optional)"
            maxLength={250}
          />
          <div className="flex justify-end">
            <Button type="submit" variant="primary" size="sm" disabled={saving || !title.trim()}>
              <BookmarkCheck size={13} className="mr-1" />
              {saving ? 'Saving...' : 'Save Reusable Playbook'}
            </Button>
          </div>
        </form>
      </section>

      {/* List Saved Playbooks */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[12px] font-semibold tracking-wider text-faint uppercase">
            Saved Team Playbooks ({playbooks.length})
          </h3>
        </div>

        {loading ? (
          <p className="text-[11px] text-muted">Loading squad playbooks...</p>
        ) : playbooks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line p-8 text-center">
            <p className="text-[12px] text-muted">No saved playbooks yet.</p>
            <p className="text-[10px] text-faint mt-1">Snapshot your current team session above to create your first playbook.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {playbooks.map((pb) => (
              <div
                key={pb.id}
                className="group rounded-xl border border-line bg-canvas/70 p-4 transition-all hover:border-accent/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-[13px] font-semibold text-ink">{pb.title}</h4>
                      {pb.tags?.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] font-medium text-muted uppercase"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted">{pb.description}</p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleRun(pb.id)}
                      disabled={instantiating === pb.id}
                    >
                      <Play size={11} className="mr-1" />
                      {instantiating === pb.id ? 'Starting...' : 'Run in Squad'}
                    </Button>
                    <button
                      onClick={() => handleDelete(pb.id)}
                      className="rounded p-1 text-faint hover:text-danger transition-colors"
                      title="Delete playbook"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Roles and Steps Preview */}
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line/60 pt-3 text-[10.5px]">
                  <span className="font-semibold text-faint uppercase tracking-wider text-[10px]">Roles:</span>
                  {pb.roles.map((r) => (
                    <span
                      key={r.id}
                      className={cn(
                        'rounded-md border px-2 py-0.5 text-[10px] font-medium',
                        r.isAgent ? 'border-accent/30 bg-accent-soft/20 text-accent-ink' : 'border-line bg-surface text-ink'
                      )}
                    >
                      {r.name}
                    </span>
                  ))}
                  <span className="ml-auto text-[10px] text-faint">
                    {pb.steps.length} sequential phase{pb.steps.length === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/* ── Proof of Work Section ────────────────────────────────────────────────── */

function ProofOfWorkSection({ state }: { state: TableState }) {
  const [proofs, setProofs] = useState<ProofOfWorkRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [cert, setCert] = useState<ProofOfWorkCertificate | null>(null)

  const loadProofs = async () => {
    try {
      const list = await window.knight.proofOfWorkList(state.code ?? undefined)
      setProofs(list)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadProofs()
  }, [])

  const handleExport = async () => {
    setExporting(true)
    try {
      const certificate = await window.knight.proofOfWorkExportCertificate({
        teamSessionId: state.code ?? 'table_session',
        playbookTitle: state.goal?.title ?? 'Squad Collaboration'
      })
      setCert(certificate)
      await loadProofs()
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-6 py-6">
      {/* Header Banner */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-positive/30 bg-positive/10 p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-positive/30 bg-surface text-positive">
            <ShieldCheck size={20} />
          </span>
          <div>
            <h2 className="text-[14px] font-semibold text-ink">Cryptographic Proof of Work</h2>
            <p className="text-[11px] leading-relaxed text-muted">
              Tamper-evident Ed25519-signed verification receipts guaranteeing output authenticity.
            </p>
          </div>
        </div>

        <Button variant="primary" size="sm" onClick={handleExport} disabled={exporting}>
          <Download size={13} className="mr-1" />
          {exporting ? 'Exporting...' : 'Export Certificate (.pow.md)'}
        </Button>
      </section>

      {/* Exported Certificate Card */}
      {cert ? (
        <section className="rounded-xl border border-line bg-surface p-4">
          <div className="flex items-center gap-2 text-positive text-[12px] font-semibold">
            <FileCheck2 size={16} />
            <span>Certificate Generated: {cert.certificateId}</span>
          </div>
          <p className="mt-1 font-mono text-[10px] text-faint break-all">
            Merkle Root: {cert.merkleRoot}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-faint break-all">
            Ed25519 Sig: {cert.signature.slice(0, 32)}...
          </p>
          <p className="mt-2 text-[10px] text-positive font-medium">
            {cert.verifiedCount} of {cert.totalProofs} milestones verified against cryptographic hash chain.
          </p>
        </section>
      ) : null}

      {/* Proof of Work Ledger */}
      <section className="space-y-3">
        <h3 className="text-[12px] font-semibold tracking-wider text-faint uppercase">
          Milestone Verification Ledger ({proofs.length})
        </h3>

        {loading ? (
          <p className="text-[11px] text-muted">Loading proof records...</p>
        ) : proofs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line p-8 text-center">
            <p className="text-[12px] text-muted">No proof records recorded yet.</p>
            <p className="text-[10px] text-faint mt-1">
              As squad members and agents complete goals and joint actions, signed receipts appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {proofs.map((p, idx) => (
              <div
                key={p.proofId}
                className="rounded-xl border border-line bg-canvas/60 p-3.5 transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-faint">#{idx + 1}</span>
                    <span className="text-[12px] font-semibold text-ink">
                      {p.authorName}
                    </span>
                    <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium text-faint uppercase">
                      {p.roleId}
                    </span>
                  </div>

                  <span
                    className={cn(
                      'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase',
                      p.verificationPassed
                        ? 'border-positive/30 bg-positive/10 text-positive'
                        : 'border-danger/30 bg-danger/10 text-danger'
                    )}
                  >
                    {p.verificationPassed ? 'Verified' : 'Unverified'}
                  </span>
                </div>

                <p className="mt-1.5 text-[11.5px] text-ink/90">{p.summary}</p>

                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-faint border-t border-line/50 pt-2">
                  <span>Output Digest: {p.outputDigest.slice(0, 14)}...</span>
                  <span>Record Hash: {p.recordHash.slice(0, 14)}...</span>
                  <span className="ml-auto">{stamp(p.timestamp)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

type ChatItem =
  | { kind: 'entry'; at: string; entry: TableLedgerEntry }
  | { kind: 'proposal'; at: string; proposal: TableProposal }

export function SharedTable() {
  const state = useTableStore((store) => store.state)
  const busy = useTableStore((store) => store.busy)
  const actionError = useTableStore((store) => store.error)
  const leave = useTableStore((store) => store.leave)
  const setGoal = useTableStore((store) => store.setGoal)
  const propose = useTableStore((store) => store.propose)
  const turnKey = useTableStore((store) => store.turnKey)
  const withdraw = useTableStore((store) => store.withdraw)
  const publish = useTableStore((store) => store.publish)
  const markDone = useTableStore((store) => store.markDone)
  const clearError = useTableStore((store) => store.clearError)
  const openTask = useApp((state) => state.openTask)

  const me = ownSeat(state)
  const partner = state.peers.find((peer) => peer.seat !== me)
  const openAction = state.proposals.find(
    (proposal) => proposal.status === 'pending' || proposal.status === 'approved'
  )
  const hostWaiting = state.role === 'host' && !partner?.online

  const [activeTab, setActiveTab] = useState<'table' | 'playbooks' | 'proofs' | 'harmonia' | 'trust'>('table')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')

  const feedRef = useRef<HTMLDivElement>(null)

  /* Proposal lifecycle events already read fully inside their card, so the
     ledger lines that merely restate them are dropped from the feed. */
  const items = useMemo<ChatItem[]>(() => {
    const titles = state.proposals.map((proposal) => proposal.title)
    const duplicated = (text: string): boolean =>
      titles.some((proposalTitle) => text.includes(`“${proposalTitle}”`))
    const entries = state.ledger.filter(
      (entry) => entry.status === 'shared' && !duplicated(entry.text)
    )
    return [
      ...entries.map((entry) => ({ kind: 'entry', at: entry.at, entry }) as ChatItem),
      ...state.proposals.map(
        (proposal) => ({ kind: 'proposal', at: proposal.createdAt, proposal }) as ChatItem
      )
    ].sort((a, b) => a.at.localeCompare(b.at))
  }, [state.ledger, state.proposals])

  useEffect(() => {
    const el = feedRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items.length])

  const onLeave = (): void => {
    if (!partner?.online) {
      void leave()
      return
    }
    void (async () => {
      const confirmed = await confirmDialog({
        title: 'Leave the table?',
        body: `The link closes for every ${agentName()} seated here, and any joint action still waiting on keys is dropped.`,
        confirmLabel: 'Leave table',
        danger: true
      })
      if (confirmed) void leave()
    })()
  }

  const submitProposal = (): void => {
    if (!title.trim() || !summary.trim() || busy) return
    void propose({ title: title.trim(), summary: summary.trim() }).then((ok) => {
      if (!ok) return
      setTitle('')
      setSummary('')
    })
  }

  const emptySeats = Math.max(0, TABLE_MAX_PEERS - state.peers.length)

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-canvas/85 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <h1 className="display text-[17px] leading-none text-ink">Table</h1>
          <span className="flex items-center gap-1 rounded-full border border-identity-b/30 bg-identity-b/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-identity-b uppercase">
            <span className="joint-marker h-1.5 w-1.5 rounded-full" />
            Collab
          </span>
          <span
            className={cn(
              'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium',
              state.connected
                ? 'border-positive/30 bg-positive/10 text-positive'
                : 'border-danger/30 bg-danger/10 text-danger'
            )}
          >
            {state.connected ? <Wifi size={9} /> : <WifiOff size={9} />}
            {state.connected ? 'link live' : 'link down'}
          </span>
        </div>

        <div className="flex items-center rounded-lg border border-line bg-surface/80 p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setActiveTab('table')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors',
              activeTab === 'table' ? 'bg-canvas text-ink shadow-sm' : 'text-muted hover:text-ink'
            )}
          >
            <Radio size={11} />
            Round Table
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('playbooks')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors',
              activeTab === 'playbooks' ? 'bg-canvas text-ink shadow-sm' : 'text-muted hover:text-ink'
            )}
          >
            <BookOpen size={11} />
            Team Playbooks
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('proofs')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors',
              activeTab === 'proofs' ? 'bg-canvas text-ink shadow-sm' : 'text-muted hover:text-ink'
            )}
          >
            <ShieldCheck size={11} />
            Proof of Work
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('harmonia')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors',
              activeTab === 'harmonia' ? 'bg-canvas text-ink shadow-sm' : 'text-muted hover:text-ink'
            )}
          >
            <Sparkles size={11} />
            Harmonia Decisions
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('trust')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors',
              activeTab === 'trust' ? 'bg-canvas text-ink shadow-sm' : 'text-muted hover:text-ink'
            )}
          >
            <ShieldAlert size={11} />
            Trust & Autonomy
          </button>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex items-center -space-x-1.5">
            {state.peers.map((peer) => (
              <SeatAvatar
                key={peer.seat}
                seat={peer.seat}
                peers={state.peers}
                className="ring-2 ring-canvas"
              />
            ))}
            {Array.from({ length: emptySeats }, (_, index) => (
              <span
                key={`empty-${index}`}
                className="h-7 w-7 rounded-full border border-dashed border-line bg-canvas ring-2 ring-canvas"
              />
            ))}
          </div>
          <span className="font-mono text-[10px] text-faint">
            {state.peers.filter((peer) => peer.online).length}/{TABLE_MAX_PEERS} present
          </span>
          {state.code ? (
            <span className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1">
              <span className="font-mono text-[12px] tracking-[0.22em] text-ink">{state.code}</span>
              <CopyButton value={state.code} label="Copy table code" />
            </span>
          ) : null}
          <Button variant="secondary" size="sm" onClick={onLeave} disabled={busy}>
            Leave table
          </Button>
        </div>
      </header>

      {actionError ? (
        <div className="flex items-start gap-2.5 border-b border-danger/20 bg-danger/5 px-6 py-2">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />
          <p className="min-w-0 flex-1 text-[10.5px] leading-relaxed text-danger">{actionError}</p>
          <button
            onClick={clearError}
            className="rounded p-0.5 text-danger/70 hover:text-danger"
            aria-label="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      ) : null}
      {state.error ? (
        <div className="flex items-start gap-2.5 border-b border-warn/20 bg-warn/5 px-6 py-2">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
          <p className="text-[10.5px] leading-relaxed text-warn">{state.error}</p>
        </div>
      ) : null}

      {activeTab === 'playbooks' ? (
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <PlaybooksSection state={state} onOpenTask={openTask} />
        </div>
      ) : activeTab === 'proofs' ? (
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <ProofOfWorkSection state={state} />
        </div>
      ) : activeTab === 'harmonia' ? (
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <HarmoniaFeed />
        </div>
      ) : activeTab === 'trust' ? (
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <TrustDashboard />
        </div>
      ) : (
        <>
          <div ref={feedRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-6 pb-6 pt-5">
              {hostWaiting ? (
                <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-accent/20 bg-accent-soft/20 px-4 py-3.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/25 bg-surface text-accent-ink">
                    <Radio size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11.5px] font-semibold text-ink">
                      Waiting for the other agents
                    </p>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-faint">
                      Share the code with the other machine on your network. Discovery finds this table
                      automatically; the address works if it does not.
                    </p>
                    {state.address || state.port ? (
                      <p className="mt-0.5 font-mono text-[10px] text-faint">
                        {state.address ?? 'this machine'}:{state.port ?? '—'}
                      </p>
                    ) : null}
                  </div>
                </section>
              ) : null}

              <GoalTopic
                key={state.goal?.updatedAt ?? 'empty'}
                goal={state.goal}
                peers={state.peers}
                busy={busy}
                onSave={setGoal}
              />

              {items.map((item) =>
                item.kind === 'proposal' ? (
                  <ProposalMessage
                    key={item.proposal.id}
                    proposal={item.proposal}
                    state={state}
                    me={me}
                    busy={busy}
                    onTurnKey={() => void turnKey(item.proposal.id)}
                    onWithdraw={() => void withdraw(item.proposal.id)}
                    onPublish={() => void publish(item.proposal.id)}
                    onMarkDone={() => void markDone(item.proposal.id)}
                    onOpenTask={() => {
                      const taskId = item.proposal.taskIds?.[me]
                      if (taskId) void openTask(taskId)
                    }}
                  />
                ) : (
                  <LedgerMessage key={item.entry.id} entry={item.entry} peers={state.peers} />
                )
              )}

              {items.length === 0 && !hostWaiting ? (
                <div className="py-10 text-center">
                  <p className="text-[11.5px] text-muted">Nothing on the table yet.</p>
                  <p className="mt-1 text-[10px] text-faint">
                    Set a shared goal, or propose a joint action below.
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          <footer className="border-t border-line bg-canvas/85 px-6 py-3.5 backdrop-blur">
            <div className="mx-auto w-full max-w-[760px]">
              {openAction ? (
                <div className="flex items-center gap-2 rounded-[var(--r-composer)] border border-line bg-canvas/50 px-3.5 py-2.5">
                  <KeyRound size={12} className="shrink-0 text-faint" />
                  <p className="min-w-0 flex-1 break-words text-[10.5px] leading-relaxed text-muted">
                    One joint action at a time. Finish or withdraw “{openAction.title}” first.
                  </p>
                </div>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    submitProposal()
                  }}
                  className="composer-shell relative z-[1] flex items-end gap-2.5 px-3.5 py-2.5"
                >
                  <Plus size={15} className="mb-1 shrink-0 text-accent" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <label className="sr-only" htmlFor="table-proposal-title">
                      Joint action
                    </label>
                    <input
                      id="table-proposal-title"
                      className="w-full bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      maxLength={120}
                      placeholder="Propose a joint action…"
                    />
                    {title.trim() ? (
                      <>
                        <label className="sr-only" htmlFor="table-proposal-summary">
                          What every agent is agreeing to
                        </label>
                        <textarea
                          id="table-proposal-summary"
                          className="w-full resize-none bg-transparent text-[12px] leading-relaxed text-ink outline-none placeholder:text-faint"
                          value={summary}
                          onChange={(event) => setSummary(event.target.value)}
                          maxLength={400}
                          rows={2}
                          placeholder={`What is every ${agentName()} agreeing to?`}
                          autoFocus
                        />
                      </>
                    ) : null}
                  </div>
                  <Button
                    type="submit"
                    variant="primary"
                    size="icon"
                    disabled={busy || !title.trim() || !summary.trim()}
                    aria-label="Put it on the table"
                  >
                    <Send size={13} />
                  </Button>
                </form>
              )}
              <p className="mt-1.5 text-center text-[10px] leading-relaxed text-faint">
                Only the goal, joint actions and this ledger cross the link — every seated key is
                needed, nothing else is shared.
              </p>
            </div>
          </footer>
        </>
      )}
    </div>
  )
}
