/**
 * Nomos — the governance gate, as the audit pane shows it.
 *
 * The gate is the one place every effectful tool call is judged, so this pane
 * answers three questions and nothing else: what has it been deciding, is the
 * emergency stop on, and what did it decide most recently.
 *
 * The kill switch is deliberately the loudest thing here. Engaging it denies
 * every action for every agent until it is released, and it is persisted — so
 * the state shown is always read back from the gate after the change, never
 * assumed from the click.
 */
import { agentName } from '../../lib/localProfile'
import { useCallback, useEffect, useState } from 'react'
import { OctagonX, RefreshCw, Scale, ShieldOff } from 'lucide-react'
import type {
  GovernanceRecordView,
  GovernanceSummaryView,
  KillSwitchState
} from '@shared/types'
import { Button, Modal, Spin } from '../../components/ui'
import { cn, errorMessage } from '../../lib/utils'
import { SettingsSection } from './SettingsSection'
import {
  Badge,
  DecisionDot,
  EmptyState,
  OutcomeBanner,
  PaneNote,
  Row,
  RowList,
  Stat,
  StatGrid,
  formatWhen,
  type Outcome
} from './paneBits'

const DECISION_LABEL: Record<GovernanceRecordView['decision'], string> = {
  allow: 'Allowed',
  steer: 'Sent to a human',
  deny: 'Refused'
}

