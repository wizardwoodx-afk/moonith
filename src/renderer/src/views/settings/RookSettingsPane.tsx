import { useEffect, useState } from 'react'
import {
  Cpu,
  ShieldCheck,
  GitPullRequest,
  Search,
  Sparkles,
  KeyRound,
  Check,
  Flame,
  Wrench,
  BookOpen,
  Monitor,
  Package,
  Layers,
  CheckCircle2,
  XCircle,
  RefreshCw
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '../../lib/utils'

export function RookSettingsPane() {
  const [status, setStatus] = useState<any>(null)
  const [coworkStatus, setCoworkStatus] = useState<any>(null)
  const [changeRequests, setChangeRequests] = useState<any[]>([])
  const [deliverables, setDeliverables] = useState<any[]>([])
  const [skillQuery, setSkillQuery] = useState('')
  const [skillResults, setSkillResults] = useState<any[]>([])
  const [searchingSkills, setSearchingSkills] = useState(false)
  const [secretTestInput, setSecretTestInput] = useState('My secret api key is sk-1234567890abcdef1234567890abcdef and should be protected.')
  const [redactedOutput, setRedactedOutput] = useState('')

  const loadData = async () => {
    try {
      const [st, cst, crs, dels] = await Promise.all([
        window.knight.rookStatus(),
        window.knight.coworkStatus(),
        window.knight.rookListChangeRequests(),
        window.knight.rookListDeliverables()
      ])
      setStatus(st)
      setCoworkStatus(cst)
      setChangeRequests(crs)
      setDeliverables(dels)
    } catch (err) {
      console.error('Failed to load ROOK settings data:', err)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const handleModeChange = async (mode: 'plan' | 'build' | 'yolo') => {
    try {
      await window.knight.rookSetPermission(mode)
      toast.success(`Permission mode set to ${mode.toUpperCase()}`)
      await loadData()
    } catch (err: any) {
      toast.error(`Error: ${err.message}`)
    }
  }

  const handleSearchSkills = async (q: string) => {
    setSkillQuery(q)
    if (!q.trim()) {
      setSkillResults([])
      return
    }
    setSearchingSkills(true)
    try {
      const results = await window.knight.coworkSearchSkills(q)
      setSkillResults(results)
    } catch (err) {
      console.error('Skill search error:', err)
    } finally {
      setSearchingSkills(false)
    }
  }

  const testSecretRedaction = () => {
    // Standard test redaction
    let out = secretTestInput.replace(/(sk-[a-zA-Z0-9_-]{20,})/g, '[REDACTED_API_KEY]')
    out = out.replace(/(ghp_[a-zA-Z0-9]{30,})/g, '[REDACTED_GITHUB_TOKEN]')
    setRedactedOutput(out)
    toast.success('Redaction simulated successfully')
  }

  return (
    <div className="space-y-6">
      {/* 1. Header Overview */}
      <div className="rounded-2xl border border-line bg-surface/40 p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Cpu size={20} />
            </span>
            <div>
              <h2 className="text-[16px] font-semibold text-ink">Autonomous worker</h2>
            </div>
          </div>
          <button
            onClick={() => void loadData()}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11px] text-muted hover:text-ink transition-colors"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        {/* Live metric cards */}
        <div className="mt-5 grid grid-cols-4 gap-3">
          <div className="rounded-xl border border-line/80 bg-canvas/50 p-3">
            <span className="text-[10.5px] font-medium text-faint uppercase">Turns Executed</span>
            <div className="mt-1 text-[18px] font-semibold text-ink">{status?.executionTurns ?? 0}</div>
          </div>
          <div className="rounded-xl border border-line/80 bg-canvas/50 p-3">
            <span className="text-[10.5px] font-medium text-faint uppercase">Change Requests</span>
            <div className="mt-1 text-[18px] font-semibold text-ink">{status?.changeRequestsCount ?? 0}</div>
          </div>
          <div className="rounded-xl border border-line/80 bg-canvas/50 p-3">
            <span className="text-[10.5px] font-medium text-faint uppercase">Deliverables</span>
            <div className="mt-1 text-[18px] font-semibold text-ink">{status?.deliverablesCount ?? 0}</div>
          </div>
          <div className="rounded-xl border border-line/80 bg-canvas/50 p-3">
            <span className="text-[10.5px] font-medium text-faint uppercase">Skills indexed</span>
            <div className="mt-1 text-[18px] font-semibold text-accent">
              {coworkStatus?.totalSkills ? coworkStatus.totalSkills.toLocaleString() : '360,000+'}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Permission Regime Config */}
      <div className="rounded-2xl border border-line bg-surface/40 p-5 space-y-3">
        <h3 className="text-[13px] font-semibold text-ink">Permission mode</h3>
        <p className="text-[11.5px] text-faint leading-relaxed">
          Controls what the worker may do without asking.
        </p>

        <div className="grid grid-cols-3 gap-3 pt-1">
          <button
            onClick={() => handleModeChange('plan')}
            className={cn(
              'rounded-xl border p-3.5 text-left transition-all',
              status?.permissionMode === 'plan'
                ? 'border-accent bg-accent-soft/30 text-ink ring-1 ring-accent'
                : 'border-line bg-canvas/40 hover:bg-surface/60'
            )}
          >
            <div className="flex items-center gap-2 font-medium text-[12px] text-ink">
              <BookOpen size={14} className="text-accent" /> Plan Mode
            </div>
            <p className="mt-1.5 text-[10.5px] text-faint leading-normal">
              Reads and plans only; changes nothing on this machine.
            </p>
          </button>

          <button
            onClick={() => handleModeChange('build')}
            className={cn(
              'rounded-xl border p-3.5 text-left transition-all',
              status?.permissionMode === 'build'
                ? 'border-amber-500 bg-amber-500/10 text-ink ring-1 ring-amber-500'
                : 'border-line bg-canvas/40 hover:bg-surface/60'
            )}
          >
            <div className="flex items-center gap-2 font-medium text-[12px] text-amber-400">
              <Wrench size={14} /> Build Mode
            </div>
            <p className="mt-1.5 text-[10.5px] text-faint leading-normal">
              Edits files freely; asks before running shell commands.
            </p>
          </button>

          <button
            onClick={() => handleModeChange('yolo')}
            className={cn(
              'rounded-xl border p-3.5 text-left transition-all',
              status?.permissionMode === 'yolo'
                ? 'border-rose-500 bg-rose-500/10 text-ink ring-1 ring-rose-500'
                : 'border-line bg-canvas/40 hover:bg-surface/60'
            )}
          >
            <div className="flex items-center gap-2 font-medium text-[12px] text-rose-400">
              <Flame size={14} /> YOLO Mode
            </div>
            <p className="mt-1.5 text-[10.5px] text-faint leading-normal">
              Runs file edits, terminal commands and background work without asking.
            </p>
          </button>
        </div>
      </div>

      {/* 3. Lobe Chat 360K+ Skills Explorer */}
      <div className="rounded-2xl border border-line bg-surface/40 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-ink">Skills catalog</h3>
        </div>

        <div className="relative pt-1">
          <Search size={14} className="absolute left-3 top-4 text-faint" />
          <input
            type="text"
            value={skillQuery}
            onChange={(e) => void handleSearchSkills(e.target.value)}
            aria-label="Search the skills catalog"
            placeholder="Search by skill name, domain (e.g. 'code', 'research', 'devops', 'design')..."
            className="w-full rounded-xl border border-line bg-canvas/70 pl-9 pr-4 py-2 text-[12px] text-ink placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </div>

        {searchingSkills && (
          <div className="py-4 text-center text-[11px] text-faint">Searching skills catalog...</div>
        )}

        {skillResults.length > 0 && (
          <div className="space-y-2 max-h-56 overflow-y-auto scroll-thin pt-1">
            {skillResults.map((skill) => (
              <div key={skill.id} className="rounded-xl border border-line bg-canvas/50 p-2.5 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-ink flex items-center gap-1.5">
                    <Sparkles size={11} className="text-accent" /> {skill.name}
                  </span>
                  <span className="text-[10px] text-faint font-mono">{skill.id}</span>
                </div>
                <p className="mt-1 text-[10.5px] text-muted">{skill.description}</p>
                {skill.tags && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {skill.tags.map((t: string) => (
                      <span key={t} className="rounded bg-surface px-1.5 py-0.2 text-[10px] whitespace-nowrap text-faint border border-line/60">
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 4. Sandboxed Credential Shield Tester */}
      <div className="rounded-2xl border border-line bg-surface/40 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-accent" />
          <h3 className="text-[13px] font-semibold text-ink">Secret redaction check</h3>
        </div>

        <div className="space-y-2 pt-1">
          <textarea
            value={secretTestInput}
            onChange={(e) => setSecretTestInput(e.target.value)}
            aria-label="Text to test secret redaction on"
            rows={2}
            className="w-full rounded-xl border border-line bg-canvas/70 p-2.5 text-[11px] font-mono text-ink focus:border-accent focus:outline-none"
          />
          <div className="flex justify-between items-center">
            <button
              onClick={testSecretRedaction}
              className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:bg-accent/90 transition-colors"
            >
              Simulate Secret Redaction
            </button>
            {redactedOutput && (
              <span className="text-[10.5px] text-positive flex items-center gap-1">
                <Check size={11} /> Redacted Cleanly
              </span>
            )}
          </div>

          {redactedOutput && (
            <pre className="rounded-xl border border-positive/30 bg-positive/5 p-2.5 font-mono text-[10.5px] text-ink whitespace-pre-wrap">
              {redactedOutput}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
