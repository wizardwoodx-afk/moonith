import { useState } from 'react'
import {
  ArrowLeft,
  Check,
  Copy,
  KeyRound,
  LockKeyhole,
  PenLine,
  Plus,
  Radio,
  ShieldCheck,
  Users,
  Wifi,
  WifiOff,
  X
} from 'lucide-react'
import { Button } from '../../components/ui'
import { cn, timeAgo } from '../../lib/utils'
import { TABLE_MAX_PEERS, ownSeat } from '@shared/table'
import type {
  TableGoal,
  TableLedgerEntry,
  TablePeer,
  TableProposal,
  TableState
} from '@shared/types'
import { useTableStore } from './tableStore'
import { TwoKeyGate } from './TwoKeyGate'

const LEDGER_STATUS: Record<TableLedgerEntry['status'], { label: string; className: string }> = {
  shared: { label: 'Shared', className: 'border-line bg-canvas text-muted' },
  pending: { label: 'Pending', className: 'border-warn/30 bg-warn/10 text-warn' },
  approved: { label: 'Co-signed', className: 'border-positive/30 bg-positive/10 text-positive' },
  withdrawn: { label: 'Withdrawn', className: 'border-danger/30 bg-danger/10 text-danger' }
}

function stamp(iso: string): string {
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

function seatName(peers: TablePeer[], seat: TableProposal['proposedBy'] | 'joint'): string {
  if (seat === 'joint') return 'Joint'
  return peers.find((peer) => peer.seat === seat)?.name ?? 'Captain'
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

function GoalPanel({
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
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <p className="text-[9px] font-semibold tracking-[0.14em] text-faint uppercase">
            Shared goal
          </p>
          {goal && !editing ? (
            <h2 className="display mt-1 text-[20px] leading-tight text-ink">{goal.title}</h2>
          ) : (
            <h2 className="mt-1 text-[14px] font-semibold text-ink">
              {goal ? 'Edit the shared goal' : 'Set what this table is for'}
            </h2>
          )}
          {goal && !editing ? (
            <p className="mt-1 max-w-[520px] text-[11px] leading-relaxed text-muted">
              {goal.detail || 'No notes yet.'}
            </p>
          ) : null}
          {goal && !editing ? (
            <p className="mt-1.5 font-mono text-[8.5px] text-faint">
              set by {seatName(peers, goal.setBy)} · updated {timeAgo(goal.updatedAt)}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {goal?.due && !editing ? (
            <span className="rounded-full border border-line bg-canvas px-2 py-0.5 font-mono text-[9px] text-muted">
              Due {goal.due}
            </span>
          ) : null}
          {goal && !editing ? (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <PenLine size={11} />
              Edit
            </Button>
          ) : null}
        </div>
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
          className="px-5 py-4"
        >
          <label className="block text-[10px] font-medium text-muted" htmlFor="table-goal-title">
            Goal
          </label>
          <input
            id="table-goal-title"
            className="field mt-1.5"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
            autoFocus={!goal}
          />

          <label className="mt-3 block text-[10px] font-medium text-muted" htmlFor="table-goal-detail">
            Notes <span className="font-normal text-faint">optional</span>
          </label>
          <textarea
            id="table-goal-detail"
            className="field mt-1.5 min-h-[58px] resize-none py-2"
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            maxLength={600}
          />

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="w-[180px]">
              <label className="block text-[10px] font-medium text-muted" htmlFor="table-goal-due">
                Due <span className="font-normal text-faint">optional</span>
              </label>
              <input
                id="table-goal-due"
                className="field mt-1.5"
                value={due}
                onChange={(event) => setDue(event.target.value)}
                maxLength={40}
              />
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              {goal ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              ) : null}
              <Button type="submit" variant="primary" size="sm" disabled={busy || !title.trim()}>
                {goal ? 'Save goal' : 'Set the goal'}
              </Button>
            </div>
          </div>
        </form>
      ) : null}
    </section>
  )
}

function ProposalComposer({
  blocked,
  busy,
  onSubmit
}: {
  blocked: TableProposal | undefined
  busy: boolean
  onSubmit: (input: { title: string; summary: string }) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')

  if (blocked) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-line bg-canvas/50 px-3.5 py-2.5">
        <KeyRound size={12} className="shrink-0 text-faint" />
        <p className="text-[10px] leading-relaxed text-muted">
          One joint action at a time. Finish or withdraw “{blocked.title}” before proposing another.
        </p>
      </div>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-xl border border-dashed border-line bg-canvas/30 px-3.5 py-2.5 text-left transition-colors hover:border-accent/30 hover:bg-accent-soft/20"
      >
        <Plus size={13} className="shrink-0 text-accent" />
        <span className="text-[11px] font-medium text-ink">Propose a joint action</span>
        <span className="ml-auto text-[9px] text-faint">both keys required</span>
      </button>
    )
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!title.trim() || !summary.trim() || busy) return
        void onSubmit({ title: title.trim(), summary: summary.trim() }).then((ok) => {
          if (!ok) return
          setTitle('')
          setSummary('')
          setOpen(false)
        })
      }}
      className="rounded-xl border border-line bg-canvas/40 px-4 py-3.5"
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-ink">New joint action</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded p-0.5 text-faint hover:text-ink"
          aria-label="Close"
        >
          <X size={12} />
        </button>
      </div>
      <label className="mt-3 block text-[10px] font-medium text-muted" htmlFor="table-proposal-title">
        Title
      </label>
      <input
        id="table-proposal-title"
        className="field mt-1.5"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={120}
        autoFocus
      />
      <label className="mt-2.5 block text-[10px] font-medium text-muted" htmlFor="table-proposal-summary">
        What are both Captains agreeing to?
      </label>
      <textarea
        id="table-proposal-summary"
        className="field mt-1.5 min-h-[60px] resize-none py-2"
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
        maxLength={400}
      />
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-[9px] text-faint">Nothing is shared until both keys are on and it is published.</p>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={busy || !title.trim() || !summary.trim()}
        >
          Put it on the table
        </Button>
      </div>
    </form>
  )
}

