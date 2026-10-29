import { useEffect, useState } from 'react'
import {
  Sun,
  Inbox,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Lock,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Play,
  Flame,
  Sliders,
  Eye,
  FileText
} from 'lucide-react'
import { Icon } from '../components/icons'
import { toast } from 'sonner'
import { cn } from '../lib/utils'
import { Button, IconButton } from '../components/ui'

export function PromeyView() {
  const [status, setStatus] = useState<any>(null)
  const [brief, setBrief] = useState<any>(null)
  const [triageItems, setTriageItems] = useState<any[]>([])
  const [approvals, setApprovals] = useState<any[]>([])
  const [routines, setRoutines] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [simText, setSimText] = useState('')
  const [activeTab, setActiveTab] = useState<'brief' | 'triage' | 'approvals' | 'routines'>('brief')

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
    const timer = setInterval(() => void refreshAll(), 5000)
    return () => clearInterval(timer)
  }, [])

  const handleGenerateBrief = async () => {
    try {
      toast.loading('Synthesizing executive morning brief...', { id: 'brief-gen' })
      const newBrief = await window.knight.promeyGenerateBrief('Operator', 'SelfImpulse')
      setBrief(newBrief)
      toast.success('Executive Morning Brief ready!', { id: 'brief-gen' })
      void refreshAll()
    } catch (e: any) {
      toast.error('Brief generation failed: ' + e.message, { id: 'brief-gen' })
    }
  }

  const handleApprovalDecision = async (
    id: string,
    decision: 'allow_once' | 'always_allowed' | 'refused'
  ) => {
    try {
      await window.knight.promeySubmitApproval(id, decision)
      toast.success(`Approval gate decision recorded: ${decision}`)
      void refreshAll()
    } catch (e: any) {
      toast.error('Decision failed: ' + e.message)
    }
  }

  const handleResolveTriage = async (id: string) => {
    try {
      await window.knight.promeyResolveTriage(id, 'Resolved via executive view')
      toast.success('Triage item resolved')
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

  const handleSimulateInbound = async () => {
    if (!simText.trim()) return
    try {
      await window.knight.promeyIngestTriage({
        source: 'email',
        title: simText.trim(),
        content: `Operator simulated stream event: ${simText.trim()}`,
        sender: 'operator@workspace.local'
      })
      setSimText('')
      toast.success('Inbound item triaged!')
      void refreshAll()
    } catch (e: any) {
      toast.error('Ingest failed: ' + e.message)
    }
  }

  const pendingApprovals = approvals.filter((a) => a.status === 'pending')

  return (
    <div className="scroll-thin h-full overflow-y-auto bg-canvas text-ink">
      <div className="mx-auto w-full max-w-[1100px] px-8 pt-8 pb-16">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <Sun size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-[22px] font-semibold tracking-[-0.01em]">Promey Duet</h1>
                  <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-accent">
                    Proactive Executive Agent
                  </span>
                </div>
                <p className="text-[12px] text-muted">
                  Autonomous executive briefings, smart inbox triage, tri-choice HITL gates & DLP privacy
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void refreshAll()}>
              <Icon name="refresh" size="md" className={loading ? 'animate-spin' : ''} />
              Refresh
            </Button>
            <Button variant="primary" size="sm" onClick={handleGenerateBrief}>
              <Icon name="spark" size="md" />
              Synthesize Morning Brief
            </Button>
          </div>
        </div>

        {/* 4 Metric Badges */}
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="card rounded-xl border border-line/80 bg-surface/80 p-3.5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted">Morning Briefing</span>
              <Sun size={15} className="text-amber-400" />
            </div>
            <div className="mt-2 text-[18px] font-semibold text-ink">
              {brief ? 'Daily Active' : 'Not generated'}
            </div>
            <div className="mt-1 text-[11px] text-faint">
              {brief ? `${brief.topPriorities.length} key priorities identified` : 'Click synthesize to generate'}
            </div>
          </div>

          <div className="card rounded-xl border border-line/80 bg-surface/80 p-3.5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted">Tri-Choice Approvals</span>
              <ShieldAlert size={15} className={pendingApprovals.length > 0 ? 'text-amber-400' : 'text-positive'} />
            </div>
            <div className="mt-2 text-[18px] font-semibold text-ink">
              {pendingApprovals.length} Pending
            </div>
            <div className="mt-1 text-[11px] text-faint">
              {status?.whitelistedPatterns?.length || 0} always-allowed patterns
            </div>
          </div>

          <div className="card rounded-xl border border-line/80 bg-surface/80 p-3.5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted">Smart Triage Items</span>
              <Inbox size={15} className="text-accent" />
            </div>
            <div className="mt-2 text-[18px] font-semibold text-ink">
              {triageItems.filter((i) => i.status !== 'resolved').length} Active
            </div>
            <div className="mt-1 text-[11px] text-faint">
              {triageItems.filter((i) => i.urgency === 'critical').length} critical / autonomous sorted
            </div>
          </div>

          <div className="card rounded-xl border border-line/80 bg-surface/80 p-3.5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted">DLP Shield Guard</span>
              <Icon name="shield" size="md" className="text-positive" />
            </div>
            <div className="mt-2 text-[18px] font-semibold text-positive">Enforced</div>
            <div className="mt-1 text-[11px] text-faint">Outbound secret & credential redaction</div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="mt-6 flex border-b border-line">
          <button
            onClick={() => setActiveTab('brief')}
            className={cn(
              'flex items-center gap-2 border-b-2 px-4 py-2 text-[13px] font-medium transition-colors',
              activeTab === 'brief'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-muted hover:text-ink'
            )}
          >
            <Sun size={14} />
            Morning Brief
          </button>
          <button
            onClick={() => setActiveTab('triage')}
            className={cn(
              'flex items-center gap-2 border-b-2 px-4 py-2 text-[13px] font-medium transition-colors',
              activeTab === 'triage'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-muted hover:text-ink'
            )}
          >
            <Inbox size={14} />
            Smart Triage ({triageItems.filter((i) => i.status !== 'resolved').length})
          </button>
          <button
            onClick={() => setActiveTab('approvals')}
            className={cn(
              'flex items-center gap-2 border-b-2 px-4 py-2 text-[13px] font-medium transition-colors',
              activeTab === 'approvals'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-muted hover:text-ink'
            )}
          >
            <ShieldAlert size={14} />
            HITL Approvals ({pendingApprovals.length})
          </button>
          <button
            onClick={() => setActiveTab('routines')}
            className={cn(
              'flex items-center gap-2 border-b-2 px-4 py-2 text-[13px] font-medium transition-colors',
              activeTab === 'routines'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-muted hover:text-ink'
            )}
          >
            <Icon name="clock" size="md" />
            Standing Routines ({routines.length})
          </button>
        </div>

        {/* Tab Content */}
        <div className="mt-6">
          {/* TAB 1: MORNING BRIEF */}
          {activeTab === 'brief' && (
            <div className="space-y-5">
              {brief ? (
                <div className="card rounded-2xl border border-line bg-surface p-6 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[15px] font-semibold text-ink">
                          Executive Brief for {brief.date}
                        </span>
                        <span className="rounded bg-accent-soft px-2 py-0.5 text-[10px] text-accent font-medium">
                          {brief.userName}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-faint">
                        Synthesized by Promey Executive Engine &bull; {new Date(brief.generatedAt).toLocaleTimeString()}
                      </p>
                    </div>
                    <Button variant="secondary" size="sm" onClick={handleGenerateBrief}>
                      <Icon name="refresh" size="md" />
                      Regenerate
                    </Button>
                  </div>

                  <div className="mt-5">
                    <h3 className="text-[12px] font-semibold uppercase tracking-wider text-muted">
                      Executive Summary
                    </h3>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-ink/90 bg-surface-2/40 rounded-xl p-3.5 border border-line/50">
                      {brief.summary}
                    </p>
                  </div>

                  <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div>
                      <h3 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-amber-500">
                        <Flame size={14} />
                        Top Priorities Today
                      </h3>
                      <div className="mt-2.5 space-y-2">
                        {brief.topPriorities.map((p: any, i: number) => (
                          <div
                            key={i}
                            className="flex items-start gap-2.5 rounded-lg border border-line/60 bg-surface-2/30 p-2.5 text-[12.5px]"
                          >
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-bold text-accent">
                              {i + 1}
                            </span>
                            <div className="flex-1">
                              <p className="font-medium text-ink">{p.title}</p>
                              <div className="mt-1 flex items-center gap-2 text-[10.5px] text-faint">
                                <span className={cn('font-semibold', p.urgency === 'high' ? 'text-danger' : 'text-muted')}>
                                  Urgency: {p.urgency}
                                </span>
                                {p.actionUrl && (
                                  <a href={p.actionUrl} className="text-accent underline" target="_blank" rel="noreferrer">
                                    Action Link
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h3 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-accent">
                        <CheckCircle2 size={14} />
                        Decisions Required
                      </h3>
                      <div className="mt-2.5 space-y-2">
                        {brief.decisionsRequired.map((d: any, i: number) => (
                          <div
                            key={i}
                            className="rounded-lg border border-line/60 bg-surface-2/30 p-2.5 text-[12.5px]"
                          >
                            <div className="flex items-center justify-between">
                              <p className="font-medium text-ink">{d.title}</p>
                              <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] text-warn font-semibold">
                                Due: {d.deadline || 'Today'}
                              </span>
                            </div>
                            <p className="mt-1 text-[11.5px] text-muted">{d.context}</p>
                            {d.suggestedAction && (
                              <p className="mt-1.5 text-[11px] text-accent">
                                Recommendation: {d.suggestedAction}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {brief.upcomingRoutines?.length > 0 && (
                    <div className="mt-6 border-t border-line/60 pt-4">
                      <h3 className="text-[12px] font-semibold uppercase tracking-wider text-muted">
                        Autonomous Routines Scheduled For Today
                      </h3>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {brief.upcomingRoutines.map((r: any, i: number) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 rounded-lg border border-line/60 bg-surface-2/40 px-3 py-1.5 text-[11.5px]"
                          >
                            <Icon name="clock" size="sm" className="text-accent" />
                            <span className="font-medium">{r.name}</span>
                            <span className="text-faint">({r.frequency})</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="card flex flex-col items-center justify-center rounded-2xl border border-line bg-surface p-12 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-500">
                    <Sun size={28} />
                  </div>
                  <h3 className="mt-4 text-[16px] font-semibold">No Morning Brief Active</h3>
                  <p className="mt-1 max-w-sm text-[12.5px] text-muted">
                    Promey can review your active streams, schedules, tasks, and system state to synthesize an executive priority plan.
                  </p>
                  <Button variant="primary" className="mt-5" onClick={handleGenerateBrief}>
                    <Icon name="spark" size="md" />
                    Synthesize Today's Morning Brief
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: TRIAGE STREAM */}
          {activeTab === 'triage' && (
            <div className="space-y-4">
              {/* Simulator input */}
              <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-2 shadow-sm">
                <input
                  type="text"
                  value={simText}
                  onChange={(e) => setSimText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSimulateInbound()}
                  placeholder="Simulate an inbound email, slack message, or webhook item for smart triage..."
                  className="flex-1 bg-transparent px-3 text-[12.5px] outline-none text-ink placeholder:text-faint"
                />
                <Button variant="secondary" size="sm" onClick={handleSimulateInbound}>
                  <Icon name="send" size="md" />
                  Ingest Stream
                </Button>
              </div>

              {triageItems.length === 0 ? (
                <div className="card rounded-2xl border border-line bg-surface p-12 text-center text-[13px] text-faint">
                  Inbox is clear. No triage items in stream.
                </div>
              ) : (
                <div className="space-y-2">
                  {triageItems.map((item) => (
                    <div
                      key={item.id}
                      className="card flex items-start justify-between gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide',
                              item.urgency === 'critical'
                                ? 'bg-danger/15 text-danger'
                                : item.urgency === 'high'
                                  ? 'bg-warn/15 text-warn'
                                  : 'bg-surface-3 text-muted'
                            )}
                          >
                            {item.urgency}
                          </span>
                          <span className="text-[11px] font-mono text-faint">{item.source}</span>
                          <span className="text-[12.5px] font-semibold text-ink">{item.title}</span>
                        </div>
                        <p className="mt-1 text-[12px] text-muted line-clamp-2">{item.content}</p>
                        {item.suggestedAction && (
                          <p className="mt-1.5 text-[11px] text-accent">
                            Autonomous Recommendation: {item.suggestedAction}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {item.status !== 'resolved' ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleResolveTriage(item.id)}
                          >
                            <Icon name="confirm" size="md" />
                            Resolve
                          </Button>
                        ) : (
                          <span className="text-[11px] text-positive font-medium">Resolved</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: HITL APPROVALS */}
          {activeTab === 'approvals' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-line/80 bg-surface-2/40 p-3 text-[12px] text-muted">
                Promey enforces a <strong>Tri-Choice Human-In-The-Loop Gate</strong>:
                <span className="ml-2 font-mono text-positive">Allow Once</span>,
                <span className="mx-1 font-mono text-accent">Always Allow (Pattern Whitelist)</span>, or
                <span className="ml-1 font-mono text-danger">Refuse</span>.
              </div>

              {pendingApprovals.length === 0 ? (
                <div className="card rounded-2xl border border-line bg-surface p-12 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-positive/10 text-positive">
                    <Icon name="shield" size="xl" />
                  </div>
                  <h3 className="mt-3 text-[15px] font-semibold">Zero Pending Approvals</h3>
                  <p className="mt-1 text-[12px] text-faint">
                    All agent execution gates are currently clear.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingApprovals.map((appr) => (
                    <div
                      key={appr.id}
                      className="card rounded-xl border border-amber-500/30 bg-surface p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-danger/15 px-1.5 py-0.5 text-[10px] font-bold text-danger uppercase">
                              {appr.riskLevel} Risk
                            </span>
                            <span className="text-[13px] font-semibold text-ink">{appr.action}</span>
                          </div>
                          <p className="mt-1.5 text-[12px] text-muted">{appr.description}</p>
                          <div className="mt-2 rounded-lg bg-surface-2/60 p-2 font-mono text-[11px] text-ink/80">
                            Pattern: {appr.scopePattern}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex items-center justify-end gap-2 border-t border-line/60 pt-3">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="text-danger hover:bg-danger/10"
                          onClick={() => handleApprovalDecision(appr.id, 'refused')}
                        >
                          <XCircle size={13} />
                          Refuse
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleApprovalDecision(appr.id, 'allow_once')}
                        >
                          <CheckCircle2 size={13} className="text-positive" />
                          Allow Once
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleApprovalDecision(appr.id, 'always_allowed')}
                        >
                          <Icon name="spark" size="md" />
                          Always Allow
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: ROUTINES */}
          {activeTab === 'routines' && (
            <div className="space-y-3">
              <div className="rounded-xl border border-line/80 bg-surface-2/40 p-3 text-[12px] text-muted">
                Promey background routine workers execute autonomous checks and standing instructions on a regular cadence without blocking active tasks.
              </div>

              <div className="space-y-2">
                {routines.map((routine) => (
                  <div
                    key={routine.id}
                    className="card flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-ink">{routine.title}</span>
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[9.5px] font-semibold',
                            routine.enabled
                              ? 'bg-positive/15 text-positive'
                              : 'bg-surface-3 text-faint'
                          )}
                        >
                          {routine.enabled ? 'Active' : 'Paused'}
                        </span>
                      </div>
                      <p className="mt-1 text-[11.5px] text-muted">{routine.prompt}</p>
                      <div className="mt-1.5 flex items-center gap-3 text-[10.5px] text-faint">
                        <span>Cron: {routine.cron}</span>
                        <span>Runs: {routine.runCount}</span>
                        {routine.lastRunAt && (
                          <span>Last run: {new Date(routine.lastRunAt).toLocaleTimeString()}</span>
                        )}
                      </div>
                    </div>

                    <Button
                      variant={routine.enabled ? 'secondary' : 'primary'}
                      size="sm"
                      onClick={() => handleToggleRoutine(routine.id, routine.enabled)}
                    >
                      {routine.enabled ? 'Pause' : 'Activate'}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
