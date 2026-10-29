import { agentName } from '../../lib/localProfile'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Globe2, MessageCircle, Trash2, Webhook } from 'lucide-react'
import { Icon } from '../../components/icons'
import { toast } from 'sonner'
import type {
  ChannelRecord,
  ChannelState,
  ConnectorsState,
  SkillDetail,
  SkillDraft,
  SkillMarketResult,
  SkillSummary,
  SubAgentRun
} from '@shared/types'
import { Button, FieldGroup, IconButton, Modal, Spin, Toggle } from '../../components/ui'
import { cn, errorMessage, plural, timeAgo } from '../../lib/utils'
import { SettingsSection } from './SettingsSection'
import {
  ActionWord,
  CountTabs,
  EmptyPanel,
  SettingCard,
  SettingList,
  SettingRow,
  SettingTile,
  StatusChip
} from './settingParts'
import { MarketspaceSection } from './MarketspaceSection'

const inputClass =
  'h-9 w-full rounded-lg border border-line bg-canvas px-3 text-[12.5px] text-ink outline-none transition-colors placeholder:text-faint focus:border-accent/45'
const textareaClass =
  'w-full resize-y rounded-lg border border-line bg-canvas px-3 py-2.5 text-[12.5px] leading-relaxed text-ink outline-none transition-colors placeholder:text-faint focus:border-accent/45'

export function DesignSystemsPane({ actionHost }: { actionHost: HTMLElement | null }) {
  return (
    <div className="space-y-9">
      <MarketspaceSection actionHost={actionHost} />
    </div>
  )
}

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
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium',
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
      <Icon name="caution" size="sm" className="mt-0.5 text-danger" />
      <p className="text-[11.5px] leading-relaxed text-danger">{message}</p>
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

const CATALOG_FAILURE = 'The catalog could not be reached. Check the connection and try again.'

