import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  Download,
  RefreshCw,
  ScrollText,
  Search,
  ShieldCheck
} from 'lucide-react'
import type {
  AuditEventView,
  AuditExportResult,
  AuditSummary,
  AuditVerifyResult,
  RuntimeAuditOutcome
} from '@shared/audit'
import { AGENT_ROLE_LABELS } from '@shared/governance'
import { useApp } from '../../store'
import { Button, Spin } from '../../components/ui'
import { cn, errorMessage } from '../../lib/utils'
import { SettingsSection } from './SettingsSection'
import { TaskOrb } from '../../motion/TaskOrb'

type Outcome =
  | { tone: 'positive'; message: string }
  | { tone: 'danger'; message: string }

function OutcomeBanner({ outcome }: { outcome: Outcome }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'flex items-start gap-2.5 rounded-xl border px-3.5 py-3',
        outcome.tone === 'positive' && 'border-positive/25 bg-positive/10',
        outcome.tone === 'danger' && 'border-danger/25 bg-danger/10'
      )}
    >
      {outcome.tone === 'positive' ? (
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-positive" />
      ) : (
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
      )}
      <p
        className={cn(
          'text-[11.5px] leading-relaxed',
          outcome.tone === 'positive' ? 'text-positive' : 'text-danger'
        )}
      >
        {outcome.message}
      </p>
    </motion.div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function outcomeClass(outcome: RuntimeAuditOutcome): string {
  if (outcome === 'denied' || outcome === 'blocked' || outcome === 'error') {
    return 'border-danger/25 bg-danger/10 text-danger'
  }
  if (outcome === 'allowed' || outcome === 'approved' || outcome === 'ok') {
    return 'border-positive/25 bg-positive/10 text-positive'
  }
  if (outcome === 'redacted' || outcome === 'requested') {
    return 'border-warn/25 bg-warn/10 text-warn'
  }
  return 'border-line bg-canvas text-muted'
}

function EventRow({ event }: { event: AuditEventView }) {
  const openTask = useApp((state) => state.openTask)
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="px-3.5 py-3"
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-[8.5px] font-medium uppercase tracking-wide',
            outcomeClass(event.outcome)
          )}
        >
          {event.outcome}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-[11px] font-medium text-ink">{event.action}</span>
            {event.target ? (
              <span className="max-w-[280px] truncate font-mono text-[10px] text-muted">
                {event.target}
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9.5px] text-faint">
            <span className="capitalize">{event.actor}</span>
            <span>·</span>
            <span>{formatTime(event.ts)}</span>
            {event.role ? (
              <>
                <span>·</span>
                <span>{AGENT_ROLE_LABELS[event.role]}</span>
              </>
            ) : null}
            <span>·</span>
            <span className="font-mono">#{event.sequence}</span>
            {event.taskId ? (
              <>
                <span>·</span>
                <button
                  onClick={() => void openTask(event.taskId!)}
                  className="font-mono text-accent-ink hover:underline"
                  title={`Open ${event.taskId}`}
                >
                  {event.taskId.slice(0, 18)}…
                </button>
              </>
            ) : null}
          </div>
          {event.detail ? (
            <p className="mt-1.5 line-clamp-2 text-[10.5px] leading-relaxed text-muted">
              {event.detail}
            </p>
          ) : null}
        </div>
      </div>
    </motion.li>
  )
}

