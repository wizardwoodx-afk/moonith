import { useEffect, useState } from 'react'
import {
  Brain,
  CheckCircle2,
  FlaskConical,
  Gauge,
  MemoryStick,
  ScrollText,
  XCircle,
  Cpu,
  Layers,
  Activity,
  GitBranch,
  ShieldAlert,
  Terminal
} from 'lucide-react'
import { Icon } from '../../components/icons'
import type { RsiralsSnapshot } from '@shared/rsirals'
import type { KnowledgeProposalView } from '@shared/types'
import { errorMessage } from '../../lib/utils'
import { Button, Spin } from '../../components/ui'
import { SettingsSection } from './SettingsSection'
import { Badge, EmptyState, Row, RowList, formatWhen } from './paneBits'

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-line bg-canvas/45 px-3 py-2.5">
      <p className="text-[16px] font-semibold text-ink">{value}</p>
      <p className="mt-0.5 text-[10px] text-faint">{label}</p>
    </div>
  )
}

const ENDPOINT_LABEL: Record<NonNullable<KnowledgeProposalView['endpointClass']>, string> = {
  'cloud-default': 'Cloud endpoint',
  'local-configured': 'Local endpoint',
  unknown: 'Endpoint unknown'
}

export function LearningPane() {
  const [snapshot, setSnapshot] = useState<RsiralsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [proposals, setProposals] = useState<KnowledgeProposalView[]>([])
  const [proposalsLoading, setProposalsLoading] = useState(true)
  const [proposalError, setProposalError] = useState<string | null>(null)
  const [deciding, setDeciding] = useState<{ id: string; decision: 'approve' | 'discard' } | null>(
    null
  )

  const refreshProposals = async (): Promise<void> => {
    setProposalsLoading(true)
    setProposalError(null)
    try {
      setProposals(await window.knight.knowledgeList())
    } catch (cause) {
      setProposalError(errorMessage(cause))
    } finally {
      setProposalsLoading(false)
    }
  }

  /* The only way a proposal becomes a skill. One click, one proposal, and the
   * main process re-reads the list so what is on screen is what was stored. */
  const decide = async (id: string, decision: 'approve' | 'discard'): Promise<void> => {
    setDeciding({ id, decision })
    setProposalError(null)
    try {
      const result = await window.knight.knowledgeDecide({ id, decision })
      setProposals(result.proposals)
      if (!result.ok) setProposalError(result.error ?? 'The decision was refused.')
    } catch (cause) {
      setProposalError(errorMessage(cause))
    } finally {
      setDeciding(null)
      await refreshProposals()
    }
  }

  const refresh = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setSnapshot(await window.knight.rsiralsSnapshot())
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    void refreshProposals()
  }, [])

  const pending = proposals.filter((proposal) => proposal.status === 'proposed')

  return (
    <div className="space-y-9">
      <SettingsSection
        title="Learning"
                action={
          <button
            type="button"
            onClick={() => void refresh()}
            title="Refresh learning evidence"
            className="text-faint hover:text-ink"
          >
            <Icon name="refresh" size="md" className={loading ? 'animate-spin' : ''} />
          </button>
        }
        >
        <div className="space-y-5">
          <div className="flex items-start gap-2.5 rounded-lg border border-line bg-canvas/45 px-3 py-2.5">
            <Icon name="shield" size="xs" className="mt-0.5 text-accent" />
            <p className="text-[10.5px] leading-relaxed text-muted">
              Learning here never trains model weights, rewrites SelfImpulse source, or bypasses
              your approval. The numbers below are read from this device.
            </p>
          </div>
          {error ? <p className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-[10.5px] text-danger">{error}</p> : null}
          {loading && !snapshot ? <div className="flex justify-center py-8"><Spin size={17} /></div> : null}
          {snapshot ? (
            <>
              <div className="flex flex-col gap-2 rounded-xl border border-accent/25 bg-accent/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-accent/20 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-accent uppercase whitespace-nowrap">
                      {snapshot.proprietary?.license ?? 'PROPRIETARY'}
                    </span>
                    <span className="text-[12px] font-semibold text-ink">
                      Self-improvement engine {snapshot.proprietary?.version ?? '2.0.0'}
                    </span>
                  </div>
                </div>
              </div>

              {snapshot.octa ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-line bg-canvas/45 p-3.5">
                    <div className="flex items-center justify-between border-b border-line pb-2.5">
                      <div className="flex items-center gap-2">
                        <Icon name="quick" size="md" className="text-amber-500" />
                        <h4 className="text-[12px] font-semibold text-ink">1. Per-action learning</h4>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-lg border border-line/60 bg-panel-2/30 p-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-ink">Risk screening</span>
                        </div>
                        <p className="mt-1.5 text-[10px] whitespace-nowrap text-muted">
                          Beliefs: <strong className="text-ink">{snapshot.octa.sentrix.activeBeliefsCount}</strong> · Avg risk: <strong className="text-ink">{snapshot.octa.sentrix.averageRiskScore}</strong>
                        </p>
                        <p className="mt-1 text-[10px] text-faint">
                          {snapshot.octa.sentrix.interceptedActions} action{snapshot.octa.sentrix.interceptedActions === 1 ? '' : 's'} intercepted · {snapshot.octa.sentrix.blockedActions} blocked
                        </p>
                      </div>

                      <div className="rounded-lg border border-line/60 bg-panel-2/30 p-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-ink">Model routing</span>
                        </div>
                        <p className="mt-1.5 text-[10px] whitespace-nowrap text-muted">
                          Routed: <strong className="text-ink">{snapshot.octa.aurix.routedEnvelopesCount}</strong> · Saved: <strong className="text-positive">${snapshot.octa.aurix.cumulativeCostSavingsUsd}</strong>
                        </p>
                        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-faint">
                          <span className="whitespace-nowrap">Tiers: {snapshot.octa.aurix.tierDistribution.T0}</span>
                          <span className="whitespace-nowrap">/ {snapshot.octa.aurix.tierDistribution.T1}</span>
                          <span className="whitespace-nowrap">/ {snapshot.octa.aurix.tierDistribution.T2}</span>
                          <span className="whitespace-nowrap">/ {snapshot.octa.aurix.tierDistribution.T3}</span>
                        </div>
                      </div>

                      <div className="rounded-lg border border-line/60 bg-panel-2/30 p-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-ink">Trial runs</span>
                        </div>
                        <p className="mt-1.5 text-[10px] whitespace-nowrap text-muted">
                          Trials: <strong className="text-ink">{snapshot.octa.vorcis.simulationsRun}</strong> · Sandboxes: <strong className="text-ink">{snapshot.octa.vorcis.cowSandboxesSpawned}</strong>
                        </p>
                        <p className="mt-1 text-[10px] text-faint">
                          Predictions correct: <span className="text-positive font-medium">{Math.round(snapshot.octa.vorcis.averagePredictionAccuracy * 100)}%</span>
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-line bg-canvas/45 p-3.5">
                    <div className="flex items-center justify-between border-b border-line pb-2.5">
                      <div className="flex items-center gap-2">
                        <Activity size={15} className="text-sky-500" />
                        <h4 className="text-[12px] font-semibold text-ink">2. Per-task learning</h4>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-lg border border-line/60 bg-panel-2/30 p-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-ink">Failure diagnosis</span>
                        </div>
                        <p className="mt-1.5 text-[10px] whitespace-nowrap text-muted">
                          Diagnosed: <strong className="text-ink">{snapshot.octa.corvex.diagnosedFailures}</strong> · Cause maps: <strong className="text-ink">{snapshot.octa.corvex.activeCausalGraphs}</strong>
                        </p>
                        <p className="mt-1 text-[10px] text-faint">
                          Faults reproduced: {snapshot.octa.corvex.reproducedFaults}
                        </p>
                      </div>

                      <div className="rounded-lg border border-line/60 bg-panel-2/30 p-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-ink">Skill proposals</span>
                        </div>
                        <p className="mt-1.5 text-[10px] whitespace-nowrap text-muted">
                          Proposed: <strong className="text-ink">{snapshot.octa.kavyra.inducedSkillsCount}</strong> · Verified: <strong className="text-positive">{snapshot.octa.kavyra.activeVerifiedSkills}</strong>
                        </p>
                      </div>

                      <div className="rounded-lg border border-line/60 bg-panel-2/30 p-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-ink">Shared claims</span>
                        </div>
                        <p className="mt-1.5 text-[10px] whitespace-nowrap text-muted">
                          Signed: <strong className="text-ink">{snapshot.octa.nexalis.signedClaimsCount}</strong> · Subscribers: <strong className="text-ink">{snapshot.octa.nexalis.activeSubscribers}</strong>
                        </p>
                        <p className="mt-1 text-[10px] text-faint">
                          Revoked: {snapshot.octa.nexalis.revokedClaimsCount}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-line bg-canvas/45 p-3.5">
                    <div className="flex items-center justify-between border-b border-line pb-2.5">
                      <div className="flex items-center gap-2">
                        <GitBranch size={15} className="text-purple-500" />
                        <h4 className="text-[12px] font-semibold text-ink">3. Long-term improvement</h4>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg border border-line/60 bg-panel-2/30 p-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-ink">Work finding</span>
                        </div>
                        <p className="mt-1.5 text-[10px] whitespace-nowrap text-muted">
                          Work items: <strong className="text-ink">{snapshot.octa.vantage.acquiredChartersCount}</strong> · Gaps tracked: <strong className="text-ink">{snapshot.octa.vantage.roadmapGapsIdentified}</strong>
                        </p>
                        <p className="mt-1 text-[10px] text-faint">
                          Queued background tasks: {snapshot.octa.vantage.pendingAutonomousTasks}
                        </p>
                      </div>

                      <div className="rounded-lg border border-line/60 bg-panel-2/30 p-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-ink">Policy tuning</span>
                        </div>
                        <p className="mt-1.5 text-[10px] whitespace-nowrap text-muted">
                          Round: <strong className="text-ink">{snapshot.octa.miralyx.currentGeneration}</strong> · Changes: <strong className="text-positive">{snapshot.octa.miralyx.promotedMutations} kept</strong> / {snapshot.octa.miralyx.rejectedMutations} rejected
                        </p>
                        <p className="mt-1 text-[10px] text-faint">
                          Evaluator: <span className="font-mono text-positive">{snapshot.octa.miralyx.anchorEvaluatorHealth}</span>
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label="Current round" value={snapshot.adopted?.gen ?? 1} />
                <Metric label="Recent learning runs" value={snapshot.runs.length} />
                <Metric label="Lessons shown" value={snapshot.lessons.length} />
                <Metric label="Receipts shown" value={snapshot.receipts.length} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-line bg-canvas/45 p-3.5">
                  <p className="flex items-center gap-2 text-[11.5px] font-medium text-ink"><Gauge size={14} className="text-accent" /> Active policy</p>
                  {snapshot.adopted ? (
                    <>
                      <p className="mt-2 text-[11px] text-muted">{snapshot.adopted.id} · score {snapshot.adopted.score?.toFixed(4) ?? 'unmeasured'} · {snapshot.adopted.evaluatedOn} scored runs</p>
                      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px] text-faint">
                        <span>Review depth: {snapshot.adopted.params.reviewDepth}</span>
                        <span>Evidence bias: {snapshot.adopted.params.checkBias}</span>
                        <span>Serial execution: {snapshot.adopted.params.serialExec ? 'yes' : 'no'}</span>
                        <span>Lesson budget: {snapshot.adopted.params.lessonBudget}</span>
                        <span>Causal briefing: {snapshot.adopted.params.mosaic ? 'on' : 'off'}</span>
                      </div>
                      <p className="mt-3 text-[10px] leading-relaxed text-faint">{snapshot.adopted.note}</p>
                    </>
                  ) : <p className="mt-2 text-[10.5px] text-faint">No adopted policy record.</p>}
                </div>
                <div className="rounded-xl border border-line bg-canvas/45 p-3.5">
                  <p className="flex items-center gap-2 text-[11.5px] font-medium text-ink"><FlaskConical size={14} className="text-accent" /> Candidate policy</p>
                  {snapshot.candidate ? (
                    <>
                      <p className="mt-2 text-[11px] text-muted">{snapshot.candidate.id} · round {snapshot.candidate.gen} · score {snapshot.candidate.score?.toFixed(4) ?? 'unmeasured'}</p>
                      <p className="mt-3 text-[10px] leading-relaxed text-faint">{snapshot.candidate.note}</p>
                    </>
                  ) : <p className="mt-2 text-[10.5px] leading-relaxed text-faint">No candidate yet. The next finished task may propose one.</p>}
                  <div className="mt-4 border-t border-line pt-3 text-[10px] leading-relaxed text-muted">{snapshot.acceptanceRule}</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Metric label="Skills awaiting your decision" value={snapshot.skills.proposed} />
                <Metric label="Approved learned skills" value={snapshot.skills.approved} />
                <Metric label="Discarded proposals" value={snapshot.skills.discarded} />
              </div>
            </>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Knowledge proposals"
        action={
          <button
            type="button"
            onClick={() => void refreshProposals()}
            title="Refresh knowledge proposals"
            className="text-faint hover:text-ink"
          >
            <Icon name="refresh" size="md" className={proposalsLoading ? 'animate-spin' : ''} />
          </button>
        }
      >
        <div className="space-y-5">
          {proposalError ? (
            <p className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-[10.5px] text-danger">
              {proposalError}
            </p>
          ) : null}
          {proposalsLoading && pending.length === 0 ? (
            <div className="flex justify-center py-8">
              <Spin size={17} />
            </div>
          ) : pending.length === 0 ? (
            <EmptyState icon={<ScrollText size={18} />} title="No knowledge proposals" />
          ) : (
            <RowList>
              {pending.map((proposal) => (
                <Row
                  key={proposal.id}
                  leading={
                    <Badge tone={proposal.dataHandling === 'local' ? 'positive' : 'warn'}>
                      {proposal.dataHandling === 'local' ? 'Local' : 'Provider'}
                    </Badge>
                  }
                  title={proposal.title}
                  meta={`${proposal.summary} · ${proposal.sourceName ?? 'Unnamed source'} · ${
                    proposal.byteLength
                  } bytes · ${formatWhen(proposal.distilledAt)} · sha256 ${proposal.sourceSha256}${
                    proposal.endpointClass ? ` · ${ENDPOINT_LABEL[proposal.endpointClass]}` : ''
                  }`}
                  trailing={
                    <>
                      <Button
                        size="xs"
                        variant="secondary"
                        loading={deciding?.id === proposal.id && deciding.decision === 'approve'}
                        disabled={deciding !== null}
                        onClick={() => void decide(proposal.id, 'approve')}
                      >
                        Approve
                      </Button>
                      <Button
                        size="xs"
                        variant="danger"
                        loading={deciding?.id === proposal.id && deciding.decision === 'discard'}
                        disabled={deciding !== null}
                        onClick={() => void decide(proposal.id, 'discard')}
                      >
                        Discard
                      </Button>
                    </>
                  }
                />
              ))}
            </RowList>
          )}
        </div>
      </SettingsSection>

      {snapshot ? (
        <>
          <SettingsSection title="Learning runs">
            {snapshot.runs.length === 0 ? (
              <div className="px-3 py-5 text-center">
                <p className="text-[11.5px] text-muted">No learning runs recorded yet.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {snapshot.runs.map((run, index) => (
                  <div key={`${run.strategyId}-${index}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-canvas/40 px-3 py-2 text-[10px]">
                    {run.verified ? <CheckCircle2 size={12} className="text-positive" /> : <XCircle size={12} className="text-warn" />}
                    <span className="font-medium text-ink">{run.strategyId ?? 'unattributed'}</span>
                    <span className="rounded-full bg-panel-3 px-1.5 py-0.5 text-faint">{run.heldOut ? 'held-out' : 'development'}</span>
                    {run.simulated ? <span className="text-warn">simulated</span> : null}
                    {run.evidenceLeak ? <span className="text-danger">evidence excluded</span> : null}
                    <span className="ml-auto text-faint">{run.verified ? 'verified' : 'not verified'} · {run.costUsd === null ? 'cost unknown' : `$${run.costUsd.toFixed(4)}`} · {run.policyTokens === null ? 'tokens unknown' : `${run.policyTokens} tokens`}</span>
                  </div>
                ))}
              </div>
            )}
          </SettingsSection>

          <SettingsSection title="Lessons learned">
            {snapshot.lessons.length === 0 ? (
              <p className="px-3 py-5 text-center text-[11.5px] text-muted">No lessons yet.</p>
            ) : (
              <div className="space-y-2">
                {snapshot.lessons.map((lesson) => (
                  <div key={lesson.id} className="rounded-lg border border-line bg-canvas/45 px-3 py-2.5">
                    <div className="flex items-start gap-2">
                      <MemoryStick size={13} className="mt-0.5 shrink-0 text-accent" />
                      <div className="min-w-0 flex-1"><p className="text-[10.5px] leading-relaxed text-ink">{lesson.text}</p><p className="mt-1 text-[10px] text-faint">{lesson.kind} · {lesson.id} · evidence: {lesson.evidence.join(', ')}</p></div>
                    </div>
                    <div className="mt-2 flex items-center gap-2"><div className="h-1 flex-1 overflow-hidden rounded-full bg-panel-3"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(lesson.utility * 100)}%` }} /></div><span className="text-[10px] text-faint">score {lesson.utility.toFixed(2)} · {lesson.utilityCount} credited outcome{lesson.utilityCount === 1 ? '' : 's'} · {lesson.retrievalCount} retrieval{lesson.retrievalCount === 1 ? '' : 's'}</span></div>
                  </div>
                ))}
              </div>
            )}
          </SettingsSection>

          <SettingsSection title="Learning receipts">
            {snapshot.receipts.length === 0 ? (
              <p className="px-3 py-5 text-center text-[11.5px] text-muted">No learning receipts yet.</p>
            ) : (
              <div className="space-y-2">
                {snapshot.receipts.map((receipt) => (
                  <div key={receipt.id} className="rounded-lg border border-line bg-canvas/45 px-3 py-2.5">
                    <p className="flex items-center gap-2 text-[11px] font-medium text-ink"><ScrollText size={13} className="text-accent" /> {receipt.id}<span className={receipt.signed ? 'text-positive' : 'text-warn'}>{receipt.signed ? 'signature present' : 'unsigned'}</span></p>
                    <p className="mt-1 text-[10px] text-faint">{receipt.missionId} · {new Date(receipt.at).toLocaleString()} {receipt.strategyChange ? `· ${receipt.strategyChange}` : ''} {receipt.evaluation?.heldOut ? '· held-out' : ''}</p>
                    {receipt.memoryCredit ? <p className="mt-1 text-[10px] text-muted">Memory credit: {receipt.memoryCredit.lessonIds.join(', ')} · {receipt.memoryCredit.model}</p> : null}
                    <p className="mt-1 truncate font-mono text-[10px] text-faint" title={receipt.evidenceDigest}>{receipt.evidenceDigest}</p>
                  </div>
                ))}
              </div>
            )}
          </SettingsSection>

          <SettingsSection title="Learning limits">
            <div className="space-y-2">{snapshot.boundaries.map((boundary) => <p key={boundary} className="flex items-start gap-2 text-[10.5px] leading-relaxed text-muted"><Icon name="spark" size="sm" className="mt-0.5 text-accent" />{boundary}</p>)}</div>
            <p className="mt-4 flex items-center gap-2 border-t border-line pt-4 text-[10px] text-faint"><Brain size={13} /> Nothing learned here overrides your permissions or approvals.</p>
          </SettingsSection>
        </>
      ) : null}
    </div>
  )
}
