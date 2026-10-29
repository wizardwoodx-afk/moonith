import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  Activity,
  Archive,
  CheckCircle2,
  Clock3,
  KeyRound,
  LockKeyhole,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldX,
  Users
} from 'lucide-react'
import {
  ENTERPRISE_ACTIONS,
  ENTERPRISE_RESOURCE_KINDS,
  type EnterpriseAction,
  type EnterpriseControlOperation,
  type EnterpriseControlSnapshot,
  type EnterpriseDecision,
  type EnterpriseLifecycle,
  type EnterpriseResourceKind
} from '@shared/enterpriseControl'
import { cn, errorMessage } from '../../lib/utils'
import { useAgentName } from '../../lib/localProfile'
import { Button } from '../../components/ui'
import { confirmDialog } from '../../components/Confirm'
import { SettingsSection } from './SettingsSection'
import { TaskOrb } from '../../motion/TaskOrb'

const inputClass =
  'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[11.5px] text-ink outline-none placeholder:text-faint focus:border-accent/45'
const labelClass = 'block space-y-1.5 text-[10.5px] font-medium text-muted'
const tabs = ['Overview', 'Grants', 'Deny rules', 'Revisions'] as const

function plural(word: string, count: number): string {
  if (count === 1) return word
  if (word.endsWith('y')) return `${word.slice(0, -1)}ies`
  return `${word}s`
}

type Tab = (typeof tabs)[number]

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={labelClass}>
      <span>{label}</span>
      {children}
    </label>
  )
}

function EntityCard({
  title,
  subtitle,
  lifecycle,
  detail,
  busy,
  onLifecycle
}: {
  title: string
  subtitle: string
  lifecycle: EnterpriseLifecycle
  detail: string
  busy: boolean
  onLifecycle: (lifecycle: EnterpriseLifecycle) => void
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-line bg-canvas/45 px-3 py-2.5"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="break-all text-[11.5px] font-medium text-ink">{title}</p>
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wide',
                lifecycle === 'active'
                  ? 'bg-positive/10 text-positive'
                  : lifecycle === 'disabled'
                    ? 'bg-warn/10 text-warn'
                    : 'bg-panel-3 text-faint'
              )}
            >
              {lifecycle}
            </span>
          </div>
          <p className="mt-1 break-all text-[10px] text-faint">{subtitle}</p>
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted">{detail}</p>
        </div>
        {lifecycle !== 'archived' ? (
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => onLifecycle(lifecycle === 'active' ? 'disabled' : 'active')}
              className="rounded-md border border-line px-2 py-1 text-[10px] text-muted hover:text-ink disabled:opacity-50"
            >
              {lifecycle === 'active' ? 'Disable' : 'Enable'}
            </button>
            <button
              type="button"
              disabled={busy}
              title="Archive permanently in the current revision"
              onClick={() => onLifecycle('archived')}
              className="rounded-md border border-line p-1.5 text-faint hover:text-danger disabled:opacity-50"
            >
              <Archive size={11} />
            </button>
          </div>
        ) : null}
      </div>
    </motion.div>
  )
}

