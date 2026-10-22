import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Aperture,
  ArrowLeft,
  ArrowRight,
  Bot,
  Boxes,
  Brain,
  Building2,
  Check,
  CheckCheck,
  CheckCircle2,
  ChessKnight,
  ChevronRight,
  CircleUserRound,
  Clipboard,
  Cpu,
  Eye,
  EyeOff,
  FileText,
  Handshake,
  Info,
  KeyRound,
  Keyboard,
  Loader2,
  Lock,
  Moon,
  Paintbrush,
  Pencil,
  Plug,
  Plus,
  Radio,
  RefreshCw,
  Search,
  ServerCog,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SwatchBook,
  Terminal,
  Trash2,
  Users,
  Waypoints,
  X,
  Zap
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  AppInfo,
  McpServerConfig,
  McpServerStatus,
  MemoryNote,
  ProviderInput,
  ProviderKind,
  ProviderPublic,
  PublicSettings,
  TaskStatus,
  UsageSummary
} from '@shared/types'
import { useApp, type SettingsTab } from '../store'
import { cn, errorMessage, statusLabel, timeAgo } from '../lib/utils'
import { PERMISSION_CHOICES, permissionChoice } from '../lib/composerChoices'
import {
  groupSettingsNav,
  searchSettingsNav,
  settingsPane,
  settingsParent,
  visibleSettingsNav,
  type SettingsNavItem,
  type SettingsPaneId
} from '../lib/settingsNav'
import { buildActivity } from '../lib/activity'
import { profileInitial, saveLocalProfile, useLocalProfile } from '../lib/localProfile'
import { startNewTask } from '../lib/navigation'
import { Button, FieldGroup, IconButton, Modal, Spin, Toggle } from '../components/ui'
import { SettingsSection } from './settings/SettingsSection'
import { AppearancePane, ColorsPane, MoonPane } from './settings/ThemePanes'
import {
  ChannelsPane,
  ComposioPane,
  SkillsPane,
  SubAgentsPane
} from './settings/CapabilityPanes'

const NAV_ICONS: Record<SettingsPaneId, typeof SlidersHorizontal> = {
  profile: CircleUserRound,
  general: SlidersHorizontal,
  'mode-config': Waypoints,
  permissions: ShieldCheck,
  'task-monitor': Activity,
  shortcuts: Keyboard,
  appearance: Paintbrush,
  colors: SwatchBook,
  moon: Moon,
  providers: Cpu,
  instructions: Brain,
  agent: ChessKnight,
  'agent-team': Users,
  skills: Sparkles,
  'sub-agents': Bot,
  mcp: Plug,
  composio: Boxes,
  channels: Radio,
  about: Info
}

const TASK_DOT: Record<TaskStatus, string> = {
  draft: 'bg-line-strong',
  running: 'bg-accent',
  waiting: 'bg-warn',
  paused: 'bg-faint',
  done: 'bg-positive',
  error: 'bg-danger'
}

const COMPACT_NUMBER = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1
})

function compactNumber(value: number): string {
  return COMPACT_NUMBER.format(value)
}

