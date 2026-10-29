import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
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
  ChevronRight,
  CircleUserRound,
  Clipboard,
  Cpu,
  Eye,
  EyeOff,
  FileText,
  Handshake,
  Info,
  ListChecks,
  KeyRound,
  Keyboard,
  Loader2,
  Lock,
  Moon,
  Monitor,
  Paintbrush,
  Palette,
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
  Zap,
  ScrollText
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  AppInfo,
  EngineStatusPublic,
  McpMarketDetail,
  McpMarketSearchResult,
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
import { ENGINE_CHOICES, PERMISSION_CHOICES, permissionChoice } from '../lib/composerChoices'
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
import { agentName, profileInitial, saveLocalProfile, useLocalProfile } from '../lib/localProfile'
import { startNewTask } from '../lib/navigation'
import { APP_AUTHOR, APP_SIGNATURE, buildStamp } from '@shared/identity'
import { BrandGlyph, BrandMark } from '../components/BrandMarks'
import { confirmDialog } from '../components/Confirm'
import { createPortal } from 'react-dom'
import { Button, FieldGroup, IconButton, Modal, Spin, Toggle } from '../components/ui'

import { SettingsSection } from './settings/SettingsSection'
import {
  ActionWord,
  Chip,
  CountTabs,
  EmptyPanel,
  SettingCard,
  SettingList,
  SettingRow,
  SettingTile,
  StatusChip
} from './settings/settingParts'

const marketplaceInputClass =
  'h-9 w-full rounded-lg border border-line bg-canvas px-3 text-[12.5px] text-ink outline-none transition-colors placeholder:text-faint focus:border-accent/45'
import { AppearancePane, ColorsPane, MoonPane } from './settings/ThemePanes'
import {
  ChannelsPane,
  ConnectorsPane,
  DesignSystemsPane,
  SkillsPane,
  SubAgentsPane
} from './settings/CapabilityPanes'
import { DesktopPane, GatewayPane, WorkFilesPane } from './settings/BackendPanes'
import { AuditPane } from './settings/AuditPane'
import { EnterprisePane } from './settings/EnterprisePane'
import { RookSettingsPane } from './settings/RookSettingsPane'
import { LearningPane } from './settings/LearningPane'
import { ImpCodesCard } from './settings/ImpCodesCard'
import { ImpDeskPane } from './settings/ImpDeskPane'
import { ProviderPresets } from './settings/ProviderPresets'
import type { ProviderPreset } from '@shared/providerPresets'

const NAV_ICONS: Record<
  SettingsPaneId,
  ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
