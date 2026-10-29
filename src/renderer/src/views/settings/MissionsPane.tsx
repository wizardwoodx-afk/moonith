/**
 * Aion — the durable missions, as the audit pane shows them.
 *
 * A mission is work that outlives the process that started it: it parks at an
 * approval or a timer, and if the app dies it comes back exactly where it was
 * — without repeating the steps that already ran. That last part is the whole
 * point, so this pane shows the step ledger rather than a status word: you can
 * see what already happened, and what is parked waiting for you.
 */
import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, FolderSearch, Hourglass, Timer, XCircle } from 'lucide-react'
import { Icon } from '../../components/icons'
import type { MissionStatusView, MissionStepView, MissionSummaryView } from '@shared/types'
import { Button, Spin } from '../../components/ui'
import { errorMessage } from '../../lib/utils'
import { SettingsSection } from './SettingsSection'
import {
  Badge,
  EmptyState,
  OutcomeBanner,
  PaneNote,
  Stat,
  StatGrid,
  formatWhen,
  type Outcome
} from './paneBits'

const STATUS_LABEL: Record<MissionStatusView, string> = {
  running: 'Running',
  'waiting-approval': 'Waiting for you',
  'waiting-signal': 'Waiting for a signal',
  sleeping: 'Sleeping',
  'needs-reconciliation': 'Needs a look',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled'
}

const STATUS_TONE: Record<MissionStatusView, 'default' | 'positive' | 'warn' | 'danger' | 'accent'> = {
  running: 'accent',
  'waiting-approval': 'warn',
  'waiting-signal': 'warn',
  sleeping: 'default',
  'needs-reconciliation': 'danger',
  done: 'positive',
  failed: 'danger',
  cancelled: 'default'
}

const STEP_LABEL: Record<MissionStepView['kind'], string> = {
  action: 'action',
  approval: 'approval',
  timer: 'timer',
  signal: 'signal'
}

const STEP_STATUS_LABEL: Record<MissionStepView['status'], string> = {
  pending: 'not started',
  running: 'running',
  succeeded: 'done',
  failed: 'failed',
  waiting: 'waiting'
}

/** The desktop is single-user, so the main process records approvals against
 *  this id; the pane names that person "you" wherever it speaks to a human. */
const APPROVER = { id: 'local-user', label: 'you' } as const

function isResumable(status: MissionStatusView): boolean {
  return status === 'sleeping' || status === 'waiting-signal'
}

function StepGlyph({ step }: { step: MissionStepView }) {
  if (step.kind === 'approval') return <Hourglass size={12} className="mt-[3px] shrink-0 text-warn" />
  if (step.kind === 'timer') return <Timer size={12} className="mt-[3px] shrink-0 text-muted" />
  if (step.status === 'succeeded')
    return <CheckCircle2 size={12} className="mt-[3px] shrink-0 text-positive" />
  if (step.status === 'failed') return <XCircle size={12} className="mt-[3px] shrink-0 text-danger" />
  return <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-line-strong" />
}