export function SkillsPane({ actionHost }: { actionHost: HTMLElement | null }) {
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'installed' | 'catalog'>('installed')
  const [results, setResults] = useState<SkillMarketResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)
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

  const runSearch = useCallback(async (searchQuery: string): Promise<void> => {
    setSearching(true)
    setCatalogError(null)
    try {
      setResults(await window.knight.searchSkills(searchQuery))
    } catch {
      setResults(null)
      setCatalogError(CATALOG_FAILURE)
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'installed') return
    let alive = true
    setSearching(true)
    setCatalogError(null)
    window.knight
      .searchSkills('')
      .then((found) => {
        if (alive) setResults(found)
      })
      .catch(() => {
        if (!alive) return
        setResults(null)
        setCatalogError(CATALOG_FAILURE)
      })
      .finally(() => {
        if (alive) setSearching(false)
      })
    return () => {
      alive = false
    }
  }, [tab])

  const install = async (ref: string): Promise<void> => {
    setInstalling(ref)
    setInstallError(null)
    try {
      setSkills(await window.knight.installSkill(ref))
      toast.success(`Skill installed. The ${agentName()} can use it now.`)
    } catch (error) {
      setInstallError(errorMessage(error))
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
    <div className="space-y-6">
      {actionHost
        ? createPortal(
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              <Icon name="add" size="md" /> New skill
            </Button>,
            actionHost
          )
        : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <CountTabs
          value={tab}
          onChange={(value) => {
            setTab(value)
            setResults(null)
            setCatalogError(null)
            setInstallError(null)
          }}
          tabs={[
            { value: 'installed', label: 'Installed', count: skills.length },
            { value: 'catalog', label: 'Catalog' }
          ]}
        />
        {tab === 'installed' ? null : (
          <Button size="sm" variant="secondary" loading={searching} onClick={() => void runSearch(query)}>
            <Icon name="search" size="md" /> Search
          </Button>
        )}
      </div>

      {tab === 'installed' ? (
        loading ? (
          <div className="card flex items-center justify-center py-12 text-muted">
            <Spin size={18} />
          </div>
        ) : skills.length === 0 ? (
          <EmptyPanel
            icon={<Icon name="spark" size="xl" />}
            title={<>No skills installed yet.</>}
            action={
              <Button size="sm" variant="secondary" onClick={() => setTab('catalog')}>
                <Icon name="builtin" size="md" /> Browse the catalog
              </Button>
            }
          >
            Create one with <ActionWord>New skill</ActionWord> in the top right, or install it from
            the catalog.
          </EmptyPanel>
        ) : (
          <SettingCard>
            {skills.map((skill) => (
              <SettingRow
                key={skill.id}
                icon={<Icon name="spark" size="md" />}
                tone="accent"
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {skill.name}
                    <Chip tone={skill.source === 'installed' ? 'accent' : 'neutral'}>
                      {skill.source === 'installed' ? 'Catalog' : 'Local'}
                    </Chip>
                  </span>
                }
                description={`${skill.description} · ${skill.files} file${skill.files === 1 ? '' : 's'}${skill.updatedAt ? ` · ${timeAgo(skill.updatedAt)}` : ''}`}
              >
                <Button size="sm" variant="secondary" onClick={() => void openDetail(skill.id)}>
                  Read
                </Button>
                <IconButton
                  aria-label={`Remove ${skill.name}`}
                  onClick={() => setRemoveTarget(skill)}
                  className="hover:text-danger"
                >
                  <Trash2 size={13} />
                </IconButton>
              </SettingRow>
            ))}
          </SettingCard>
        )
      ) : (
        <div className="space-y-4">
          <div className="relative">
            <Icon name="search" size="md" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void runSearch(query)
              }}
              placeholder="Search the skill catalog"
              aria-label="Search the skill catalog"
              className={cn(inputClass, 'pl-8')}
            />
          </div>

          {installError ? <ErrorBanner message={installError} /> : null}

          {searching ? (
            <div className="card flex items-center justify-center py-12 text-muted">
              <Spin size={18} />
            </div>
          ) : catalogError ? (
            <div className="space-y-3">
              <ErrorBanner message={catalogError} />
              <Button size="sm" variant="secondary" onClick={() => void runSearch(query)}>
                <Icon name="refresh" size="md" /> Try again
              </Button>
            </div>
          ) : results === null ? (
            <p className="px-1 text-[12px] leading-relaxed text-faint">Loading the catalog…</p>
          ) : results.length === 0 ? (
            <p className="px-1 text-[12px] text-muted">No skill in the catalog matches that search.</p>
          ) : (
            <SettingCard>
              {results.map((result) => (
                <SettingRow
                  key={result.ref}
                  icon={<Icon name="builtin" size="md" />}
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {result.name}
                      {result.version ? <Chip>{result.version}</Chip> : null}
                      {result.author ? (
                        <span className="text-[10.5px] text-faint">by {result.author}</span>
                      ) : null}
                    </span>
                  }
                  description={result.summary || 'No summary provided.'}
                >
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={installing === result.ref}
                    disabled={!result.ref || Boolean(installing)}
                    onClick={() => void install(result.ref)}
                  >
                    Install
                  </Button>
                </SettingRow>
              ))}
            </SettingCard>
          )}
        </div>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New skill"
        subtitle={`Give the ${agentName()} a repeatable playbook it can load by name.`}
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
        subtitle="This deletes the bundle from this device. Catalog skills can be installed again."
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
          The {agentName()} will stop seeing this skill in its prompt immediately.
        </p>
      </Modal>
    </div>
  )
}

/* ───────────────────────────── Connectors ─────────────────────────── */

/** The connector service names itself in the errors it returns; the UI stays in product voice. */
function connectorMessage(message: string): string {
  return message.replace(/\bComposio\b/g, 'Connector service')
}