> = {
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
  agent: BrandMark,
  'agent-team': Users,
  rook: Cpu,
  skills: Sparkles,
  learning: Brain,
  'sub-agents': Bot,
  mcp: Plug,
  impdesk: Aperture,
  connectors: Boxes,
  'design-systems': Palette,
  channels: Radio,
  gateway: ServerCog,
  'work-files': Building2,
  desktop: Monitor,
  enterprise: ShieldCheck,
  audit: ScrollText,
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
  const [actionHost, setActionHost] = useState<HTMLElement | null>(null)

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
      <aside className="flex w-[256px] shrink-0 flex-col border-r border-line/60 bg-panel-2">
        <div className="px-3 pt-3.5 pb-3">
          <button
            onClick={() => openSurface('chat')}
            className="flex h-7 items-center gap-1.5 rounded-md px-1 text-[12.5px] text-muted transition-colors outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/30"
          >
            <ArrowLeft size={13} />
            Back to app
          </button>
          <div className="relative mt-3">
            <Search
              size={13}
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
              placeholder="Search settings…"
              aria-label="Search settings"
              className="h-8 w-full rounded-[9px] border border-line bg-canvas/70 pr-8 pl-8 text-[12.5px] text-ink outline-none transition-colors placeholder:text-faint hover:border-line-strong focus:border-line-strong focus:bg-canvas"
            />
            {query ? (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-faint hover:text-ink"
              >
                <X size={11} />
              </button>
            ) : null}
          </div>
        </div>

        <nav className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-5">
          {sections.length === 0 ? (
            <div className="pt-3">
              <p className="text-[12.5px] text-faint">Nothing matches “{query.trim()}”.</p>
              <button
                onClick={() => setQuery('')}
                className="mt-1.5 text-[12px] text-muted underline underline-offset-2 hover:text-ink"
              >
                Clear
              </button>
            </div>
          ) : (
            sections.map((section) => (
              <div key={section.group} className="mt-5 first:mt-1">
                <p className="pb-1.5 text-[12px] text-faint/60">{section.group}</p>
                <div className="space-y-0.5">
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
                          'group flex h-7 w-full items-center gap-2 rounded-lg px-1.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/30',
                          isActive
                            ? 'bg-surface-3/70 text-ink'
                            : 'text-muted hover:bg-surface-2/60 hover:text-ink'
                        )}
                      >
                        <Icon
                          size={14}
                          className={cn(
                            'shrink-0',
                            isActive ? 'text-ink' : 'text-faint group-hover:text-muted'
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate text-[12.5px]">{item.label}</span>
                        {item.badge ? (
                          <span className="shrink-0 rounded-md bg-accent/15 px-1.5 py-px text-[10px] font-medium text-accent-ink">
                            {item.badge}
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </nav>

        <div className="border-t border-line/40 px-5 py-4">
          <p className="flex items-center gap-2 text-[11px] text-faint/80">
            <Lock size={11} />
            On this device
          </p>
        </div>
      </aside>

      <section className={cn('min-w-0 flex-1 bg-panel', tab === 'profile' && 'settings-dots')}>
        <div className="scroll-thin h-full overflow-y-auto">
          <div className="mx-auto w-full max-w-[757px] px-4 pt-12 pb-20">
            <div className="flex items-start justify-between gap-6">
              <div
                key={`head:${searching ? 'search' : tab}`}
                className="tab-enter min-w-0 px-4"
              >
                {drilled && !searching ? (
                  <button
                    onClick={() => openSettings(parent)}
                    className="mb-4 flex items-center gap-1.5 text-[12.5px] text-faint transition-colors hover:text-ink"
                  >
                    <ArrowLeft size={13} />
                    {settingsPane(parent).label}
                  </button>
                ) : null}
                <h1 className="text-[21px] font-semibold leading-tight text-ink">
                  {searching ? 'Search results' : active.label}
                </h1>
                {searching ? (
                  <p className="mt-1.5 text-[12px] text-muted">
                    {`Found ${results.length} setting${results.length === 1 ? '' : 's'} for “${trimmedQuery}”`}
                  </p>
                ) : null}
              </div>
              <div ref={setActionHost} className="shrink-0 pt-1" />
            </div>

            <div
              key={searching ? 'search' : tab}
              className={cn('mt-8', drilled && !searching ? 'drill-in' : 'tab-enter')}
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
                  {tab === 'rook' ? <RookSettingsPane /> : null}
                  {tab === 'skills' ? <SkillsPane actionHost={actionHost} /> : null}
                  {tab === 'learning' ? <LearningPane /> : null}
                  {tab === 'sub-agents' ? <SubAgentsPane /> : null}
                  {tab === 'appearance' ? <AppearancePane /> : null}
                  {tab === 'colors' ? <ColorsPane /> : null}
                  {tab === 'moon' ? <MoonPane /> : null}
                  {tab === 'permissions' ? <PermissionsPane settings={settings} /> : null}
                  {tab === 'instructions' ? <InstructionsPane settings={settings} actionHost={actionHost} /> : null}
                  {tab === 'providers' ? <ProvidersTab settings={settings} actionHost={actionHost} /> : null}
                  {tab === 'mcp' ? <McpTab actionHost={actionHost} /> : null}
                  {tab === 'impdesk' ? <ImpDeskPane settings={settings} /> : null}
                  {tab === 'connectors' ? <ConnectorsPane /> : null}
                  {tab === 'design-systems' ? <DesignSystemsPane actionHost={actionHost} /> : null}
                  {tab === 'channels' ? <ChannelsPane actionHost={actionHost} /> : null}
                  {tab === 'gateway' ? <GatewayPane /> : null}
                  {tab === 'work-files' ? <WorkFilesPane /> : null}
                  {tab === 'desktop' ? <DesktopPane /> : null}
                  {tab === 'enterprise' ? <EnterprisePane settings={settings} /> : null}
                  {tab === 'audit' ? <AuditPane /> : null}
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
      <EmptyPanel icon={<Search size={18} />} title={`No setting matches “${query}”`}>
        Try “model”, “theme”, “permissions”, or “keys”.
      </EmptyPanel>
    )
  }

  return (
    <section>
      <h2 className="mb-2.5 px-4 text-[12px] font-medium text-muted">Matching settings</h2>
      <SettingCard>
        {results.map((item) => {
          const Icon = NAV_ICONS[item.id]
          return (
            <SettingRow
              key={item.id}
              icon={<Icon size={14} />}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {item.label}
                  <span className="rounded-md border border-line bg-surface-2/60 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                    {item.group}
                  </span>
                </span>
              }
              description={item.summary}
            >
              <Button size="sm" variant="secondary" onClick={() => onOpen(item.id)}>
                Open
                <ChevronRight size={12} />
              </Button>
            </SettingRow>
          )
        })}
      </SettingCard>
    </section>
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
  const mcpEnabled = settings.mcpServers.filter((server) => server.enabled).length

  return (
    <div className="space-y-9">
      {providers.length === 0 ? (
        <EmptyPanel
          icon={<Cpu size={19} />}
          title={<>No model provider yet. Connect one to pick a default model.</>}
          action={
            <Button variant="primary" size="sm" onClick={() => openSettings('providers')}>
              Set up
            </Button>
          }
        />
      ) : (
        <SettingsSection title="Model defaults">
          <SettingList>
            <SettingRow
              icon={<Plug size={14} />}
              title="Default provider"
            >
              <select
                className="field field-sm"
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
            </SettingRow>
            <SettingRow
              icon={<Sparkles size={14} />}
              title="Default model"
            >
              <select
                className="field field-sm"
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
            </SettingRow>
          </SettingList>
        </SettingsSection>
      )}

      <SettingsSection title="Defaults">
        <SettingList>
          <SettingRow
            icon={<ShieldCheck size={14} />}
            title="Permissions"
            description="What runs without asking. Shell commands always ask."
          >
            <select
              className="field field-sm"
              value={settings.defaultPermissionMode}
              aria-label="Default permission mode"
              onChange={(event) =>
                void saveSettings({
                  defaultPermissionMode: event.target.value as PublicSettings['defaultPermissionMode']
                })
              }
            >
              {PERMISSION_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </SettingRow>
          <SettingRow
            icon={<FileText size={14} />}
            title="Memory"
            description={
              settings.customInstructions.trim()
                ? `The ${agentName()} has standing instructions to follow.`
                : 'No standing instructions yet.'
            }
          >
            <Button size="sm" variant="secondary" onClick={() => openSettings('instructions')}>
              Write instructions
            </Button>
          </SettingRow>
          <SettingRow
            icon={<Plug size={14} />}
            title="MCP servers"
            description={
              settings.mcpServers.length === 0
                ? 'No external tool servers connected.'
                : `${mcpEnabled} of ${settings.mcpServers.length} running.`
            }
          >
            <Button size="sm" variant="secondary" onClick={() => openSettings('mcp')}>
              Manage
            </Button>
          </SettingRow>
        </SettingList>
      </SettingsSection>
    </div>
  )
}

function EngineStatusLine() {
  const [status, setStatus] = useState<EngineStatusPublic | null>(null)

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const next = await window.knight.getEngineStatus()
        if (alive) setStatus(next)
      } catch {
        if (alive) setStatus({ state: 'error', error: 'The engine status could not be read.' })
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 3000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  if (!status) return null
  const line =
    status.state === 'running'
      ? `Running · port ${status.port ?? '—'} · ${status.providers ?? 0} provider${status.providers === 1 ? '' : 's'}`
      : status.state === 'starting'
        ? 'Starting…'
        : status.state === 'error'
          ? (status.error ?? 'The engine reported an error.')
          : 'Idle'

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 text-[11.5px]">
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          status.state === 'running'
            ? 'bg-positive'
            : status.state === 'error'
              ? 'bg-danger'
              : status.state === 'starting'
                ? 'animate-pulse bg-warn'
                : 'bg-line-strong'
        )}
      />
      <span className={status.state === 'error' ? 'text-danger' : 'text-muted'}>{line}</span>
    </div>
  )
}

function PermissionsPane({ settings }: { settings: PublicSettings }) {
  const saveSettings = useApp((state) => state.saveSettings)

  return (
    <div className="space-y-9">
      <SettingsSection title="Execution engine">
        <SettingList>
          {ENGINE_CHOICES.map((choice) => {
            const active = settings.engineMode === choice.value
            return (
              <button
                key={choice.value}
                onClick={() => void saveSettings({ engineMode: choice.value })}
                className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2/40"
              >
                <SettingTile tone={active ? 'accent' : 'default'}>
                  <Cpu size={14} />
                </SettingTile>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] leading-snug font-medium text-ink">
                    {choice.label}
                  </span>
                  <span className="mt-1 block text-[12px] leading-[1.6] text-muted">
                    {choice.blurb}
                  </span>
                </span>
                <span
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                    active ? 'border-accent bg-accent' : 'border-line-strong'
                  )}
                >
                  {active ? <span className="h-1.5 w-1.5 rounded-full bg-on-ink" /> : null}
                </span>
              </button>
            )
          })}
        </SettingList>
        <EngineStatusLine />
      </SettingsSection>

      <SettingsSection
        title="Approval mode"
        
      >
        <SettingList>
          {PERMISSION_CHOICES.map((choice) => {
            const active = settings.defaultPermissionMode === choice.value
            const Icon =
              choice.value === 'plan'
                ? ListChecks
                : choice.value === 'manual'
                  ? ShieldCheck
                  : choice.value === 'auto'
                    ? Zap
                    : CheckCheck
            return (
              <button
                key={choice.value}
                onClick={() => void saveSettings({ defaultPermissionMode: choice.value })}
                className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2/40"
              >
                <SettingTile tone={active ? 'accent' : 'default'}>
                  <Icon size={14} />
                </SettingTile>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] leading-snug font-medium text-ink">
                    {choice.label}
                  </span>
                  <span className="mt-1 block text-[12px] leading-[1.6] text-muted">
                    {choice.blurb}
                  </span>
                </span>
                <span
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                    active ? 'border-accent bg-accent' : 'border-line-strong'
                  )}
                >
                  {active ? <span className="h-1.5 w-1.5 rounded-full bg-on-ink" /> : null}
                </span>
              </button>
            )
          })}
        </SettingList>
      </SettingsSection>

      <SettingsSection title="Shell">
        <SettingList>
          <SettingRow
            icon={<Terminal size={14} />}
            title="Allow shell commands"
            description="Run commands inside approved folders. Every command still asks before it runs."
          >
            <Toggle
              checked={settings.allowShell}
              onChange={(checked) => void saveSettings({ allowShell: checked })}
              label="Allow shell commands"
            />
          </SettingRow>
        </SettingList>
      </SettingsSection>

      <div className="flex items-center gap-2 px-1 text-[11px] text-faint">
        <Handshake size={12} className="shrink-0" />
        Joint Table actions always need both keys.
      </div>
    </div>
  )
}

