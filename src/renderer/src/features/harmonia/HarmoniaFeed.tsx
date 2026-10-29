import { useEffect, useState } from 'react'
import {
  Check,
  X,
  Sparkles,
  GitCommit,
  Lightbulb,
  FileCode,
  ShieldAlert,
  RotateCw,
  Clock,
  ExternalLink,
  MessageSquare
} from 'lucide-react'
import { Button } from '../../components/ui'
import { cn, timeAgo } from '../../lib/utils'
import type {
  HarmoniaDecisionCard,
  HarmoniaDecisionKind,
  HarmoniaDecisionStatus
} from '@shared/types'

const KIND_CONFIG: Record<
  HarmoniaDecisionKind,
  { label: string; icon: any; color: string; bg: string }
> = {
  patch: {
    label: 'Code Patch',
    icon: FileCode,
    color: 'text-sky-400',
    bg: 'bg-sky-500/10 border-sky-500/20'
  },
  action: {
    label: 'Agent Action',
    icon: GitCommit,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/20'
  },
  insight: {
    label: 'Mneme Insight',
    icon: Lightbulb,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/20'
  },
  review: {
    label: 'Review Required',
    icon: ShieldAlert,
    color: 'text-violet-400',
    bg: 'bg-violet-500/10 border-violet-500/20'
  }
}