function StepLedger({ steps }: { steps: MissionStepView[] }) {
  return (
    <ol className="mt-2 space-y-1 border-l border-line pl-3">
      {steps.map((step) => (
        <li key={step.id} className="flex items-start gap-2">
          <StepGlyph step={step} />
          <span className="text-[11px] text-muted">
            <span className="font-medium text-ink">{step.id}</span>
            <span className="text-faint"> · {STEP_LABEL[step.kind]} </span>
            <span
              className={
                step.status === 'failed'
                  ? 'text-danger'
                  : step.status === 'succeeded'
                    ? 'text-positive'
                    : step.status === 'waiting'
                      ? 'text-warn'
                      : 'text-faint'
              }
            >
              {STEP_STATUS_LABEL[step.status]}
            </span>
            {step.attempts > 1 ? (
              <span className="text-faint"> · {step.attempts} attempts</span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  )
}

export function MissionsPane() {
  const [missions, setMissions] = useState<MissionSummaryView[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const load = useCallback(async () => {
    try {
      setMissions(await window.knight.missionList())
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

  /* Fold one mission's freshly read state into the list without waiting for
   * the whole list to reload — the journal may have moved on mid-render. */
  const applyMission = (next: MissionSummaryView | null): void => {
    if (!next) return
    setMissions((previous) => {
      const list = previous ?? []
      return list.some((mission) => mission.missionId === next.missionId)
        ? list.map((mission) => (mission.missionId === next.missionId ? next : mission))
        : [next, ...list]
    })
  }

  const act = async (
    missionId: string,
    run: () => Promise<unknown>,
    done: string
  ): Promise<void> => {
    setBusyId(missionId)
    setOutcome(null)
    try {
      await run()
      await load()
      setOutcome({ tone: 'positive', message: done })
    } catch (error) {
      setOutcome({ tone: 'danger', message: errorMessage(error) })
    } finally {
      setBusyId(null)
    }
  }

  const resume = (missionId: string): void => {
    void act(
      missionId,
      async () => {
        const resumed = await window.knight.missionResume(missionId)
        if (!resumed) {
          throw new Error('The mission is no longer loaded, so it could not be resumed.')
        }
        applyMission(resumed)
        /* Resume re-drives from the journal; read it back so the ledger and
         * current status shown come from the state the orchestrator settled
         * on, not from the list snapshot that was on screen. A failed read-back
         * is not a failed resume — the load() that follows act() still runs. */
        applyMission(await window.knight.missionGet(missionId).catch(() => null))
      },
      'Resumed — the mission re-read its journal; steps that already ran were not repeated.'
    )
  }

  const startRepoScan = async (): Promise<void> => {
    setBusyId('new')
    setOutcome(null)
    try {
      const root = await window.knight.pickFolder()
      if (!root) return
      await window.knight.missionStartRepoScan(root)
      await load()
      setOutcome({
        tone: 'positive',
        message: `A repository scan of ${root} has started. It parks whenever it needs your approval.`
      })
    } catch (error) {
      setOutcome({ tone: 'danger', message: errorMessage(error) })
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted">
        <Spin size={20} />
      </div>
    )
  }

  const list = missions ?? []
  const live = list.filter((mission) =>
    ['running', 'waiting-approval', 'waiting-signal', 'sleeping', 'needs-reconciliation'].includes(
      mission.status
    )
  ).length
  const waiting = list.filter((mission) => mission.status === 'waiting-approval').length
  const needsLook = list.filter((mission) => mission.status === 'needs-reconciliation').length

  return (
    <SettingsSection
      title="Durable missions"
      
    >
      <div className="space-y-5">
        <PaneNote>
          A mission records every step as it runs, so it can resume exactly where it stopped after
          a restart. The ledger below shows each step and its attempts.
        </PaneNote>

        {loadError ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-danger/25 bg-danger/10 px-3.5 py-3">
            <XCircle size={14} className="mt-0.5 shrink-0 text-danger" />
            <p className="text-[11.5px] leading-relaxed text-danger">
              The mission journal could not be read: {loadError}
            </p>
          </div>
        ) : null}

        {list.length > 0 ? (
          <StatGrid>
            <Stat label="Missions" value={list.length} hint="all time" />
            <Stat
              label="In flight"
              value={live}
              tone={live > 0 ? 'accent' : 'default'}
              hint="running or parked"
            />
            <Stat
              label="Waiting for you"
              value={waiting}
              tone={waiting > 0 ? 'warn' : 'default'}
              hint="parked at an approval"
            />
            <Stat
              label="Needs a look"
              value={needsLook}
              tone={needsLook > 0 ? 'danger' : 'default'}
              hint="interrupted mid-step"
            />
          </StatGrid>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button
            variant="primary"
            loading={busyId === 'new'}
            onClick={() => void startRepoScan()}
          >
            <FolderSearch size={13} /> Scan a repository
          </Button>
          <Button variant="ghost" onClick={() => void load()}>
            <Icon name="refresh" size="md" /> Refresh
          </Button>
        </div>

        {outcome ? <OutcomeBanner outcome={outcome} /> : null}

        {list.length === 0 ? (
          <EmptyState icon={<Hourglass size={18} />} title="No missions yet" />
        ) : (
          <div className="space-y-3">
            {list
              .slice()
              .reverse()
              .map((mission) => (
                <div
                  key={mission.missionId}
                  className="rounded-xl border border-line bg-canvas/50 px-4 py-3.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[12.5px] font-medium text-ink">{mission.workflowId}</p>
                        <Badge tone={STATUS_TONE[mission.status]}>
                          {STATUS_LABEL[mission.status]}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[10.5px] text-faint">
                        started {formatWhen(mission.startedAt)} · updated {formatWhen(mission.updatedAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {mission.status === 'waiting-approval' ? (
                        <>
                          <Button
                            variant="primary"
                            size="sm"
                            loading={busyId === mission.missionId}
                            onClick={() =>
                              void act(
                                mission.missionId,
                                () =>
                                  window.knight.missionApprove({
                                    missionId: mission.missionId,
                                    approve: true,
                                    by: APPROVER.id
                                  }),
                                `Approved by ${APPROVER.label} — the mission carries on from where it parked.`
                              )
                            }
                          >
                            Approve
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            loading={busyId === mission.missionId}
                            onClick={() =>
                              void act(
                                mission.missionId,
                                () =>
                                  window.knight.missionApprove({
                                    missionId: mission.missionId,
                                    approve: false,
                                    by: APPROVER.id
                                  }),
                                `Refused by ${APPROVER.label} — the mission stopped where it parked.`
                              )
                            }
                          >
                            Refuse
                          </Button>
                        </>
                      ) : null}
                      {mission.status === 'needs-reconciliation' ? (
                        <>
                          <Button
                            variant="primary"
                            size="sm"
                            loading={busyId === mission.missionId}
                            onClick={() =>
                              void act(
                                mission.missionId,
                                () => window.knight.missionReconcile(mission.missionId, 'done'),
                                'Marked as landed — the mission carries on from the step after it.'
                              )
                            }
                          >
                            It landed
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            loading={busyId === mission.missionId}
                            onClick={() =>
                              void act(
                                mission.missionId,
                                () => window.knight.missionReconcile(mission.missionId, 'failed'),
                                'Marked as not landed — the mission stops here rather than replaying the step.'
                              )
                            }
                          >
                            It didn&apos;t
                          </Button>
                        </>
                      ) : null}
                      {isResumable(mission.status) ? (
                        <Button
                          variant="primary"
                          size="sm"
                          loading={busyId === mission.missionId}
                          onClick={() => resume(mission.missionId)}
                        >
                          <Icon name="play" size="md" /> Resume
                        </Button>
                      ) : null}
                      {[
                        'running',
                        'waiting-approval',
                        'waiting-signal',
                        'sleeping',
                        'needs-reconciliation'
                      ].includes(mission.status) ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={busyId === mission.missionId}
                          onClick={() =>
                            void act(
                              mission.missionId,
                              () => window.knight.missionCancel(mission.missionId),
                              'Cancelled.'
                            )
                          }
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {mission.pendingApproval ? (
                    <div className="mt-3 rounded-lg border border-warn/25 bg-warn/10 px-3 py-2.5">
                      <p className="text-[11.5px] font-medium text-warn">
                        {mission.pendingApproval.title}
                      </p>
                      <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">
                        {mission.pendingApproval.summary}
                      </p>
                    </div>
                  ) : null}

                  {mission.error ? (
                    <p className="mt-2 text-[11.5px] leading-relaxed text-danger">{mission.error}</p>
                  ) : null}

                  {mission.status === 'needs-reconciliation' ? (
                    <div className="mt-3 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2.5">
                      <p className="text-[11.5px] font-medium text-danger">
                        Interrupted mid-step
                      </p>
                      <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">
                        The app stopped while{' '}
                        <span className="font-medium text-ink">
                          {mission.steps.find((step) => step.status === 'running')?.id ?? 'a step'}
                        </span>{' '}
                        was running, so the journal cannot say whether its effect landed.{' '}
                        <span className="font-medium text-ink">It landed</span> continues from the
                        next step; <span className="font-medium text-ink">It didn&apos;t</span>{' '}
                        stops the mission. Nothing is retried on a guess.
                      </p>
                    </div>
                  ) : null}

                  {mission.steps.length > 0 ? <StepLedger steps={mission.steps} /> : null}
                </div>
              ))}
          </div>
        )}
      </div>
    </SettingsSection>
  )
}