function workspaceLabel(note: Pick<MemoryNote, 'scope' | 'scopeRef'>): string {
  if (note.scope === 'global' || !note.scopeRef) return 'All tasks'
  return note.scopeRef.split(/[\\/]/).filter(Boolean).pop() ?? note.scopeRef
}

function InstructionsPane({
  settings,
  actionHost
}: {
  settings: PublicSettings
  actionHost: HTMLElement | null
}) {
  const saveSettings = useApp((state) => state.saveSettings)
  const [instructions, setInstructions] = useState(settings.customInstructions)
  const [saving, setSaving] = useState(false)
  const [notes, setNotes] = useState<MemoryNote[]>([])
  const [note, setNote] = useState('')
  const [noteFolder, setNoteFolder] = useState<string | null>(null)
  const [retentionDays, setRetentionDays] = useState('')
  const [adding, setAdding] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
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
    if (!text || adding) return
    setAdding(true)
    try {
      setNotes(await window.knight.addMemory({
        text,
        scope: noteFolder ? 'workspace' : 'global',
        scopeRef: noteFolder ?? undefined,
        retentionDays: retentionDays ? Number(retentionDays) : undefined
      }))
      setNote('')
      setComposerOpen(false)
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
      {actionHost
        ? createPortal(
            <Button size="sm" variant="primary" onClick={() => setComposerOpen((open) => !open)}>
              <Plus size={12.5} /> Add note
            </Button>,
            actionHost
          )
        : null}

      <section>
        <div className="mb-2.5 flex items-end justify-between gap-4 px-4">
          <h2 className="text-[12px] font-medium text-muted">Saved notes</h2>
          <Button size="sm" variant="ghost" onClick={() => setImportOpen(true)}>
            <FileText size={12.5} /> Import
          </Button>
        </div>

        {composerOpen ? (
          <div className="card mb-2 space-y-3 p-3">
            <div className="flex gap-2">
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) void addNote()
                }}
                placeholder="Something worth remembering"
                aria-label="New memory note"
                maxLength={4000}
                disabled={adding}
                className="field min-w-0 flex-1"
              />
              <Button size="sm" variant="primary" loading={adding} disabled={!note.trim()} onClick={() => void addNote()}>
                Add
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={adding}
                title={noteFolder ?? 'Available to all tasks on this device'}
                onClick={() => {
                  void window.knight.pickFolder().then((folder) => {
                    if (folder) setNoteFolder(folder)
                  }).catch((error) => toast.error(errorMessage(error)))
                }}
              >
                <Lock size={12} />
                {noteFolder ? workspaceLabel({ scope: 'workspace', scopeRef: noteFolder }) : 'Limit to a workspace'}
              </Button>
              {noteFolder ? (
                <Button size="sm" variant="ghost" disabled={adding} onClick={() => setNoteFolder(null)}>Use in all tasks</Button>
              ) : <span className="text-[11px] text-faint">All tasks</span>}
              <label className="ml-auto flex items-center gap-2 text-[11px] text-muted">
                Keep for
                <select aria-label="Memory retention" className="field w-auto" value={retentionDays} disabled={adding} onChange={(event) => setRetentionDays(event.target.value)}>
                  <option value="">Until forgotten</option>
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                </select>
              </label>
            </div>
            <p className="text-[11px] text-faint">Workspace notes are recalled only for tasks granted that folder. Expired notes are excluded from recall.</p>
          </div>
        ) : null}

        {notes.length === 0 ? (
          <EmptyPanel
            icon={<Brain size={18} />}
            title={<>No notes saved yet.</>}
          >
            Select <ActionWord>Add note</ActionWord> in the top right to get started.
          </EmptyPanel>
        ) : (
          <SettingCard>
            {notes.map((item) => (
              <SettingRow
                key={item.id}
                icon={<Brain size={14} />}
                title={item.text}
                description={[
                  workspaceLabel(item),
                  item.source === 'captain' ? `written by the ${agentName()}` : '',
                  item.source === 'import' ? 'imported' : '',
                  item.expiresAt ? `expires ${new Date(item.expiresAt).toLocaleDateString()}` : 'until forgotten'
                ]
                  .filter(Boolean)
                  .join(' · ')}
              >
                <IconButton
                  aria-label="Forget this note"
                  onClick={() => void removeNote(item.id)}
                  className="hover:text-danger"
                >
                  <Trash2 size={12.5} />
                </IconButton>
              </SettingRow>
            ))}
          </SettingCard>
        )}
      </section>

      <SettingsSection
        title="Instructions"
        
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
          aria-label="Standing instructions"
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
          aria-label="Notes to import"
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
  address: string
  icon: typeof Sparkles
}[] = [
  {
    value: 'anthropic',
    label: 'Anthropic',
    blurb: 'Claude',
    address: 'https://api.anthropic.com',
    icon: Sparkles
  },
  {
    value: 'openai',
    label: 'OpenAI',
    blurb: 'GPT',
    address: 'https://api.openai.com/v1',
    icon: Aperture
  },
  {
    value: 'compatible',
    label: 'Other',
    blurb: 'Local or custom server',
    address: 'http://localhost:11434/v1',
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

function ProvidersTab({
  settings,
  actionHost
}: {
  settings: PublicSettings
  actionHost: HTMLElement | null
}) {
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
    const confirmed = await confirmDialog({
      title: `Remove “${provider.name}”?`,
      body: 'Tasks already using it will need another model.',
      confirmLabel: 'Remove provider',
      danger: true
    })
    if (!confirmed) {
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
      {actionHost
        ? createPortal(
            <Button variant="primary" size="sm" onClick={openCreate}>
              <Plus size={13} />
              Add provider
            </Button>,
            actionHost
          )
        : null}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[11.5px] text-faint">
          <ShieldCheck size={12} />
          Keys are sealed with your OS keychain and never reach the interface.
        </p>
      </div>

      <div className="mb-3">
        <ImpCodesCard />
      </div>

      <div className="space-y-2.5">
        {settings.providers.length === 0 ? (
          <EmptyPanel
            icon={<Cpu size={19} />}
            title={<>No model provider yet.</>}
          >
            Select <ActionWord>Add provider</ActionWord> in the top right to get started.
          </EmptyPanel>
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
                      <h3 className="min-w-0 truncate text-[13px] font-semibold" title={provider.name}>{provider.name}</h3>
                      <span className="rounded-full border border-line bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-muted">
                        {meta.label}
                      </span>
                      {isDefault ? (
                        <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent-ink">
                          Default
                        </span>
                      ) : null}
                      {!provider.enabled ? (
                        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-faint">
                          Disabled
                        </span>
                      ) : null}
                    </div>
                    <p
                      className="mt-0.5 truncate text-[11px] text-faint"
                      title={provider.baseUrl || undefined}
                    >
                      {provider.baseUrl || (
                        provider.kind === 'anthropic'
                          ? 'First-party endpoint'
                          : provider.kind === 'openai'
                            ? 'Hosted endpoint'
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
                        'rounded-md border px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap',
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

  const applyPreset = (preset: ProviderPreset): void => {
    setName(preset.name)
    setKind(preset.kind)
    setBaseUrl(preset.baseUrl ?? '')
    setModelsText(preset.models.join('\n'))
    setTestResult(null)
    setError(null)
  }

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.knight.testProvider(buildInput())
      setTestResult({ ok: result.ok, message: result.message })
      if (result.ok && result.models?.length) {
        setModelsText(result.models.slice(0, 40).join('\n'))
      }
    } catch (caught) {
      setTestResult({ ok: false, message: errorMessage(caught) })
    } finally {
      setTesting(false)
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
    if (!provider?.hasKey && !apiKey.trim() && kind !== 'compatible') {
      setError('Add an API key for this provider.')
      return
    }
    if (kind === 'compatible' && !baseUrl.trim()) {
      setError('Add the address of the server, for example http://localhost:11434/v1.')
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
        {!provider ? <ProviderPresets onPick={applyPreset} /> : null}

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
          label="Server address"
          hint={kind === 'compatible' ? 'Required' : 'Only if not the default'}
        >
          <input
            className="field"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={meta.address}
            spellCheck={false}
          />
        </FieldGroup>

        <FieldGroup
          label="API key"
          hint={
            provider?.hasKey
              ? 'A key is already saved'
              : kind === 'compatible'
                ? 'Leave blank for a local server'
                : undefined
          }
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
            placeholder={kind === 'compatible' ? 'llama3.2' : 'claude-sonnet-4-5'}
            spellCheck={false}
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={testing}
              onClick={() => void runTest()}
            >
              <RefreshCw size={12} />
              Load models
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
          aria-label="Filter tools"
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
                  <span className="min-w-0 break-all font-mono text-[10.5px] font-medium text-ink">{tool.name}</span>
                  {exposed ? (
                    <Check size={10} className="shrink-0 text-positive" />
                  ) : (
                    <span className="text-[10px] text-faint">hidden</span>
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
            <h3 className="min-w-0 truncate text-[13px] font-semibold" title={config.name}>{config.name}</h3>
            {config.preset === 'rea' ? (
              <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent-ink">
                Preset
              </span>
            ) : null}
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
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
          <p
            className="mt-0.5 truncate font-mono text-[10.5px] text-faint"
            title={`${config.command} ${config.args.join(' ')}`}
          >
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
              {allowCount ? ` · ${allowCount} exposed to SelfImpulse` : ' · all tools exposed'}
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

function McpMarketBrowser({
  isInstalled,
  onInstalled
}: {
  isInstalled: (configId: string) => boolean
  onInstalled: (statuses: McpServerStatus[]) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<McpMarketSearchResult[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [detail, setDetail] = useState<McpMarketDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async (target: string): Promise<void> => {
    setLoading(true)
    try {
      setResults(await window.knight.searchMcpMarket(target))
    } catch (caught) {
      toast.error(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load('')
  }, [load])

  const install = async (id: string): Promise<void> => {
    setInstallingId(id)
    try {
      const result = await window.knight.installMcpMarket(id)
      onInstalled(result.statuses)
      toast.success(
        result.updated ? `${result.config.name} updated.` : `${result.config.name} added to your servers.`
      )
    } catch (caught) {
      toast.error(errorMessage(caught))
    } finally {
      setInstallingId(null)
    }
  }

  const toggleDetail = async (id: string): Promise<void> => {
    if (detail?.id === id) {
      setDetail(null)
      return
    }
    setDetailLoading(true)
    try {
      setDetail(await window.knight.readMcpMarket(id))
    } catch (caught) {
      toast.error(errorMessage(caught))
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search
          size={13}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint"
        />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void load(query)
          }}
          placeholder="Search the tool server library"
          aria-label="Search the tool server library"
          className={cn(marketplaceInputClass, 'pl-8')}
        />
      </div>

      {loading ? (
        <div className="card flex items-center justify-center gap-2 py-12 text-[12px] text-faint">
          <Spin size={13} />
          Reading the library…
        </div>
      ) : results && results.length > 0 ? (
        <SettingCard>
          {results.map((result) => {
            const configId = `market_${result.id.replace(/[^A-Za-z0-9._-]/g, '_')}`
            const installed = isInstalled(configId)
            const open = detail?.id === result.id
            return (
              <div key={result.id}>
                <SettingRow
                  icon={<Boxes size={14} />}
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {result.name}
                      {result.validated ? <Chip tone="positive">Verified</Chip> : null}
                      {result.category ? <Chip>{result.category}</Chip> : null}
                    </span>
                  }
                  description={`${result.author || 'Community'} · ${result.description || 'No description provided.'}`}
                >
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void toggleDetail(result.id)}
                    disabled={detailLoading}
                  >
                    {open ? 'Hide details' : 'Details'}
                  </Button>
                  <Button
                    size="sm"
                    variant={installed ? 'secondary' : 'primary'}
                    loading={installingId === result.id}
                    disabled={Boolean(installingId)}
                    onClick={() => void install(result.id)}
                  >
                    {installed ? 'Reinstall' : 'Add'}
                  </Button>
                </SettingRow>
                {open ? (
                  <div className="mx-11 mb-3 rounded-[10px] border border-line bg-canvas/50 px-3.5 py-3">
                    <p className="text-[11.5px] leading-relaxed text-muted">
                      {detail?.description || result.description || 'No description provided.'}
                    </p>
                    {result.tools.length ? (
                      <p className="mt-2 text-[10.5px] text-faint">
                        Tools: {result.tools.slice(0, 12).join(', ')}
                        {result.tools.length > 12 ? ` and ${result.tools.length - 12} more` : ''}
                      </p>
                    ) : null}
                    {detail?.deploymentDescription ? (
                      <p className="mt-2 text-[10.5px] text-faint">
                        Runs as: {detail.deploymentDescription}
                      </p>
                    ) : null}
                    {detail && detail.systemDependencies.length > 0 ? (
                      <p className="mt-2 text-[10.5px] text-warn">
                        Needs on this machine: {detail.systemDependencies.join(', ')}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </SettingCard>
      ) : (
        <p className="px-1 text-[12px] text-muted">
          {results === null ? 'Reading the library…' : 'Nothing matches that search.'}
        </p>
      )}
    </div>
  )
}

function McpTab({ actionHost }: { actionHost: HTMLElement | null }) {
  const [configs, setConfigs] = useState<McpServerConfig[]>([])
  const [statuses, setStatuses] = useState<McpServerStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<McpServerConfig | null>(null)
  const [addingRea, setAddingRea] = useState(false)
  const [view, setView] = useState<'installed' | 'market'>('installed')

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
    const confirmed = await confirmDialog({
      title: `Remove MCP server “${config.name}”?`,
      body: 'Its tools stop being available to the agent until you add it again.',
      confirmLabel: 'Remove server',
      danger: true
    })
    if (!confirmed) return
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
    <div className="space-y-6">
      {actionHost && view === 'installed'
        ? createPortal(
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setEditing(null)
                setModalOpen(true)
              }}
            >
              <Plus size={13} />
              Add server
            </Button>,
            actionHost
          )
        : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <CountTabs
          value={view}
          onChange={setView}
          tabs={[
            { value: 'installed', label: 'Installed', count: configs.length },
            { value: 'market', label: 'Library' }
          ]}
        />
        {view === 'installed' ? (
          <IconButton onClick={() => void refresh()} aria-label="Refresh servers">
            <RefreshCw size={13} />
          </IconButton>
        ) : null}
      </div>

      {view === 'market' ? (
        <McpMarketBrowser
          isInstalled={(configId) => configs.some((config) => config.id === configId)}
          onInstalled={(next) => {
            setStatuses(next)
            void refreshConfigs()
          }}
        />
      ) : (
        <>
          <p className="flex items-center gap-1.5 text-[11.5px] text-faint">
            <Plug size={12} />
            Servers run locally. Add only servers you trust — their tool calls follow your permission rules.
          </p>

          <div className="rounded-2xl border border-accent/25 bg-accent-soft/25 p-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-surface text-accent">
                <Boxes size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold">Analysis preset</p>
                <p className="mt-1 max-w-[560px] text-[12px] leading-[1.6] text-muted">
                  Adds a ready-made tool server for inspecting binaries, apps and websites. Only
                  analyze software you are authorized to inspect.
                </p>
              </div>
              <Button
                variant={hasRea ? 'secondary' : 'primary'}
                size="sm"
                loading={addingRea}
                onClick={() => void addRea()}
              >
                {hasRea ? <RefreshCw size={12} /> : <Plus size={12} />}
                {hasRea ? 'Reconnect' : 'Add preset'}
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="card flex items-center justify-center gap-2 py-12 text-[12px] text-faint">
              <Spin size={13} />
              Reading installed servers…
            </div>
          ) : configs.length === 0 ? (
            <EmptyPanel
              icon={<Plug size={17} />}
              title={<>No MCP servers installed.</>}
            >
              Select <ActionWord>Add server</ActionWord> in the top right, or open the{' '}
              <ActionWord>Library</ActionWord> tab to browse the community catalogue.
            </EmptyPanel>
          ) : (
            <div className="space-y-2.5">
              {configs.map((config) => (
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
              ))}
            </div>
          )}
        </>
      )}

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
            <p className="text-[10.5px] text-faint">Connect this server when SelfImpulse launches.</p>
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
      <div className="flex flex-wrap items-center gap-4 px-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[15px] font-semibold text-ink">{profile.name}</p>
            <span className="rounded-md border border-line bg-surface-2/60 px-1.5 py-0.5 text-[10px] font-medium text-muted">
              Owner
            </span>
          </div>
          <p className="mt-1 text-[12px] leading-[1.6] text-muted">
            {profile.role} · {profile.email}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface-2/60 px-1.5 py-0.5 text-[10px] font-medium text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-positive" /> Local
        </span>
      </div>

      <section>
        <div className="mb-3 flex items-end justify-between gap-4">
          <h2 className="text-[12px] font-medium text-muted">Usage</h2>
          <button
            onClick={() => openSettings('task-monitor')}
            className="text-[11.5px] text-muted transition-colors hover:text-ink"
          >
            All tasks
          </button>
        </div>
        <div className="grid grid-cols-2 divide-x divide-y divide-line/70 rounded-[var(--r-card)] border border-line bg-canvas/40 sm:grid-cols-4 sm:divide-y-0">
          {[
            { label: 'Tokens', value: compactNumber(usage?.totals.total ?? 0) },
            { label: 'Model calls', value: compactNumber(usage?.totals.calls ?? 0) },
            { label: 'Sessions', value: String(sessions.stats.total) },
            { label: 'Day streak', value: `${sessions.stats.streak}d` }
          ].map((stat) => (
            <div key={stat.label} className="px-5 py-4 text-center">
              <p className="font-data text-[22px] leading-none font-semibold text-ink">{stat.value}</p>
              <p className="mt-1.5 text-[11px] text-muted">{stat.label}</p>
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
              aria-label="Display name"
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
            />
          </FieldGroup>
          <FieldGroup label="Role">
            <input
              className="field"
              aria-label="Role"
              value={draft.role}
              onChange={(event) =>
                setDraft((current) => ({ ...current, role: event.target.value }))
              }
            />
          </FieldGroup>
          <FieldGroup label="Email or handle" className="sm:col-span-2">
            <input
              className="field"
              aria-label="Email or handle"
              value={draft.email}
              onChange={(event) =>
                setDraft((current) => ({ ...current, email: event.target.value }))
              }
            />
          </FieldGroup>
        </div>
      </SettingsSection>

      <SettingsSection title="Account">
        <SettingList>
          <SettingRow title="Mode" description="How this device is set up.">
            <span className="text-[12px] font-medium text-ink">Self · this device</span>
          </SettingRow>
          <SettingRow
            title="Default permission"
            description={`What ${agentName()} may do without asking.`}
          >
            <button
              onClick={() => openSettings('permissions')}
              className="text-[12px] font-medium text-ink transition-colors hover:text-accent-ink"
            >
              {permission.label}
            </button>
          </SettingRow>
          <SettingRow
            title="Execution engine"
            description="The loop that runs every task on this machine."
          >
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
              <span
                className={cn('h-1 w-1 rounded-full', hasModel ? 'bg-positive' : 'bg-warn')}
              />
              Local engine · {hasModel ? 'ready' : 'needs a model'}
            </span>
          </SettingRow>
        </SettingList>
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
      icon: BrandMark,
      blurb: 'One person. Chat and Company, private to this laptop.',
      points: [
        `${agentName()} → Envoy → Operator → Team.`,
        'Your key turns every local gate.'
      ],
      actionLabel: 'Open Chat',
      onOpen: () => openSurface('chat')
    },
    {
      name: 'Collab',
      tag: 'Two machines',
      icon: Handshake,
      blurb: `Two people, each running their own ${agentName()} and engine.`,
      points: [
        `${agentName()}s meet as peers at the Table.`,
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
                        'rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
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
      <SettingsSection title="Overview">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-line/60 sm:grid-cols-4">
          {[
            { label: 'Total', value: tasks.length },
            { label: 'Running', value: tasks.filter((task) => task.status === 'running').length },
            { label: 'Waiting', value: tasks.filter((task) => task.status === 'waiting').length },
            { label: 'Done', value: tasks.filter((task) => task.status === 'done').length }
          ].map((stat) => (
            <div key={stat.label} className="bg-canvas px-3.5 py-3">
              <p className="font-mono text-[20px] leading-7 text-ink">{stat.value}</p>
              <p className="mt-0.5 text-[10px] tracking-[0.09em] text-faint uppercase">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Local tasks"
        action={
          tasks.length ? (
            <Button size="sm" variant="secondary" onClick={() => openSurface('chat')}>
              Open Chat
            </Button>
          ) : undefined
        }
      >
        {tasks.length === 0 ? (
          <EmptyPanel
            icon={<Activity size={19} />}
            title={<>Nothing has run yet.</>}
            action={
              <Button size="sm" variant="primary" onClick={startNewTask}>
                Start a task
              </Button>
            }
          />
        ) : (
          <SettingList>
            {tasks.map((task) => (
              <button
                key={task.id}
                onClick={() => void openTask(task.id)}
                className="group flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2/40"
              >
                <span
                  className={cn('h-2 w-2 shrink-0 rounded-full', TASK_DOT[task.status])}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink" title={task.title}>
                    {task.title}
                  </span>
                  <span className="mt-1 block text-[12px] text-muted">
                    {statusLabel(task.status)} · updated {timeAgo(task.updatedAt)}
                  </span>
                </span>
                <span className="shrink-0 text-[11.5px] text-faint">
                  {task.artifactsCount} receipt{task.artifactsCount === 1 ? '' : 's'}
                </span>
                <ChevronRight
                  size={13}
                  className="shrink-0 text-faint transition-colors group-hover:text-ink"
                />
              </button>
            ))}
          </SettingList>
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
      {
        label: 'New task',
        description: 'Start a fresh task in the Chat surface.',
        keys: ['Ctrl', 'N']
      },
      {
        label: 'Search settings',
        description: 'Find any pane in Settings.',
        keys: ['Ctrl', 'K']
      },
      {
        label: 'Toggle sidebar',
        description: 'Show or hide the navigation rail.',
        keys: ['Ctrl', 'B']
      },
      {
        label: 'Open Chat',
        description: 'Jump to the conversation surface.',
        keys: ['Ctrl', '1']
      },
      {
        label: 'Open Company',
        description: 'Jump to the shared workspace.',
        keys: ['Ctrl', '2']
      },
      {
        label: 'Open Table',
        description: 'Jump to the collaborative table.',
        keys: ['Ctrl', '3']
      },
      {
        label: 'Open settings',
        description: 'Open this page.',
        keys: ['Ctrl', ',']
      }
    ]
  },
  {
    title: 'Composer',
    description: 'While the cursor is in a message box.',
    rows: [
      {
        label: 'Send',
        description: `Send the message to the ${agentName()}.`,
        keys: ['Enter']
      },
      {
        label: 'New line',
        description: 'Keep writing without sending.',
        keys: ['Shift', 'Enter']
      },
      {
        label: 'Close a menu',
        description: 'Dismiss any open menu or dialog.',
        keys: ['Esc']
      }
    ]
  }
]

function ShortcutsPane() {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const total = SHORTCUT_GROUPS.reduce((count, group) => count + group.rows.length, 0)
  const groups = SHORTCUT_GROUPS.map((group) => ({
    ...group,
    rows: needle
      ? group.rows.filter((row) =>
          [row.label, row.description, ...row.keys].some((value) =>
            value.toLowerCase().includes(needle)
          )
        )
      : group.rows
  })).filter((group) => group.rows.length > 0)

  return (
    <div className="space-y-9">
      <SettingsSection title="Shortcuts">
        <p className="text-[13px] font-medium text-ink">Search shortcuts</p>
        <p className="mt-1 text-[12px] text-muted">
          {total} shortcut{total === 1 ? '' : 's'}, 0 customized.
        </p>
        <div className="relative mt-3.5">
          <Search
            size={13}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search shortcuts"
            placeholder="Search commands, descriptions, or key combos"
            className="h-9 w-full rounded-lg border border-line bg-canvas pl-8 text-[12.5px] text-ink outline-none transition-colors placeholder:text-faint focus:border-line-strong"
          />
        </div>
      </SettingsSection>

      {groups.length === 0 ? (
        <EmptyPanel
          icon={<Keyboard size={19} />}
          title={<>No shortcut matches “{query.trim()}”.</>}
        />
      ) : (
        groups.map((group) => (
          <SettingsSection key={group.title} title={group.title}>
            <SettingList>
              {group.rows.map((shortcut) => (
                <div
                  key={shortcut.label}
                  className="flex items-start gap-[14px] px-4 py-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-snug font-medium text-ink">
                      {shortcut.label}
                    </p>
                    <p className="mt-1 text-[12px] leading-[1.6] text-muted">
                      {shortcut.description}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center justify-end gap-1 pt-px">
                    {shortcut.keys.map((key) => (
                      <kbd
                        key={key}
                        className="rounded-[5px] border border-line bg-surface-2/80 px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted"
                      >
                        {key}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </SettingList>
          </SettingsSection>
        ))
      )}
    </div>
  )
}

const AGENT_SEATS = [
  {
    name: 'Envoy',
    role: 'Interpreter',
    detail: `Reads the request, shapes the plan, and carries messages between ${agentName()} and Operator.`,
    icon: Building2
  },
  {
    name: 'Operator',
    role: 'Executor',
    detail: 'Turns one step of the plan into action, then returns the result up the ladder.',
    icon: Cpu
  },
  {
    name: 'Team',
    role: 'Hands and tools',
    detail: 'Files, shell and MCP tools, confined to the folders and gates the task allows.',
    icon: Terminal
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
      <section>
        <h2 className="mb-2.5 px-4 text-[12px] font-medium text-muted">The {agentName()}</h2>
        <SettingCard>
          <SettingRow
            icon={<BrandMark size={14} />}
            title={agentName()}
            description="Holds the plan and signs every receipt."
          >
            <StatusChip tone={ready ? 'positive' : 'warn'}>
              {ready ? 'Ready' : 'Needs a model'}
            </StatusChip>
          </SettingRow>
          <SettingRow
            icon={<Cpu size={14} />}
            title="Model"
            description={
              ready
                ? `${defaultProvider?.name} · ${defaultModel}`
                : 'No model provider is enabled yet.'
            }
          >
            <Button size="sm" variant="secondary" onClick={() => openSettings('providers')}>
              Change
              <ChevronRight size={12} />
            </Button>
          </SettingRow>
        </SettingCard>
      </section>

      <section>
        <h2 className="mb-2.5 px-4 text-[12px] font-medium text-muted">The ladder</h2>
        <SettingCard>
          {AGENT_SEATS.map((seat) => {
            const Icon = seat.icon
            return (
              <SettingRow
                key={seat.name}
                icon={<Icon size={14} />}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {seat.name}
                    <span className="rounded-md border border-line bg-surface-2/60 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                      Internal
                    </span>
                  </span>
                }
                description={`${seat.role} · ${seat.detail}`}
              />
            )
          })}
        </SettingCard>
      </section>

      <section>
        <h2 className="mb-2.5 px-4 text-[12px] font-medium text-muted">Gates and receipts</h2>
        <SettingCard>
          <SettingRow
            icon={<KeyRound size={14} />}
            title="Gates"
            description={`Your permission mode decides what runs. Table actions need both ${agentName()}s.`}
          >
            <Button size="sm" variant="secondary" onClick={() => openSettings('permissions')}>
              Open
              <ChevronRight size={12} />
            </Button>
          </SettingRow>
          <SettingRow
            icon={<CheckCircle2 size={14} />}
            title="Receipts"
            description="Every finished step is attested in the local ledger."
          >
            <Button size="sm" variant="secondary" onClick={() => openSettings('audit')}>
              Open
              <ChevronRight size={12} />
            </Button>
          </SettingRow>
        </SettingCard>
      </section>
    </div>
  )
}

function AgentTeamsPane() {
  const openSurface = useApp((state) => state.openSurface)
  const openSettings = useApp((state) => state.openSettings)

  return (
    <div className="space-y-9">
      <section>
        <h2 className="mb-2.5 px-4 text-[12px] font-medium text-muted">The Table</h2>
        <SettingCard>
          <SettingRow
            icon={<Users size={14} />}
            title={`Two ${agentName()}s, one Table`}
            description="Each side keeps its own engine, files and memory. The Table holds only what both bring."
          >
            <Button size="sm" variant="primary" onClick={() => openSurface('table')}>
              Open Table
              <ArrowRight size={12} />
            </Button>
          </SettingRow>
          <SettingRow
            icon={<SlidersHorizontal size={14} />}
            title="Modes"
            description={`Self runs alone. Collab seats both ${agentName()}s at the Table.`}
          >
            <Button size="sm" variant="secondary" onClick={() => openSettings('mode-config')}>
              Open
              <ChevronRight size={12} />
            </Button>
          </SettingRow>
        </SettingCard>
      </section>

      <section>
        <h2 className="mb-2.5 px-4 text-[12px] font-medium text-muted">A joint action</h2>
        <SettingCard>
          {[
            {
              title: 'Propose',
              detail: 'The step, its files, and the expected outcome.'
            },
            {
              title: 'Review',
              detail: `The other ${agentName()} sees the proposal, never the private task behind it.`
            },
            {
              title: 'Two keys',
              detail: 'Both approvals start the step. Each side writes its own receipt.'
            },
            {
              title: 'Work',
              detail: 'Publishing starts the work on each desk as its own local task. Each side marks itself done.'
            }
          ].map((step, index) => (
            <SettingRow
              key={step.title}
              icon={
                <span className="font-data text-[11px] text-faint">{String(index + 1)}</span>
              }
              title={step.title}
              description={step.detail}
            />
          ))}
        </SettingCard>
      </section>

      <SettingsSection title="The boundary">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
              <CheckCircle2 size={12} className="text-positive" />
              Crosses
            </p>
            <ul className="mt-2 space-y-1.5">
              {['Task title and proposal', 'Accept or decline decisions', 'Ledger receipts', 'Presence at the Table'].map(
                (line) => (
                  <li key={line} className="flex items-start gap-2 text-[12px] text-muted">
                    <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-positive/70" />
                    {line}
                  </li>
                )
              )}
            </ul>
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
              <Lock size={12} />
              Stays home
            </p>
            <ul className="mt-2 space-y-1.5">
              {['Your files and folders', 'Memory and instructions', 'Model keys', 'Private tasks'].map(
                (line) => (
                  <li key={line} className="flex items-start gap-2 text-[12px] text-muted">
                    <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-line-strong" />
                    {line}
                  </li>
                )
              )}
            </ul>
          </div>
        </div>
      </SettingsSection>
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

  const stamp = info ? buildStamp(info.version) : null
  const rows = info
    ? [
        { label: 'Version', value: info.version },
        {
          label: 'Build',
          value: stamp?.commit
            ? `${info.isDev ? 'Development' : 'Packaged'} · ${stamp.commit.slice(0, 7)}`
            : info.isDev
              ? 'Development'
              : 'Packaged'
        },
        {
          label: 'Built at',
          value: stamp?.builtAt ? new Date(stamp.builtAt).toLocaleString() : 'Unknown'
        },
        {
          label: 'Platform',
          value:
            info.platform === 'win32'
              ? 'Windows'
              : info.platform === 'darwin'
                ? 'macOS'
                : info.platform
        }
      ]
    : []

  return (
    <div className="space-y-9">
      <div className="card flex items-start gap-4 p-6">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-ink-button text-on-ink shadow-sm">
          <BrandGlyph height={22} />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="display text-[22px] leading-tight">SelfImpulse</h2>
            {info ? (
              <span className="rounded-md border border-line bg-surface-2/60 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                v{info.version}
              </span>
            ) : null}
          </div>
          <p className="mt-1.5 font-mono text-[10px] whitespace-nowrap text-faint">
            {APP_SIGNATURE} · made by {APP_AUTHOR}
          </p>
        </div>
      </div>

      <SettingsSection title="Details">
        <SettingList>
          {rows.map((row) => (
            <SettingRow key={row.label} title={row.label}>
              <span className="font-mono text-[11.5px] whitespace-nowrap text-muted">{row.value}</span>
            </SettingRow>
          ))}
          <SettingRow title="Data folder">
            <span
              className="max-w-[240px] truncate font-mono text-[11px] whitespace-nowrap text-muted"
              title={info?.userDataPath ?? 'Locating…'}
            >
              {info?.userDataPath ?? 'Locating…'}
            </span>
            <IconButton onClick={() => void copyPath()} aria-label="Copy data folder">
              {copied ? <Check size={12} className="text-positive" /> : <Clipboard size={12} />}
            </IconButton>
          </SettingRow>
        </SettingList>
      </SettingsSection>
    </div>
  )
}