export function ConnectorsPane() {
  const [state, setState] = useState<ConnectorsState | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')
  const [showTools, setShowTools] = useState(false)

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true)
    try {
      setState(await window.knight.connectorsState(refresh))
    } catch (error) {
      toast.error(connectorMessage(errorMessage(error)))
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
      toast.error('Paste a connector key first.')
      return
    }
    setSaving(true)
    try {
      const next = await window.knight.saveConnectors({ apiKey: keyDraft })
      setState(next)
      setKeyDraft('')
      if (next.error) toast.error(connectorMessage(next.error))
      else toast.success('Connectors connected.')
    } catch (error) {
      toast.error(connectorMessage(errorMessage(error)))
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
      const next = await window.knight.saveConnectors(input)
      setState(next)
      if (next.error) toast.error(connectorMessage(next.error))
    } catch (error) {
      toast.error(connectorMessage(errorMessage(error)))
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
        body={
          <div className="space-y-5">
            <div className="flex gap-2">
              <input
                type="password"
                value={keyDraft}
                onChange={(event) => setKeyDraft(event.target.value)}
                aria-label="Connector key"
                placeholder="Paste a connector key"
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
                  <p className="text-[12.5px] font-medium text-ink">Give the {agentName()} tool access</p>
                  <p className="text-[11.5px] text-muted">
                    Only enabled toolkits are exposed. Calls follow your gates.
                  </p>
                </div>
                <Toggle
                  checked={state.enabled}
                  onChange={(checked) => void patch({ enabled: checked })}
                  label="Expose connector tools"
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
            {state?.error ? <ErrorBanner message={connectorMessage(state.error)} /> : null}
          </div>
        }
      >
        <SettingList>
          <SettingRow
            icon={<Icon name="connector" size="md" />}
            title="Connector key"
            description={
              state?.configured ? 'A key is saved on this device.' : 'Add a key to list toolkits.'
            }
          >
            <Chip tone={state?.configured ? 'positive' : 'neutral'}>
              {state?.configured ? 'Connected' : 'Not connected'}
            </Chip>
          </SettingRow>
        </SettingList>
      </SettingsSection>

      {state ? null : (
        <div className="space-y-3">
          <ErrorBanner message="Connector status could not be loaded. Check the connection and try again." />
          <Button size="sm" variant="secondary" loading={refreshing} onClick={() => void load(true)}>
            <Icon name="refresh" size="md" /> Try again
          </Button>
        </div>
      )}

      {state ? (
        <SettingsSection
          title="Impulse Connectors Matrix"
          
          action={
            <Button size="sm" variant="ghost" loading={refreshing} onClick={() => void load(true)}>
              <Icon name="refresh" size="md" /> Refresh
            </Button>
          }
        >
          <div className="relative">
            <Icon name="search" size="md" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
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
                        <span className="whitespace-nowrap text-[10px] text-faint">{plural(toolkit.tools, 'tool')}</span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted" title={toolkit.description || undefined}>
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
          title="Available tools"
          
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-data text-[26px] leading-none font-semibold text-ink">{state.tools.length}</p>
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

export function ChannelsPane({ actionHost }: { actionHost: HTMLElement | null }) {
  const [state, setState] = useState<ChannelState | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<ChannelRecord | 'new' | null>(null)
  const [kind, setKind] = useState<'webhook' | 'telegram'>('webhook')
  const [name, setName] = useState('')
  const [token, setToken] = useState('')
  const [allowedChatIds, setAllowedChatIds] = useState('')
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
    setName(next === 'webhook' ? 'Local webhook' : 'Chat channel')
    setToken('')
    setAllowedChatIds('')
    setEditing('new')
  }

  const openEdit = (channel: ChannelRecord): void => {
    setKind(channel.kind)
    setName(channel.name)
    setToken('')
    setAllowedChatIds(channel.allowedChatIds.join('\n'))
    setEditing(channel)
  }

  const save = async (): Promise<void> => {
    const chatIds = allowedChatIds.split(/[\s,]+/).map((id) => id.trim()).filter(Boolean)
    setSaving(true)
    try {
      if (editing === 'new') {
        setState(
          await window.knight.upsertChannel({
            kind,
            name,
            enabled: true,
            token: kind === 'telegram' ? token : undefined,
            allowedChatIds: kind === 'telegram' ? chatIds : undefined
          })
        )
      } else if (editing) {
        setState(
          await window.knight.upsertChannel({
            id: editing.id,
            kind: editing.kind,
            name,
            enabled: editing.enabled,
            token: token || undefined,
            allowedChatIds: kind === 'telegram' ? chatIds : undefined
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
      {actionHost
        ? createPortal(
            <Button size="sm" variant="primary" onClick={() => openNew('webhook')}>
              <Icon name="add" size="md" /> Add channel
            </Button>,
            actionHost
          )
        : null}

      {state?.channels.length ? (
        <SettingsSection
          title="Listeners"
        
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
                          <code
                            className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink/80"
                            title={channel.webhookPath ?? undefined}
                          >
                            {channel.webhookPath}
                          </code>
                          <IconButton
                            aria-label="Copy webhook URL"
                            onClick={() => void copy(channel.webhookPath ?? '', `${channel.id}-url`)}
                          >
                            {copied === `${channel.id}-url` ? (
                              <Icon name="confirm" size="md" className="text-positive" />
                            ) : (
                              <Icon name="copy" size="md" />
                            )}
                          </IconButton>
                        </div>
                        {channel.webhookToken ? (
                          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5">
                            <code
                              className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink/80"
                              title={channel.webhookToken ?? undefined}
                            >
                              {channel.webhookToken}
                            </code>
                            <IconButton
                              aria-label="Copy webhook token"
                              onClick={() =>
                                void copy(channel.webhookToken ?? '', `${channel.id}-token`)
                              }
                            >
                              {copied === `${channel.id}-token` ? (
                                <Icon name="confirm" size="md" className="text-positive" />
                              ) : (
                                <Icon name="copy" size="md" />
                              )}
                            </IconButton>
                          </div>
                        ) : null}
                        <p className="text-[10.5px] leading-relaxed text-faint">
                          POST JSON with a text field to this address and the header
                          <span className="mx-1 font-mono">x-selfimpulse-token</span>. The call returns the
                          {agentName()}’s reply, or 202 with a task id if it is still running.
                        </p>
                      </div>
                    ) : null}

                    {channel.kind === 'telegram' ? (
                      <p className="mt-3 text-[10.5px] leading-relaxed text-faint">
                        Only {channel.allowedChatIds.length} configured numeric chat ID{channel.allowedChatIds.length === 1 ? '' : 's'} can create tasks.
                        Unlisted chats are denied; outgoing replies are checked by enterprise DLP.
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
                      Configure
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setRemoveTarget(channel)}>
                    <Trash2 size={12} /> Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </SettingsSection>
      ) : (
        <EmptyPanel
          icon={<Globe2 size={18} />}
          title={<>No channels yet.</>}
        >
          Select <ActionWord>Add channel</ActionWord> in the top right to get started.
        </EmptyPanel>
      )}

      <div>
        <p className="mb-2.5 px-4 text-[12px] font-medium text-muted">Other kinds</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            onClick={() => openNew('webhook')}
            className="group flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3.5 text-left transition-colors hover:border-accent/40 hover:bg-accent-soft/40"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2 text-muted group-hover:text-accent-ink">
              <Webhook size={14} />
            </div>
            <div>
              <p className="text-[12px] font-medium text-ink">Local webhook</p>
              <p className="text-[10.5px] text-muted">Loopback only · token protected</p>
            </div>
            <Icon name="add" size="md" className="ml-auto text-faint" />
          </button>
          <button
            onClick={() => openNew('telegram')}
            className="group flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3.5 text-left transition-colors hover:border-accent/40 hover:bg-accent-soft/40"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2 text-muted group-hover:text-accent-ink">
              <MessageCircle size={14} />
            </div>
            <div>
              <p className="text-[12px] font-medium text-ink">Chat bot</p>
              <p className="text-[10.5px] text-muted">Long polling · no public URL</p>
            </div>
            <Icon name="add" size="md" className="ml-auto text-faint" />
          </button>
        </div>
      </div>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add a channel' : 'Update channel'}
        subtitle={
          kind === 'webhook'
            ? 'SelfImpulse issues the token and listens only on this machine.'
            : 'Paste the BotFather token and authorize only the numeric chat IDs you trust.'
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
            <>
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
              <FieldGroup
                label="Allowed chat IDs"
                hint="One numeric ID per line. Group IDs may start with -. Empty keeps the channel locked."
              >
                <textarea
                  value={allowedChatIds}
                  onChange={(event) => setAllowedChatIds(event.target.value)}
                  className={cn(inputClass, 'min-h-24 resize-y font-mono text-[11px]')}
                  placeholder={'123456789\n-1001234567890'}
                  spellCheck={false}
                />
              </FieldGroup>
            </>
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
        title="Specialist sub-agents"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 bg-canvas/40 border-b border-line">
          <div className="rounded-lg border border-line bg-surface p-3.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-ink">Coding</span>
              <StatusChip tone="positive">Ready</StatusChip>
            </div>
            <p className="text-[11px] leading-relaxed text-muted">
              Reads code structure, applies edits, and checks syntax before running.
            </p>
          </div>
          <div className="rounded-lg border border-line bg-surface p-3.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-ink">File navigation</span>
              <StatusChip tone="positive">Ready</StatusChip>
            </div>
            <p className="text-[11px] leading-relaxed text-muted">
              Reads and indexes files and folders, and outlines their contents.
            </p>
          </div>
          <div className="rounded-lg border border-line bg-surface p-3.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-ink">Background work</span>
              <StatusChip tone="positive">Active</StatusChip>
            </div>
            <p className="text-[11px] leading-relaxed text-muted">
              Runs steps and timers that survive app restarts and resume where they stopped.
            </p>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Team run activity"
        
        action={
          <Button size="sm" variant="ghost" onClick={() => void window.knight.listSubAgents().then(setRuns)}>
            <Icon name="refresh" size="md" /> Refresh
          </Button>
        }
      >
        <div className="grid grid-cols-3 divide-x divide-line/70 border-b border-line bg-canvas/40">
          {[
            { label: 'Running now', value: live },
            { label: 'Finished', value: finished },
            { label: 'Recorded runs', value: runs.length }
          ].map((stat) => (
            <div key={stat.label} className="px-5 py-4 text-center">
              <p className="font-data text-[22px] leading-none font-semibold text-ink">{stat.value}</p>
              <p className="mt-1.5 text-[11px] text-muted">{stat.label}</p>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted">
            <Spin size={18} />
          </div>
        ) : ordered.length === 0 ? (
          <div className="mt-4">
            <EmptyPanel
              icon={<Icon name="crew" size="xl" />}
              title={<>No team runs yet.</>}
            />
          </div>
        ) : (
          <div className="mt-4">
            <SettingList>
              {ordered.map((run) => {
                const open = expanded === run.id
                return (
                  <div key={run.id}>
                    <div className="flex items-start gap-3 px-4 py-3.5">
                      <SettingTile tone="accent">
                        <Icon name="crew" size="md" />
                      </SettingTile>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[13px] font-medium text-ink">{run.name}</p>
                          <StatusChip
                            tone={
                              run.status === 'running'
                                ? 'accent'
                                : run.status === 'done'
                                  ? 'positive'
                                  : run.status === 'error'
                                    ? 'danger'
                                    : 'neutral'
                            }
                          >
                            {run.status === 'running' ? 'Working' : run.status}
                          </StatusChip>
                          {(run.batchSize ?? 1) > 1 ? (
                            <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent-ink">
                              Team of {run.batchSize}
                            </span>
                          ) : null}
                          <span className="text-[10.5px] text-faint">
                            {formatElapsed(run)} · {run.provider} · {run.model}
                          </span>
                        </div>
                        <p className="mt-1 text-[12px] text-muted">
                          For “{run.taskTitle}” · {run.steps.length} step{run.steps.length === 1 ? '' : 's'}
                          {run.usage && run.usage.total > 0
                            ? ` · ${run.usage.total.toLocaleString()} tokens`
                            : ''}
                        </p>
                        <p className="mt-1 font-mono text-[10px] text-faint">
                          {(run.agentPath ?? [agentName(), run.name]).join(' / ')}
                        </p>
                        {run.purpose ? (
                          <p className="mt-1.5 text-[12px] font-medium text-ink/80">{run.purpose}</p>
                        ) : null}
                        <p className={cn('mt-1.5 text-[12px] leading-[1.6] text-muted', !open && 'line-clamp-2')}>
                          {run.instruction}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setExpanded(open ? null : run.id)}
                      >
                        {open ? 'Hide' : 'Details'}
                      </Button>
                    </div>

                    {open ? (
                      <div className="border-t border-line/70 bg-canvas/40 px-4 py-3.5">
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
                                    <p className="mt-0.5 line-clamp-2 break-words font-mono text-[10px] leading-relaxed text-faint" title={step.detail ?? undefined}>
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
                        {run.events?.length ? (
                          <div className="mt-3 rounded-lg border border-line/70 bg-surface/45 px-3 py-2.5">
                            <p className="mb-1.5 text-[10px] font-semibold tracking-[0.1em] text-faint uppercase">
                              Forwarded activity
                            </p>
                            <ol className="space-y-1">
                              {[...run.events].slice(-6).reverse().map((event) => (
                                <li
                                  key={event.id}
                                  className="flex items-center gap-2 text-[10.5px] text-muted"
                                >
                                  <span className="h-1 w-1 shrink-0 rounded-full bg-accent/70" />
                                  <span>{event.label}</span>
                                </li>
                              ))}
                            </ol>
                          </div>
                        ) : null}
                        {run.error ? (
                          <p className="mt-3 text-[11px] leading-relaxed text-danger">{run.error}</p>
                        ) : null}
                        {run.summary ? (
                          <div className="mt-3 rounded-lg border border-line bg-surface px-3 py-2.5">
                            <p className="mb-1 text-[10px] font-semibold tracking-[0.1em] text-faint uppercase">
                              Team report
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
            </SettingList>
          </div>
        )}
      </SettingsSection>
    </div>
  )
}