export function EnterpriseControlPlane() {
  const [snapshot, setSnapshot] = useState<EnterpriseControlSnapshot | null>(null)
  const [tab, setTab] = useState<Tab>('Overview')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [decision, setDecision] = useState<EnterpriseDecision | null>(null)
  const agent = useAgentName()
  /* Principals minted before the owner named their agent carry the placeholder
   * in their stored name. The control plane is signed, so the record is left
   * untouched and the old label is read as the owner's chosen name. */
  const principalName = (name: string): string =>
    name.startsWith('Captain · ') ? `${agent}${name.slice('Captain'.length)}` : name

  const refresh = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setSnapshot(await window.knight.enterpriseControl.snapshot())
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const mutate = async (operation: EnterpriseControlOperation, reason: string): Promise<boolean> => {
    if (!snapshot) return false
    setBusy(true)
    setError(null)
    try {
      const next = await window.knight.enterpriseControl.mutate({
        expectedRevision: snapshot.state.revision,
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

  const lifecycle = (
    kind: 'namespace' | 'principal' | 'role' | 'binding' | 'restriction',
    id: string,
    next: EnterpriseLifecycle
  ): void => {
    if (next !== 'archived') {
      void mutate({ type: 'lifecycle.set', kind, id, lifecycle: next }, `${next} ${kind} ${id}`)
      return
    }
    void (async () => {
      const confirmed = await confirmDialog({
        title: `Archive ${id}?`,
        body: 'It cannot be edited in the current revision.',
        confirmLabel: 'Archive',
        danger: true
      })
      if (confirmed) void mutate({ type: 'lifecycle.set', kind, id, lifecycle: next }, `${next} ${kind} ${id}`)
    })()
  }

  const submitNamespace = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const id = String(data.get('id') ?? '').trim()
    const name = String(data.get('name') ?? '').trim()
    void mutate(
      {
        type: 'namespace.create',
        namespace: { id, name, description: String(data.get('description') ?? '') }
      },
      `Create namespace ${name || id}`
    ).then((saved) => { if (saved) form.reset() })
  }

  const submitRole = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const id = String(data.get('id') ?? '').trim()
    void mutate(
      {
        type: 'role.upsert',
        role: {
          id,
          namespaceId: String(data.get('namespaceId') ?? ''),
          name: String(data.get('name') ?? ''),
          description: String(data.get('description') ?? ''),
          actions: data.getAll('actions') as EnterpriseAction[],
          resourceKinds: data.getAll('resourceKinds') as EnterpriseResourceKind[]
        }
      },
      `Define Role ${id}`
    ).then((saved) => { if (saved) form.reset() })
  }

  const submitBinding = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const role = snapshot?.state.roles.find((candidate) => candidate.id === data.get('roleId'))
    if (!role) return
    const resourceId = String(data.get('resourceId') ?? '').trim()
    const id = String(data.get('id') ?? '').trim()
    void mutate(
      {
        type: 'binding.upsert',
        binding: {
          id,
          namespaceId: role.namespaceId,
          principalId: String(data.get('principalId') ?? ''),
          roleId: role.id,
          resource: {
            kind: String(data.get('resourceKind')) as EnterpriseResourceKind,
            namespaceId: role.namespaceId,
            ...(resourceId ? { id: resourceId } : {})
          }
        }
      },
      `Bind ${String(data.get('principalId'))} to ${role.id}`
    ).then((saved) => { if (saved) form.reset() })
  }

  const submitRestriction = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const resourceId = String(data.get('resourceId') ?? '').trim()
    const principal = String(data.get('principalId') ?? '')
    const id = String(data.get('id') ?? '').trim()
    void mutate(
      {
        type: 'restriction.upsert',
        restriction: {
          id,
          namespaceId: String(data.get('namespaceId') ?? ''),
          principalId: principal || null,
          name: String(data.get('name') ?? ''),
          actions: data.getAll('actions') as EnterpriseAction[],
          resource: {
            kind: String(data.get('resourceKind')) as EnterpriseResourceKind,
            namespaceId: String(data.get('namespaceId') ?? ''),
            ...(resourceId ? { id: resourceId } : {})
          }
        }
      },
      `Define deny rule ${id}`
    ).then((saved) => { if (saved) form.reset() })
  }

  const testAuthorization = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const resourceId = String(data.get('resourceId') ?? '').trim()
    setBusy(true)
    setError(null)
    void window.knight.enterpriseControl
      .authorize({
        principalId: String(data.get('principalId') ?? ''),
        action: String(data.get('action')) as EnterpriseAction,
        resource: {
          kind: String(data.get('resourceKind')) as EnterpriseResourceKind,
          namespaceId: String(data.get('namespaceId') ?? ''),
          ...(resourceId ? { id: resourceId } : {})
        }
      })
      .then(setDecision)
      .catch((cause) => setError(errorMessage(cause)))
      .finally(() => setBusy(false))
  }

  return (
    <SettingsSection
      title="Enterprise Control Plane"
      
      action={
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-positive/25 bg-positive/10 px-2 py-0.5 text-[10px] font-medium text-positive whitespace-nowrap">
            Local
          </span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="text-faint transition-colors hover:text-ink"
            title="Refresh control plane"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-lg border border-line bg-canvas/45 px-3 py-2.5">
          <LockKeyhole size={13} className="mt-0.5 shrink-0 text-accent" />
          <p className="text-[10px] leading-relaxed text-muted">
            Default deny; a deny rule always overrides a grant. Local product policy only — not
            hosted SSO or hard tenant isolation.
          </p>
        </div>
        {error ? <p className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-[10.5px] text-danger">{error}</p> : null}
        {loading && !snapshot ? (
          <div className="flex items-center justify-center gap-3 py-8 text-muted">
            <TaskOrb state="connecting" size={20} label="Loading native policy" />
            <span className="text-[10.5px]">Loading native policy</span>
          </div>
        ) : snapshot ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[
                ['Revision', snapshot.state.revision],
                [plural('Namespace', snapshot.state.namespaces.length), snapshot.state.namespaces.length],
                [plural('Identity', snapshot.state.principals.length), snapshot.state.principals.length],
                [plural('Grant', snapshot.state.bindings.length), snapshot.state.bindings.length],
                [plural('Deny rule', snapshot.state.restrictions.length), snapshot.state.restrictions.length]
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-line bg-canvas/40 px-2.5 py-2">
                  <p className="text-[15px] font-semibold text-ink">{value}</p>
                  <p className="mt-0.5 text-[10px] text-faint">{label}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-1 overflow-x-auto border-b border-line">
              {tabs.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setTab(item)}
                  className={cn(
                    'shrink-0 border-b-2 px-3 py-2 text-[10.5px] transition-colors',
                    tab === item ? 'border-accent text-ink' : 'border-transparent text-faint hover:text-muted'
                  )}
                >
                  {item}
                </button>
              ))}
            </div>

            {tab === 'Overview' ? (
              <div className="space-y-5">
                <form onSubmit={testAuthorization} className="rounded-xl border border-line bg-panel-2/45 p-3">
                  <p className="mb-3 flex items-center gap-2 text-[11.5px] font-medium text-ink"><KeyRound size={13} /> Access test</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Principal">
                      <select name="principalId" required className={inputClass}>
                        {snapshot.state.principals.map((principal) => <option key={principal.id} value={principal.id}>{principalName(principal.name)} · {principal.id}</option>)}
                      </select>
                    </Field>
                    <Field label="Action">
                      <select name="action" className={inputClass}>{ENTERPRISE_ACTIONS.map((action) => <option key={action}>{action}</option>)}</select>
                    </Field>
                    <Field label="Namespace">
                      <select name="namespaceId" className={inputClass}>{snapshot.state.namespaces.map((namespace) => <option key={namespace.id} value={namespace.id}>{namespace.name}</option>)}</select>
                    </Field>
                    <Field label="Resource kind">
                      <select name="resourceKind" className={inputClass}>{ENTERPRISE_RESOURCE_KINDS.map((kind) => <option key={kind}>{kind}</option>)}</select>
                    </Field>
                    <Field label="Resource id (blank = any in scope)"><input name="resourceId" className={inputClass} placeholder="mission-123" /></Field>
                    <div className="flex items-end"><Button type="submit" variant="secondary" loading={busy}>Evaluate</Button></div>
                  </div>
                  {decision ? (
                    <motion.div
                      key={`${decision.allowed}-${decision.reason}`}
                      initial={{ opacity: 0, scale: 0.985 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className={cn('mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[10.5px]', decision.allowed ? 'bg-positive/10 text-positive' : 'bg-danger/10 text-danger')}
                    >
                      {decision.allowed ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <ShieldX size={14} className="mt-0.5 shrink-0" />}
                      <span>{decision.allowed ? 'ALLOW' : 'DENY'} · {decision.reason}</span>
                    </motion.div>
                  ) : null}
                </form>

                <div className="grid gap-3 sm:grid-cols-2">
                  {snapshot.state.namespaces.map((namespace) => (
                    <EntityCard key={namespace.id} title={namespace.name} subtitle={namespace.id} lifecycle={namespace.lifecycle} detail={namespace.description || 'Native policy namespace.'} busy={busy} onLifecycle={(next) => lifecycle('namespace', namespace.id, next)} />
                  ))}
                </div>
                <details className="rounded-xl border border-line bg-canvas/35 p-3">
                  <summary className="cursor-pointer text-[11px] font-medium text-ink"><Plus size={12} className="mr-1 inline" /> Create namespace</summary>
                  <form onSubmit={submitNamespace} className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Namespace id"><input name="id" required pattern="[A-Za-z0-9][A-Za-z0-9:._%@-]*" className={inputClass} placeholder="research" /></Field>
                    <Field label="Display name"><input name="name" required className={inputClass} placeholder="Research workspace" /></Field>
                    <div className="sm:col-span-2"><Field label="Description"><input name="description" className={inputClass} placeholder="Scoped agents and missions" /></Field></div>
                    <div><Button type="submit" loading={busy}>Create namespace</Button></div>
                  </form>
                </details>
                <div>
                  <p className="mb-2 flex items-center gap-2 text-[11px] font-medium text-ink"><Users size={13} /> Human and per-agent identities</p>
                  <div className="space-y-2">
                    {snapshot.state.principals.map((principal) => (
                      <EntityCard key={principal.id} title={principalName(principal.name)} subtitle={`${principal.kind} · ${principal.id}`} lifecycle={principal.lifecycle} detail={principal.agentRef ? `Team ${principal.agentRef.teamId} · seat ${principal.agentRef.seatId}` : 'Local human owner and recovery identity.'} busy={busy} onLifecycle={(next) => lifecycle('principal', principal.id, next)} />
                    ))}
                  </div>
                </div>
                {snapshot.recentDecisions.length > 0 ? (
                  <div>
                    <p className="mb-2 flex items-center gap-2 text-[11px] font-medium text-ink"><Activity size={13} /> Recent native decisions</p>
                    <div className="max-h-48 space-y-1 overflow-auto">
                      {snapshot.recentDecisions.slice(0, 12).map((item, index) => <p key={`${item.evaluatedAt}-${index}`} className="text-[10px] text-faint"><span className={item.allowed ? 'text-positive' : 'text-danger'}>{item.allowed ? 'ALLOW' : 'DENY'}</span> · {item.principalId} · {item.action} · revision {item.revision}</p>)}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {tab === 'Grants' ? (
              <div className="space-y-5">
                <div>
                  <p className="mb-2 text-[11px] font-medium text-ink">Roles</p>
                  <div className="space-y-2">{snapshot.state.roles.map((role) => <EntityCard key={role.id} title={role.name} subtitle={`${role.id} · ${role.namespaceId}`} lifecycle={role.lifecycle} detail={`${role.actions.join(', ') || 'No actions'} · ${role.resourceKinds.join(', ') || 'no resource kinds'}`} busy={busy} onLifecycle={(next) => lifecycle('role', role.id, next)} />)}</div>
                </div>
                <details className="rounded-xl border border-line bg-canvas/35 p-3">
                  <summary className="cursor-pointer text-[11px] font-medium text-ink"><Plus size={12} className="mr-1 inline" /> Define or update a Role</summary>
                  <form onSubmit={submitRole} className="mt-3 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Role id"><input name="id" required className={inputClass} placeholder="role:read-only" /></Field>
                      <Field label="Name"><input name="name" required className={inputClass} placeholder="Read-only researcher" /></Field>
                      <Field label="Namespace"><select name="namespaceId" className={inputClass}>{snapshot.state.namespaces.map((namespace) => <option key={namespace.id} value={namespace.id}>{namespace.name}</option>)}</select></Field>
                      <Field label="Description"><input name="description" className={inputClass} /></Field>
                    </div>
                    <div><p className="mb-2 text-[10px] text-muted">Actions</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{ENTERPRISE_ACTIONS.map((action) => <label key={action} className="flex items-center gap-1.5 text-[10px] text-muted"><input type="checkbox" name="actions" value={action} />{action}</label>)}</div></div>
                    <div><p className="mb-2 text-[10px] text-muted">Resource kinds</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{ENTERPRISE_RESOURCE_KINDS.map((kind) => <label key={kind} className="flex items-center gap-1.5 text-[10px] text-muted"><input type="checkbox" name="resourceKinds" value={kind} />{kind}</label>)}</div></div>
                    <Button type="submit" loading={busy}>Save Role</Button>
                  </form>
                </details>
                <div>
                  <p className="mb-2 text-[11px] font-medium text-ink">Bindings</p>
                  <div className="space-y-2">{snapshot.state.bindings.map((binding) => <EntityCard key={binding.id} title={binding.id} subtitle={`${binding.principalId} → ${binding.roleId}`} lifecycle={binding.lifecycle} detail={`${binding.resource.kind}:${binding.resource.id ?? 'any'} · ${binding.resource.namespaceId}`} busy={busy} onLifecycle={(next) => lifecycle('binding', binding.id, next)} />)}</div>
                </div>
                <details className="rounded-xl border border-line bg-canvas/35 p-3">
                  <summary className="cursor-pointer text-[11px] font-medium text-ink"><Plus size={12} className="mr-1 inline" /> Create binding</summary>
                  <form onSubmit={submitBinding} className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Binding id"><input name="id" required className={inputClass} placeholder="binding:researcher" /></Field>
                    <Field label="Principal"><select name="principalId" className={inputClass}>{snapshot.state.principals.map((principal) => <option key={principal.id} value={principal.id}>{principal.name}</option>)}</select></Field>
                    <Field label="Role"><select name="roleId" className={inputClass}>{snapshot.state.roles.map((role) => <option key={role.id} value={role.id}>{role.name} · {role.namespaceId}</option>)}</select></Field>
                    <Field label="Resource kind"><select name="resourceKind" className={inputClass}>{ENTERPRISE_RESOURCE_KINDS.map((kind) => <option key={kind}>{kind}</option>)}</select></Field>
                    <Field label="Resource id (blank = any in scope)"><input name="resourceId" className={inputClass} /></Field>
                    <div className="flex items-end"><Button type="submit" loading={busy}>Create binding</Button></div>
                  </form>
                </details>
              </div>
            ) : null}

            {tab === 'Deny rules' ? (
              <div className="space-y-4">
                <p className="text-[10.5px] leading-relaxed text-muted">Deny rules are checked before every grant. Disable one for a temporary exception; archiving keeps it in history.</p>
                <div className="space-y-2">{snapshot.state.restrictions.length === 0 ? <p className="rounded-lg border border-dashed border-line px-3 py-5 text-center text-[10.5px] text-faint">No deny rules. Default deny still applies wherever no grant exists.</p> : snapshot.state.restrictions.map((restriction) => <EntityCard key={restriction.id} title={restriction.name} subtitle={`${restriction.id} · ${restriction.principalId ?? 'all principals'}`} lifecycle={restriction.lifecycle} detail={`${restriction.actions.join(', ')} · ${restriction.resource.kind}:${restriction.resource.id ?? 'any'} · ${restriction.resource.namespaceId}`} busy={busy} onLifecycle={(next) => lifecycle('restriction', restriction.id, next)} />)}</div>
                <details className="rounded-xl border border-line bg-canvas/35 p-3">
                  <summary className="cursor-pointer text-[11px] font-medium text-ink"><Plus size={12} className="mr-1 inline" /> Create deny rule</summary>
                  <form onSubmit={submitRestriction} className="mt-3 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Deny rule id"><input name="id" required className={inputClass} placeholder="restriction:no-external-write" /></Field>
                      <Field label="Name"><input name="name" required className={inputClass} placeholder="Block memory writes" /></Field>
                      <Field label="Namespace"><select name="namespaceId" className={inputClass}>{snapshot.state.namespaces.map((namespace) => <option key={namespace.id} value={namespace.id}>{namespace.name}</option>)}</select></Field>
                      <Field label="Principal"><select name="principalId" className={inputClass}><option value="">All principals</option>{snapshot.state.principals.map((principal) => <option key={principal.id} value={principal.id}>{principal.name}</option>)}</select></Field>
                      <Field label="Resource kind"><select name="resourceKind" className={inputClass}>{ENTERPRISE_RESOURCE_KINDS.map((kind) => <option key={kind}>{kind}</option>)}</select></Field>
                      <Field label="Resource id (blank = any in scope)"><input name="resourceId" className={inputClass} /></Field>
                    </div>
                    <div><p className="mb-2 text-[10px] text-muted">Denied actions</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{ENTERPRISE_ACTIONS.map((action) => <label key={action} className="flex items-center gap-1.5 text-[10px] text-muted"><input type="checkbox" name="actions" value={action} />{action}</label>)}</div></div>
                    <Button type="submit" loading={busy}>Create deny rule</Button>
                  </form>
                </details>
              </div>
            ) : null}

            {tab === 'Revisions' ? (
              <div className="space-y-3">
                <p className="text-[10.5px] leading-relaxed text-muted">History is append-only: restoring creates a new revision, it never rewrites past ones.</p>
                {snapshot.revisions.map((revision) => (
                  <div key={revision.revision} className="flex items-center gap-3 rounded-lg border border-line bg-canvas/45 px-3 py-2.5">
                    <Clock3 size={14} className="shrink-0 text-faint" />
                    <div className="min-w-0 flex-1"><p className="text-[11px] font-medium text-ink">Revision {revision.revision} {revision.revision === snapshot.state.revision ? <span className="text-positive">· current</span> : null}</p><p className="mt-0.5 text-[10px] text-faint">{revision.reason} · {revision.actor} · {new Date(revision.at).toLocaleString()}</p><p className="mt-1 truncate font-mono text-[10px] text-faint" title={`SHA-256 ${revision.digest}`}>SHA-256 {revision.digest}</p></div>
                    {revision.revision !== snapshot.state.revision ? <button type="button" disabled={busy} onClick={() => { const target = revision.revision; void (async () => { if (await confirmDialog({ title: `Restore revision ${target} as a new revision?`, confirmLabel: 'Restore' })) void mutate({ type: 'revision.restore', revision: target }, `Restore revision ${target}`) })() }} className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[10px] text-muted hover:text-ink"><RotateCcw size={11} /> Restore</button> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </SettingsSection>
  )
}
