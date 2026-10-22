import { ArrowRight, BadgeCheck, KeyRound, LockKeyhole, ShieldAlert, Undo2 } from 'lucide-react'
import { Button } from '../../components/ui'
import { cn, timeAgo } from '../../lib/utils'
import type { TablePeer, TableProposal, TableSeat } from '@shared/types'

const STATUS: Record<
  TableProposal['status'],
  { label: string; className: string }
> = {
  pending: { label: 'Two keys needed', className: 'border-warn/30 bg-warn/10 text-warn' },
  approved: { label: 'Co-signed', className: 'border-positive/30 bg-positive/10 text-positive' },
  withdrawn: { label: 'Withdrawn', className: 'border-danger/30 bg-danger/10 text-danger' },
  published: { label: 'Published', className: 'border-line bg-canvas text-muted' }
}

function seatName(peers: TablePeer[], seat: TableSeat): string {
  return peers.find((peer) => peer.seat === seat)?.name ?? 'Waiting for the second Captain'
}

function KeyCard({
  name,
  on,
  own,
  waiting
}: {
  name: string
  on: boolean
  own: boolean
  waiting: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-xl border px-3 py-3 transition-colors',
        on
          ? own
            ? 'border-identity-a/40 bg-identity-a/5'
            : 'border-identity-b/40 bg-identity-b/5'
          : 'border-line bg-canvas/40'
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            own ? 'bg-identity-a' : waiting ? 'bg-faint' : 'bg-identity-b'
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink">{name}</span>
        <span
          className={cn(
            'rounded-full border px-1.5 py-0.5 text-[8.5px] font-semibold tracking-wide uppercase',
            on ? 'border-positive/30 bg-positive/10 text-positive' : 'border-line bg-surface text-faint'
          )}
        >
          {on ? 'Key on' : 'Key off'}
        </span>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <span
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-full border',
            on ? 'border-positive/30 bg-positive/10 text-positive' : 'border-line text-faint'
          )}
        >
          {on ? <KeyRound size={14} /> : <LockKeyhole size={14} />}
        </span>
        <p className="text-[9.5px] leading-snug text-faint">
          {on
            ? 'Turned on the record.'
            : waiting
              ? 'Not at the table yet.'
              : own
                ? 'Your key is still off.'
                : 'Their key is still off.'}
        </p>
      </div>
    </div>
  )
}

export function TwoKeyGate({
  proposal,
  peers,
  ownSeat,
  busy,
  onTurnKey,
  onWithdraw,
  onPublish
}: {
  proposal: TableProposal
  peers: TablePeer[]
  ownSeat: TableSeat
  busy: boolean
  onTurnKey: () => void
  onWithdraw: () => void
  onPublish: () => void
}) {
  const other: TableSeat = ownSeat === 'a' ? 'b' : 'a'
  const meta = STATUS[proposal.status]
  const pending = proposal.status === 'pending'
  const approved = proposal.status === 'approved'
  const published = proposal.status === 'published'
  const withdrawn = proposal.status === 'withdrawn'
  const ownKey = proposal.keys[ownSeat]
  const otherKey = proposal.keys[other]
  const partner = peers.find((peer) => peer.seat === other)

  return (
    <section className="card overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h3 className="text-[13px] font-semibold text-ink">{proposal.title}</h3>
            <span className="font-mono text-[8.5px] text-faint">
              {proposal.proposedBy === ownSeat ? 'proposed by you' : `by ${seatName(peers, proposal.proposedBy)}`}{' '}
              · {timeAgo(proposal.createdAt)}
            </span>
          </div>
          <p className="mt-1 max-w-[520px] text-[10.5px] leading-relaxed text-muted">
            {proposal.summary}
          </p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold tracking-wide uppercase',
            meta.className
          )}
        >
          {meta.label}
        </span>
      </div>

      <div className="px-5 py-4">
        <div className="flex h-1.5 overflow-hidden rounded-full bg-line/60">
          <span
            className="h-full bg-identity-a transition-all duration-300"
            style={{ width: proposal.keys.a ? '50%' : '0%' }}
          />
          <span
            className="h-full bg-identity-b transition-all duration-300"
            style={{ width: proposal.keys.b ? '50%' : '0%' }}
          />
        </div>

        <div className="mt-3.5 grid gap-2 sm:grid-cols-2">
          <KeyCard
            name={seatName(peers, ownSeat)}
            own
            on={ownKey}
            waiting={false}
          />
          <KeyCard
            name={seatName(peers, other)}
            own={false}
            on={otherKey}
            waiting={!partner?.online}
          />
        </div>

        {approved ? (
          <div className="mt-3.5 flex items-start gap-2 rounded-xl border border-positive/25 bg-positive/5 px-3 py-2.5">
            <BadgeCheck size={13} className="mt-0.5 shrink-0 text-positive" />
            <p className="text-[10.5px] leading-relaxed text-positive">
              Both keys are on the record. Either Captain can publish it to the shared table.
            </p>
          </div>
        ) : null}
        {withdrawn ? (
          <div className="mt-3.5 flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/5 px-3 py-2.5">
            <ShieldAlert size={13} className="mt-0.5 shrink-0 text-danger" />
            <p className="text-[10.5px] leading-relaxed text-danger">
              Withdrawn by {seatName(peers, proposal.proposedBy)}. Nothing was published.
            </p>
          </div>
        ) : null}
        {published ? (
          <div className="mt-3.5 flex items-start gap-2 rounded-xl border border-line bg-canvas/60 px-3 py-2.5">
            <ArrowRight size={13} className="mt-0.5 shrink-0 text-muted" />
            <p className="text-[10.5px] leading-relaxed text-muted">
              Published to the table. This record is closed.
            </p>
          </div>
        ) : null}

        {pending ? (
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant="primary"
              disabled={busy || ownKey}
              onClick={onTurnKey}
            >
              <KeyRound size={11} />
              {ownKey ? 'Your key is on' : 'Turn your key'}
            </Button>
            {ownKey && partner ? (
              <span className="text-[9.5px] text-faint">
                Waiting for {partner.name} to turn theirs.
              </span>
            ) : null}
            {proposal.proposedBy === ownSeat ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={onWithdraw}>
                <Undo2 size={11} />
                Withdraw
              </Button>
            ) : null}
          </div>
        ) : null}

        {approved ? (
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-[9.5px] text-faint">The gate is unlocked.</p>
            <Button size="sm" variant="accent" disabled={busy} onClick={onPublish}>
              Publish to the table
              <ArrowRight size={11} />
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  )
}
