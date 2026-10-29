import { useEffect, useState } from 'react'
import {
  Sun,
  Inbox,
  ShieldAlert,
  Clock,
  CheckCircle2,
  XCircle,
  Sparkles,
  RefreshCw,
  Lock,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  AlertTriangle
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '../../lib/utils'

export function PromeyDuetPanel() {
  const [status, setStatus] = useState<any>(null)
  const [brief, setBrief] = useState<any>(null)
  const [triageItems, setTriageItems] = useState<any[]>([])
  const [approvals, setApprovals] = useState<any[]>([])
  const [routines, setRoutines] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [briefOpen, setBriefOpen] = useState(true)

  const refreshAll = async () => {
    try {
      const [st, triage, appr, rout] = await Promise.all([
        window.knight.promeyStatus(),
        window.knight.promeyListTriage(),
        window.knight.promeyListApprovals(),
        window.knight.promeyListRoutines()
      ])
      setStatus(st)
      setBrief(st?.latestBrief || null)
      setTriageItems(triage || [])
      setApprovals(appr || [])
      setRoutines(rout || [])
    } catch (e: any) {
      console.error('Failed to load Promey data:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshAll()
    const timer = setInterval(() => void refreshAll(), 6000)
    return () => clearInterval(timer)
  }, [])

  const handleGenerateBrief = async () => {
    try {
      toast.loading('Synthesizing executive morning brief...', { id: 'brief-gen' })
      const newBrief = await window.knight.promeyGenerateBrief('Operator', 'SelfImpulse')
      setBrief(newBrief)
      setBriefOpen(true)
      toast.success('Morning Brief ready!', { id: 'brief-gen' })
      void refreshAll()
    } catch (e: any) {
      toast.error('Brief generation failed: ' + e.message, { id: 'brief-gen' })
    }
  }

  const handleApprovalDecision = async (id: string, decision: 'allow_once' | 'always_allowed' | 'refused') => {
    try {
      await window.knight.promeySubmitApproval(id, decision)
      toast.success(`Approval decided: ${decision}`)
      void refreshAll()
    } catch (e: any) {
      toast.error('Decision failed: ' + e.message)
    }
  }

  const handleResolveTriage = async (id: string) => {
    try {
      await window.knight.promeyResolveTriage(id, 'Resolved via panel')
      toast.success('Item marked resolved')
      void refreshAll()
    } catch (e: any) {
      toast.error('Resolve failed: ' + e.message)
    }
  }

  const handleToggleRoutine = async (id: string, current: boolean) => {
    try {
      await window.knight.promeyToggleRoutine(id, !current)
      toast.success(`Routine ${!current ? 'activated' : 'paused'}`)
      void refreshAll()
    } catch (e: any) {
      toast.error('Toggle failed: ' + e.message)
    }
  }

  const pendingApprovals = approvals.filter((a) => a.status === 'pending')

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 py-3 text-[11px] text-ink">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <Sun size={15} />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-ink">Promey Duet</span>
              <span className="rounded bg-accent/20 px-1.5 py-0.2 text-[9px] font-medium text-accent uppercase">
                Proactive
              </span>
            </div>
            <p className="text-[10px] text-faint">Human-in-the-Loop & Executive Triage Engine</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleGenerateBrief}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-panel-2/60 px-2.5 py-1 text-[10.5px] font-medium text-ink hover:bg-panel-3"
            title="Generate fresh morning brief"
          >
            <Sparkles size={12} className="text-amber-500" />
            Morning Brief
          </button>
          <button
            onClick={() => void refreshAll()}
            className="rounded p-1 text-faint hover:text-ink"
            title="Refresh"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="mb-4 grid grid-cols-4 gap-2">
        <div className="rounded-lg border border-line bg-canvas/40 p-2 text-center">
          <span className="text-[9.5px] text-faint">Triage</span>
          <p className="mt-0.5 text-[14px] font-semibold text-ink">{triageItems.length}</p>
        </div>
        <div className="rounded-lg border border-line bg-canvas/40 p-2 text-center">
          <span className="text-[9.5px] text-faint">Approvals</span>
          <p className="mt-0.5 text-[14px] font-semibold text-amber-500">{pendingApprovals.length}</p>
        </div>
        <div className="rounded-lg border border-line bg-canvas/40 p-2 text-center">
          <span className="text-[9.5px] text-faint">Routines</span>
          <p className="mt-0.5 text-[14px] font-semibold text-sky-500">{routines.filter((r) => r.active).length}</p>
        </div>
        <div className="rounded-lg border border-line bg-canvas/40 p-2 text-center">
          <span className="text-[9.5px] text-faint">DLP Shield</span>
          <p className="mt-0.5 text-[14px] font-semibold text-positive">
            {status?.privacy?.totalLeaksPrevented ?? 0}
          </p>
        </div>
      </div>

      {/* Morning Brief Card */}
      {brief ? (
        <div className="mb-4 rounded-xl border border-accent/25 bg-accent/5 p-3">
          <button
            onClick={() => setBriefOpen(!briefOpen)}
            className="flex w-full items-center justify-between text-left"
          >
            <div className="flex items-center gap-2">
              <Sun size={14} className="text-amber-500" />
              <span className="font-semibold text-ink">{brief.headline}</span>
            </div>
            {briefOpen ? <ChevronDown size={14} className="text-faint" /> : <ChevronRight size={14} className="text-faint" />}
          </button>

          {briefOpen ? (
            <div className="mt-2.5 border-t border-accent/15 pt-2 text-[10.5px] leading-relaxed text-muted whitespace-pre-line">
              {brief.summaryMarkdown}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Pending Approvals (HITL Tri-Choice) */}
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-medium text-ink">
            <ShieldAlert size={13} className="text-amber-500" />
            Human-in-the-Loop Approvals ({pendingApprovals.length})
          </span>
          <span className="text-[9.5px] text-faint">Allow Once · Always Allow · Refuse</span>
        </div>

        {pendingApprovals.length === 0 ? (
          <div className="rounded-lg border border-line/60 bg-canvas/20 px-3 py-3 text-center text-[10px] text-faint">
            <CheckCircle2 size={14} className="mx-auto mb-1 text-positive" />
            No pending human approvals. Agent has clear path.
          </div>
        ) : (
          <div className="space-y-2">
            {pendingApprovals.map((appr) => (
              <div key={appr.id} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-amber-500/20 px-1 py-0.2 text-[8.5px] font-bold text-amber-500 uppercase">
                        {appr.consequenceLevel}
                      </span>
                      <span className="font-medium text-ink">{appr.title}</span>
                    </div>
                    <p className="mt-1 text-[10px] text-muted">{appr.description}</p>
                    <p className="mt-0.5 font-mono text-[9px] text-faint">Target: {appr.targetResource}</p>
                  </div>
                </div>

                <div className="mt-2.5 flex items-center justify-end gap-1.5 border-t border-amber-500/20 pt-2">
                  <button
                    onClick={() => handleApprovalDecision(appr.id, 'allow_once')}
                    className="rounded bg-accent/20 px-2 py-0.5 text-[9.5px] font-medium text-accent hover:bg-accent/30"
                  >
                    Allow Once
                  </button>
                  <button
                    onClick={() => handleApprovalDecision(appr.id, 'always_allowed')}
                    className="rounded bg-positive/20 px-2 py-0.5 text-[9.5px] font-medium text-positive hover:bg-positive/30"
                  >
                    Always Allow
                  </button>
                  <button
                    onClick={() => handleApprovalDecision(appr.id, 'refused')}
                    className="rounded bg-danger/20 px-2 py-0.5 text-[9.5px] font-medium text-danger hover:bg-danger/30"
                  >
                    Refuse
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Smart Triage Stream */}
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-medium text-ink">
            <Inbox size={13} className="text-sky-500" />
            Smart Triage Stream ({triageItems.filter((i) => i.status !== 'resolved').length} active)
          </span>
        </div>

        {triageItems.length === 0 ? (
          <p className="text-[10px] text-faint">No stream items ingested yet.</p>
        ) : (
          <div className="space-y-1.5">
            {triageItems.slice(0, 5).map((item) => (
              <div
                key={item.id}
                className={cn(
                  'rounded-lg border p-2 text-[10px]',
                  item.status === 'resolved'
                    ? 'border-line/40 bg-canvas/10 opacity-60'
                    : item.urgency === 'critical'
                    ? 'border-danger/30 bg-danger/5'
                    : 'border-line bg-canvas/30'
                )}
              >
                <div className="flex items-start justify-between gap-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-line/60 px-1 py-0.2 text-[8.5px] text-faint uppercase">
                        {item.source}
                      </span>
                      <span className="font-medium text-ink truncate">{item.title}</span>
                    </div>
                    <p className="mt-1 text-[9.5px] text-muted">{item.content}</p>
                  </div>
                  {item.status !== 'resolved' ? (
                    <button
                      onClick={() => handleResolveTriage(item.id)}
                      className="shrink-0 text-faint hover:text-positive"
                      title="Mark resolved"
                    >
                      <CheckCircle2 size={13} />
                    </button>
                  ) : (
                    <span className="text-[8.5px] text-positive font-medium">Resolved</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Active Standing Routines */}
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-medium text-ink">
            <Clock size={13} className="text-purple-500" />
            Standing Routines ({routines.length})
          </span>
        </div>

        <div className="space-y-1.5">
          {routines.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-lg border border-line bg-canvas/30 px-2.5 py-1.5">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-ink text-[10px]">{r.name}</span>
                  <span className="rounded bg-line/50 px-1 py-0.2 text-[8.5px] text-faint">{r.cadence}</span>
                </div>
                <p className="mt-0.5 text-[9px] text-muted truncate max-w-[220px]">{r.standingPrompt}</p>
              </div>
              <button
                onClick={() => handleToggleRoutine(r.id, r.active)}
                className={cn(
                  'rounded px-1.5 py-0.5 text-[9px] font-semibold transition-colors',
                  r.active ? 'bg-positive/20 text-positive' : 'bg-line/40 text-faint'
                )}
              >
                {r.active ? 'ACTIVE' : 'PAUSED'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Privacy Shield & Masking */}
      <div className="rounded-lg border border-line/60 bg-canvas/25 p-2.5 text-[10px]">
        <div className="flex items-center gap-1.5 font-medium text-ink">
          <ShieldCheck size={13} className="text-positive" />
          <span>Credential Masking & Outbound DLP</span>
        </div>
        <p className="mt-1 text-[9.5px] text-muted leading-relaxed">
          Sensitive passwords and tokens are replaced with masked tokens before model transcripts see them. 
          Outbound messages are scanned to prevent private key and payment card leakage.
        </p>
      </div>
    </div>
  )
}
