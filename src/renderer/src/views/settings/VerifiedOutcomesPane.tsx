import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CheckCircle2,
  FlaskConical,
  LockKeyhole,
  Plus,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  XCircle
} from 'lucide-react'
import {
  DEFAULT_OUTCOME_DEFINITION,
  OUTCOME_DATA_CLASSES,
  OUTCOME_ENVIRONMENTS,
  type OutcomeAutonomyLevel,
  type OutcomeContract,
  type OutcomeContractDefinition,
  type OutcomeContractVersion,
  type OutcomeTaskBindingInput,
  type VerifiedOutcomeOperation,
  type VerifiedOutcomeSnapshot
} from '@shared/verifiedOutcomes'
import { cn, errorMessage } from '../../lib/utils'
import { Button, Spin, Toggle } from '../../components/ui'
import { SettingsSection } from './SettingsSection'

const tabs = ['Overview', 'Contracts', 'Autonomy', 'Evidence', 'Regressions'] as const
type Tab = (typeof tabs)[number]

const inputClass =
  'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[11.5px] text-ink outline-none placeholder:text-faint focus:border-accent/45 disabled:opacity-50'
const labelClass = 'block space-y-1.5 text-[10.5px] font-medium text-muted'

const LEVEL_LABELS: Record<OutcomeAutonomyLevel, string> = {
  observe: 'Observe',
  suggest: 'Suggest',
  'approved-action': 'Approved action',
  'bounded-autonomy': 'Bounded autonomy'
}

function activeVersion(contract: OutcomeContract): OutcomeContractVersion | undefined {
  return contract.versions.find((version) => version.status === 'active')
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className={labelClass}><span>{label}</span>{children}</label>
}

function Metric({ label, value, tone = false }: { label: string; value: number; tone?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-canvas/45 px-3 py-2.5">
      <p className={cn('text-[17px] font-semibold', tone && value > 0 ? 'text-warn' : 'text-ink')}>{value}</p>
      <p className="mt-0.5 text-[9px] text-faint">{label}</p>
    </div>
  )
}