export function HarmoniaFeed() {
  const [cards, setCards] = useState<HarmoniaDecisionCard[]>([])
  const [statusFilter, setStatusFilter] = useState<HarmoniaDecisionStatus | 'all'>('all')
  const [loading, setLoading] = useState(false)
  const [decidingId, setDecidingId] = useState<string | null>(null)
  const [commentInput, setCommentInput] = useState<Record<string, string>>({})

  const loadCards = async () => {
    setLoading(true)
    try {
      const res = await window.selfimpulse.harmoniaList(
        statusFilter === 'all' ? undefined : statusFilter
      )
      setCards(res)
    } catch (err) {
      console.error('Failed to load Harmonia cards', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCards()
  }, [statusFilter])

  const handleDecision = async (
    cardId: string,
    decision: 'accept' | 'reject'
  ) => {
    setDecidingId(cardId)
    try {
      const comment = commentInput[cardId]?.trim()
      await window.selfimpulse.harmoniaDecide({
        cardId,
        decision,
        comment: comment || undefined
      })
      await loadCards()
      setCommentInput((prev) => {
        const next = { ...prev }
        delete next[cardId]
        return next
      })
    } catch (err) {
      console.error('Failed to decide Harmonia card', err)
    } finally {
      setDecidingId(null)
    }
  }

  const pendingCount = cards.filter((c) => c.status === 'pending').length

  return (
    <div className="flex h-full flex-col p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight text-ink flex items-center gap-2">
              <Sparkles size={18} className="text-amber-400" />
              Harmonia Executive Decision Feed
            </h2>
            {pendingCount > 0 && (
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300 border border-amber-500/30">
                {pendingCount} pending
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted leading-relaxed max-w-xl">
            Autonomous agents finish background execution and deliver structured decision cards
            directly to you. Review code diffs and insights, then approve or reject in one click.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Status filters */}
          <div className="flex rounded-lg border border-line bg-surface p-0.5 text-xs">
            {(['all', 'pending', 'accepted', 'rejected'] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setStatusFilter(filter)}
                className={cn(
                  'rounded-md px-3 py-1 font-medium capitalize transition-colors',
                  statusFilter === filter
                    ? 'bg-canvas text-ink shadow-sm'
                    : 'text-muted hover:text-ink'
                )}
              >
                {filter}
              </button>
            ))}
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={loadCards}
            disabled={loading}
            className="h-8 px-2.5 text-muted hover:text-ink"
            aria-label="Refresh decisions"
          >
            <RotateCw size={13} className={cn(loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* Card Grid / List */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line p-12 text-center">
            <Sparkles size={32} className="text-muted mb-3 opacity-60" />
            <h3 className="text-sm font-medium text-ink">Feed is clear</h3>
            <p className="mt-1 text-xs text-muted max-w-sm">
              No decision cards matching the filter. Background agents will publish cards here as soon as
              patches or proactive discoveries are ready for your executive sign-off.
            </p>
          </div>
        ) : (
          cards.map((card) => {
            const kindMeta = KIND_CONFIG[card.kind] ?? KIND_CONFIG.action
            const Icon = kindMeta.icon
            const isPending = card.status === 'pending'
            const isDeciding = decidingId === card.cardId

            return (
              <div
                key={card.cardId}
                className={cn(
                  'group relative rounded-xl border transition-all p-5 shadow-sm',
                  isPending
                    ? 'border-line hover:border-line-active bg-surface/60'
                    : 'border-line/60 bg-surface/30 opacity-80'
                )}
              >
                {/* Card Top Metadata */}
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium border',
                        kindMeta.bg,
                        kindMeta.color
                      )}
                    >
                      <Icon size={12} />
                      {kindMeta.label}
                    </span>
                    <span className="text-xs font-medium text-muted">
                      via <strong className="text-ink">{card.agentName}</strong>
                    </span>
                    <span className="text-[11px] text-faint flex items-center gap-1">
                      <Clock size={10} />
                      {timeAgo(card.timestamp)}
                    </span>
                  </div>

                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider border',
                      card.status === 'pending' &&
                        'bg-amber-500/10 text-amber-400 border-amber-500/20',
                      card.status === 'accepted' &&
                        'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
                      card.status === 'rejected' &&
                        'bg-rose-500/10 text-rose-400 border-rose-500/20'
                    )}
                  >
                    {card.status}
                  </span>
                </div>

                {/* Title & Summary */}
                <h3 className="text-sm font-semibold text-ink mb-1.5">{card.title}</h3>
                <p className="text-xs text-muted leading-relaxed mb-3">{card.summary}</p>

                {/* Diff Preview if present */}
                {card.diff && (
                  <div className="mb-3 rounded-lg border border-line bg-black/40 p-3 font-mono text-[11px] leading-tight text-neutral-300 overflow-x-auto max-h-48 scroll-thin">
                    <pre className="whitespace-pre">{card.diff}</pre>
                  </div>
                )}

                {/* Suggested Action Bar */}
                <div className="flex items-center gap-2 rounded-lg bg-canvas/70 border border-line px-3 py-2 text-xs text-muted mb-4">
                  <span className="font-semibold text-ink">Action:</span>
                  <span className="flex-1">{card.suggestedAction}</span>
                </div>

                {/* Comments / Decision Feedback if accepted/rejected */}
                {card.metadata?.decisionComment ? (
                  <div className="flex items-center gap-2 text-xs text-faint mb-3 pl-1">
                    <MessageSquare size={11} />
                    <span>Executive Note: &ldquo;{String(card.metadata.decisionComment)}&rdquo;</span>
                  </div>
                ) : null}

                {/* Action Buttons for Pending Cards */}
                {isPending && (
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-line/60">
                    <div className="flex-1 min-w-[200px]">
                      <input
                        type="text"
                        placeholder="Optional comment / direction..."
                        value={commentInput[card.cardId] ?? ''}
                        onChange={(e) =>
                          setCommentInput((prev) => ({
                            ...prev,
                            [card.cardId]: e.target.value
                          }))
                        }
                        className="w-full bg-canvas/50 border border-line rounded-md px-2.5 py-1 text-xs text-ink placeholder:text-faint focus:outline-none focus:border-line-active"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isDeciding}
                        onClick={() => handleDecision(card.cardId, 'reject')}
                        className="h-8 gap-1.5 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                      >
                        <X size={13} />
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        disabled={isDeciding}
                        onClick={() => handleDecision(card.cardId, 'accept')}
                        className="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
                      >
                        <Check size={13} />
                        Accept & Apply
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
