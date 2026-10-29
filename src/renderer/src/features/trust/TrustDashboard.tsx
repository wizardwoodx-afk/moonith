import { useState } from 'react'
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Lock,
  Cpu,
  Power,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Eye,
  Activity,
  Layers,
  Award
} from 'lucide-react'
import { Button } from '../../components/ui'
import { cn } from '../../lib/utils'

export function TrustDashboard() {
  const [killSwitchActive, setKillSwitchActive] = useState(false)
  const [breakGlassActive, setBreakGlassActive] = useState(false)

  const autonomyLevels = [
    {
      agent: 'Daedalus Coder',
      level: 'Level 2: Semi-Autonomous',
      score: 88,
      proofCount: 8,
      overrideRate: '3.2%',
      badgeColor: 'text-sky-400 bg-sky-500/10 border-sky-500/20'
    },
    {
      agent: 'Kubernis Watcher',
      level: 'Level 3: Autonomous',
      score: 96,
      proofCount: 22,
      overrideRate: '0.8%',
      badgeColor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
    },
    {
      agent: 'Theatron Creative',
      level: 'Level 1: Supervised',
      score: 82,
      proofCount: 2,
      overrideRate: '8.4%',
      badgeColor: 'text-amber-400 bg-amber-500/10 border-amber-500/20'
    }
  ]

  const recentApprovals = [
    {
      tool: 'opendesign_generate_prototype',
      agent: 'Theatron Creative',
      tier: 'safe',
      status: 'auto-approved',
      timestamp: '2m ago'
    },
    {
      tool: 'apply_code_patch',
      agent: 'Daedalus Coder',
      tier: 'warn',
      status: 'approved by Owner',
      timestamp: '14m ago'
    },
    {
      tool: 'run_command (rm -rf /)',
      agent: 'Daedalus Coder',
      tier: 'danger',
      status: 'blocked outright',
      timestamp: '1h ago'
    }
  ]

  return (
    <div className="flex h-full flex-col p-6 space-y-6 overflow-y-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-ink flex items-center gap-2">
            <ShieldCheck size={18} className="text-emerald-400" />
            Trust & Safety, Autonomy, and Egress Ledger
          </h2>
          <p className="mt-1 text-xs text-muted leading-relaxed max-w-xl">
            Hardware-grade OS-level sandboxing, tiered approval gates, per-agent quarantine,
            cryptographic flight-recorder replay, and earned autonomy profiles.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {killSwitchActive ? (
            <Button
              size="sm"
              onClick={() => setKillSwitchActive(false)}
              className="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
            >
              <RotateCcw size={13} />
              Resume System Execution
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setKillSwitchActive(true)}
              className="h-8 gap-1.5 border border-danger/30 bg-danger/10 text-danger hover:bg-danger/20 font-medium"
            >
              <Power size={13} />
              Emergency Kill Switch
            </Button>
          )}
        </div>
      </div>

      {killSwitchActive && (
        <div className="flex items-center justify-between rounded-xl border border-danger/40 bg-danger/10 p-4 text-xs text-danger">
          <div className="flex items-center gap-3">
            <ShieldAlert size={20} className="shrink-0 animate-pulse text-danger" />
            <div>
              <p className="font-semibold text-danger">EMERGENCY KILL SWITCH ENGAGED</p>
              <p className="text-muted mt-0.5">
                All background agent turns and tool dispatches are paused. No external or local actions can execute.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => setBreakGlassActive((prev) => !prev)}
            className="h-7 text-xs bg-danger hover:bg-danger/80 text-white"
          >
            {breakGlassActive ? 'Revoke Break-Glass' : 'Break-Glass Override'}
          </Button>
        </div>
      )}

      {/* Grid: Autonomy Ladder & Tiered Approvals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Earned Autonomy Profiles */}
        <div className="rounded-xl border border-line bg-surface/40 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-faint flex items-center gap-1.5">
              <Award size={13} className="text-amber-400" />
              Earned Progressive Autonomy
            </h3>
            <span className="text-[11px] text-muted">Reliability Gate: &ge;90%</span>
          </div>

          <div className="space-y-3">
            {autonomyLevels.map((item) => (
              <div
                key={item.agent}
                className="flex items-center justify-between rounded-lg border border-line/60 bg-canvas/60 p-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-ink">{item.agent}</span>
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium border', item.badgeColor)}>
                      {item.level}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[11px] text-faint">
                    <span>{item.proofCount} Verified Proofs</span>
                    <span>·</span>
                    <span>Override Rate: {item.overrideRate}</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-sm font-semibold font-mono text-ink">{item.score}%</span>
                  <p className="text-[10px] text-faint">Reliability</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Tiered Approvals & Audit Feed */}
        <div className="rounded-xl border border-line bg-surface/40 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-faint flex items-center gap-1.5">
              <Layers size={13} className="text-sky-400" />
              Tiered Action Guardrails
            </h3>
            <span className="text-[11px] text-muted">3-Tier Matrix</span>
          </div>

          <div className="space-y-2.5">
            {recentApprovals.map((appr, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded-lg border border-line/50 bg-canvas/40 px-3 py-2 text-xs"
              >
                <div className="min-w-0 pr-2">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'rounded px-1 py-0.2 text-[10px] font-mono font-semibold uppercase',
                        appr.tier === 'danger' && 'bg-rose-500/10 text-rose-400 border border-rose-500/20',
                        appr.tier === 'warn' && 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
                        appr.tier === 'safe' && 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      )}
                    >
                      {appr.tier}
                    </span>
                    <span className="font-mono text-[11px] text-ink truncate">{appr.tool}</span>
                  </div>
                  <p className="text-[10.5px] text-faint mt-0.5">
                    {appr.agent} · {appr.timestamp}
                  </p>
                </div>
                <span
                  className={cn(
                    'text-[10.5px] font-medium shrink-0',
                    appr.tier === 'danger' ? 'text-rose-400' : 'text-emerald-400'
                  )}
                >
                  {appr.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Local-First Egress & Sandbox Ledger */}
      <div className="rounded-xl border border-line bg-surface/30 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-faint flex items-center gap-1.5">
            <Lock size={13} className="text-emerald-400" />
            Provable Egress Ledger & Sandboxing
          </h3>
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">
            0 Localhost Ports Open
          </span>
        </div>
        <p className="text-xs text-muted leading-relaxed">
          SelfImpulse operates strictly in-process with 0 listening TCP ports. Every outbound request is
          hashed and logged in the immutable Egress Ledger. API keys and passwords never enter LLM prompt contexts
          and are managed exclusively through AES-256-GCM opaque handles.
        </p>
      </div>
    </div>
  )
}
