import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  Bot,
  Boxes,
  Check,
  Copy,
  Globe2,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Webhook
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  ChannelRecord,
  ChannelState,
  ComposioState,
  SkillDetail,
  SkillDraft,
  SkillMarketResult,
  SkillRegistry,
  SkillSummary,
  SubAgentRun
} from '@shared/types'
import { Button, FieldGroup, IconButton, Modal, Spin, Toggle } from '../../components/ui'
import { cn, errorMessage, timeAgo } from '../../lib/utils'
import { SettingsSection } from './SettingsSection'

const inputClass =
  'h-9 w-full rounded-lg border border-line bg-canvas px-3 text-[12.5px] text-ink outline-none transition-colors placeholder:text-faint focus:border-accent/45'
const textareaClass =
  'w-full resize-y rounded-lg border border-line bg-canvas px-3 py-2.5 text-[12.5px] leading-relaxed text-ink outline-none transition-colors placeholder:text-faint focus:border-accent/45'

function Chip({
  children,
  tone = 'neutral'
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'positive' | 'warn'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium',
        tone === 'accent' && 'border-accent/30 bg-accent-soft text-accent-ink',
        tone === 'positive' && 'border-positive/25 bg-positive/10 text-positive',
        tone === 'warn' && 'border-warn/30 bg-warn/10 text-warn',
        tone === 'neutral' && 'border-line bg-surface/70 text-muted'
      )}
    >
      {children}
    </span>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-danger/25 bg-danger/10 px-3.5 py-3">
      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
      <p className="text-[11.5px] leading-relaxed text-danger">{message}</p>
    </div>
  )
}

function Empty({
  icon,
  title,
  hint,
  action
}: {
  icon: ReactNode
  title: string
  hint: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line px-6 py-12 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-2 text-faint">
        {icon}
      </div>
      <div>
        <p className="text-[13px] font-medium text-ink">{title}</p>
        <p className="mx-auto mt-1 max-w-[420px] text-[11.5px] leading-relaxed text-muted">{hint}</p>
      </div>
      {action}
    </div>
  )
}

const STATUS_TONE: Record<string, string> = {
  running: 'bg-accent',
  done: 'bg-positive',
  error: 'bg-danger',
  stopped: 'bg-faint'
}