export function AuditPane() {
  const [summary, setSummary] = useState<AuditSummary | null>(null)
  const [events, setEvents] = useState<AuditEventView[]>([])
  const [loading, setLoading] = useState(true)
  const [eventsLoading, setEventsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [eventsError, setEventsError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [query, setQuery] = useState('')
  const [eventOutcome, setEventOutcome] = useState<RuntimeAuditOutcome | ''>('')

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await window.knight.auditSummary())
      setLoadError(null)
    } catch (error) {
      setLoadError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadEvents = useCallback(
    async (search: string, selectedOutcome: RuntimeAuditOutcome | '') => {
      setEventsLoading(true)
      try {
        setEvents(
          await window.knight.auditEvents({
            query: search,
            outcome: selectedOutcome || undefined,
            limit: 100
          })
        )
        setEventsError(null)
      } catch (error) {
        setEventsError(errorMessage(error))
      } finally {
        setEventsLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    void loadSummary()
    void loadEvents('', '')
  }, [loadSummary, loadEvents])

  const runExport = async (): Promise<void> => {
    setExporting(true)
    setOutcome(null)
    try {
      const result: AuditExportResult | null = await window.knight.auditExport()
      if (result) {
        setOutcome({
          tone: 'positive',
          message: `Exported ${result.entries} recorded ${result.entries === 1 ? 'entry' : 'entries'} to ${result.path}`
        })
      }
    } catch (error) {
      setOutcome({ tone: 'danger', message: errorMessage(error) })
    } finally {
      setExporting(false)
    }
  }

  const runVerify = async (): Promise<void> => {
    setVerifying(true)
    setOutcome(null)
    try {
      const result: AuditVerifyResult | null = await window.knight.auditVerify()
      if (!result) return
      if (result.ok) {
        setOutcome({
          tone: 'positive',
          message: `Verification passed — ${result.entries} ${result.entries === 1 ? 'entry' : 'entries'}, and the signature is valid.`
        })
      } else if (result.line !== null) {
        setOutcome({
          tone: 'danger',
          message: `Tampering detected at line ${result.line}: ${result.reason}`
        })
      } else {
        setOutcome({ tone: 'danger', message: `Verification failed: ${result.reason}` })
      }
    } catch (error) {
      setOutcome({ tone: 'danger', message: errorMessage(error) })
    } finally {
      setVerifying(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-muted">
        <TaskOrb state="connecting" size={20} label="Reading signed evidence" />
        <span className="text-[11px]">Reading signed evidence</span>
      </div>
    )
  }

  const empty =
    summary !== null && summary.entries === 0 && summary.runtimeIntegrity.entries === 0

  return (
    <div className="space-y-9">
      <SettingsSection
        title="Signed audit evidence"
        description="The combined engine record and live Captain/Crew ledger are exported as deterministic, hash-chained JSONL with a keychain-backed signature."
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void loadSummary()
              void loadEvents(query, eventOutcome)
            }}
          >
            <RefreshCw size={12} /> Refresh
          </Button>
        }
      >
        <div className="space-y-5">
          <p className="text-[11.5px] leading-relaxed text-muted">
            Runtime events record policy decisions, DLP actions, provider attempts, approvals,
            tool/argument/result hashes, and completion outcomes. Raw prompts and tool payloads are
            not added to this ledger. Older engine receipts and traces remain in the export and may
            contain work content, so treat exported files as confidential.
          </p>

          {loadError ? (
            <OutcomeBanner
              outcome={{
                tone: 'danger',
                message: `The recorded decisions could not be read: ${loadError}`
              }}
            />
          ) : null}

          {summary?.runtimeIntegrity ? (
            <div
              className={cn(
                'flex items-start gap-2.5 rounded-xl border px-3.5 py-3',
                summary.runtimeIntegrity.ok
                  ? 'border-positive/25 bg-positive/10'
                  : 'border-danger/25 bg-danger/10'
              )}
            >
              {summary.runtimeIntegrity.ok ? (
                <ShieldCheck size={14} className="mt-0.5 shrink-0 text-positive" />
              ) : (
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
              )}
              <div>
                <p
                  className={cn(
                    'text-[11.5px] font-medium',
                    summary.runtimeIntegrity.ok ? 'text-positive' : 'text-danger'
                  )}
                >
                  {summary.runtimeIntegrity.ok
                    ? `Live ledger verified · ${summary.runtimeIntegrity.entries} runtime ${summary.runtimeIntegrity.entries === 1 ? 'entry' : 'entries'}`
                    : 'Live ledger integrity needs attention'}
                </p>
                <p
                  className={cn(
                    'mt-1 break-all font-mono text-[9.5px] leading-relaxed',
                    summary.runtimeIntegrity.ok ? 'text-positive/80' : 'text-danger/85'
                  )}
                >
                  {summary.runtimeIntegrity.ok
                    ? `Signed head ${summary.runtimeIntegrity.head ?? '0'.repeat(64)}`
                    : summary.runtimeIntegrity.reason}
                </p>
              </div>
            </div>
          ) : null}

          {summary && !empty ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'All evidence', value: summary.entries },
                { label: 'Runtime events', value: summary.runtime },
                { label: 'Signed receipts', value: summary.receipts },
                { label: 'Engine approvals', value: summary.approvals }
              ].map((stat, index) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.045 }}
                  className="rounded-xl border border-line bg-canvas/50 px-4 py-3"
                >
                  <p className="display text-[22px] leading-none text-ink">{stat.value}</p>
                  <p className="mt-1 text-[10.5px] text-muted">{stat.label}</p>
                </motion.div>
              ))}
            </div>
          ) : null}

          {summary && !empty && summary.firstTs && summary.lastTs ? (
            <p className="text-[11.5px] leading-relaxed text-muted">
              Covers {formatDate(summary.firstTs)} to {formatDate(summary.lastTs)}.
            </p>
          ) : null}

          {empty ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line px-6 py-10 text-center">
              <ScrollText size={20} className="text-faint" />
              <div>
                <p className="text-[13px] font-medium text-ink">Nothing recorded yet</p>
                <p className="mx-auto mt-1 max-w-[420px] text-[11.5px] leading-relaxed text-muted">
                  Run a task or change an enterprise policy to create runtime evidence. You can
                  still verify a file exported on another machine.
                </p>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <Button variant="primary" loading={exporting} disabled={empty} onClick={() => void runExport()}>
              <Download size={13} /> Export signed JSONL
            </Button>
            <Button variant="secondary" loading={verifying} onClick={() => void runVerify()}>
              <ShieldCheck size={13} /> Verify an export
            </Button>
          </div>
          {outcome ? <OutcomeBanner outcome={outcome} /> : null}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Runtime event search"
        description="Search the latest 100 matching events by action, tool, task, actor, role, or scrubbed metadata. Select a task ID to open its transcript."
      >
        <div className="space-y-4">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault()
              void loadEvents(query, eventOutcome)
            }}
          >
            <div className="relative min-w-0 flex-1">
              <Search size={12} className="absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="policy.check, write_file, task ID…"
                className="h-9 w-full rounded-lg border border-line bg-canvas pr-3 pl-8 text-[11.5px] text-ink outline-none placeholder:text-faint focus:border-accent/45"
              />
            </div>
            <select
              value={eventOutcome}
              onChange={(event) => {
                const next = event.target.value as RuntimeAuditOutcome | ''
                setEventOutcome(next)
                void loadEvents(query, next)
              }}
              className="h-9 rounded-lg border border-line bg-canvas px-2.5 text-[11px] text-ink outline-none focus:border-accent/45"
              aria-label="Filter audit outcome"
            >
              <option value="">All outcomes</option>
              {(['allowed', 'denied', 'approved', 'redacted', 'blocked', 'ok', 'error', 'info'] as RuntimeAuditOutcome[]).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <Button type="submit" variant="secondary" loading={eventsLoading}>
              Search
            </Button>
          </form>

          {eventsError ? (
            <OutcomeBanner
              outcome={{ tone: 'danger', message: `Runtime events are unavailable: ${eventsError}` }}
            />
          ) : null}

          {eventsLoading && !events.length ? (
            <div className="flex justify-center py-8 text-muted">
              <Spin size={17} />
            </div>
          ) : events.length ? (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-canvas/35">
              {events.map((event) => (
                <EventRow key={event.sequence} event={event} />
              ))}
            </ul>
          ) : (
            <div className="rounded-xl border border-dashed border-line px-5 py-8 text-center">
              <p className="text-[12px] font-medium text-ink">No matching runtime events</p>
              <p className="mt-1 text-[10.5px] text-faint">
                Clear the filters or run a task to create new evidence.
              </p>
            </div>
          )}
        </div>
      </SettingsSection>
    </div>
  )
}
