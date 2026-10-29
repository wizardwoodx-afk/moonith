import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShieldAlert,
  GitPullRequest,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Package,
  Layers,
  Copy,
  Check,
  Cpu,
  Monitor,
  Flame,
  Wrench,
  BookOpen
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '../../lib/utils'

const MODE_LABEL = { plan: 'Plan', build: 'Build', yolo: 'Full access' } as const

const MODE_SUMMARY = {
  plan: 'Read only',
  build: 'Edits allowed, shells ask first',
  yolo: 'Runs everything without asking'
} as const

const CR_STATUS = {
  applied: 'Applied',
  approved: 'Approved',
  pending_review: 'Awaiting review',
  rejected: 'Rejected'
} as Record<string, string>

export function RookWorkerPanel() {
  const [status, setStatus] = useState<{
    ready: boolean
    permissionMode: 'plan' | 'build' | 'yolo'
    executionTurns: number
    deliverablesCount: number
    changeRequestsCount: number
    pendingGatesCount: number
  } | null>(null)

  const [changeRequests, setChangeRequests] = useState<any[]>([])
  const [deliverables, setDeliverables] = useState<any[]>([])
  const [pendingGates, setPendingGates] = useState<any[]>([])
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshAll = async () => {
    try {
      const [st, crs, dels, gates] = await Promise.all([
        window.knight.rookStatus(),
        window.knight.rookListChangeRequests(),
        window.knight.rookListDeliverables(),
        window.knight.rookListPendingGates()
      ])
      setStatus(st)
      setChangeRequests(crs)
      setDeliverables(dels)
      setPendingGates(gates)
    } catch (err) {
      console.error('Failed to load ROOK status:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshAll()
    const interval = setInterval(() => {
      void refreshAll()
    }, 4000)
    return () => clearInterval(interval)
  }, [])

  const handleSetPermission = async (mode: 'plan' | 'build' | 'yolo') => {
    try {
      await window.knight.rookSetPermission(mode)
      toast.success(`Access set to ${MODE_LABEL[mode]}`)
      await refreshAll()
    } catch {
      toast.error('Could not change the access level.')
    }
  }

  const handleReviewCr = async (id: string, decision: 'approved' | 'rejected') => {
    try {
      await window.knight.rookReviewChangeRequest(id, decision)
      toast.success(decision === 'approved' ? 'Approved' : 'Rejected')
      await refreshAll()
    } catch {
      toast.error('Could not record your answer.')
    }
  }

  const handleApplyCr = async (id: string) => {
    try {
      await window.knight.rookApplyChangeRequest(id)
      toast.success('Applied to the workspace.')
      await refreshAll()
    } catch {
      toast.error('Could not apply this change.')
    }
  }

  const handleResolveGate = async (gateId: string, option: string) => {
    try {
      await window.knight.rookResolveGate(gateId, { selectedOption: option, userAnswer: option })
      toast.success(`Answer sent: ${option}`)
      await refreshAll()
    } catch {
      toast.error('Could not send your answer.')
    }
  }

  const copyContent = (id: string, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id)
      toast.success('Copied to clipboard')
      setTimeout(() => setCopiedId(null), 1500)
    })
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-3 scroll-thin space-y-4">
      {/* 1. Header & Permission Regime Control */}
      <div className="rounded-xl border border-line bg-surface/50 p-3 shadow-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/15 text-accent">
              <Cpu size={13} />
            </span>
            <h3 className="text-[11.5px] font-semibold text-ink">Autonomous worker</h3>
          </div>
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-positive/10 px-2 py-0.5 text-[10px] font-medium text-positive">
            <span className="h-1.5 w-1.5 rounded-full bg-positive animate-pulse" /> Active
          </span>
        </div>

        <div className="mt-3">
          <span id="worker-access-level" className="text-[10px] font-medium text-muted block mb-1.5">
            Access level
          </span>
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-canvas/60 p-0.5" role="group" aria-labelledby="worker-access-level">
            <button
              onClick={() => void handleSetPermission('plan')}
              aria-pressed={status?.permissionMode === 'plan'}
              className={cn(
                'flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md py-1 text-[10.5px] font-medium transition-all',
                status?.permissionMode === 'plan'
                  ? 'bg-surface text-ink shadow-xs border border-line'
                  : 'text-muted hover:text-ink'
              )}
            >
              <BookOpen size={11} /> Plan
            </button>
            <button
              onClick={() => void handleSetPermission('build')}
              aria-pressed={status?.permissionMode === 'build'}
              className={cn(
                'flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md py-1 text-[10.5px] font-medium transition-all',
                status?.permissionMode === 'build'
                  ? 'bg-amber-500/15 text-amber-400 shadow-xs border border-amber-500/30'
                  : 'text-muted hover:text-ink'
              )}
            >
              <Wrench size={11} /> Build
            </button>
            <button
              onClick={() => void handleSetPermission('yolo')}
              aria-pressed={status?.permissionMode === 'yolo'}
              className={cn(
                'flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md py-1 text-[10.5px] font-medium transition-all',
                status?.permissionMode === 'yolo'
                  ? 'bg-rose-500/15 text-rose-400 shadow-xs border border-rose-500/30'
                  : 'text-muted hover:text-ink'
              )}
            >
              <Flame size={11} /> Full access
            </button>
          </div>
          {status ? (
            <p className="mt-1.5 text-[10px] text-faint">{MODE_SUMMARY[status.permissionMode]}</p>
          ) : null}
        </div>
      </div>

      {/* 2. Interactive Decision Gates (Human-in-the-Loop) */}
      {pendingGates.length > 0 && (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="flex items-center gap-1.5 text-amber-400 mb-2">
            <HelpCircle size={13} />
            <span className="text-[11px] font-semibold">Human Decision Gate Paused</span>
          </div>
          {pendingGates.map((gate) => (
            <div key={gate.id} className="rounded-lg border border-amber-500/20 bg-surface/70 p-2.5 space-y-2">
              <p className="text-[11px] font-medium text-ink">{gate.question}</p>
              <p className="text-[10px] text-muted">{gate.context}</p>
              {gate.options && gate.options.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {gate.options.map((opt: string) => (
                    <button
                      key={opt}
                      onClick={() => handleResolveGate(gate.id, opt)}
                      className="rounded-md border border-line bg-surface px-2.5 py-1 text-[10px] font-medium text-ink hover:border-accent hover:text-accent transition-colors"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {/* 3. GitOps Change Requests */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <GitPullRequest size={13} className="text-accent" />
            <h4 className="text-[11px] font-semibold text-ink uppercase tracking-wider">Change Requests</h4>
          </div>
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[9.5px] text-muted">
            {changeRequests.length} total
          </span>
        </div>

        {changeRequests.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line p-3 text-center text-[10.5px] text-faint">
            No active Change Requests. Automated modifications will appear here.
          </div>
        ) : (
          <div className="space-y-2">
            {changeRequests.map((cr) => (
              <div key={cr.id} className="rounded-xl border border-line bg-surface/40 p-2.5 text-[10.5px]">
                <div className="flex items-start justify-between gap-1.5">
                  <span className="font-medium text-ink">{cr.title}</span>
                  <span className={cn(
                    'rounded px-1.5 py-0.2 text-[9px] font-medium uppercase',
                    cr.status === 'applied' && 'bg-positive/10 text-positive',
                    cr.status === 'approved' && 'bg-blue-500/10 text-blue-400',
                    cr.status === 'pending_review' && 'bg-amber-500/10 text-amber-400',
                    cr.status === 'rejected' && 'bg-danger/10 text-danger'
                  )}>
                    {cr.status}
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-muted line-clamp-2">{cr.description}</p>
                <div className="mt-1.5 flex items-center gap-2 text-[9.5px] text-faint">
                  <span>Branch: <code className="font-mono text-ink/80">{cr.targetBranch}</code></span>
                  <span>•</span>
                  <span>Risk: <span className={cn(
                    cr.riskAssessment === 'high' ? 'text-rose-400' : 'text-positive'
                  )}>{cr.riskAssessment}</span></span>
                </div>

                {cr.status === 'pending_review' && (
                  <div className="mt-2.5 flex items-center gap-1.5 pt-1.5 border-t border-line/60">
                    <button
                      onClick={() => handleReviewCr(cr.id, 'approved')}
                      className="inline-flex items-center gap-1 rounded bg-positive/15 px-2 py-0.5 text-[10px] font-medium text-positive hover:bg-positive/25 transition-colors"
                    >
                      <CheckCircle2 size={10} /> Approve
                    </button>
                    <button
                      onClick={() => handleReviewCr(cr.id, 'rejected')}
                      className="inline-flex items-center gap-1 rounded bg-danger/15 px-2 py-0.5 text-[10px] font-medium text-danger hover:bg-danger/25 transition-colors"
                    >
                      <XCircle size={10} /> Reject
                    </button>
                  </div>
                )}

                {cr.status === 'approved' && (
                  <div className="mt-2.5 pt-1.5 border-t border-line/60">
                    <button
                      onClick={() => handleApplyCr(cr.id)}
                      className="inline-flex items-center gap-1 rounded bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/30 transition-colors"
                    >
                      <Layers size={10} /> Apply to Workspace
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 4. Verified Deliverables & Research */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Package size={13} className="text-accent" />
            <h4 className="text-[11px] font-semibold text-ink uppercase tracking-wider">Deliverables</h4>
          </div>
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[9.5px] text-muted">
            {deliverables.length} verified
          </span>
        </div>

        {deliverables.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line p-3 text-center text-[10.5px] text-faint">
            No sealed deliverables registered yet. Reports, patches, and artifacts will show here.
          </div>
        ) : (
          <div className="space-y-2">
            {deliverables.map((deliv) => (
              <div key={deliv.id} className="rounded-xl border border-line bg-surface/40 p-2.5 text-[10.5px]">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-ink">{deliv.title}</span>
                  <button
                    onClick={() => copyContent(deliv.id, deliv.content)}
                    className="flex items-center gap-1 text-[9.5px] text-faint hover:text-ink transition-colors"
                    title="Copy deliverable content"
                  >
                    {copiedId === deliv.id ? <Check size={11} className="text-positive" /> : <Copy size={11} />}
                    {copiedId === deliv.id ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <span className="mt-0.5 inline-block text-[9.5px] text-accent uppercase font-mono">{deliv.type}</span>
                <pre className="mt-1.5 max-h-24 overflow-y-auto scroll-thin rounded border border-line/50 bg-canvas/80 p-1.5 font-mono text-[9px] text-muted whitespace-pre-wrap">
                  {deliv.content.slice(0, 300)}
                  {deliv.content.length > 300 ? '...' : ''}
                </pre>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 5. VLA GUI Perception Sensor */}
      <div className="rounded-xl border border-line/70 bg-canvas-deep/40 p-2.5 text-[10px] text-faint flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Monitor size={12} className="text-accent" />
          <span>Screen Viewport: 1920 × 1080 · Natural Bézier Mouse</span>
        </div>
        <span className="text-[9px] bg-surface px-1.5 py-0.5 rounded border border-line">Secrets Shielded</span>
      </div>
    </div>
  )
}