function Ledger({ entries, peers }: { entries: TableLedgerEntry[]; peers: TablePeer[] }) {
  return (
    <section className="card overflow-hidden">
      <div className="flex items-end justify-between gap-3 border-b border-line px-5 py-3.5">
        <div>
          <h2 className="text-[12.5px] font-semibold tracking-[-0.01em] text-ink">Ledger</h2>
          <p className="mt-0.5 text-[10px] text-faint">Both machines see the same entries</p>
        </div>
        <span className="font-mono text-[9px] text-faint">{entries.length} entries</span>
      </div>
      {entries.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-[11px] text-muted">Nothing shared yet.</p>
          <p className="mt-1 text-[9.5px] text-faint">Set a goal or propose a joint action to begin.</p>
        </div>
      ) : (
        <div className="divide-y divide-line/60">
          {entries.map((entry) => {
            const status = LEDGER_STATUS[entry.status]
            return (
              <div key={entry.id} className="flex items-start gap-2.5 px-5 py-2.5">
                {entry.actor === 'joint' ? (
                  <span className="joint-marker mt-1.5 h-2 w-2 shrink-0 rounded-full" />
                ) : (
                  <span
                    className={cn(
                      'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                      entry.actor === 'a' ? 'bg-identity-a' : 'bg-identity-b'
                    )}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[10.5px] leading-snug text-muted">
                    <span className="font-medium text-ink">{seatName(peers, entry.actor)}</span>{' '}
                    {entry.text}
                  </p>
                  <p className="mt-0.5 font-mono text-[8.5px] text-faint">{stamp(entry.at)}</p>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] font-semibold tracking-wide uppercase',
                    status.className
                  )}
                >
                  {status.label}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function TableStatus({ state }: { state: TableState }) {
  const me = ownSeat(state)
  const rows: Array<[string, string]> = [
    ['Role', state.role === 'host' ? 'Hosting this machine' : 'Joined a table'],
    ['Code', state.code ?? '—'],
    [
      'Address',
      state.role === 'host'
        ? `${state.address ?? 'this machine'}:${state.port ?? '—'}`
        : (state.address ?? '—')
    ],
    ['Open for', timeAgo(state.startedAt ?? undefined) || 'just now']
  ]

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[12.5px] font-semibold tracking-[-0.01em] text-ink">This table</h2>
        <span
          className={cn(
            'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[8.5px] font-semibold tracking-wide uppercase',
            state.connected
              ? 'border-positive/30 bg-positive/10 text-positive'
              : 'border-danger/30 bg-danger/10 text-danger'
          )}
        >
          {state.connected ? <Wifi size={9} /> : <WifiOff size={9} />}
          {state.connected ? 'live' : 'offline'}
        </span>
      </div>

      <dl className="mt-3 space-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <dt className="text-[9.5px] text-faint">{label}</dt>
            <dd className="min-w-0 truncate font-mono text-[9.5px] text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 border-t border-line pt-3">
        <p className="text-[9px] font-semibold tracking-[0.14em] text-faint uppercase">Captains</p>
        <div className="mt-2 space-y-2">
          {state.peers.map((peer) => (
            <div key={peer.seat} className="flex items-center gap-2">
              <span
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  peer.seat === 'a' ? 'bg-identity-a' : 'bg-identity-b'
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[10.5px] font-medium text-ink">
                  {peer.name}
                  {peer.seat === me ? <span className="ml-1 text-[8.5px] text-faint">you</span> : null}
                </p>
                <p className="truncate font-mono text-[8px] text-faint">{peer.device}</p>
              </div>
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  peer.online ? 'bg-positive' : 'bg-faint'
                )}
                title={peer.online ? 'Online' : 'Offline'}
              />
            </div>
          ))}
          {state.peers.length < TABLE_MAX_PEERS ? (
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full border border-dashed border-line" />
              <p className="text-[10px] text-faint">Waiting for the second Captain</p>
            </div>
          ) : null}
        </div>
      </div>

      {state.code ? (
        <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
          <span className="font-mono text-[15px] tracking-[0.24em] text-ink">{state.code}</span>
          <span className="text-[9px] text-faint">share this code</span>
          <span className="ml-auto">
            <CopyButton value={state.code} label="Copy table code" />
          </span>
        </div>
      ) : null}

      <p className="mt-2.5 text-[8.5px] leading-relaxed text-faint">
        The table lives while SelfImpulse is open. No files, tools or provider keys cross the link.
      </p>
    </section>
  )
}

function BoundaryCard() {
  return (
    <section className="card p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck size={13} className="text-accent" />
        <h2 className="text-[12.5px] font-semibold tracking-[-0.01em] text-ink">The boundary</h2>
      </div>
      <div className="mt-3 space-y-3">
        <div>
          <p className="text-[9px] font-semibold tracking-[0.14em] text-faint uppercase">
            Stays on your desk
          </p>
          <ul className="mt-1.5 space-y-1">
            {['Your files and notes', 'Your provider keys', 'Consul, Adept, Crew', 'Private receipts'].map(
              (item) => (
                <li key={item} className="flex items-center gap-1.5 text-[10px] text-muted">
                  <LockKeyhole size={9} className="text-faint" />
                  {item}
                </li>
              )
            )}
          </ul>
        </div>
        <div className="border-t border-line pt-2.5">
          <p className="text-[9px] font-semibold tracking-[0.14em] text-faint uppercase">
            Crosses the link
          </p>
          <ul className="mt-1.5 space-y-1">
            {['The shared goal', 'Joint actions and keys', 'This ledger'].map((item) => (
              <li key={item} className="flex items-center gap-1.5 text-[10px] text-muted">
                <span className="joint-marker h-1.5 w-1.5 rounded-full" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-3 border-t border-line pt-2.5 font-mono text-[8.5px] leading-relaxed text-faint">
        no shared tools · no shared context · both keys or nothing
      </p>
    </section>
  )
}

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
  const clearError = useTableStore((store) => store.clearError)

  const me = ownSeat(state)
  const partner = state.peers.find((peer) => peer.seat !== me)
  const openAction = state.proposals.find(
    (proposal) => proposal.status === 'pending' || proposal.status === 'approved'
  )
  const hostWaiting = state.role === 'host' && !partner?.online

  const onLeave = (): void => {
    if (partner?.online && !window.confirm('Leave the table? The link closes for both Captains.')) {
      return
    }
    void leave()
  }

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="surface-enter mx-auto w-full max-w-[1200px] px-8 pt-8 pb-14">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[9px] font-semibold tracking-[0.18em] text-faint uppercase">
              Shared space · Collab
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
              <h1 className="display text-[24px] leading-none text-ink">Table</h1>
              <span className="flex items-center gap-1 rounded-full border border-identity-b/30 bg-identity-b/10 px-2 py-0.5 text-[9px] font-semibold tracking-wide text-identity-b uppercase">
                <span className="joint-marker h-1.5 w-1.5 rounded-full" />
                Collab
              </span>
              <span
                className={cn(
                  'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-medium',
                  state.connected
                    ? 'border-positive/30 bg-positive/10 text-positive'
                    : 'border-danger/30 bg-danger/10 text-danger'
                )}
              >
                {state.connected ? <Wifi size={9} /> : <WifiOff size={9} />}
                {state.connected ? 'link live' : 'link down'}
              </span>
            </div>
            <p className="mt-2 max-w-[560px] text-[11.5px] leading-relaxed text-muted">
              Two Captains, two local engines. Only the goal, joint actions and ledger cross the
              link; every action needs both keys.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={onLeave} disabled={busy}>
            <ArrowLeft size={12} />
            Leave table
          </Button>
        </header>

        {actionError ? (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-danger/25 bg-danger/5 px-3.5 py-2.5">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />
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
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-warn/25 bg-warn/5 px-3.5 py-2.5">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
            <p className="text-[10.5px] leading-relaxed text-warn">{state.error}</p>
          </div>
        ) : null}

        {hostWaiting ? (
          <section className="mt-4 flex flex-wrap items-center gap-4 rounded-2xl border border-accent/20 bg-accent-soft/20 px-5 py-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/25 bg-surface text-accent-ink">
              <Radio size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold text-ink">Waiting for the second Captain</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-faint">
                Share the code with the other machine on your network. Discovery finds this table
                automatically; the address below works if it does not.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-lg border border-line bg-surface px-3 py-1.5 font-mono text-[20px] tracking-[0.3em] text-ink">
                {state.code}
              </span>
              {state.code ? <CopyButton value={state.code} label="Copy table code" /> : null}
            </div>
          </section>
        ) : null}

        <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_312px]">
          <div className="space-y-4">
            <GoalPanel
              key={state.goal?.updatedAt ?? 'empty'}
              goal={state.goal}
              peers={state.peers}
              busy={busy}
              onSave={setGoal}
            />

            <section className="card p-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-[12.5px] font-semibold tracking-[-0.01em] text-ink">
                    Joint actions
                  </h2>
                  <p className="mt-0.5 text-[10px] text-faint">
                    Turned by one Captain, unlocked by two
                  </p>
                </div>
                <span className="flex items-center gap-1.5 font-mono text-[9px] text-faint">
                  <Users size={10} />
                  {state.peers.filter((peer) => peer.online).length}/{TABLE_MAX_PEERS} present
                </span>
              </div>

              <div className="mt-3">
                <ProposalComposer blocked={openAction} busy={busy} onSubmit={propose} />
              </div>

              {state.proposals.length ? (
                <div className="mt-3 space-y-3">
                  {state.proposals.map((proposal) => (
                    <TwoKeyGate
                      key={proposal.id}
                      proposal={proposal}
                      peers={state.peers}
                      ownSeat={me}
                      busy={busy}
                      onTurnKey={() => void turnKey(proposal.id)}
                      onWithdraw={() => void withdraw(proposal.id)}
                      onPublish={() => void publish(proposal.id)}
                    />
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-[10px] text-faint">
                  No joint actions yet. Anything that touches both desks goes through this gate.
                </p>
              )}
            </section>

            <Ledger entries={state.ledger} peers={state.peers} />
          </div>

          <div className="space-y-4">
            <TableStatus state={state} />
            <BoundaryCard />
          </div>
        </div>
      </div>
    </div>
  )
}