function formatElapsed(run: SubAgentRun): string {
  const start = Date.parse(run.startedAt)
  const end = run.endedAt ? Date.parse(run.endedAt) : Date.now()
  const seconds = Math.max(0, Math.round((end - start) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}m ${rest}s`
}

/* ───────────────────────────── Skills ───────────────────────────── */

export function SkillsPane() {
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [registry, setRegistry] = useState<SkillRegistry>('clawhub')
  const [results, setResults] = useState<SkillMarketResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [removeTarget, setRemoveTarget] = useState<SkillSummary | null>(null)
  const [removing, setRemoving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<SkillDraft>({ name: '', description: '', body: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      setSkills(await window.knight.listSkills())
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const runSearch = async (): Promise<void> => {
    setSearching(true)
    try {
      setResults(await window.knight.searchSkills(query, registry))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSearching(false)
    }
  }

  const install = async (ref: string, from: SkillRegistry): Promise<void> => {
    setInstalling(ref)
    try {
      setSkills(await window.knight.installSkill(ref, from))
      toast.success('Skill installed. The Captain can use it now.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setInstalling(null)
    }
  }

  const openDetail = async (id: string): Promise<void> => {
    try {
      const skill = await window.knight.readSkill(id)
      if (!skill) toast.error('That skill could not be read.')
      else setDetail(skill)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      setSkills(await window.knight.createSkill(draft))
      setCreating(false)
      setDraft({ name: '', description: '', body: '' })
      toast.success('Skill saved.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!removeTarget) return
    setRemoving(true)
    try {
      setSkills(await window.knight.removeSkill(removeTarget.id))
      toast.success(`Removed ${removeTarget.name}.`)
      setRemoveTarget(null)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="space-y-9">
      <SettingsSection
        title="Installed skills"
        description="Playbooks the Captain loads when the work matches."
        action={
          <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
            <Plus size={13} /> New skill
          </Button>
        }
      >
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted">
            <Spin size={18} />
          </div>
        ) : skills.length === 0 ? (
          <Empty
            icon={<Sparkles size={18} />}
            title="No skills installed yet"
            hint="Write a playbook for work you repeat, or install one from the registry."
            action={
              <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
                <Plus size={13} /> Write the first skill
              </Button>
            }
          />
        ) : (
          <div className="divide-y divide-line">
            {skills.map((skill) => (
              <div key={skill.id} className="flex items-start gap-3.5 py-3.5 first:pt-0 last:pb-0">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-ink">
                  <Sparkles size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[12.5px] font-medium text-ink">{skill.name}</p>
                    <Chip tone={skill.source === 'installed' ? 'accent' : 'neutral'}>
                      {skill.registry === 'lobehub'
                        ? 'LobeHub'
                        : skill.registry === 'clawhub'
                          ? 'ClawHub'
                          : 'Local'}
                    </Chip>
                    <span className="text-[10px] text-faint">
                      {skill.files} file{skill.files === 1 ? '' : 's'}
                      {skill.updatedAt ? ` · ${timeAgo(skill.updatedAt)}` : ''}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-muted">
                    {skill.description}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => void openDetail(skill.id)}>
                    Read
                  </Button>
                  <IconButton
                    aria-label={`Remove ${skill.name}`}
                    onClick={() => setRemoveTarget(skill)}
                    className="hover:text-danger"
                  >
                    <Trash2 size={13} />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="Skill registries"
        description="Search a public registry. Nothing installs until you choose it."
      >
        <div className="flex w-fit gap-0.5 rounded-lg border border-line bg-canvas p-0.5">
          {(['clawhub', 'lobehub'] as const).map((id) => (
            <button
              key={id}
              onClick={() => {
                setRegistry(id)
                setResults(null)
              }}
              className={cn(
                'rounded-[6px] px-2.5 py-1 text-[11px] transition-colors',
                registry === id
                  ? 'bg-surface-3 text-ink'
                  : 'text-muted hover:text-ink'
              )}
            >
              {id === 'clawhub' ? 'ClawHub' : 'LobeHub'}
            </button>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <div className="relative flex-1">
            <Search
              size={13}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void runSearch()
              }}
              placeholder={`Search ${registry === 'lobehub' ? 'LobeHub' : 'ClawHub'}`}
              aria-label={`Search ${registry === 'lobehub' ? 'LobeHub' : 'ClawHub'} skills`}
              className={cn(inputClass, 'pl-8')}
            />
          </div>
          <Button size="md" variant="secondary" loading={searching} onClick={() => void runSearch()}>
            Search
          </Button>
        </div>

        {results === null ? (
          <p className="mt-4 text-[11.5px] leading-relaxed text-faint">
            See what is available. Nothing installs until you choose it.
          </p>
        ) : results.length === 0 ? (
          <p className="mt-4 text-[11.5px] text-muted">No skills match that search.</p>
        ) : (
          <div className="mt-4 divide-y divide-line">
            {results.map((result) => (
              <div key={result.ref} className="flex items-start gap-3.5 py-3.5 first:pt-0 last:pb-0">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
                  <Boxes size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[12.5px] font-medium text-ink">{result.name}</p>
                    {result.version ? <Chip>{result.version}</Chip> : null}
                    {result.author ? <span className="text-[10px] text-faint">by {result.author}</span> : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-muted">
                    {result.summary || 'No summary provided.'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={installing === result.ref}
                  disabled={!result.ref || Boolean(installing)}
                  onClick={() => void install(result.ref, result.registry)}
                >
                  Install
                </Button>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New skill"
        subtitle="Give the Captain a repeatable playbook it can load by name."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              Save skill
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <FieldGroup label="Name">
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              className={inputClass}
              autoFocus
            />
          </FieldGroup>
          <FieldGroup label="When to use it" hint="One line">
            <input
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              className={inputClass}
            />
          </FieldGroup>
          <FieldGroup label="Instructions" hint="Markdown">
            <textarea
              value={draft.body}
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
              rows={9}
              className={textareaClass}
            />
          </FieldGroup>
        </div>
      </Modal>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.name}
        subtitle={detail?.description}
        width="max-w-2xl"
        footer={
          <Button variant="ghost" onClick={() => setDetail(null)}>
            Close
          </Button>
        }
      >
        <pre className="scroll-thin max-h-[58vh] overflow-auto rounded-xl border border-line bg-canvas px-4 py-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink/85">
          {detail?.content}
        </pre>
      </Modal>

      <Modal
        open={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        title={`Remove ${removeTarget?.name ?? 'skill'}?`}
        subtitle="This deletes the bundle from this device. Installed registry skills can be installed again."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoveTarget(null)}>
              Keep it
            </Button>
            <Button variant="danger" loading={removing} onClick={() => void remove()}>
              Remove skill
            </Button>
          </>
        }
      >
        <p className="text-[12px] leading-relaxed text-muted">
          The Captain will stop seeing this skill in its prompt immediately.
        </p>
      </Modal>
    </div>
  )
}

/* ───────────────────────────── Composio ───────────────────────────── */

export function ComposioPane() {
  const [state, setState] = useState<ComposioState | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')
  const [showTools, setShowTools] = useState(false)

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true)
    try {
      setState(await window.knight.composioState(refresh))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const saveKey = async (): Promise<void> => {
    if (!keyDraft.trim()) {
      toast.error('Paste a Composio API key first.')
      return
    }
    setSaving(true)
    try {
      const next = await window.knight.saveComposio({ apiKey: keyDraft })
      setState(next)
      setKeyDraft('')
      if (next.error) toast.error(next.error)
      else toast.success('Composio connected.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const patch = async (input: {
    enabled?: boolean
    removeKey?: boolean
    toolkits?: string[]
  }): Promise<void> => {
    try {
      const next = await window.knight.saveComposio(input)
      setState(next)
      if (next.error) toast.error(next.error)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const toggleToolkit = async (slug: string): Promise<void> => {
    if (!state) return
    const enabled = new Set(
      state.toolkits.filter((toolkit) => toolkit.enabled).map((toolkit) => toolkit.slug)
    )
    if (enabled.has(slug)) enabled.delete(slug)
    else enabled.add(slug)
    await patch({ toolkits: [...enabled] })
  }

  const toolkits = useMemo(() => {
    if (!state) return []
    const needle = filter.trim().toLowerCase()
    return [...state.toolkits]
      .filter(
        (toolkit) =>
          !needle ||
          toolkit.name.toLowerCase().includes(needle) ||
          toolkit.description.toLowerCase().includes(needle) ||
          toolkit.slug.toLowerCase().includes(needle)
      )
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))
  }, [state, filter])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted">
        <Spin size={20} />
      </div>
    )
  }

  return (
    <div className="space-y-9">
      <SettingsSection
        title="Connection"
        description="Your key stays sealed on this device. Calls go straight to Composio."
      >
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[12.5px] font-medium text-ink">Composio key</p>
              <p className="text-[11.5px] text-muted">
                {state?.configured ? 'A key is saved on this device.' : 'Add a key to list toolkits.'}
              </p>
            </div>
            <Chip tone={state?.configured ? 'positive' : 'neutral'}>
              {state?.configured ? 'Connected' : 'Not connected'}
            </Chip>
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              value={keyDraft}
              onChange={(event) => setKeyDraft(event.target.value)}
              aria-label="Composio API key"
              className={inputClass}
              autoComplete="off"
            />
            <Button variant="primary" loading={saving} onClick={() => void saveKey()}>
              {state?.configured ? 'Replace' : 'Connect'}
            </Button>
          </div>
          {state?.configured ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <div>
                <p className="text-[12.5px] font-medium text-ink">Give the Captain tool access</p>
                <p className="text-[11.5px] text-muted">
                  Only enabled toolkits are exposed. Calls follow your gates.
                </p>
              </div>
              <Toggle
                checked={state.enabled}
                onChange={(checked) => void patch({ enabled: checked })}
                label="Expose Composio tools"
              />
            </div>
          ) : null}
          {state?.configured ? (
            <button
              onClick={() => void patch({ removeKey: true })}
              className="text-[11px] font-medium text-danger hover:underline"
            >
              Remove the saved key
            </button>
          ) : null}
          {state?.error ? <ErrorBanner message={state.error} /> : null}
        </div>
      </SettingsSection>

      {state?.configured && state.enabled ? (
        <SettingsSection
          title="Toolkits"
          description="Enabled toolkits expose their tools to the Captain."
          action={
            <Button size="sm" variant="ghost" loading={refreshing} onClick={() => void load(true)}>
              <RefreshCw size={12} /> Refresh
            </Button>
          }
        >
          <div className="relative">
            <Search
              size={13}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint"
            />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              aria-label="Filter toolkits"
              placeholder="Filter toolkits"
              className={cn(inputClass, 'pl-8')}
            />
          </div>
          {toolkits.length === 0 ? (
            <p className="mt-4 text-[11.5px] text-muted">
              {state.toolkits.length === 0
                ? 'No toolkits are available for this key yet.'
                : 'No toolkit matches that filter.'}
            </p>
          ) : (
            <div className="scroll-thin mt-3 max-h-[380px] divide-y divide-line overflow-y-auto pr-1">
              {toolkits.map((toolkit) => (
                <div key={toolkit.slug} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[12.5px] font-medium text-ink">{toolkit.name}</p>
                      {toolkit.connected ? <Chip tone="positive">Account linked</Chip> : null}
                      {toolkit.enabled && toolkit.tools ? (
                        <span className="text-[10px] text-faint">{toolkit.tools} tools</span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-[11px] leading-relaxed text-muted">
                      {toolkit.description || 'No description provided.'}
                    </p>
                  </div>
                  <Toggle
                    checked={toolkit.enabled}
                    onChange={() => void toggleToolkit(toolkit.slug)}
                    label={`Enable ${toolkit.name}`}
                  />
                </div>
              ))}
            </div>
          )}
        </SettingsSection>
      ) : null}

      {state?.configured && state.enabled ? (
        <SettingsSection
          title="Tools in the prompt"
          description="Handed to the model. Every call passes your gates."
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="display text-[26px] leading-none text-ink">{state.tools.length}</p>
              <p className="mt-1 text-[11px] text-muted">
                across {state.toolkits.filter((toolkit) => toolkit.enabled).length} enabled toolkit
                {state.toolkits.filter((toolkit) => toolkit.enabled).length === 1 ? '' : 's'}
              </p>
            </div>
            {state.tools.length ? (
              <Button size="sm" variant="ghost" onClick={() => setShowTools((value) => !value)}>
                {showTools ? 'Hide names' : 'Show names'}
              </Button>
            ) : null}
          </div>
          {showTools ? (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {state.tools.map((tool) => (
                <span
                  key={tool.slug}
                  className="rounded-md border border-line bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-muted"
                >
                  {tool.slug}
                </span>
              ))}
            </div>
          ) : null}
        </SettingsSection>
      ) : null}
    </div>
  )
}

/* ───────────────────────────── Channels ───────────────────────────── */

export function ChannelsPane() {
  const [state, setState] = useState<ChannelState | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<ChannelRecord | 'new' | null>(null)
  const [kind, setKind] = useState<'webhook' | 'telegram'>('webhook')
  const [name, setName] = useState('')
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<ChannelRecord | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setState(await window.knight.channelState())
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openNew = (next: 'webhook' | 'telegram'): void => {
    setKind(next)
    setName(next === 'webhook' ? 'Local webhook' : 'Telegram')
    setToken('')
    setEditing('new')
  }

  const openEdit = (channel: ChannelRecord): void => {
    setKind(channel.kind)
    setName(channel.name)
    setToken('')
    setEditing(channel)
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      if (editing === 'new') {
        setState(
          await window.knight.upsertChannel({
            kind,
            name,
            enabled: true,
            token: kind === 'telegram' ? token : undefined
          })
        )
      } else if (editing) {
        setState(
          await window.knight.upsertChannel({
            id: editing.id,
            kind: editing.kind,
            name,
            enabled: editing.enabled,
            token: token || undefined
          })
        )
      }
      setEditing(null)
      toast.success('Channel saved.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (channel: ChannelRecord): Promise<void> => {
    setBusyId(channel.id)
    try {
      setState(
        await window.knight.upsertChannel({
          id: channel.id,
          kind: channel.kind,
          name: channel.name,
          enabled: !channel.enabled
        })
      )
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusyId(null)
    }
  }

  const rotate = async (channel: ChannelRecord): Promise<void> => {
    setBusyId(channel.id)
    try {
      setState(
        await window.knight.upsertChannel({
          id: channel.id,
          kind: 'webhook',
          name: channel.name,
          enabled: channel.enabled,
          removeToken: true
        })
      )
      toast.success('New token issued. Update anything that calls the webhook.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (): Promise<void> => {
    if (!removeTarget) return
    setBusyId(removeTarget.id)
    try {
      setState(await window.knight.removeChannel(removeTarget.id))
      setRemoveTarget(null)
      toast.success('Channel removed.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusyId(null)
    }
  }

  const copy = async (value: string, label: string): Promise<void> => {
    await navigator.clipboard.writeText(value)
    setCopied(label)
    window.setTimeout(() => setCopied(null), 1600)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted">
        <Spin size={20} />
      </div>
    )
  }

  return (
    <div className="space-y-9">
      <SettingsSection
        title="Listeners"
        description="Another program can message the Captain. The reply goes back the same way."
        action={
          <div className="flex items-center gap-2 whitespace-nowrap text-[11px] text-muted">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                state?.running ? 'bg-positive' : 'bg-faint'
              )}
            />
            {state?.running ? `Listening${state.port ? ` · port ${state.port}` : ''}` : 'Not listening'}
          </div>
        }
      >
        {state?.channels.length ? (
          <div className="space-y-4">
            {state.channels.map((channel) => (
              <div key={channel.id} className="rounded-xl border border-line bg-canvas/45 p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
                    {channel.kind === 'webhook' ? <Webhook size={14} /> : <MessageCircle size={14} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[12.5px] font-medium text-ink">{channel.name}</p>
                      <Chip tone={channel.enabled ? 'positive' : 'neutral'}>
                        {channel.enabled ? 'Enabled' : 'Off'}
                      </Chip>
                      {channel.kind === 'telegram' && !channel.hasToken ? (
                        <Chip tone="warn">Needs a token</Chip>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[11px] text-muted">
                      {channel.messagesIn} in · {channel.messagesOut} out
                      {channel.lastMessageAt ? ` · last message ${timeAgo(channel.lastMessageAt)}` : ''}
                    </p>
                    {channel.error ? (
                      <p className="mt-1.5 text-[11px] leading-relaxed text-danger">{channel.error}</p>
                    ) : null}

                    {channel.kind === 'webhook' && channel.webhookPath ? (
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5">
                          <code className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink/80">
                            {channel.webhookPath}
                          </code>
                          <IconButton
                            aria-label="Copy webhook URL"
                            onClick={() => void copy(channel.webhookPath ?? '', `${channel.id}-url`)}
                          >
                            {copied === `${channel.id}-url` ? (
                              <Check size={12} className="text-positive" />
                            ) : (
                              <Copy size={12} />
                            )}
                          </IconButton>
                        </div>
                        {channel.webhookToken ? (
                          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5">
                            <code className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink/80">
                              {channel.webhookToken}
                            </code>
                            <IconButton
                              aria-label="Copy webhook token"
                              onClick={() =>
                                void copy(channel.webhookToken ?? '', `${channel.id}-token`)
                              }
                            >
                              {copied === `${channel.id}-token` ? (
                                <Check size={12} className="text-positive" />
                              ) : (
                                <Copy size={12} />
                              )}
                            </IconButton>
                          </div>
                        ) : null}
                        <p className="text-[10.5px] leading-relaxed text-faint">
                          POST JSON with a text field to this address and the header
                          <span className="mx-1 font-mono">x-knight-token</span>. The call returns the
                          Captain’s reply, or 202 with a task id if it is still running.
                        </p>
                      </div>
                    ) : null}

                    {channel.kind === 'telegram' ? (
                      <p className="mt-3 text-[10.5px] leading-relaxed text-faint">
                        The bot polls Telegram from this machine. Messages from any chat the bot can
                        receive become tasks; replies are sent back to the same chat.
                      </p>
                    ) : null}
                  </div>
                  <Toggle
                    checked={channel.enabled}
                    onChange={() => void toggle(channel)}
                    disabled={busyId === channel.id}
                    label={`Enable ${channel.name}`}
                  />
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5 border-t border-line pt-3">
                  {channel.kind === 'webhook' ? (
                    <Button size="sm" variant="ghost" onClick={() => void rotate(channel)}>
                      Rotate token
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => openEdit(channel)}>
                      {channel.hasToken ? 'Replace token' : 'Add token'}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setRemoveTarget(channel)}>
                    <Trash2 size={12} /> Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty
            icon={<Globe2 size={18} />}
            title="No channels yet"
            hint="Add a local webhook for your own scripts and apps, or connect a Telegram bot so you can message the Captain from your phone."
          />
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button
            onClick={() => openNew('webhook')}
            className="group flex items-center gap-3 rounded-xl border border-dashed border-line px-4 py-3.5 text-left transition-colors hover:border-accent/40 hover:bg-accent-soft/40"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2 text-muted group-hover:text-accent-ink">
              <Webhook size={14} />
            </div>
            <div>
              <p className="text-[12px] font-medium text-ink">Local webhook</p>
              <p className="text-[10.5px] text-muted">Loopback only · token protected</p>
            </div>
            <Plus size={13} className="ml-auto text-faint" />
          </button>
          <button
            onClick={() => openNew('telegram')}
            className="group flex items-center gap-3 rounded-xl border border-dashed border-line px-4 py-3.5 text-left transition-colors hover:border-accent/40 hover:bg-accent-soft/40"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2 text-muted group-hover:text-accent-ink">
              <MessageCircle size={14} />
            </div>
            <div>
              <p className="text-[12px] font-medium text-ink">Telegram bot</p>
              <p className="text-[10.5px] text-muted">Long polling · no public URL</p>
            </div>
            <Plus size={13} className="ml-auto text-faint" />
          </button>
        </div>
      </SettingsSection>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add a channel' : 'Update channel'}
        subtitle={
          kind === 'webhook'
            ? 'Knight issues the token and listens only on this machine.'
            : 'Paste the token BotFather gave your bot.'
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              Save channel
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <FieldGroup label="Name">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
            />
          </FieldGroup>
          {kind === 'telegram' ? (
            <FieldGroup
              label="Bot token"
              hint={editing !== 'new' ? 'Leave blank to keep the saved token' : undefined}
            >
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                className={inputClass}
                autoComplete="off"
              />
            </FieldGroup>
          ) : (
            <p className="text-[11.5px] leading-relaxed text-muted">
              A token is generated and shown on the channel card after you save. Only requests that
              present it are accepted.
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        title={`Remove ${removeTarget?.name ?? 'channel'}?`}
        subtitle="The listener stops immediately. Past tasks stay in your history."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoveTarget(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              loading={Boolean(busyId && removeTarget && busyId === removeTarget.id)}
              onClick={() => void remove()}
            >
              Remove channel
            </Button>
          </>
        }
      >
        <p className="text-[12px] leading-relaxed text-muted">
          The saved token is deleted with the channel. Anything still sending to it will fail.
        </p>
      </Modal>
    </div>
  )
}

/* ───────────────────────────── Sub-agents ───────────────────────────── */

export function SubAgentsPane() {
  const [runs, setRuns] = useState<SubAgentRun[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const next = await window.knight.listSubAgents()
        if (alive) {
          setRuns(next)
          setLoading(false)
        }
      } catch {
        if (alive) setLoading(false)
      }
    }
    void load()
    const timer = setInterval(() => void load(), 2000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  const ordered = useMemo(
    () =>
      [...runs].sort((a, b) => {
        const running = Number(b.status === 'running') - Number(a.status === 'running')
        return running || b.startedAt.localeCompare(a.startedAt)
      }),
    [runs]
  )
  const live = runs.filter((run) => run.status === 'running').length
  const finished = runs.filter((run) => run.status === 'done').length

  return (
    <div className="space-y-9">
      <SettingsSection
        title="Crew activity"
        description="Focused jobs the Captain delegates, live as they work."
        action={
          <Button size="sm" variant="ghost" onClick={() => void window.knight.listSubAgents().then(setRuns)}>
            <RefreshCw size={12} /> Refresh
          </Button>
        }
      >
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Running now', value: live },
            { label: 'Finished', value: finished },
            { label: 'Recorded runs', value: runs.length }
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-line bg-canvas/50 px-4 py-3">
              <p className="display text-[22px] leading-none text-ink">{stat.value}</p>
              <p className="mt-1 text-[10.5px] text-muted">{stat.label}</p>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted">
            <Spin size={18} />
          </div>
        ) : ordered.length === 0 ? (
          <div className="mt-4">
            <Empty
              icon={<Bot size={18} />}
              title="No Crew runs yet"
              hint="Ask for work that can be split; delegated runs appear here as they work."
            />
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {ordered.map((run) => {
              const open = expanded === run.id
              return (
                <div key={run.id} className="rounded-xl border border-line bg-canvas/45">
                  <div className="flex items-start gap-3 px-4 py-3.5">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-ink">
                      <Bot size={14} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[12.5px] font-medium text-ink">{run.name}</p>
                        <span className="flex items-center gap-1.5 rounded-full border border-line bg-surface/70 px-2 py-0.5 text-[10px] font-medium text-muted">
                          <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_TONE[run.status])} />
                          {run.status === 'running' ? 'Working' : run.status}
                        </span>
                        <span className="text-[10px] text-faint">
                          {formatElapsed(run)} · {run.provider} · {run.model}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted">
                        For “{run.taskTitle}” · {run.steps.length} step{run.steps.length === 1 ? '' : 's'}
                      </p>
                      <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-relaxed text-ink/70">
                        {run.instruction}
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setExpanded(open ? null : run.id)}>
                      {open ? 'Hide' : 'Details'}
                    </Button>
                  </div>

                  {open ? (
                    <div className="border-t border-line px-4 py-3.5">
                      <div className="space-y-2">
                        {run.steps.length ? (
                          run.steps.map((step) => (
                            <div key={step.id} className="flex items-start gap-2.5">
                              <span
                                className={cn(
                                  'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                                  step.status === 'running'
                                    ? 'bg-accent'
                                    : step.status === 'ok'
                                      ? 'bg-positive'
                                      : 'bg-danger'
                                )}
                              />
                              <div className="min-w-0">
                                <p className="text-[11.5px] font-medium text-ink">{step.title}</p>
                                {step.detail ? (
                                  <p className="mt-0.5 line-clamp-2 font-mono text-[10px] leading-relaxed text-faint">
                                    {step.detail}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-[11px] text-faint">
                            {run.status === 'running'
                              ? 'Reading the brief…'
                              : 'No tool steps were recorded.'}
                          </p>
                        )}
                      </div>
                      {run.error ? (
                        <p className="mt-3 text-[11px] leading-relaxed text-danger">{run.error}</p>
                      ) : null}
                      {run.summary ? (
                        <div className="mt-3 rounded-lg border border-line bg-surface px-3 py-2.5">
                          <p className="mb-1 text-[10px] font-semibold tracking-[0.1em] text-faint uppercase">
                            Crew report
                          </p>
                          <pre className="scroll-thin max-h-48 overflow-auto text-[11px] leading-relaxed whitespace-pre-wrap text-ink/80">
                            {run.summary}
                          </pre>
                        </div>
                      ) : null}
                      <p className="mt-3 text-[10px] text-faint">
                        Started {timeAgo(run.startedAt)}
                        {run.endedAt ? ` · ended ${timeAgo(run.endedAt)}` : ''}
                      </p>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </SettingsSection>
    </div>
  )
}
