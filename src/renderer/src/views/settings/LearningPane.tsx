import { useEffect, useState } from 'react'
import {
  Brain,
  CheckCircle2,
  FlaskConical,
  Gauge,
  MemoryStick,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Sparkles,
  XCircle
} from 'lucide-react'
import type { RsiralsSnapshot } from '@shared/rsirals'
import { errorMessage } from '../../lib/utils'
import { Spin } from '../../components/ui'
import { SettingsSection } from './SettingsSection'

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-line bg-canvas/45 px-3 py-2.5">
      <p className="text-[16px] font-semibold text-ink">{value}</p>
      <p className="mt-0.5 text-[9px] text-faint">{label}</p>
    </div>
  )
}

export function LearningPane() {
  const [snapshot, setSnapshot] = useState<RsiralsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
  }, [])

  return (
    <div className="space-y-9">
      <SettingsSection
        title="RSIRALS"
        description="Recursive Self-Improving Reinforcement Agentic Learning System — the measured learning loop already inside mission execution, not a separate agent runtime."
        action={
          <button type="button" onClick={() => void refresh()} title="Refresh learning evidence" className="text-faint hover:text-ink">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        }
      >
        <div className="space-y-5">
          <div className="flex items-start gap-2.5 rounded-lg border border-line bg-canvas/45 px-3 py-2.5">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-accent" />
            <p className="text-[10.5px] leading-relaxed text-muted">
              Non-parametric runtime and harness learning only. RSIRALS does not train model weights,
              rewrite SelfImpulse source, or bypass human approval. Numbers below are read from the
              actual strategy, memory, skill, run, and receipt stores.
            </p>
          </div>
          {error ? <p className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-[10.5px] text-danger">{error}</p> : null}
          {loading && !snapshot ? <div className="flex justify-center py-8"><Spin size={17} /></div> : null}
          {snapshot ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label="Adopted generation" value={snapshot.adopted?.gen ?? 1} />
                <Metric label="Recent attributed runs" value={snapshot.runs.length} />
                <Metric label="Memory records shown" value={snapshot.lessons.length} />
                <Metric label="Learning receipts shown" value={snapshot.receipts.length} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-line bg-canvas/45 p-3.5">
                  <p className="flex items-center gap-2 text-[11.5px] font-medium text-ink"><Gauge size={14} className="text-accent" /> Adopted runtime policy</p>
                  {snapshot.adopted ? (
                    <>
                      <p className="mt-2 text-[11px] text-muted">{snapshot.adopted.id} · utility {snapshot.adopted.score?.toFixed(4) ?? 'unmeasured'} · {snapshot.adopted.evaluatedOn} scored runs</p>
                      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[9.5px] text-faint">
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
                  <p className="flex items-center gap-2 text-[11.5px] font-medium text-ink"><FlaskConical size={14} className="text-accent" /> Controlled candidate</p>
                  {snapshot.candidate ? (
                    <>
                      <p className="mt-2 text-[11px] text-muted">{snapshot.candidate.id} · generation {snapshot.candidate.gen} · utility {snapshot.candidate.score?.toFixed(4) ?? 'unmeasured'}</p>
                      <p className="mt-3 text-[10px] leading-relaxed text-faint">{snapshot.candidate.note}</p>
                    </>
                  ) : <p className="mt-2 text-[10.5px] leading-relaxed text-faint">No active candidate. The next settled mission proposes one sparse variation from the adopted policy.</p>}
                  <div className="mt-4 border-t border-line pt-3 text-[10px] leading-relaxed text-muted">{snapshot.acceptanceRule}</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Metric label="Proposed skills awaiting human decision" value={snapshot.skills.proposed} />
                <Metric label="Approved learned skills" value={snapshot.skills.approved} />
                <Metric label="Discarded proposals" value={snapshot.skills.discarded} />
              </div>
            </>
          ) : null}
        </div>
      </SettingsSection>

      {snapshot ? (
        <>
          <SettingsSection title="Attributed experiment runs" description="Newest records first. Development selects promising policies; held-out runs check transfer. Simulated or leaked records do not improve performance scores.">
            {snapshot.runs.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-3 py-5 text-center text-[10.5px] text-faint">No RSIRALS runs recorded yet. Complete a real mission to produce attributed evidence.</p>
            ) : (
              <div className="space-y-1.5">
                {snapshot.runs.map((run, index) => (
                  <div key={`${run.strategyId}-${index}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-canvas/40 px-3 py-2 text-[9.5px]">
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

          <SettingsSection title="Utility-aware organizational memory" description="Utility credit is attached only to lesson ids actually injected into a run briefing. Retrieval counts stay separate from repeated measured evidence used for skill promotion.">
            {snapshot.lessons.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-3 py-5 text-center text-[10.5px] text-faint">No organizational lessons yet.</p>
            ) : (
              <div className="space-y-2">
                {snapshot.lessons.map((lesson) => (
                  <div key={lesson.id} className="rounded-lg border border-line bg-canvas/45 px-3 py-2.5">
                    <div className="flex items-start gap-2">
                      <MemoryStick size={13} className="mt-0.5 shrink-0 text-accent" />
                      <div className="min-w-0 flex-1"><p className="text-[10.5px] leading-relaxed text-ink">{lesson.text}</p><p className="mt-1 text-[9px] text-faint">{lesson.kind} · {lesson.id} · evidence: {lesson.evidence.join(', ')}</p></div>
                    </div>
                    <div className="mt-2 flex items-center gap-2"><div className="h-1 flex-1 overflow-hidden rounded-full bg-panel-3"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(lesson.utility * 100)}%` }} /></div><span className="text-[9px] text-faint">utility {lesson.utility.toFixed(2)} · {lesson.utilityCount} credited outcomes · {lesson.retrievalCount} retrievals</span></div>
                  </div>
                ))}
              </div>
            )}
          </SettingsSection>

          <SettingsSection title="Learning receipts" description="Receipts bind lessons, memory credit, evaluation split, and strategy changes to a SHA-256 evidence digest. Signature status is shown explicitly.">
            {snapshot.receipts.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-3 py-5 text-center text-[10.5px] text-faint">No learning receipts yet.</p>
            ) : (
              <div className="space-y-2">
                {snapshot.receipts.map((receipt) => (
                  <div key={receipt.id} className="rounded-lg border border-line bg-canvas/45 px-3 py-2.5">
                    <p className="flex items-center gap-2 text-[11px] font-medium text-ink"><ScrollText size={13} className="text-accent" /> {receipt.id}<span className={receipt.signed ? 'text-positive' : 'text-warn'}>{receipt.signed ? 'signature present' : 'unsigned'}</span></p>
                    <p className="mt-1 text-[9.5px] text-faint">{receipt.missionId} · {new Date(receipt.at).toLocaleString()} {receipt.strategyChange ? `· ${receipt.strategyChange}` : ''} {receipt.evaluation?.heldOut ? '· held-out' : ''}</p>
                    {receipt.memoryCredit ? <p className="mt-1 text-[9.5px] text-muted">Memory credit: {receipt.memoryCredit.lessonIds.join(', ')} · {receipt.memoryCredit.model}</p> : null}
                    <p className="mt-1 truncate font-mono text-[8.5px] text-faint">{receipt.evidenceDigest}</p>
                  </div>
                ))}
              </div>
            )}
          </SettingsSection>

          <SettingsSection title="Learning boundaries" description="What RSIRALS does — and deliberately does not claim.">
            <div className="space-y-2">{snapshot.boundaries.map((boundary) => <p key={boundary} className="flex items-start gap-2 text-[10.5px] leading-relaxed text-muted"><Sparkles size={12} className="mt-0.5 shrink-0 text-accent" />{boundary}</p>)}</div>
            <p className="mt-4 flex items-center gap-2 border-t border-line pt-4 text-[10px] text-faint"><Brain size={13} /> Research-informed policy selection, utility memory, verified skill proposals, and replay controls are integrated beneath the existing mission authority.</p>
          </SettingsSection>
        </>
      ) : null}
    </div>
  )
}