export function SettingsView() {
  const view = useApp((state) => state.view)
  const settings = useApp((state) => state.settings)
  const openSettings = useApp((state) => state.openSettings)
  const openSurface = useApp((state) => state.openSurface)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const tab: SettingsTab = view.kind === 'settings' ? view.tab : 'general'
  const trimmedQuery = query.trim()
  const searching = trimmedQuery.length > 0
  const results = searchSettingsNav(trimmedQuery)
  const sections = groupSettingsNav(searching ? results : visibleSettingsNav())
  const active = settingsPane(tab)
  const parent = settingsParent(tab)
  const drilled = parent !== tab

  useEffect(() => {
    const focus = (): void => {
      searchRef.current?.focus()
      searchRef.current?.select()
    }
    window.addEventListener('knight:focus-settings-search', focus)
    return () => window.removeEventListener('knight:focus-settings-search', focus)
  }, [])

  if (!settings) return null

  return (
    <div className="flex h-full min-h-0 bg-canvas">
      <aside className="flex w-[248px] shrink-0 flex-col border-r border-line/60 bg-panel-2">
        <div className="px-3 pt-3.5 pb-3">
          <button
            onClick={() => openSurface('chat')}
            className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[11.5px] text-muted transition-colors outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/30"
          >
            <ArrowLeft size={13} />
            Back
          </button>
          <div className="relative mt-2.5">
            <Search
              size={12}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint"
            />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setQuery('')
                  event.currentTarget.blur()
                } else if (event.key === 'Enter' && results.length) {
                  openSettings(results[0].id)
                  setQuery('')
                }
              }}
              placeholder="Search"
              aria-label="Search settings"
              className="h-[30px] w-full rounded-[8px] border border-transparent bg-canvas/50 pr-7 pl-7.5 text-[12px] text-ink outline-none transition-colors placeholder:text-faint hover:border-line/70 focus:border-line-strong focus:bg-canvas"
            />
            {query ? (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-faint hover:text-ink"
              >
                <X size={10} />
              </button>
            ) : null}
          </div>
        </div>

        <nav className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {sections.length === 0 ? (
            <div className="px-2.5 pt-3">
              <p className="text-[11.5px] text-faint">Nothing matches “{query.trim()}”.</p>
              <button
                onClick={() => setQuery('')}
                className="mt-1 text-[11px] text-muted underline underline-offset-2 hover:text-ink"
              >
                Clear
              </button>
            </div>
          ) : (
            sections.map((section) => (
              <div key={section.group} className="mt-4 first:mt-0.5">
                <p className="px-2.5 pb-1.5 text-[10.5px] font-medium text-faint/80">
                  {section.group}
                </p>
                <div className="space-y-px">
                  {section.items.map((item) => {
                    const Icon = NAV_ICONS[item.id]
                    const isActive = item.id === parent
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          openSettings(item.id)
                          setQuery('')
                        }}
                        className={cn(
                          'group flex h-[30px] w-full items-center gap-2.5 rounded-[7px] px-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/30',
                          isActive
                            ? 'bg-surface-3/80 text-ink'
                            : 'text-muted hover:bg-surface-2/60 hover:text-ink'
                        )}
                      >
                        <Icon
                          size={13.5}
                          className={cn(
                            'shrink-0',
                            isActive ? 'text-accent' : 'text-faint group-hover:text-muted'
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate text-[12px]">{item.label}</span>
                        {item.badge ? (
                          <span className="shrink-0 text-[9px] text-faint">{item.badge}</span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </nav>

        <div className="px-4 py-3">
          <p className="flex items-center gap-1.5 text-[9.5px] text-faint/70">
            <Lock size={9} />
            On this device
          </p>
        </div>
      </aside>

      <section className="min-w-0 flex-1 bg-panel">
        <div className="scroll-thin h-full overflow-y-auto">
          <div className="mx-auto w-full max-w-[780px] px-10 pt-10 pb-24">
            <div key={`head:${searching ? 'search' : tab}`} className="tab-enter">
              {drilled && !searching ? (
                <button
                  onClick={() => openSettings(parent)}
                  className="mb-3 flex items-center gap-1 text-[11.5px] text-faint transition-colors hover:text-ink"
                >
                  <ArrowLeft size={12} />
                  {settingsPane(parent).label}
                </button>
              ) : null}
              <h1 className="display text-[24px] leading-tight text-ink">
                {searching ? 'Search' : active.label}
              </h1>
              <p className="mt-1.5 text-[12px] text-muted">
                {searching
                  ? results.length
                    ? `${results.length} match${results.length === 1 ? '' : 'es'} for “${trimmedQuery}”`
                    : `Nothing matches “${trimmedQuery}”`
                  : active.summary}
              </p>
            </div>

            <div
              key={searching ? 'search' : tab}
              className={cn('mt-9', drilled && !searching ? 'drill-in' : 'tab-enter')}
            >
              {searching ? (
                <SearchResults
                  query={trimmedQuery}
                  results={results}
                  onOpen={(id) => {
                    openSettings(id)
                    setQuery('')
                  }}
                />
              ) : (
                <>
                  {tab === 'profile' ? <ProfilePane settings={settings} /> : null}
                  {tab === 'general' ? <GeneralPane settings={settings} /> : null}
                  {tab === 'mode-config' ? <ModeConfigPane settings={settings} /> : null}
                  {tab === 'task-monitor' ? <TaskMonitorPane /> : null}
                  {tab === 'shortcuts' ? <ShortcutsPane /> : null}
                  {tab === 'agent' ? <AgentPane settings={settings} /> : null}
                  {tab === 'agent-team' ? <AgentTeamsPane /> : null}
                  {tab === 'skills' ? <SkillsPane /> : null}
                  {tab === 'sub-agents' ? <SubAgentsPane /> : null}
                  {tab === 'appearance' ? <AppearancePane /> : null}
                  {tab === 'colors' ? <ColorsPane /> : null}
                  {tab === 'moon' ? <MoonPane /> : null}
                  {tab === 'permissions' ? <PermissionsPane settings={settings} /> : null}
                  {tab === 'instructions' ? <InstructionsPane settings={settings} /> : null}
                  {tab === 'providers' ? <ProvidersTab settings={settings} /> : null}
                  {tab === 'mcp' ? <McpTab /> : null}
                  {tab === 'composio' ? <ComposioPane /> : null}
                  {tab === 'channels' ? <ChannelsPane /> : null}
                  {tab === 'about' ? <AboutTab /> : null}
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function SearchResults({
  query,
  results,
  onOpen
}: {
  query: string
  results: SettingsNavItem[]
  onOpen: (id: SettingsPaneId) => void
}) {
  if (results.length === 0) {
    return (
      <div className="card flex flex-col items-center px-6 py-12 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-muted">
          <Search size={17} />
        </div>
        <p className="mt-3 text-[13px] font-medium">No setting matches “{query}”</p>
        <p className="mt-1 max-w-xs text-[11.5px] leading-relaxed text-faint">
          Try “model”, “theme”, “permissions”, or “keys”.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {results.map((item) => {
        const Icon = NAV_ICONS[item.id]
        return (
          <button
            key={item.id}
            onClick={() => onOpen(item.id)}
            className="group flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-line-strong"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted transition-colors group-hover:text-accent">
              <Icon size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-[12.5px] font-medium text-ink">{item.label}</span>
                <span className="rounded-full border border-line bg-canvas px-1.5 py-px text-[9px] text-faint">
                  {item.group}
                </span>
              </span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                {item.summary}
              </span>
            </span>
            <ChevronRight
              size={13}
              className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5"
            />
          </button>
        )
      })}
    </div>
  )
}

function GlanceRow({
  icon: Icon,
  label,
  value,
  onClick
}: {
  icon: typeof ShieldCheck
  label: string
  value: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2/50"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
        <Icon size={13} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-medium text-ink">{label}</span>
        <span className="mt-0.5 block truncate text-[10.5px] text-faint">{value}</span>
      </span>
      <ChevronRight
        size={13}
        className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-muted"
      />
    </button>
  )
}

function GeneralPane({ settings }: { settings: PublicSettings }) {
  const saveSettings = useApp((state) => state.saveSettings)
  const openSettings = useApp((state) => state.openSettings)

  const providers = settings.providers.filter((provider) => provider.enabled)
  const defaultProvider =
    providers.find((provider) => provider.id === settings.defaultProviderId) ?? providers[0]
  const defaultModel =
    defaultProvider?.id === settings.defaultProviderId && settings.defaultModel
      ? settings.defaultModel
      : defaultProvider?.models[0]
  const permission = permissionChoice(settings.defaultPermissionMode)
  const mcpEnabled = settings.mcpServers.filter((server) => server.enabled).length

  return (
    <div className="space-y-9">
      <SettingsSection title="Model defaults">
        {providers.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-line px-4 py-3.5">
            <Sparkles size={15} className="text-accent" />
            <p className="flex-1 text-[12.5px] text-muted">Connect a model to begin.</p>
            <Button variant="primary" size="sm" onClick={() => openSettings('providers')}>
              Set up
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldGroup label="Default provider">
              <select
                className="field"
                value={defaultProvider?.id ?? ''}
                onChange={(event) => {
                  const provider = providers.find((item) => item.id === event.target.value)
                  if (!provider) return
                  void saveSettings({
                    defaultProviderId: provider.id,
                    defaultModel: provider.models[0] ?? ''
                  })
                }}
              >
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </FieldGroup>
            <FieldGroup label="Default model">
              <select
                className="field"
                value={defaultModel ?? ''}
                disabled={!defaultProvider?.models.length}
                onChange={(event) => {
                  if (!defaultProvider) return
                  void saveSettings({
                    defaultProviderId: defaultProvider.id,
                    defaultModel: event.target.value
                  })
                }}
              >
                {(defaultProvider?.models.length ?? 0) === 0 ? (
                  <option value="">No models on this provider</option>
                ) : (
                  defaultProvider?.models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))
                )}
              </select>
            </FieldGroup>
          </div>
        )}
      </SettingsSection>

      <section>
        <h2 className="mb-2.5 text-[12.5px] font-medium text-faint">Defaults</h2>
        <div className="card divide-y divide-line overflow-hidden">
          <GlanceRow
            icon={ShieldCheck}
            label="Permissions"
            value={`${permission.label} · ${settings.allowShell ? 'shell on' : 'shell off'}`}
            onClick={() => openSettings('permissions')}
          />
          <GlanceRow
            icon={FileText}
            label="Memory"
            value={settings.customInstructions.trim() ? 'On' : 'Empty'}
            onClick={() => openSettings('instructions')}
          />
          <GlanceRow
            icon={Plug}
            label="MCP"
            value={
              settings.mcpServers.length === 0
                ? 'None'
                : `${mcpEnabled} of ${settings.mcpServers.length} active`
            }
            onClick={() => openSettings('mcp')}
          />
        </div>
      </section>
    </div>
  )
}

function PermissionsPane({ settings }: { settings: PublicSettings }) {
  const saveSettings = useApp((state) => state.saveSettings)

  return (
    <div className="space-y-7">
      <SettingsSection title="Approval mode">
        <div className="space-y-1.5">
          {PERMISSION_CHOICES.map((choice) => {
            const active = settings.defaultPermissionMode === choice.value
            const Icon =
              choice.value === 'manual'
                ? ShieldCheck
                : choice.value === 'auto'
                  ? Zap
                  : CheckCheck
            return (
              <button
                key={choice.value}
                onClick={() => void saveSettings({ defaultPermissionMode: choice.value })}
                className={cn(
                  'flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors',
                  active
                    ? 'border-accent/40 bg-accent-soft/20'
                    : 'border-line hover:border-line-strong hover:bg-surface-2/40'
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                    active ? 'bg-accent text-on-ink' : 'bg-surface-2 text-muted'
                  )}
                >
                  <Icon size={13} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[12.5px] font-medium">
                    {choice.label}
                    {active ? <Check size={12} className="text-accent" /> : null}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted">
                    {choice.blurb}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="mt-4 flex items-start gap-3 border-t border-line pt-4">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
            <Terminal size={13} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-medium">Allow shell commands</p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">
              Run commands inside approved folders.
            </p>
          </div>
          <Toggle
            checked={settings.allowShell}
            onChange={(checked) => void saveSettings({ allowShell: checked })}
            label="Allow shell commands"
          />
        </div>
      </SettingsSection>

      <div className="flex items-center gap-2 px-1 text-[11px] text-faint">
        <Handshake size={12} className="shrink-0" />
        Joint Table actions always need both keys.
      </div>
    </div>
  )
}

function workspaceLabel(note: MemoryNote): string {
  if (note.scope === 'global' || !note.scopeRef) return 'All tasks'
  return note.scopeRef.split(/[\\/]/).filter(Boolean).pop() ?? note.scopeRef
}

function InstructionsPane({ settings }: { settings: PublicSettings }) {
  const saveSettings = useApp((state) => state.saveSettings)
  const [instructions, setInstructions] = useState(settings.customInstructions)
  const [saving, setSaving] = useState(false)
  const [notes, setNotes] = useState<MemoryNote[]>([])
  const [note, setNote] = useState('')
  const [adding, setAdding] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    setInstructions(settings.customInstructions)
  }, [settings.customInstructions])

  useEffect(() => {
    window.knight
      .listMemories()
      .then(setNotes)
      .catch((error) => toast.error(errorMessage(error)))
  }, [])

  const dirty = instructions !== settings.customInstructions

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const saved = await saveSettings({ customInstructions: instructions })
      if (saved) toast.success('Custom instructions saved.')
    } finally {
      setSaving(false)
    }
  }

  const addNote = async (): Promise<void> => {
    const text = note.trim()
    if (!text) return
    setAdding(true)
    try {
      setNotes(await window.knight.addMemory({ text }))
      setNote('')
      toast.success('Note saved.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setAdding(false)
    }
  }

  const removeNote = async (id: string): Promise<void> => {
    try {
      setNotes(await window.knight.removeMemory(id))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const importNotes = async (): Promise<void> => {
    setImporting(true)
    try {
      setNotes(await window.knight.importMemories(importText))
      setImportOpen(false)
      setImportText('')
      toast.success('Notes imported.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-9">
      <SettingsSection
        title="Saved notes"
        description="Facts and preferences the Captain recalls when they matter."
        action={
          <Button size="sm" variant="ghost" onClick={() => setImportOpen(true)}>
            <FileText size={12.5} /> Import
          </Button>
        }
      >
        <div className="flex gap-2">
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void addNote()
            }}
            placeholder="Something worth remembering"
            aria-label="New memory note"
            className="field flex-1"
          />
          <Button
            size="sm"
            variant="primary"
            loading={adding}
            disabled={!note.trim()}
            onClick={() => void addNote()}
          >
            Add
          </Button>
        </div>

        {notes.length === 0 ? (
          <p className="mt-4 text-[11.5px] text-faint">Nothing saved yet.</p>
        ) : (
          <div className="mt-4 divide-y divide-line">
            {notes.map((item) => (
              <div key={item.id} className="group flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-2 text-faint">
                  <Brain size={12} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] leading-relaxed text-ink">{item.text}</p>
                  <p className="mt-0.5 text-[10px] text-faint">
                    {workspaceLabel(item)}
                    {item.source === 'captain' ? ' · written by the Captain' : ''}
                    {item.source === 'import' ? ' · imported' : ''}
                  </p>
                </div>
                <IconButton
                  aria-label="Forget this note"
                  onClick={() => void removeNote(item.id)}
                  className="opacity-0 group-hover:opacity-100 hover:text-danger"
                >
                  <Trash2 size={12.5} />
                </IconButton>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="Instructions"
        description="Added to every task, before the work starts."
        action={
          <Button
            size="sm"
            variant={dirty ? 'primary' : 'secondary'}
            disabled={!dirty}
            loading={saving}
            onClick={() => void save()}
          >
            Save
          </Button>
        }
      >
        <textarea
          className="field"
          rows={7}
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder="How you like work done"
        />
        <div className="mt-2 flex items-center justify-between text-[10.5px] text-faint">
          <span>Every task</span>
          <span>{instructions.length.toLocaleString()} characters</span>
        </div>
      </SettingsSection>

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import notes"
        subtitle="One note per line. Duplicates are skipped."
        footer={
          <>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={importing} onClick={() => void importNotes()}>
              Import
            </Button>
          </>
        }
      >
        <textarea
          className="field"
          rows={10}
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          placeholder={'Prefers British spelling\nInvoices go to finance on Fridays'}
          autoFocus
        />
      </Modal>
    </div>
  )
}

const PROVIDER_KINDS: {
  value: ProviderKind
  label: string
  blurb: string
  icon: typeof Sparkles
}[] = [
  {
    value: 'anthropic',
    label: 'Anthropic',
    blurb: 'Claude models',
    icon: Sparkles
  },
  {
    value: 'openai',
    label: 'OpenAI',
    blurb: 'GPT and o-series',
    icon: Aperture
  },
  {
    value: 'compatible',
    label: 'Compatible',
    blurb: 'OpenAI-style APIs',
    icon: Plug
  }
]

function kindMeta(kind: ProviderKind) {
  return PROVIDER_KINDS.find((item) => item.value === kind) ?? PROVIDER_KINDS[0]
}

function toProviderInput(provider: ProviderPublic): ProviderInput {
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    models: provider.models,
    enabled: provider.enabled
  }
}

function ProvidersTab({ settings }: { settings: PublicSettings }) {
  const saveSettings = useApp((state) => state.saveSettings)
  const [editing, setEditing] = useState<ProviderPublic | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  const openCreate = (): void => {
    setEditing(null)
    setModalOpen(true)
  }

  const openEdit = (provider: ProviderPublic): void => {
    setEditing(provider)
    setModalOpen(true)
  }

  const toggleProvider = async (provider: ProviderPublic, enabled: boolean): Promise<void> => {
    await saveSettings({
      providers: settings.providers.map((item) =>
        item.id === provider.id ? { ...toProviderInput(item), enabled } : toProviderInput(item)
      )
    })
  }

  const removeProvider = async (provider: ProviderPublic): Promise<void> => {
    if (
      !window.confirm(
        `Remove “${provider.name}”? Tasks already using it will need another model.`
      )
    ) {
      return
    }
    const saved = await saveSettings({
      providers: settings.providers
        .filter((item) => item.id !== provider.id)
        .map(toProviderInput)
    })
    if (saved) toast.success('Provider removed.')
  }

  const makeDefault = async (provider: ProviderPublic): Promise<void> => {
    await saveSettings({
      defaultProviderId: provider.id,
      defaultModel: provider.models[0] ?? ''
    })
    toast.success(`${provider.name} is now the default.`)
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[10.5px] text-faint">
          <ShieldCheck size={11} />
          Keys are sealed with your OS keychain and never reach the interface.
        </p>
        <Button variant="primary" size="sm" onClick={openCreate}>
          <Plus size={13} />
          Add provider
        </Button>
      </div>

      <div className="space-y-2.5">
        {settings.providers.length === 0 ? (
          <div className="card flex flex-col items-center px-6 py-12 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink">
              <Cpu size={19} />
            </div>
            <p className="mt-3 text-[13px] font-medium">No model provider yet</p>
            <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-faint">
              Add an Anthropic key, an OpenAI key, or point Knight at any OpenAI-compatible
              endpoint such as LM Studio, Ollama, or OpenRouter.
            </p>
            <Button variant="primary" size="sm" className="mt-4" onClick={openCreate}>
              <Plus size={13} />
              Connect a model
            </Button>
          </div>
        ) : (
          settings.providers.map((provider) => {
            const meta = kindMeta(provider.kind)
            const Icon = meta.icon
            const isDefault = settings.defaultProviderId === provider.id
            return (
              <div key={provider.id} className="card overflow-hidden">
                <div className="flex items-start gap-3 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2 text-accent-ink">
                    <Icon size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="truncate text-[13px] font-semibold">{provider.name}</h3>
                      <span className="rounded-full border border-line bg-canvas px-1.5 py-0.5 text-[9.5px] font-medium text-muted">
                        {meta.label}
                      </span>
                      {isDefault ? (
                        <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[9.5px] font-medium text-accent-ink">
                          Default
                        </span>
                      ) : null}
                      {!provider.enabled ? (
                        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[9.5px] font-medium text-faint">
                          Disabled
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-faint">
                      {provider.baseUrl || (
                        provider.kind === 'anthropic'
                          ? 'api.anthropic.com'
                          : provider.kind === 'openai'
                            ? 'api.openai.com'
                            : 'Custom endpoint'
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Toggle
                      checked={provider.enabled}
                      onChange={(checked) => void toggleProvider(provider, checked)}
                      label={`Enable ${provider.name}`}
                    />
                    <IconButton onClick={() => openEdit(provider)} aria-label="Edit provider">
                      <Pencil size={13.5} />
                    </IconButton>
                    <IconButton
                      onClick={() => void removeProvider(provider)}
                      aria-label="Remove provider"
                      className="hover:text-danger"
                    >
                      <Trash2 size={13.5} />
                    </IconButton>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1 px-4">
                  {provider.models.slice(0, 8).map((model) => (
                    <span
                      key={model}
                      className={cn(
                        'rounded-md border px-1.5 py-0.5 font-mono text-[10px]',
                        isDefault && settings.defaultModel === model
                          ? 'border-accent/30 bg-accent-soft/50 text-accent-ink'
                          : 'border-line bg-canvas text-muted'
                      )}
                    >
                      {model}
                    </span>
                  ))}
                  {provider.models.length > 8 ? (
                    <span className="px-1 py-0.5 text-[10px] text-faint">
                      +{provider.models.length - 8} more
                    </span>
                  ) : null}
                  {provider.models.length === 0 ? (
                    <span className="text-[11px] text-faint">No models listed</span>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line bg-canvas/40 px-4 py-2">
                  <span className="flex items-center gap-1.5 text-[10.5px] text-faint">
                    <KeyRound size={11} className={provider.hasKey ? 'text-positive' : 'text-warn'} />
                    {provider.hasKey ? 'API key saved' : 'No API key'}
                  </span>
                  {!isDefault ? (
                    <button
                      onClick={() => void makeDefault(provider)}
                      className="text-[10.5px] font-medium text-muted transition-colors hover:text-ink"
                    >
                      Make default
                    </button>
                  ) : (
                    <span className="text-[10.5px] text-faint">Used for new tasks</span>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {modalOpen ? (
        <ProviderModal provider={editing} onClose={() => setModalOpen(false)} />
      ) : null}
    </div>
  )
}

function ProviderModal({
  provider,
  onClose
}: {
  provider: ProviderPublic | null
  onClose: () => void
}) {
  const settings = useApp((state) => state.settings)
  const saveSettings = useApp((state) => state.saveSettings)

  const [name, setName] = useState(provider?.name ?? '')
  const [kind, setKind] = useState<ProviderKind>(provider?.kind ?? 'anthropic')
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [modelsText, setModelsText] = useState(provider?.models.join('\n') ?? '')
  const [enabled, setEnabled] = useState(provider?.enabled ?? true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const meta = kindMeta(kind)
  const Icon = meta.icon
  const models = modelsText
    .split(/[\n,]/)
    .map((model) => model.trim())
    .filter(Boolean)

  const buildInput = (): ProviderInput => ({
    id: provider?.id,
    name: name.trim() || meta.label,
    kind,
    baseUrl: baseUrl.trim() || undefined,
    models,
    enabled,
    apiKey: apiKey.trim() || undefined
  })

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.knight.testProvider(buildInput())
      setTestResult({ ok: result.ok, message: result.message })
      if (result.ok && models.length === 0 && result.models?.length) {
        setModelsText(result.models.slice(0, 40).join('\n'))
        toast.success('Models loaded from the provider.')
      }
    } catch (caught) {
      setTestResult({ ok: false, message: errorMessage(caught) })
    } finally {
      setTesting(false)
    }
  }

  const fetchModels = async (): Promise<void> => {
    setFetching(true)
    try {
      const result = await window.knight.fetchModels(buildInput())
      if (!result.length) {
        toast.error('The provider returned no models.')
        return
      }
      setModelsText(result.join('\n'))
      toast.success(`Loaded ${result.length} model${result.length === 1 ? '' : 's'}.`)
    } catch (caught) {
      toast.error(errorMessage(caught))
    } finally {
      setFetching(false)
    }
  }

  const submit = async (): Promise<void> => {
    setError(null)
    if (!name.trim()) {
      setError('Give this provider a name.')
      return
    }
    if (!models.length) {
      setError('Add at least one model ID.')
      return
    }
    if (!provider?.hasKey && !apiKey.trim()) {
      setError('Add an API key for this provider.')
      return
    }
    if (kind === 'compatible' && !baseUrl.trim()) {
      setError('A base URL is required for compatible providers.')
      return
    }
    if (!settings) return

    setSaving(true)
    try {
      const beforeIds = new Set(settings.providers.map((item) => item.id))
      const list = settings.providers.map(toProviderInput)
      const input = buildInput()
      const index = list.findIndex((item) => item.id === provider?.id)
      if (index >= 0) list[index] = input
      else list.push(input)

      const saved = await saveSettings({ providers: list })
      if (!saved) throw new Error('Could not save this provider.')

      if (!saved.defaultProviderId && enabled) {
        const created = saved.providers.find(
          (item) => (provider ? item.id === provider.id : !beforeIds.has(item.id))
        )
        if (created) {
          await saveSettings({
            defaultProviderId: created.id,
            defaultModel: created.models[0] ?? ''
          })
        }
      }

      toast.success(provider ? 'Provider updated.' : 'Provider connected.')
      onClose()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-[560px]"
      icon={<Icon size={17} />}
      title={provider ? 'Edit provider' : 'Add a model provider'}
      subtitle="Knight talks to providers directly from this device."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" loading={saving} onClick={() => void submit()}>
            {provider ? 'Save changes' : 'Connect provider'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FieldGroup label="Provider type">
          <div className="grid gap-2 sm:grid-cols-3">
            {PROVIDER_KINDS.map((option) => {
              const OptionIcon = option.icon
              const active = kind === option.value
              return (
                <button
                  key={option.value}
                  onClick={() => setKind(option.value)}
                  className={cn(
                    'rounded-xl border px-2.5 py-2.5 text-left transition-colors',
                    active
                      ? 'border-accent/50 bg-accent-soft/25'
                      : 'border-line hover:border-line-strong'
                  )}
                >
                  <OptionIcon
                    size={14}
                    className={active ? 'text-accent' : 'text-muted'}
                  />
                  <span className="mt-1.5 block text-[12px] font-medium">{option.label}</span>
                  <span className="mt-0.5 block text-[10px] text-faint">{option.blurb}</span>
                </button>
              )
            })}
          </div>
        </FieldGroup>

        <FieldGroup label="Name">
          <input
            className="field"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
        </FieldGroup>

        <FieldGroup
          label="Base URL"
          hint={kind === 'compatible' ? 'Required' : 'Optional'}
        >
          <input
            className="field"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            spellCheck={false}
          />
        </FieldGroup>

        <FieldGroup
          label="API key"
          hint={provider?.hasKey ? 'A key is already saved' : undefined}
        >
          <div className="relative">
            <input
              className="field pr-10"
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={provider?.hasKey ? 'Leave blank to keep the saved key' : undefined}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowKey((value) => !value)}
              className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-1 text-faint hover:text-ink"
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
            >
              {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
          <p className="mt-1.5 flex items-center gap-1 text-[10.5px] text-faint">
            <ShieldCheck size={11} />
            Encrypted with your OS keychain. Never sent to the interface.
          </p>
        </FieldGroup>

        <FieldGroup
          label="Models"
          hint="One model ID per line"
          className="pt-1"
        >
          <textarea
            className="field min-h-[92px] font-mono text-[11.5px]"
            value={modelsText}
            onChange={(event) => setModelsText(event.target.value)}
            spellCheck={false}
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={fetching}
              onClick={() => void fetchModels()}
            >
              <RefreshCw size={12} />
              Fetch models
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={testing}
              onClick={() => void runTest()}
            >
              Test connection
            </Button>
            <span className="text-[10.5px] text-faint">
              {models.length} model{models.length === 1 ? '' : 's'} listed
            </span>
          </div>
        </FieldGroup>

        {testResult ? (
          <div
            className={cn(
              'flex items-start gap-2 rounded-xl border px-3 py-2 text-[11.5px] leading-relaxed',
              testResult.ok
                ? 'border-positive/25 bg-positive/5 text-positive'
                : 'border-danger/25 bg-danger/5 text-danger'
            )}
          >
            {testResult.ok ? (
              <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            )}
            <span>{testResult.message}</span>
          </div>
        ) : null}

        {error ? (
          <div className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/5 px-3 py-2 text-[11.5px] leading-relaxed text-danger">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-canvas/50 px-3.5 py-2.5">
          <div>
            <p className="text-[12px] font-medium">Enable provider</p>
            <p className="text-[10.5px] text-faint">Show its models in the composer.</p>
          </div>
          <Toggle checked={enabled} onChange={setEnabled} label="Enable provider" />
        </div>
      </div>
    </Modal>
  )
}

const STATUS_META: Record<
  McpServerStatus['status'],
  { label: string; className: string; dot: string }
> = {
  stopped: {
    label: 'Stopped',
    className: 'border-line bg-surface-2 text-faint',
    dot: 'bg-faint'
  },
  starting: {
    label: 'Starting',
    className: 'border-warn/25 bg-warn/10 text-warn',
    dot: 'bg-warn'
  },
  ready: {
    label: 'Connected',
    className: 'border-positive/25 bg-positive/10 text-positive',
    dot: 'bg-positive'
  },
  error: {
    label: 'Failed',
    className: 'border-danger/25 bg-danger/10 text-danger',
    dot: 'bg-danger'
  }
}

function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index > 0) {
      env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim()
    }
  }
  return env
}

function McpTools({
  status,
  allowlist
}: {
  status: McpServerStatus
  allowlist?: string[]
}) {
  const [query, setQuery] = useState('')
  const allowed = allowlist?.length ? new Set(allowlist) : null
  const normalized = query.trim().toLowerCase()
  const tools = normalized
    ? status.tools.filter(
        (tool) =>
          tool.name.toLowerCase().includes(normalized) ||
          tool.description?.toLowerCase().includes(normalized)
      )
    : status.tools

  if (status.status === 'error') {
    return (
      <pre className="scroll-thin mt-2 max-h-36 overflow-auto rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap text-danger/90">
        {status.error || 'The server did not start.'}
      </pre>
    )
  }

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-line bg-canvas/60">
      <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter tools"
          className="h-6 min-w-0 flex-1 bg-transparent text-[11px] text-ink outline-none placeholder:text-faint"
        />
        <span className="text-[10px] text-faint">
          {tools.length}/{status.tools.length}
        </span>
      </div>
      <div className="scroll-thin max-h-60 overflow-y-auto p-1">
        {tools.length === 0 ? (
          <p className="px-2 py-3 text-[11px] text-faint">
            {status.status === 'starting'
              ? 'Waiting for the server to report its tools…'
              : 'No tools match this filter.'}
          </p>
        ) : (
          tools.map((tool) => {
            const exposed = !allowed || allowed.has(tool.name)
            return (
              <div
                key={tool.name}
                className={cn(
                  'rounded-lg px-2 py-1.5',
                  exposed ? 'hover:bg-surface-2/60' : 'opacity-45'
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[10.5px] font-medium text-ink">{tool.name}</span>
                  {exposed ? (
                    <Check size={10} className="shrink-0 text-positive" />
                  ) : (
                    <span className="text-[9px] text-faint">hidden</span>
                  )}
                </div>
                {tool.description ? (
                  <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-relaxed text-faint">
                    {tool.description}
                  </p>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function McpServerCard({
  config,
  status,
  onEdit,
  onRemove,
  onToggle,
  onRestart
}: {
  config: McpServerConfig
  status?: McpServerStatus
  onEdit: () => void
  onRemove: () => void
  onToggle: (enabled: boolean) => void
  onRestart: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const state = status?.status ?? 'stopped'
  const meta = STATUS_META[state]
  const toolCount = status?.tools.length ?? 0
  const allowCount = config.toolAllowlist?.length ?? 0
  const Icon = config.preset === 'rea' ? Boxes : ServerCog

  return (
    <div className="card overflow-hidden">
      <div className="flex items-start gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2 text-accent-ink">
          <Icon size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-[13px] font-semibold">{config.name}</h3>
            {config.preset === 'rea' ? (
              <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[9.5px] font-medium text-accent-ink">
                REA preset
              </span>
            ) : null}
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9.5px] font-medium',
                meta.className
              )}
            >
              {state === 'starting' ? (
                <Loader2 size={9} className="animate-spin" />
              ) : (
                <span className={cn('h-1 w-1 rounded-full', meta.dot)} />
              )}
              {meta.label}
            </span>
          </div>
          <p className="mt-0.5 truncate font-mono text-[10.5px] text-faint">
            {config.command} {config.args.join(' ')}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Toggle
            checked={config.enabled}
            onChange={onToggle}
            label={`Enable ${config.name}`}
          />
          <IconButton onClick={onRestart} aria-label="Restart server" disabled={!config.enabled}>
            <RefreshCw size={13} />
          </IconButton>
          <IconButton onClick={onEdit} aria-label="Edit server">
            <Pencil size={13} />
          </IconButton>
          <IconButton
            onClick={onRemove}
            aria-label="Remove server"
            className="hover:text-danger"
          >
            <Trash2 size={13} />
          </IconButton>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-canvas/40 px-4 py-2">
        <div className="flex items-center gap-2 text-[10.5px] text-faint">
          {state === 'ready' ? (
            <span>
              {toolCount} tool{toolCount === 1 ? '' : 's'} available
              {allowCount ? ` · ${allowCount} exposed to Knight` : ' · all tools exposed'}
            </span>
          ) : state === 'error' ? (
            <span className="text-danger">Could not start this server.</span>
          ) : state === 'starting' ? (
            <span>Starting server…</span>
          ) : (
            <span>{config.enabled ? 'Not connected yet.' : 'Server is disabled.'}</span>
          )}
        </div>
        {state !== 'stopped' || status?.error ? (
          <button
            onClick={() => setExpanded((value) => !value)}
            className="flex items-center gap-1 text-[10.5px] font-medium text-muted hover:text-ink"
          >
            {expanded ? 'Hide tools' : 'Inspect tools'}
            <span
              className={cn(
                'inline-block transition-transform',
                expanded ? 'rotate-180' : ''
              )}
            >
              ▾
            </span>
          </button>
        ) : null}
      </div>

      {expanded && status ? (
        <div className="border-t border-line px-3 pt-2 pb-3">
          <McpTools status={status} allowlist={config.toolAllowlist} />
        </div>
      ) : null}
    </div>
  )
}

function McpTab() {
  const [configs, setConfigs] = useState<McpServerConfig[]>([])
  const [statuses, setStatuses] = useState<McpServerStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<McpServerConfig | null>(null)
  const [addingRea, setAddingRea] = useState(false)

  const refreshConfigs = async (): Promise<void> => {
    const settings = await window.knight.getSettings()
    setConfigs(settings.mcpServers)
  }

  const refresh = async (): Promise<void> => {
    const [settings, list] = await Promise.all([
      window.knight.getSettings(),
      window.knight.listMcp()
    ])
    setConfigs(settings.mcpServers)
    setStatuses(list)
  }

  useEffect(() => {
    let alive = true
    void refresh()
      .catch((caught) => {
        if (alive) toast.error(errorMessage(caught))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!statuses.some((status) => status.status === 'starting')) return
    const timer = window.setInterval(() => {
      void window.knight
        .listMcp()
        .then(setStatuses)
        .catch(() => undefined)
    }, 2500)
    return () => window.clearInterval(timer)
  }, [statuses])

  const addRea = async (): Promise<void> => {
    setAddingRea(true)
    try {
      const list = await window.knight.addReaPreset()
      setStatuses(list)
      await refreshConfigs()
    } catch (caught) {
      toast.error(errorMessage(caught))
    } finally {
      setAddingRea(false)
    }
  }

  const submitServer = (config: McpServerConfig): void => {
    setModalOpen(false)
    setEditing(null)
    setConfigs((current) => {
      const index = current.findIndex((item) => item.id === config.id)
      if (index < 0) return [...current, config]
      return current.map((item) => (item.id === config.id ? config : item))
    })
    setStatuses((current) => {
      const entry: McpServerStatus = {
        id: config.id,
        name: config.name,
        status: config.enabled ? 'starting' : 'stopped',
        tools: []
      }
      const exists = current.some((item) => item.id === config.id)
      return exists
        ? current.map((item) => (item.id === config.id ? { ...item, ...entry } : item))
        : [...current, entry]
    })
    void window.knight
      .upsertMcp(config)
      .then(async (list) => {
        setStatuses(list)
        await refreshConfigs()
      })
      .catch((caught) => toast.error(errorMessage(caught)))
  }

  const toggleServer = (config: McpServerConfig, enabled: boolean): void => {
    const next = { ...config, enabled }
    setConfigs((current) => current.map((item) => (item.id === config.id ? next : item)))
    setStatuses((current) =>
      current.map((item) =>
        item.id === config.id
          ? { ...item, status: enabled ? 'starting' : 'stopped', tools: [] }
          : item
      )
    )
    void window.knight
      .upsertMcp(next)
      .then(async (list) => {
        setStatuses(list)
        await refreshConfigs()
      })
      .catch((caught) => toast.error(errorMessage(caught)))
  }

  const restartServer = (config: McpServerConfig): void => {
    setStatuses((current) =>
      current.map((item) =>
        item.id === config.id ? { ...item, status: 'starting', tools: [], error: undefined } : item
      )
    )
    void window.knight
      .restartMcp(config.id)
      .then(setStatuses)
      .catch((caught) => toast.error(errorMessage(caught)))
  }

  const removeServer = async (config: McpServerConfig): Promise<void> => {
    if (!window.confirm(`Remove MCP server “${config.name}”?`)) return
    try {
      await window.knight.removeMcp(config.id)
      await refresh()
      toast.success('MCP server removed.')
    } catch (caught) {
      toast.error(errorMessage(caught))
    }
  }

  const hasRea = configs.some((config) => config.preset === 'rea' || config.id === 'mcp-rea')

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[10.5px] text-faint">
          <Plug size={11} />
          Servers run locally over stdio. Add only what you trust.
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setEditing(null)
            setModalOpen(true)
          }}
        >
          <Plus size={13} />
          Add server
        </Button>
      </div>

      <div className="rounded-2xl border border-accent/25 bg-accent-soft/25 p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-surface text-accent">
            <Boxes size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="text-[12.5px] font-semibold">Reverse Engineer Anything</p>
              <span className="rounded-full border border-line bg-surface/70 px-1.5 py-0.5 text-[9.5px] font-medium text-muted">
                REA · 200+ tools
              </span>
            </div>
            <p className="mt-1 max-w-[560px] text-[11.5px] leading-relaxed text-muted">
              Inspect binaries, Electron apps, .NET assemblies, and websites. Knight exposes a
              curated set of 20 analysis tools by default. Only analyze software you are authorized
              to inspect.
            </p>
          </div>
          <Button
            variant={hasRea ? 'secondary' : 'primary'}
            size="sm"
            loading={addingRea}
            onClick={() => void addRea()}
          >
            {hasRea ? <RefreshCw size={12} /> : <Plus size={12} />}
            {hasRea ? 'Reconnect' : 'Add REA preset'}
          </Button>
        </div>
      </div>

      <div className="mt-3 space-y-2.5">
        {loading ? (
          <div className="card flex items-center justify-center gap-2 py-12 text-[12px] text-faint">
            <Spin size={13} />
            Reading installed servers…
          </div>
        ) : configs.length === 0 ? (
          <div className="card flex flex-col items-center px-6 py-10 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-muted">
              <Plug size={17} />
            </div>
            <p className="mt-3 text-[12.5px] font-medium">No MCP servers installed</p>
            <p className="mt-1 max-w-sm text-[11.5px] leading-relaxed text-faint">
              Add the REA preset above, or connect any stdio MCP server with its command, arguments,
              and environment variables.
            </p>
          </div>
        ) : (
          configs.map((config) => (
            <McpServerCard
              key={config.id}
              config={config}
              status={statuses.find((status) => status.id === config.id)}
              onEdit={() => {
                setEditing(config)
                setModalOpen(true)
              }}
              onRemove={() => void removeServer(config)}
              onToggle={(enabled) => toggleServer(config, enabled)}
              onRestart={() => restartServer(config)}
            />
          ))
        )}
      </div>

      <div className="mt-6 flex items-start gap-2 rounded-xl border border-line bg-canvas-deep/40 px-3.5 py-3 text-[11px] leading-relaxed text-faint">
        <Info size={13} className="mt-0.5 shrink-0" />
        <p>
          MCP servers run as local processes on your machine. Only add servers from sources you
          trust. Tool calls follow the same permission rules as built-in tools.
        </p>
      </div>

      {modalOpen ? (
        <McpServerModal
          config={editing}
          onClose={() => {
            setModalOpen(false)
            setEditing(null)
          }}
          onSave={submitServer}
        />
      ) : null}
    </div>
  )
}

function McpServerModal({
  config,
  onClose,
  onSave
}: {
  config: McpServerConfig | null
  onClose: () => void
  onSave: (config: McpServerConfig) => void
}) {
  const [name, setName] = useState(config?.name ?? '')
  const [command, setCommand] = useState(config?.command ?? 'npx')
  const [args, setArgs] = useState((config?.args ?? []).join('\n'))
  const [env, setEnv] = useState(
    Object.entries(config?.env ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')
  )
  const [allowlist, setAllowlist] = useState((config?.toolAllowlist ?? []).join('\n'))
  const [enabled, setEnabled] = useState(config?.enabled ?? true)
  const [error, setError] = useState<string | null>(null)

  const submit = (): void => {
    setError(null)
    if (!name.trim()) {
      setError('Give this server a name.')
      return
    }
    if (!command.trim()) {
      setError('Add the command that starts this server.')
      return
    }
    const parsedAllowlist = allowlist
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
    onSave({
      id: config?.id ?? `mcp-${crypto.randomUUID()}`,
      name: name.trim(),
      command: command.trim(),
      args: args
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean),
      env: parseEnv(env),
      enabled,
      preset: config?.preset,
      toolAllowlist: parsedAllowlist.length ? parsedAllowlist : undefined
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-[560px]"
      icon={<Plug size={17} />}
      title={config ? 'Edit MCP server' : 'Add MCP server'}
      subtitle="Knight launches the server over stdio and discovers its tools."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={submit}>
            {config ? 'Save server' : 'Add server'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FieldGroup label="Name">
          <input
            className="field"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
        </FieldGroup>
        <FieldGroup label="Command">
          <input
            className="field font-mono text-[12px]"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            spellCheck={false}
          />
        </FieldGroup>
        <FieldGroup label="Arguments" hint="One per line">
          <textarea
            className="field min-h-[80px] font-mono text-[11.5px]"
            value={args}
            onChange={(event) => setArgs(event.target.value)}
            spellCheck={false}
          />
        </FieldGroup>
        <FieldGroup label="Environment" hint="KEY=VALUE, one per line">
          <textarea
            className="field min-h-[64px] font-mono text-[11.5px]"
            value={env}
            onChange={(event) => setEnv(event.target.value)}
            spellCheck={false}
          />
        </FieldGroup>
        <FieldGroup
          label="Tool allowlist"
          hint="Optional — blank exposes every tool"
        >
          <textarea
            className="field min-h-[64px] font-mono text-[11.5px]"
            value={allowlist}
            onChange={(event) => setAllowlist(event.target.value)}
            spellCheck={false}
          />
        </FieldGroup>

        {error ? (
          <div className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/5 px-3 py-2 text-[11.5px] leading-relaxed text-danger">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-canvas/50 px-3.5 py-2.5">
          <div>
            <p className="text-[12px] font-medium">Start automatically</p>
            <p className="text-[10.5px] text-faint">Connect this server when Knight launches.</p>
          </div>
          <Toggle checked={enabled} onChange={setEnabled} label="Start server automatically" />
        </div>
      </div>
    </Modal>
  )
}

function ProfilePane({ settings }: { settings: PublicSettings }) {
  const profile = useLocalProfile()
  const tasks = useApp((state) => state.tasks)
  const openSettings = useApp((state) => state.openSettings)
  const [draft, setDraft] = useState(profile)
  const [saving, setSaving] = useState(false)
  const [usage, setUsage] = useState<UsageSummary | null>(null)

  useEffect(() => setDraft(profile), [profile])

  useEffect(() => {
    window.knight
      .getUsageSummary()
      .then(setUsage)
      .catch(() => undefined)
  }, [])

  const sessions = useMemo(() => buildActivity(tasks, 'sessions'), [tasks])
  const permission = permissionChoice(settings.defaultPermissionMode)
  const hasModel = settings.providers.some((provider) => provider.enabled && provider.models.length > 0)
  const dirty =
    draft.name !== profile.name || draft.role !== profile.role || draft.email !== profile.email

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      saveLocalProfile(draft)
      toast.success('Profile saved on this device.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-9">
      <div className="card relative overflow-hidden p-5">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-32 opacity-70"
          style={{
            background:
              'radial-gradient(ellipse 65% 100% at 15% 0%, var(--c-accent-soft) 0%, transparent 78%)'
          }}
        />
        <div className="relative flex flex-wrap items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-line bg-surface-3 text-[18px] font-semibold text-accent-ink">
            {profileInitial(profile)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="display text-[20px] leading-tight text-ink">{profile.name}</h2>
              <span className="rounded-full border border-gold/20 bg-gold-soft/60 px-2 py-0.5 text-[9.5px] font-medium text-gold">
                Owner
              </span>
            </div>
            <p className="mt-0.5 text-[11.5px] text-muted">
              {profile.role} · {profile.email}
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-canvas/70 px-2.5 py-1 text-[10px] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-positive" /> Local
          </span>
        </div>
      </div>

      <section>
        <div className="mb-2.5 flex items-end justify-between gap-4">
          <h2 className="text-[12.5px] font-medium text-faint">Usage</h2>
          <button
            onClick={() => openSettings('task-monitor')}
            className="text-[11px] text-muted transition-colors hover:text-ink"
          >
            All tasks
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: 'Tokens', value: compactNumber(usage?.totals.total ?? 0) },
            { label: 'Model calls', value: compactNumber(usage?.totals.calls ?? 0) },
            { label: 'Sessions', value: String(sessions.stats.total) },
            { label: 'Day streak', value: `${sessions.stats.streak}d` }
          ].map((stat) => (
            <div key={stat.label} className="card px-3.5 py-3">
              <p className="font-mono text-[20px] leading-7 text-ink">{stat.value}</p>
              <p className="mt-0.5 text-[9.5px] text-faint">{stat.label}</p>
            </div>
          ))}
        </div>
        {usage && usage.byAgent.length > 0 ? (
          <div className="mt-2 space-y-1.5">
            {usage.byAgent.slice(0, 4).map((agent) => (
              <div
                key={agent.agentId}
                className="flex items-center justify-between gap-4 rounded-lg border border-line bg-surface px-3 py-2"
              >
                <span className="min-w-0 truncate text-[11.5px] text-muted">{agent.agentId}</span>
                <span className="shrink-0 font-mono text-[10.5px] text-faint">
                  {compactNumber(agent.total)} tokens · {agent.calls} calls
                </span>
              </div>
            ))}
          </div>
        ) : usage ? (
          <p className="mt-2 text-[10.5px] text-faint">No model calls recorded on this device yet.</p>
        ) : null}
      </section>

      <SettingsSection
        title="Details"
        action={
          <Button
            size="sm"
            variant={dirty ? 'primary' : 'secondary'}
            disabled={!dirty}
            loading={saving}
            onClick={() => void save()}
          >
            Save
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldGroup label="Display name">
            <input
              className="field"
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
            />
          </FieldGroup>
          <FieldGroup label="Role">
            <input
              className="field"
              value={draft.role}
              onChange={(event) =>
                setDraft((current) => ({ ...current, role: event.target.value }))
              }
            />
          </FieldGroup>
          <FieldGroup label="Email or handle" className="sm:col-span-2">
            <input
              className="field"
              value={draft.email}
              onChange={(event) =>
                setDraft((current) => ({ ...current, email: event.target.value }))
              }
            />
          </FieldGroup>
        </div>
      </SettingsSection>

      <SettingsSection title="Account">
        <div className="divide-y divide-line">
          <div className="flex items-center justify-between gap-4 py-2.5 first:pt-0">
            <span className="text-[12px] text-muted">Mode</span>
            <span className="text-[12px] font-medium text-ink">Self · this device</span>
          </div>
          <div className="flex items-center justify-between gap-4 py-2.5">
            <span className="text-[12px] text-muted">Default permission</span>
            <button
              onClick={() => openSettings('permissions')}
              className="text-[12px] font-medium text-ink hover:text-accent-ink"
            >
              {permission.label}
            </button>
          </div>
          <div className="flex items-center justify-between gap-4 py-2.5 last:pb-0">
            <span className="text-[12px] text-muted">Execution engine</span>
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
              <span
                className={cn('h-1 w-1 rounded-full', hasModel ? 'bg-positive' : 'bg-warn')}
              />
              Local engine · {hasModel ? 'ready' : 'needs a model'}
            </span>
          </div>
        </div>
      </SettingsSection>
    </div>
  )
}

function ModeConfigPane({ settings }: { settings: PublicSettings }) {
  const openSettings = useApp((state) => state.openSettings)
  const openSurface = useApp((state) => state.openSurface)
  const permission = permissionChoice(settings.defaultPermissionMode)
  const modes = [
    {
      name: 'Self',
      tag: 'One machine',
      icon: ChessKnight,
      blurb: 'One person. Chat and Company, private to this laptop.',
      points: [
        'Captain → Consul → Adept → Crew.',
        'Your key turns every local gate.'
      ],
      actionLabel: 'Open Chat',
      onOpen: () => openSurface('chat')
    },
    {
      name: 'Collab',
      tag: 'Two machines',
      icon: Handshake,
      blurb: 'Two people, each running their own Captain and engine.',
      points: [
        'Captains meet as peers at the Table.',
        'Joint actions need both keys.'
      ],
      actionLabel: 'Open Table',
      onOpen: () => openSurface('table')
    }
  ]

  return (
    <div className="space-y-9">
      <div className="grid gap-3 lg:grid-cols-2">
        {modes.map((mode) => {
          const Icon = mode.icon
          return (
            <div key={mode.name} className="card flex flex-col p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2 text-accent">
                  <Icon size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[13.5px] font-semibold text-ink">{mode.name}</h3>
                    <span
                      className={cn(
                        'rounded-full border px-1.5 py-0.5 text-[8.5px] font-medium',
                        mode.name === 'Self'
                          ? 'border-gold/25 bg-gold-soft/60 text-gold'
                          : 'border-identity-a/25 bg-identity-a/10 text-identity-a'
                      )}
                    >
                      {mode.tag}
                    </span>
                  </div>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{mode.blurb}</p>
                </div>
              </div>
              <ul className="mt-3 space-y-1.5">
                {mode.points.map((point) => (
                  <li
                    key={point}
                    className="flex items-start gap-2 text-[11px] leading-relaxed text-muted"
                  >
                    <Check size={11} className="mt-0.5 shrink-0 text-positive" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-3">
                <Button size="sm" variant="secondary" onClick={mode.onOpen}>
                  {mode.actionLabel}
                  <ChevronRight size={12} />
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      <SettingsSection title="Default permission">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 text-accent">
            <ShieldCheck size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-medium text-ink">{permission.label}</p>
            <p className="text-[11px] text-muted">{permission.blurb}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => openSettings('permissions')}>
            Change
            <ChevronRight size={12} />
          </Button>
        </div>
      </SettingsSection>

    </div>
  )
}

function TaskMonitorPane() {
  const tasks = useApp((state) => state.tasks)
  const openTask = useApp((state) => state.openTask)
  const openSurface = useApp((state) => state.openSurface)

  return (
    <div className="space-y-9">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Total', value: tasks.length },
          { label: 'Running', value: tasks.filter((task) => task.status === 'running').length },
          { label: 'Waiting', value: tasks.filter((task) => task.status === 'waiting').length },
          { label: 'Done', value: tasks.filter((task) => task.status === 'done').length }
        ].map((stat) => (
          <div key={stat.label} className="card px-3.5 py-3">
            <p className="font-mono text-[20px] leading-7 text-ink">{stat.value}</p>
            <p className="mt-0.5 text-[9.5px] tracking-[0.09em] text-faint uppercase">
              {stat.label}
            </p>
          </div>
        ))}
      </div>

      <SettingsSection
        title="Local tasks"
        description="Read from this machine's task store. Only tasks you actually start appear here."
        action={
          tasks.length ? (
            <Button size="sm" variant="secondary" onClick={() => openSurface('chat')}>
              Open Chat
            </Button>
          ) : undefined
        }
      >
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-faint">
              <Activity size={17} />
            </span>
            <p className="text-[12.5px] font-medium text-ink">Nothing has run yet</p>
            <p className="max-w-[320px] text-[11px] leading-relaxed text-faint">
              When a task starts, its state and receipts appear here.
            </p>
            <Button size="sm" variant="primary" className="mt-1" onClick={startNewTask}>
              Start a task
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {tasks.map((task) => (
              <button
                key={task.id}
                onClick={() => void openTask(task.id)}
                className="group flex w-full items-center gap-3 py-2.5 text-left first:pt-0 last:pb-0"
              >
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TASK_DOT[task.status])} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-ink">{task.title}</span>
                  <span className="mt-0.5 block text-[10px] text-faint">
                    {statusLabel(task.status)} · updated {timeAgo(task.updatedAt)}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] text-faint">
                  {task.artifactsCount} receipt{task.artifactsCount === 1 ? '' : 's'}
                </span>
                <ChevronRight
                  size={13}
                  className="shrink-0 text-faint transition-colors group-hover:text-ink"
                />
              </button>
            ))}
          </div>
        )}
      </SettingsSection>
    </div>
  )
}

const SHORTCUT_GROUPS = [
  {
    title: 'Global',
    description: 'Work anywhere in the app.',
    rows: [
      { label: 'New task', keys: ['Ctrl', 'N'] },
      { label: 'Search settings', keys: ['Ctrl', 'K'] },
      { label: 'Toggle sidebar', keys: ['Ctrl', 'B'] },
      { label: 'Open Chat', keys: ['Ctrl', '1'] },
      { label: 'Open Company', keys: ['Ctrl', '2'] },
      { label: 'Open Table', keys: ['Ctrl', '3'] },
      { label: 'Open settings', keys: ['Ctrl', ','] }
    ]
  },
  {
    title: 'Composer',
    description: 'While the cursor is in a message box.',
    rows: [
      { label: 'Send', keys: ['Enter'] },
      { label: 'New line', keys: ['Shift', 'Enter'] },
      { label: 'Close a menu', keys: ['Esc'] }
    ]
  }
]

function ShortcutsPane() {
  return (
    <div className="space-y-9">
      {SHORTCUT_GROUPS.map((group) => (
        <SettingsSection
          key={group.title}
          title={group.title}
          description={group.description}
        >
          <div className="grid gap-x-10 gap-y-2.5 sm:grid-cols-2">
            {group.rows.map((shortcut) => (
              <div
                key={shortcut.label}
                className="flex items-center justify-between gap-3 py-1"
              >
                <span className="text-[11.5px] text-muted">{shortcut.label}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {shortcut.keys.map((key) => (
                    <kbd
                      key={key}
                      className="rounded-[5px] border border-line bg-canvas px-1.5 py-0.5 font-sans text-[9.5px] font-medium text-muted"
                    >
                      {key}
                    </kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </SettingsSection>
      ))}
    </div>
  )
}

const AGENT_SEATS = [
  {
    name: 'Captain',
    role: 'The one voice',
    detail: 'The only seat you message. Holds the plan, speaks for the company, signs receipts.',
    icon: ChessKnight,
    tag: 'You talk here'
  },
  {
    name: 'Consul',
    role: 'Interpreter',
    detail: 'Reads the request, shapes the plan, and carries messages between Captain and Adept.',
    icon: Building2,
    tag: 'Internal'
  },
  {
    name: 'Adept',
    role: 'Executor',
    detail: 'Turns one step of the plan into action, then returns the result up the ladder.',
    icon: Cpu,
    tag: 'Internal'
  },
  {
    name: 'Crew',
    role: 'Hands and tools',
    detail: 'Files, shell and MCP tools, confined to the folders and gates the task allows.',
    icon: Terminal,
    tag: 'Internal'
  }
]

function AgentPane({ settings }: { settings: PublicSettings }) {
  const openSettings = useApp((state) => state.openSettings)

  const providers = settings.providers.filter((provider) => provider.enabled)
  const defaultProvider =
    providers.find((provider) => provider.id === settings.defaultProviderId) ?? providers[0]
  const defaultModel =
    defaultProvider?.id === settings.defaultProviderId && settings.defaultModel
      ? settings.defaultModel
      : defaultProvider?.models[0]
  const ready = Boolean(defaultProvider && defaultModel)

  return (
    <div className="space-y-9">
      <div className="card relative overflow-hidden p-6">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-36 opacity-60"
          style={{
            background:
              'radial-gradient(ellipse 60% 100% at 10% 0%, var(--c-gold-soft) 0%, transparent 75%)'
          }}
        />
        <div className="relative flex flex-wrap items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ink-button text-on-ink shadow-sm">
            <ChessKnight size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[14px] font-semibold text-ink">Captain</h2>
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9.5px] font-medium',
                  ready
                    ? 'border-positive/25 bg-positive/10 text-positive'
                    : 'border-warn/25 bg-warn/10 text-warn'
                )}
              >
                <span
                  className={cn('h-1 w-1 rounded-full', ready ? 'bg-positive' : 'bg-warn')}
                />
                {ready ? 'Ready' : 'Needs a model'}
              </span>
            </div>
            <p className="mt-1.5 max-w-[540px] text-[11.5px] leading-[1.7] text-muted">
              The one agent you message. Holds the plan and signs every receipt.
            </p>
            {ready ? (
              <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[10.5px] text-faint">
                <Cpu size={11} className="text-accent" />
                <span className="font-medium text-muted">{defaultProvider?.name}</span>
                <span className="text-faint/70">/</span>
                <span className="font-mono text-[10px]">{defaultModel}</span>
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => openSettings('providers')}>
                Models
                <ChevronRight size={12} />
              </Button>
              <Button size="sm" variant="secondary" onClick={() => openSettings('permissions')}>
                Permissions
                <ChevronRight size={12} />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <section>
        <h2 className="mb-2.5 text-[12.5px] font-medium text-faint">The ladder</h2>
        <div className="card divide-y divide-line">
          {AGENT_SEATS.map((seat, index) => {
            const Icon = seat.icon
            return (
              <div
                key={seat.name}
                className="flex flex-wrap items-center gap-3 px-5 py-3.5 first:pt-1.5 last:pb-1.5"
              >
                <span className="font-mono text-[9.5px] text-faint">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 text-muted">
                  <Icon size={14} />
                </span>
                <span className="w-[92px] shrink-0">
                  <span className="block text-[12.5px] font-medium text-ink">{seat.name}</span>
                  <span className="block text-[9.5px] text-faint">{seat.role}</span>
                </span>
                <span className="min-w-[180px] flex-1 text-[11px] leading-[1.65] text-muted">
                  {seat.detail}
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-full border px-2 py-0.5 text-[8.5px] font-medium tracking-[0.05em] uppercase',
                    seat.tag === 'You talk here'
                      ? 'border-gold/25 bg-gold-soft/50 text-gold'
                      : 'border-line bg-canvas/70 text-faint'
                  )}
                >
                  {seat.tag}
                </span>
              </div>
            )
          })}
        </div>
        <p className="mt-3 px-1 text-[11px] leading-relaxed text-faint">
          The Consul relays between the Captain and the Adept. No internal seat ever addresses you.
        </p>
      </section>

      <section>
        <h2 className="mb-2.5 text-[12.5px] font-medium text-faint">Gates and receipts</h2>
        <div className="card divide-y divide-line">
          <div className="flex items-start gap-3 px-4 py-3">
            <KeyRound size={13} className="mt-0.5 shrink-0 text-accent" />
            <p className="text-[11.5px] leading-relaxed text-muted">
              Your permission mode decides what runs. Table actions need both Captains.
            </p>
          </div>
          <div className="flex items-start gap-3 px-4 py-3">
            <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-positive" />
            <p className="text-[11.5px] leading-relaxed text-muted">
              Every finished step is attested in the local ledger.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}

function AgentTeamsPane() {
  const openSurface = useApp((state) => state.openSurface)
  const openSettings = useApp((state) => state.openSettings)

  return (
    <div className="space-y-9">
      <div className="card relative overflow-hidden p-5">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-32 opacity-50"
          style={{
            background:
              'radial-gradient(ellipse 60% 100% at 12% 0%, var(--c-identity-a) 0%, transparent 72%)'
          }}
        />
        <div className="relative flex flex-wrap items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2 text-identity-a">
            <Users size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[13.5px] font-semibold text-ink">Two Captains, one Table</h2>
            </div>
            <p className="mt-1 max-w-[520px] text-[11.5px] leading-[1.7] text-muted">
              Each side keeps its own engine, files and memory. The Table holds only what both bring.
            </p>
            <div className="mt-3.5 flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => openSurface('table')}>
                Open Table
                <ArrowRight size={12} />
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => openSettings('mode-config')}
              >
                Modes
              </Button>
            </div>
          </div>
        </div>
      </div>

      <section>
        <h2 className="mb-2.5 text-[12.5px] font-medium text-faint">A joint action</h2>
        <div className="card divide-y divide-line">
          {[
            {
              title: 'Propose',
              detail: 'The step, its files, and the expected outcome.'
            },
            {
              title: 'Review',
              detail: 'The other Captain sees the proposal, never the private task behind it.'
            },
            {
              title: 'Two keys',
              detail: 'Both approvals start the step. Each side writes its own receipt.'
            }
          ].map((step, index) => (
            <div key={step.title} className="flex items-start gap-3.5 px-5 py-4 first:pt-2 last:pb-2">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-canvas font-mono text-[9.5px] text-faint">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium text-ink">{step.title}</p>
                <p className="mt-1 max-w-[600px] text-[11px] leading-[1.65] text-muted">
                  {step.detail}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <SettingsSection title="The boundary">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.08em] text-positive uppercase">
              <CheckCircle2 size={11} />
              Crosses
            </p>
            <ul className="mt-2 space-y-1.5">
              {['Task title and proposal', 'Accept or decline decisions', 'Ledger receipts', 'Presence at the Table'].map(
                (line) => (
                  <li key={line} className="flex items-start gap-2 text-[11.5px] text-muted">
                    <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-positive/70" />
                    {line}
                  </li>
                )
              )}
            </ul>
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.08em] text-faint uppercase">
              <Lock size={11} />
              Stays home
            </p>
            <ul className="mt-2 space-y-1.5">
              {['Your files and folders', 'Memory and instructions', 'Model keys', 'Private tasks'].map(
                (line) => (
                  <li key={line} className="flex items-start gap-2 text-[11.5px] text-muted">
                    <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-line-strong" />
                    {line}
                  </li>
                )
              )}
            </ul>
          </div>
        </div>
      </SettingsSection>

      <p className="px-1 text-[11px] text-faint">
        A Table seats two Captains. Leaving it never moves either ledger.
      </p>
    </div>
  )
}

function AboutTab() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    void window.knight
      .getAppInfo()
      .then((value) => {
        if (alive) setInfo(value)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const copyPath = async (): Promise<void> => {
    if (!info) return
    await navigator.clipboard.writeText(info.userDataPath)
    setCopied(true)
    toast.success('Data folder copied.')
    window.setTimeout(() => setCopied(false), 1800)
  }

  const rows = info
    ? [
        { label: 'Version', value: info.version },
        {
          label: 'Platform',
          value:
            info.platform === 'win32'
              ? 'Windows'
              : info.platform === 'darwin'
                ? 'macOS'
                : info.platform
        },
        { label: 'Build', value: info.isDev ? 'Development' : 'Packaged' },
        { label: 'Execution engine', value: 'Local agent loop · TypeScript' },
        { label: 'Interface', value: 'Electron · React 19' },
        { label: 'Storage', value: 'Local JSON · OS-encrypted keys' }
      ]
    : []

  return (
    <div className="space-y-8">
      <div className="card relative overflow-hidden p-6">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-40 opacity-60"
          style={{
            background:
              'radial-gradient(ellipse 60% 100% at 20% 0%, var(--c-accent-soft) 0%, transparent 75%)'
          }}
        />
        <div className="relative flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-ink-button text-on-ink shadow-sm">
            <Sparkles size={20} />
          </div>
          <div>
            <h2 className="display text-[26px] leading-tight">Knight Cowork</h2>
            <p className="mt-1 max-w-[520px] text-[12px] leading-relaxed text-muted">
              A local-first desktop coworker. One Captain, one engine, your files on this machine.
            </p>
          </div>
        </div>
      </div>

      <SettingsSection title="Details">
        <div className="divide-y divide-line">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
              <span className="text-[12px] text-muted">{row.label}</span>
              <span className="text-[12px] font-medium text-ink">{row.value}</span>
            </div>
          ))}
          <div className="flex items-center justify-between gap-4 py-2.5 last:pb-0">
            <span className="text-[12px] text-muted">Data folder</span>
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-mono text-[10.5px] text-ink/80">
                {info?.userDataPath ?? 'Locating…'}
              </span>
              <IconButton onClick={() => void copyPath()} aria-label="Copy data folder">
                {copied ? <Check size={12} className="text-positive" /> : <Clipboard size={12} />}
              </IconButton>
            </span>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Open source">
        <p className="text-[11.5px] leading-relaxed text-muted">
          Skills follow the agentskills.io format. Registry and channel contracts follow Seamoon
          and OpenClaw (MIT). Composio, ClawHub and Telegram are third-party services.
        </p>
      </SettingsSection>

      <p className="px-1 text-[10.5px] leading-relaxed text-faint">
        Knight Cowork is an independent, local-first project. It is not affiliated with Anthropic.
        Claude is a trademark of Anthropic, PBC. Only analyze software you are authorized to
        inspect.
      </p>
    </div>
  )
}