const OUTCOME_LABEL: Record<string, string> = {
  success: 'succeeded',
  failure: 'failed',
  denied: 'never ran',
  unknown: 'unknown'
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

export function GovernancePane() {
  const [summary, setSummary] = useState<GovernanceSummaryView | null>(null)
  const [records, setRecords] = useState<GovernanceRecordView[]>([])
  const [kill, setKill] = useState<KillSwitchState | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [askEngage, setAskEngage] = useState(false)
  const [reason, setReason] = useState('')
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const load = useCallback(async () => {
    try {
      const [nextSummary, nextRecords] = await Promise.all([
        window.knight.governanceSummary(),
        window.knight.governanceRecent(40)
      ])
      setSummary(nextSummary)
      setRecords(nextRecords)
      setLoadError(null)
    } catch (error) {
      setLoadError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /* The command response comes from the gate itself, so it is fresh truth for
   * the switch — fold it into the summary so a failed reload cannot show a
   * stale "engaged" (or hide a persisted one) next to the counts. */
  const applyKill = (state: KillSwitchState): void => {
    setKill(state)
    setSummary((previous) =>
      previous
        ? { ...previous, killEngaged: state.engaged, killReason: state.reason }
        : previous
    )
  }

  const engage = async (): Promise<void> => {
    setBusy(true)
    setOutcome(null)
    try {
      const state = await window.knight.governanceEngageKill(reason.trim() || 'Engaged by hand')
      applyKill(state)
      setAskEngage(false)
      setReason('')
      setOutcome({
        tone: 'danger',
        message:
          `The kill switch is engaged. Every action ${agentName()} or any sub-agent attempts is refused until you release it.`
      })
      await load()
    } catch (error) {
      setOutcome({ tone: 'danger', message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const release = async (): Promise<void> => {
    setBusy(true)
    setOutcome(null)
    try {
      const state = await window.knight.governanceReleaseKill()
      applyKill(state)
      setOutcome({
        tone: 'positive',
        message: 'The kill switch is released. Governed actions are judged normally again.'
      })
      await load()
    } catch (error) {
      setOutcome({ tone: 'danger', message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted">
        <Spin size={20} />
      </div>
    )
  }

  /* Persisted state wins: the summary is read from the gate on mount and after
   * every command, so the local response can add detail but must never report
   * "released" over an engaged switch. A summary without the field is unknown,
   * not released. */
  const persistedKill =
    typeof summary?.killEngaged === 'boolean' ? summary.killEngaged : null
  const engaged = persistedKill === true || kill?.engaged === true
  const gateKnown = persistedKill !== null || kill !== null
  const killReason = textOrNull(summary?.killReason) ?? textOrNull(kill?.reason)
  const killAt = textOrNull(summary?.killAt) ?? textOrNull(kill?.at)
  const killBy = textOrNull(summary?.killBy) ?? textOrNull(kill?.by)
  const decided = summary ? summary.allow + summary.steer + summary.deny : 0

  return (
    <SettingsSection
      title="Governance gate"
      
    >
      <div className="space-y-5">
        <PaneNote>
          Every tool action passes this gate before it runs. High-risk actions always ask you.
        </PaneNote>

        {loadError ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-danger/25 bg-danger/10 px-3.5 py-3">
            <ShieldOff size={14} className="mt-0.5 shrink-0 text-danger" />
            <p className="text-[11.5px] leading-relaxed text-danger">
              The gate could not be read: {loadError}
            </p>
          </div>
        ) : null}

        {summary ? (
          <StatGrid>
            <Stat label="Allowed" value={summary.allow} hint="ran without asking" />
            <Stat
              label="Sent to a human"
              value={summary.steer}
              tone={summary.steer > 0 ? 'warn' : 'default'}
              hint="needed your approval"
            />
            <Stat
              label="Refused"
              value={summary.deny}
              tone={summary.deny > 0 ? 'danger' : 'default'}
              hint="never ran"
            />
            <Stat label="Registered agents" value={summary.agents} />
          </StatGrid>
        ) : null}

        {summary && decided === 0 ? (
          <EmptyState icon={<Scale size={18} />} title="Nothing judged yet" />
        ) : null}

        {/* ── the emergency control ─────────────────────────────────────────── */}
        <div
          className={cn(
            'rounded-xl border px-4 py-3.5',
            engaged
              ? 'border-danger/40 bg-danger/10 ring-1 ring-danger/20'
              : 'border-line bg-canvas/50'
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                    engaged ? 'bg-danger/15 text-danger' : 'bg-surface-2 text-muted'
                  )}
                >
                  <OctagonX size={13} />
                </span>
                <p className="text-[12.5px] font-medium text-ink">Kill switch</p>
                <Badge tone={engaged ? 'danger' : gateKnown ? 'default' : 'warn'}>
                  {engaged ? 'Engaged' : gateKnown ? 'Released' : 'Unknown'}
                </Badge>
              </div>

              {engaged ? (
                <div
                  role="alert"
                  className="mt-2.5 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-danger">
                    Emergency stop engaged — every action is being refused
                  </p>
                  <div className="mt-1.5 space-y-0.5 text-[11px] leading-relaxed text-danger">
                    {killReason ? (
                      <p>
                        <span className="font-medium">Reason:</span> {killReason}
                      </p>
                    ) : null}
                    {killAt ? (
                      <p>
                        <span className="font-medium">Engaged:</span> {formatWhen(killAt)}
                      </p>
                    ) : null}
                    {killBy ? (
                      <p>
                        <span className="font-medium">By:</span> {killBy}
                      </p>
                    ) : null}
                    {!killReason && !killAt && !killBy ? (
                      <p>Engaged before this session; the gate did not return when or why.</p>
                    ) : !killAt && !killBy ? (
                      <p className="text-danger/80">
                        The gate did not report when or by whom it was engaged.
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="mt-1.5 max-w-[520px] text-[11.5px] leading-relaxed text-muted">
                  {gateKnown
                    ? 'Engaging refuses every governed action, immediately and across restarts. Use it when something is running that should not be.'
                    : 'The gate could not be read, so whether the emergency stop is engaged is unknown. Engaging still refuses everything until you release it.'}
                </p>
              )}

              {engaged ? (
                <p className="mt-1.5 text-[10.5px] text-muted">
                  Stays engaged across a restart until you release it.
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {engaged ? (
                <Button variant="primary" loading={busy} onClick={() => void release()}>
                  Release the kill switch
                </Button>
              ) : (
                <>
                  {!gateKnown ? (
                    <Button variant="secondary" onClick={() => void load()}>
                      <RefreshCw size={13} /> Read again
                    </Button>
                  ) : null}
                  <Button variant="danger" loading={busy} onClick={() => setAskEngage(true)}>
                    Engage the kill switch
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── recent decisions ──────────────────────────────────────────────── */}
        {records.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[12px] font-medium text-ink">Recent decisions</p>
              <Button variant="ghost" size="sm" onClick={() => void load()}>
                <RefreshCw size={12} /> Refresh
              </Button>
            </div>
            <RowList>
              {records
                .slice()
                .reverse()
                .map((record) => (
                  <Row
                    key={record.actionId}
                    leading={<DecisionDot decision={record.decision} />}
                    title={`${record.tool} — ${DECISION_LABEL[record.decision]}`}
                    meta={`${formatWhen(record.ts)} · ${record.agentId} · ${record.rule}${
                      record.outcome ? ` · ${OUTCOME_LABEL[record.outcome] ?? record.outcome}` : ''
                    }${record.approvedBy ? ` · approved by ${record.approvedBy}` : ''}`}
                    trailing={
                      <Badge
                        tone={
                          record.decision === 'allow'
                            ? 'positive'
                            : record.decision === 'steer'
                              ? 'warn'
                              : 'danger'
                        }
                      >
                        {record.trust.toFixed(2)}
                      </Badge>
                    }
                  />
                ))}
            </RowList>
            <p className="px-2.5 text-[10.5px] text-faint">
              The number on the right is the agent&apos;s trust score at the decision. Trust never
              authorises a high-risk action on its own.
            </p>
          </div>
        ) : null}

        {outcome ? <OutcomeBanner outcome={outcome} /> : null}
      </div>

      <Modal
        open={askEngage}
        onClose={() => setAskEngage(false)}
        title="Engage the kill switch"
        subtitle="Every governed action will be refused until you release it. This survives a restart."
        icon={<OctagonX size={16} />}
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAskEngage(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void engage()}>
              Engage it
            </Button>
          </>
        }
      >
        <label className="block space-y-1.5">
          <span className="text-[12.5px] font-medium text-ink">Why are you stopping it?</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder="e.g. an agent is writing to the wrong folder"
            className="w-full resize-none rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-accent/40"
          />
          <span className="block text-[11px] text-faint">
            The reason is recorded with the switch, so the log shows who stopped the agent and why.
          </span>
        </label>
      </Modal>
    </SettingsSection>
  )
}