function Status({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return (
    <span className={cn(
      'inline-flex rounded-full px-1.5 py-0.5 text-[8.5px] font-medium uppercase tracking-wide',
      danger ? 'bg-danger/10 text-danger' : 'bg-accent-soft/60 text-accent-ink'
    )}>
      {children}
    </span>
  )
}

function ContractEditor({
  initial,
  mode,
  busy,
  onCancel,
  onSubmit
}: {
  initial: { name: string; workflowId: string; description: string; definition: OutcomeContractDefinition }
  mode: 'create' | 'stage'
  busy: boolean
  onCancel: () => void
  onSubmit: (input: { name: string; workflowId: string; description: string; definition: OutcomeContractDefinition }) => Promise<boolean>
}) {
  const [name, setName] = useState(initial.name)
  const [workflowId, setWorkflowId] = useState(initial.workflowId)
  const [description, setDescription] = useState(initial.description)
  const [downstreamOutcome, setDownstreamOutcome] = useState(initial.definition.downstreamOutcome)
  const [completed, setCompleted] = useState(initial.definition.checks.some((check) => check.kind === 'task-completed'))
  const [cleanTools, setCleanTools] = useState(initial.definition.checks.some((check) => check.kind === 'no-failed-tools'))
  const [planComplete, setPlanComplete] = useState(initial.definition.checks.some((check) => check.kind === 'plan-complete'))
  const artifactCheck = initial.definition.checks.find((check) => check.kind === 'minimum-artifacts')
  const [artifactsEnabled, setArtifactsEnabled] = useState(Boolean(artifactCheck))
  const [artifacts, setArtifacts] = useState(artifactCheck?.kind === 'minimum-artifacts' ? artifactCheck.minimum : 1)
  const toolCheck = initial.definition.checks.find((check) => check.kind === 'required-tool')
  const [requiredTool, setRequiredTool] = useState(toolCheck?.kind === 'required-tool' ? toolCheck.tool : '')
  const [toolMinimum, setToolMinimum] = useState(toolCheck?.kind === 'required-tool' ? toolCheck.minimum : 1)
  const [minimumRuns, setMinimumRuns] = useState(initial.definition.promotion.minimumRuns)
  const [passRate, setPassRate] = useState(Math.round(initial.definition.promotion.minimumPassRate * 100))
  const [lookbackDays, setLookbackDays] = useState(initial.definition.promotion.lookbackDays)
  const [ceiling, setCeiling] = useState<OutcomeAutonomyLevel>(initial.definition.autonomyCeiling)
  const [humanReview, setHumanReview] = useState(initial.definition.humanReviewRequired)
  const [formError, setFormError] = useState<string | null>(null)

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const definition: OutcomeContractDefinition = {
      downstreamOutcome: downstreamOutcome.trim(),
      checks: [
        ...(completed ? [{ id: 'completed', label: 'Task completed', kind: 'task-completed' as const, required: true }] : []),
        ...(cleanTools ? [{ id: 'clean-tools', label: 'No failed tool steps', kind: 'no-failed-tools' as const, required: true }] : []),
        ...(planComplete ? [{ id: 'plan-complete', label: 'Every plan step completed', kind: 'plan-complete' as const, required: true }] : []),
        ...(artifactsEnabled ? [{ id: 'artifacts', label: 'Required output artifacts', kind: 'minimum-artifacts' as const, required: true, minimum: artifacts }] : []),
        ...(requiredTool.trim() ? [{ id: 'required-tool', label: `Successful ${requiredTool.trim()} execution`, kind: 'required-tool' as const, required: true, tool: requiredTool.trim(), minimum: toolMinimum }] : [])
      ],
      promotion: { minimumRuns, minimumPassRate: passRate / 100, lookbackDays },
      autonomyCeiling: ceiling,
      humanReviewRequired: humanReview
    }
    if (!definition.checks.length) {
      setFormError('Select at least one deterministic outcome check.')
      return
    }
    setFormError(null)
    void onSubmit({ name, workflowId, description, definition })
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-accent/25 bg-accent-soft/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-ink">{mode === 'create' ? 'New outcome contract' : 'Stage a draft revision'}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-faint">Checks are evaluated from actual task metadata, never from the agent’s self-assessment.</p>
        </div>
        <button type="button" onClick={onCancel} className="text-[10px] text-faint hover:text-ink">Cancel</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Workflow name"><input required maxLength={120} disabled={busy || mode === 'stage'} value={name} onChange={(event) => setName(event.target.value)} className={inputClass} placeholder="ITSM resolution" /></Field>
        <Field label="Workflow id"><input required maxLength={140} disabled={busy || mode === 'stage'} value={workflowId} onChange={(event) => setWorkflowId(event.target.value)} className={cn(inputClass, 'font-mono text-[10.5px]')} placeholder="itsm-resolution" /></Field>
      </div>
      <Field label="Downstream business result"><textarea required minLength={3} maxLength={500} disabled={busy} value={downstreamOutcome} onChange={(event) => setDownstreamOutcome(event.target.value)} className={cn(inputClass, 'resize-y')} rows={2} placeholder="The support case is resolved and remains closed in the downstream system." /></Field>
      <Field label="Scope / notes (optional)"><textarea maxLength={500} disabled={busy || mode === 'stage'} value={description} onChange={(event) => setDescription(event.target.value)} className={cn(inputClass, 'resize-y')} rows={2} placeholder="Workflow boundaries, owner, or operational context." /></Field>
      <div>
        <p className="text-[10.5px] font-medium text-muted">Deterministic acceptance checks</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {[
            { value: completed, set: setCompleted, label: 'Task completed' },
            { value: cleanTools, set: setCleanTools, label: 'No failed tool steps' },
            { value: planComplete, set: setPlanComplete, label: 'Every plan step completed' },
            { value: artifactsEnabled, set: setArtifactsEnabled, label: 'Minimum output artifacts' }
          ].map((item) => (
            <label key={item.label} className="flex items-center gap-2 rounded-lg border border-line bg-canvas/45 px-3 py-2 text-[10.5px] text-muted">
              <input type="checkbox" checked={item.value} disabled={busy} onChange={(event) => item.set(event.target.checked)} className="accent-[var(--c-accent)]" />
              {item.label}
            </label>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Artifact minimum"><input type="number" min={1} max={10000} disabled={busy || !artifactsEnabled} value={artifacts} onChange={(event) => setArtifacts(Number(event.target.value))} className={inputClass} /></Field>
        <Field label="Required successful tool (optional)"><input disabled={busy} value={requiredTool} onChange={(event) => setRequiredTool(event.target.value)} className={cn(inputClass, 'font-mono text-[10.5px]')} placeholder="write_file" /></Field>
        <Field label="Tool success minimum"><input type="number" min={1} max={10000} disabled={busy || !requiredTool.trim()} value={toolMinimum} onChange={(event) => setToolMinimum(Number(event.target.value))} className={inputClass} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Evidence runs"><input type="number" min={1} max={100} required disabled={busy} value={minimumRuns} onChange={(event) => setMinimumRuns(Number(event.target.value))} className={inputClass} /></Field>
        <Field label="Pass rate %"><input type="number" min={1} max={100} required disabled={busy} value={passRate} onChange={(event) => setPassRate(Number(event.target.value))} className={inputClass} /></Field>
        <Field label="Lookback days"><input type="number" min={1} max={365} required disabled={busy} value={lookbackDays} onChange={(event) => setLookbackDays(Number(event.target.value))} className={inputClass} /></Field>
        <Field label="Autonomy ceiling"><select disabled={busy} value={ceiling} onChange={(event) => setCeiling(event.target.value as OutcomeAutonomyLevel)} className={inputClass}>{Object.entries(LEVEL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      </div>
      <div className="flex items-center gap-3 rounded-lg border border-line bg-canvas/45 px-3 py-2.5">
        <div className="min-w-0 flex-1"><p className="text-[10.5px] font-medium text-ink">Human outcome review</p><p className="mt-0.5 text-[9.5px] text-faint">Passing checks become verified evidence only after local administrator acceptance.</p></div>
        <Toggle label="Require human outcome review" checked={humanReview} disabled={busy} onChange={setHumanReview} />
      </div>
      {formError ? <p className="text-[10.5px] text-danger">{formError}</p> : null}
      <div className="flex justify-end"><Button type="submit" variant="primary" loading={busy}><ShieldCheck size={13} />{mode === 'create' ? 'Create active contract' : 'Stage draft'}</Button></div>
    </form>
  )
}

export function VerifiedOutcomesPane() {
  const [snapshot, setSnapshot] = useState<VerifiedOutcomeSnapshot | null>(null)
  const [tab, setTab] = useState<Tab>('Overview')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editor, setEditor] = useState<{
    mode: 'create' | 'stage'
    contractId?: string
    initial: { name: string; workflowId: string; description: string; definition: OutcomeContractDefinition }
  } | null>(null)

  const refresh = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setSnapshot(await window.knight.verifiedOutcomes.snapshot())
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  const mutate = async (operation: VerifiedOutcomeOperation, reason: string): Promise<boolean> => {
    if (!snapshot) return false
    setBusy(true)
    setError(null)
    try {
      const next = await window.knight.verifiedOutcomes.mutate({
        expectedRevision: snapshot.revision,
        reason,
        operation
      })
      setSnapshot(next)
      return true
    } catch (cause) {
      const message = errorMessage(cause)
      await refresh().catch(() => undefined)
      setError(message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const contractName = (id: string): string => snapshot?.contracts.find((contract) => contract.id === id)?.name ?? id

  return (
    <SettingsSection
      title="Verified Outcomes"
      description="Agents earn autonomy through evidence—per workflow, exact tool, data class, environment, model, and policy version. Never through a global agent score."
      action={<button type="button" onClick={() => void refresh()} title="Refresh outcome evidence" className="text-faint hover:text-ink"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>}
    >
      <div className="space-y-5">
        <div className="flex items-start gap-2.5 rounded-lg border border-line bg-canvas/45 px-3 py-2.5">
          <LockKeyhole size={14} className="mt-0.5 shrink-0 text-accent" />
          <p className="text-[10.5px] leading-relaxed text-muted">Evidence can make a grant eligible. Only the local enterprise administrator can expand authority. Material failures automatically demote matching grants and open a circuit.</p>
        </div>
        {error ? <p className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-[10.5px] text-danger">{error}</p> : null}
        {loading && !snapshot ? <div className="flex justify-center py-8"><Spin size={17} /></div> : null}
        {snapshot ? (
          <>
            <div className="flex gap-1 overflow-x-auto border-b border-line" role="tablist" aria-label="Verified Outcomes sections">
              {tabs.map((item) => (
                <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)} className={cn('relative shrink-0 px-3 py-2 text-[10.5px] font-medium transition-colors', tab === item ? 'text-ink' : 'text-faint hover:text-muted')}>
                  {item}
                  {item === 'Evidence' && snapshot.metrics.pendingReviews ? <span className="ml-1 text-warn">{snapshot.metrics.pendingReviews}</span> : null}
                  {item === 'Regressions' && snapshot.metrics.pendingRegressions ? <span className="ml-1 text-warn">{snapshot.metrics.pendingRegressions}</span> : null}
                  {tab === item ? <motion.span layoutId="outcome-settings-tab" className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent" /> : null}
                </button>
              ))}
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={tab} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} transition={{ duration: 0.14 }}>
                {tab === 'Overview' ? (
                  <div className="space-y-5">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <Metric label="Active contracts" value={snapshot.metrics.activeContracts} />
                      <Metric label="Verified outcomes" value={snapshot.metrics.verifiedReceipts} />
                      <Metric label="Bounded grants" value={snapshot.metrics.boundedGrants} />
                      <Metric label="Open circuits" value={snapshot.metrics.openCircuits} tone />
                      <Metric label="Pending outcome reviews" value={snapshot.metrics.pendingReviews} tone />
                      <Metric label="Pending regressions" value={snapshot.metrics.pendingRegressions} tone />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <button type="button" onClick={() => setTab('Contracts')} className="rounded-xl border border-line bg-canvas/45 p-3.5 text-left transition-colors hover:border-line-strong"><ShieldCheck size={15} className="text-accent" /><p className="mt-2 text-[11.5px] font-medium text-ink">Define the business result</p><p className="mt-1 text-[10px] leading-relaxed text-faint">Deterministic checks, human review, evidence thresholds, and a hard autonomy ceiling.</p></button>
                      <button type="button" onClick={() => setTab('Autonomy')} className="rounded-xl border border-line bg-canvas/45 p-3.5 text-left transition-colors hover:border-line-strong"><LockKeyhole size={15} className="text-accent" /><p className="mt-2 text-[11.5px] font-medium text-ink">Authorize one exact scope</p><p className="mt-1 text-[10px] leading-relaxed text-faint">No authority expands until evidence is sufficient and an administrator approves it.</p></button>
                    </div>
                    <div className="space-y-2 rounded-lg border border-line bg-canvas/35 p-3.5">
                      {Object.values(snapshot.security).map((boundary) => <p key={boundary} className="flex items-start gap-2 text-[10px] leading-relaxed text-muted"><CheckCircle2 size={12} className="mt-0.5 shrink-0 text-accent" />{boundary}</p>)}
                    </div>
                  </div>
                ) : null}

                {tab === 'Contracts' ? (
                  <div className="space-y-3">
                    <div className="flex justify-end"><Button variant="secondary" size="sm" disabled={busy} onClick={() => setEditor({ mode: 'create', initial: { name: '', workflowId: '', description: '', definition: DEFAULT_OUTCOME_DEFINITION } })}><Plus size={12} />New contract</Button></div>
                    {editor ? <ContractEditor key={`${editor.mode}:${editor.contractId ?? 'new'}`} mode={editor.mode} initial={editor.initial} busy={busy} onCancel={() => setEditor(null)} onSubmit={async (input) => {
                      const saved = editor.mode === 'create'
                        ? await mutate({ type: 'contract.create', contract: { workflowId: input.workflowId, name: input.name, description: input.description, definition: input.definition } }, `Create outcome contract ${input.name}`)
                        : await mutate({ type: 'contract.stage', contractId: editor.contractId!, definition: input.definition }, `Stage draft for ${editor.initial.name}`)
                      if (saved) setEditor(null)
                      return saved
                    }} /> : null}
                    {snapshot.contracts.length === 0 && !editor ? <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[10.5px] text-faint">No outcome contracts yet. Start with one workflow whose downstream result can be checked deterministically.</p> : null}
                    {snapshot.contracts.map((contract) => {
                      const active = activeVersion(contract)
                      const drafts = contract.versions.filter((version) => version.status === 'draft')
                      return (
                        <div key={contract.id} className="rounded-xl border border-line bg-canvas/45 p-3.5">
                          <div className="flex flex-wrap items-start gap-3">
                            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-[12px] font-semibold text-ink">{contract.name}</p><Status danger={contract.lifecycle !== 'active'}>{contract.lifecycle}</Status><span className="text-[9px] text-faint">active v{active?.revision ?? '—'}</span></div><p className="mt-1 font-mono text-[9px] text-faint">{contract.workflowId}</p><p className="mt-2 text-[10.5px] leading-relaxed text-muted">{active?.downstreamOutcome ?? 'No active downstream outcome.'}</p>{contract.description ? <p className="mt-1 text-[9.5px] leading-relaxed text-faint">{contract.description}</p> : null}</div>
                            <div className="flex gap-1.5"><Button variant="ghost" size="sm" disabled={busy || contract.lifecycle === 'archived'} onClick={() => active && setEditor({ mode: 'stage', contractId: contract.id, initial: { name: contract.name, workflowId: contract.workflowId, description: contract.description, definition: active } })}>Stage revision</Button><Button variant="ghost" size="sm" disabled={busy || contract.lifecycle === 'archived'} onClick={() => void mutate({ type: 'contract.lifecycle', contractId: contract.id, lifecycle: contract.lifecycle === 'active' ? 'disabled' : 'active' }, `${contract.lifecycle === 'active' ? 'Disable' : 'Enable'} ${contract.name}`)}>{contract.lifecycle === 'active' ? 'Disable' : 'Enable'}</Button></div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-1.5">{active?.checks.map((check) => <span key={check.id} className="rounded-full border border-line px-2 py-0.5 text-[9px] text-muted">{check.label}{check.required ? '' : ' · optional'}</span>)}</div>
                          <p className="mt-3 text-[9.5px] leading-relaxed text-faint">{active?.promotion.minimumRuns} runs · {(active?.promotion.minimumPassRate ?? 0) * 100}% pass rate · {active?.promotion.lookbackDays} days · {active?.humanReviewRequired ? 'human review required' : 'automatic deterministic acceptance'} · ceiling {active ? LEVEL_LABELS[active.autonomyCeiling] : '—'}</p>
                          {drafts.length ? <div className="mt-3 space-y-2 border-t border-line pt-3">{drafts.map((draft) => {
                            const shadows = snapshot.shadows.filter((shadow) => shadow.contractId === contract.id && shadow.contractRevision === draft.revision)
                            const latest = shadows[0]
                            return <div key={draft.revision} className="rounded-lg border border-line bg-surface/45 px-3 py-2.5"><div className="flex flex-wrap items-center gap-2"><FlaskConical size={12} className="text-accent" /><span className="text-[10.5px] font-medium text-ink">Draft v{draft.revision}</span>{latest ? <Status danger={!latest.passed}>{latest.passed ? 'shadow passed' : 'shadow failed'}</Status> : <span className="text-[9px] text-faint">not shadow-checked</span>}<span className="ml-auto flex gap-1.5"><Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate({ type: 'shadow.run', contractId: contract.id, revision: draft.revision }, `Policy shadow ${contract.name} v${draft.revision}`)}>Run policy shadow</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate({ type: 'contract.activate', contractId: contract.id, revision: draft.revision }, `Activate ${contract.name} v${draft.revision}`)}>Activate</Button></span></div>{latest ? <p className="mt-1.5 text-[9px] text-faint">{latest.cases.length} historical expectations · {latest.cases.filter((item) => item.passed).length} matched · no model or external write replayed</p> : null}</div>
                          })}</div> : null}
                        </div>
                      )
                    })}
                  </div>
                ) : null}

                {tab === 'Autonomy' ? (
                  <div className="space-y-4">
                    <form onSubmit={(event) => {
                      event.preventDefault()
                      const form = event.currentTarget
                      const data = new FormData(form)
                      const contractId = String(data.get('contractId') ?? '')
                      void mutate({
                        type: 'grant.create',
                        grant: {
                          contractId,
                          agentId: String(data.get('agentId') ?? 'captain'),
                          tools: String(data.get('tools') ?? '').split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
                          dataClass: String(data.get('dataClass')) as OutcomeTaskBindingInput['dataClass'],
                          environment: String(data.get('environment')) as OutcomeTaskBindingInput['environment'],
                          level: String(data.get('level')) as 'observe' | 'suggest' | 'approved-action',
                          ceiling: String(data.get('ceiling')) as OutcomeAutonomyLevel
                        }
                      }, 'Create scoped autonomy grant').then((saved) => { if (saved) form.reset() })
                    }} className="space-y-3 rounded-xl border border-line bg-canvas/45 p-3.5">
                      <p className="text-[11.5px] font-medium text-ink">New scoped grant</p>
                      <div className="grid gap-3 sm:grid-cols-2"><Field label="Contract"><select name="contractId" required disabled={busy} className={inputClass}><option value="">Choose workflow…</option>{snapshot.contracts.filter((contract) => contract.lifecycle === 'active' && activeVersion(contract)).map((contract) => <option key={contract.id} value={contract.id}>{contract.name}</option>)}</select></Field><Field label="Stable agent id"><input name="agentId" required disabled={busy} defaultValue="captain" className={cn(inputClass, 'font-mono text-[10.5px]')} /></Field></div>
                      <Field label="Exact tool names"><textarea name="tools" required disabled={busy} className={cn(inputClass, 'resize-y font-mono text-[10.5px]')} rows={2} placeholder="write_file, edit_file" /></Field>
                      <div className="grid gap-3 sm:grid-cols-4"><Field label="Data class"><select name="dataClass" disabled={busy} defaultValue="internal" className={inputClass}>{OUTCOME_DATA_CLASSES.map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="Environment"><select name="environment" disabled={busy} defaultValue="development" className={inputClass}>{OUTCOME_ENVIRONMENTS.map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="Initial level"><select name="level" disabled={busy} defaultValue="approved-action" className={inputClass}><option value="observe">Observe</option><option value="suggest">Suggest</option><option value="approved-action">Approved action</option></select></Field><Field label="Ceiling"><select name="ceiling" disabled={busy} defaultValue="bounded-autonomy" className={inputClass}>{Object.entries(LEVEL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div>
                      <div className="flex justify-end"><Button type="submit" variant="secondary" size="sm" loading={busy}><Plus size={12} />Create grant</Button></div>
                    </form>
                    {snapshot.grants.length === 0 ? <p className="rounded-lg border border-dashed border-line px-3 py-5 text-center text-[10.5px] text-faint">No grants. Unscoped consequential actions keep their existing human approval behavior.</p> : null}
                    {snapshot.grants.map((grant) => {
                      const recommendation = snapshot.recommendations.find((item) => item.grantId === grant.id)
                      return <div key={grant.id} className="rounded-xl border border-line bg-canvas/45 p-3.5"><div className="flex flex-wrap items-center gap-2"><LockKeyhole size={13} className="text-accent" /><p className="text-[11.5px] font-medium text-ink">{grant.agentId} · {contractName(grant.contractId)}</p><Status danger={grant.circuitOpen || grant.status !== 'active'}>{LEVEL_LABELS[grant.level]}</Status>{grant.circuitOpen ? <Status danger>circuit open</Status> : null}{grant.status !== 'active' ? <Status danger>{grant.status}</Status> : null}</div><p className="mt-2 font-mono text-[9.5px] text-muted">{grant.tools.join(' · ')}</p><p className="mt-1.5 text-[9.5px] text-faint">{grant.dataClass} · {grant.environment} · contract v{grant.contractRevision} · grant revision {grant.revision} · ceiling {LEVEL_LABELS[grant.ceiling]}</p>{grant.execution ? <p className="mt-1.5 truncate font-mono text-[8.5px] text-faint">{grant.execution.model.providerId}/{grant.execution.model.model} · policy {grant.execution.policyDigest.slice(0, 12)}…</p> : <p className="mt-1.5 text-[9px] text-faint">No model/policy execution is currently authorized for bounded autonomy.</p>}{grant.circuitReason ? <p className="mt-2 flex items-start gap-1.5 text-[10px] text-warn"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{grant.circuitReason}</p> : null}{recommendation ? <div className="mt-3 rounded-lg border border-line bg-surface/40 px-3 py-2"><p className="text-[9.5px] text-muted">Evidence: {recommendation.sampleSize} settled runs · {(recommendation.passRate * 100).toFixed(0)}% verified</p><p className="mt-1 text-[9.5px] leading-relaxed text-faint">{recommendation.reasons.join(' ')}</p></div> : null}<div className="mt-3 flex flex-wrap justify-end gap-1.5">{recommendation?.eligible ? <Button variant="primary" size="sm" disabled={busy} onClick={() => void mutate({ type: 'grant.promote', grantId: grant.id }, `Administrator authorize ${recommendation.targetLevel} for ${grant.id}`)}>Authorize {LEVEL_LABELS[recommendation.targetLevel]} <ArrowRight size={11} /></Button> : null}{grant.level === 'bounded-autonomy' ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate({ type: 'grant.demote', grantId: grant.id }, `Demote ${grant.id}`)}>Demote</Button> : null}{grant.status !== 'revoked' ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate({ type: 'grant.status', grantId: grant.id, status: grant.status === 'active' ? 'suspended' : 'active' }, `${grant.status === 'active' ? 'Suspend' : 'Reactivate'} ${grant.id}`)}>{grant.status === 'active' ? 'Suspend' : 'Reactivate'}</Button> : null}{grant.status !== 'revoked' ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => { if (window.confirm(`Revoke ${grant.id} permanently?`)) void mutate({ type: 'grant.status', grantId: grant.id, status: 'revoked' }, `Revoke ${grant.id}`) }}><Ban size={11} />Revoke</Button> : null}</div></div>
                    })}
                  </div>
                ) : null}

                {tab === 'Evidence' ? (
                  <div className="space-y-2.5">
                    {snapshot.receipts.length === 0 ? <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[10.5px] text-faint">No outcome receipts yet. Bind a contract when creating a task, then complete or fail that real run.</p> : null}
                    {snapshot.receipts.map((receipt) => <div key={receipt.id} className="rounded-xl border border-line bg-canvas/45 p-3.5"><div className="flex flex-wrap items-center gap-2">{receipt.verificationStatus === 'verified' ? <CheckCircle2 size={14} className="text-positive" /> : receipt.verificationStatus === 'pending-review' ? <ScrollText size={14} className="text-warn" /> : <XCircle size={14} className="text-danger" />}<p className="text-[11px] font-medium text-ink">{contractName(receipt.contractId)} <span className="text-faint">v{receipt.contractRevision}</span></p><Status danger={receipt.verificationStatus === 'failed' || receipt.verificationStatus === 'invalid'}>{receipt.verificationStatus}</Status><span className="ml-auto text-[9px] text-faint">{new Date(receipt.createdAt).toLocaleString()}</span></div><p className="mt-1.5 font-mono text-[9px] text-faint">{receipt.taskId} · {receipt.id}</p><p className="mt-2 text-[9.5px] text-muted">{receipt.agentIds.join(', ')} · {receipt.binding.dataClass} · {receipt.binding.environment} · {receipt.execution.attempts.map((attempt) => `${attempt.providerId}/${attempt.model}`).join(', ') || 'no attributable model'}</p><details className="mt-2"><summary className="cursor-pointer text-[9.5px] text-faint hover:text-muted">{receipt.checks.filter((check) => check.passed).length}/{receipt.checks.length} checks passed · source {receipt.sourceDigest.slice(0, 12)}…</summary><div className="mt-2 space-y-1">{receipt.checks.map((check) => <p key={check.id} className="flex items-start gap-1.5 text-[9.5px] text-muted">{check.passed ? <CheckCircle2 size={11} className="mt-0.5 text-positive" /> : <XCircle size={11} className="mt-0.5 text-danger" />}<span>{check.label}: {check.observed}{check.required ? '' : ' (optional)'}</span></p>)}</div></details>{receipt.invalidReasons.length ? <p className="mt-2 text-[9.5px] text-danger">{receipt.invalidReasons.join(' ')}</p> : null}{receipt.demotedGrantIds.length ? <p className="mt-2 text-[9.5px] text-warn">Circuit-broken grants: {receipt.demotedGrantIds.join(', ')}</p> : null}{receipt.review.state === 'pending' ? <div className="mt-3 flex justify-end gap-1.5"><Button variant="ghost" size="sm" disabled={busy} onClick={() => { const note = window.prompt('Why is this outcome rejected? (optional)') ?? ''; void mutate({ type: 'receipt.review', receiptId: receipt.id, decision: 'rejected', note }, `Reject outcome ${receipt.id}`) }}>Reject outcome</Button><Button variant="primary" size="sm" disabled={busy} onClick={() => void mutate({ type: 'receipt.review', receiptId: receipt.id, decision: 'accepted' }, `Accept verified outcome ${receipt.id}`)}>Accept verified outcome</Button></div> : receipt.review.by ? <p className="mt-2 text-[9px] text-faint">{receipt.review.state} by local administrator · {receipt.review.at ? new Date(receipt.review.at).toLocaleString() : ''}{receipt.review.note ? ` · ${receipt.review.note}` : ''}</p> : null}</div>)}
                  </div>
                ) : null}

                {tab === 'Regressions' ? (
                  <div className="space-y-2.5">
                    <p className="rounded-lg border border-line bg-canvas/35 px-3 py-2.5 text-[10px] leading-relaxed text-muted">Production failures become sanitized, deduplicated candidates. Approval enforces the copied deterministic check on later matching runs; human-only failures become a mandatory review gate. No raw trace is added to training and no agent promotes itself.</p>
                    {snapshot.regressions.length === 0 ? <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[10.5px] text-faint">No failure-to-regression candidates.</p> : null}
                    {snapshot.regressions.map((candidate) => (
                      <div key={candidate.id} className="rounded-xl border border-line bg-canvas/45 p-3.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <FlaskConical size={13} className="text-accent" />
                          <p className="text-[11px] font-medium text-ink">{candidate.title}</p>
                          <Status danger={candidate.status === 'rejected'}>{candidate.status}</Status>
                        </div>
                        <p className="mt-1.5 text-[9.5px] text-faint">{candidate.occurrences} occurrence{candidate.occurrences === 1 ? '' : 's'} · {candidate.binding.dataClass} · {candidate.binding.environment} · source contract v{candidate.contractRevision} · {candidate.sourceReceiptIds.length} linked receipt{candidate.sourceReceiptIds.length === 1 ? '' : 's'}</p>
                        <p className="mt-2 text-[9.5px] text-muted">{candidate.check ? `Executable ${candidate.check.kind} check · ${candidate.check.label}` : 'Human-review gate · no deterministic check is fabricated from a subjective rejection.'}</p>
                        {candidate.reviewNote ? <p className="mt-2 text-[9.5px] text-muted">{candidate.reviewNote}</p> : null}
                        {candidate.status === 'pending' ? (
                          <div className="mt-3 flex justify-end gap-1.5">
                            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate({ type: 'regression.review', candidateId: candidate.id, decision: 'rejected' }, `Reject regression ${candidate.id}`)}>Reject</Button>
                            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void mutate({ type: 'regression.review', candidateId: candidate.id, decision: 'approved' }, `Approve regression ${candidate.id}`)}>Approve and enforce</Button>
                          </div>
                        ) : null}
                        {candidate.status === 'approved' ? (
                          <div className="mt-3 flex justify-end">
                            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate({ type: 'regression.retire', candidateId: candidate.id }, `Retire superseded regression ${candidate.id}`)}>Retire regression</Button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </motion.div>
            </AnimatePresence>
          </>
        ) : null}
      </div>
    </SettingsSection>
  )
}
