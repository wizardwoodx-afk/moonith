import { useEffect, useState } from 'react'
import { ScanEye, ScrollText } from 'lucide-react'
import { Icon } from '../../components/icons'
import type { PublicSettings } from '@shared/types'
import {
  AGENT_ROLE_LABELS,
  ALL_SENSITIVE_DATA_CATEGORIES,
  SENSITIVE_DATA_LABELS,
  type AgentCapability,
  type AgentRiskCeiling,
  type AgentRole,
  type DlpInspection,
  type DlpMode,
  type GovernanceSettings
} from '@shared/governance'
import { useApp } from '../../store'
import { cn, errorMessage } from '../../lib/utils'
import { Button, Spin, Toggle } from '../../components/ui'
import { SettingsSection } from './SettingsSection'
import { EnterpriseControlPlane } from './EnterpriseControlPlane'

const ROLE_DETAILS: Record<AgentRole, { description: string; grants: string }> = {
  executor: {
    description: 'Full agent work, with the existing approval gates still in force.',
    grants: 'Read · write · execute · network · sub-agents'
  },
  researcher: {
    description: 'Research and read-only delegation without local writes or shell access.',
    grants: 'Read · network · sub-agents · medium-risk ceiling'
  },
  viewer: {
    description: 'Local, low-risk reading only. No outbound tools or sub-agent delegation.',
    grants: 'Read · low-risk ceiling'
  },
  custom: {
    description: 'A precise capability, risk, and tool-name policy defined below.',
    grants: 'Your capabilities · allowlist · denylist'
  }
}

const CAPABILITIES: Array<{ id: AgentCapability; label: string; detail: string }> = [
  { id: 'read', label: 'Read', detail: 'Files, browser reads, and other read tools' },
  { id: 'write', label: 'Write', detail: 'Create or change files and memory' },
  { id: 'execute', label: 'Execute', detail: 'Shell commands and MCP execution tools' },
  { id: 'network', label: 'Network', detail: 'Web, browser actions, and connectors' },
  { id: 'delegate', label: 'Delegate', detail: 'Start sub-agents with inherited permissions' }
]

const inputClass =
  'w-full rounded-lg border border-line bg-canvas px-3 py-2.5 text-[12px] leading-relaxed text-ink outline-none transition-colors placeholder:text-faint focus:border-accent/45'

function ListEditor({
  label,
  description,
  value,
  placeholder,
  disabled,
  onSave
}: {
  label: string
  description: string
  value: string[]
  placeholder: string
  disabled: boolean
  onSave: (value: string[]) => Promise<void>
}) {
  const [draft, setDraft] = useState(value.join('\n'))
  useEffect(() => setDraft(value.join('\n')), [value])
  return (
    <label className="block">
      <span className="text-[11.5px] font-medium text-ink">{label}</span>
      <span className="mt-0.5 block text-[10.5px] leading-relaxed text-faint">{description}</span>
      <textarea
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const next = [...new Set(draft.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))]
          if (JSON.stringify(next) !== JSON.stringify(value)) void onSave(next)
        }}
        placeholder={placeholder}
        rows={3}
        className={cn(inputClass, 'mt-2 resize-y font-mono text-[11px] disabled:opacity-50')}
      />
    </label>
  )
}

export function EnterprisePane({ settings }: { settings: PublicSettings }) {
  const saveSettings = useApp((state) => state.saveSettings)
  const openSettings = useApp((state) => state.openSettings)
  const [saving, setSaving] = useState(false)
  const [sample, setSample] = useState('')
  const [inspection, setInspection] = useState<DlpInspection | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const governance = settings.governance

  const update = async (
    recipe: (current: GovernanceSettings) => GovernanceSettings
  ): Promise<void> => {
    setSaving(true)
    try {
      await saveSettings({ governance: recipe(governance) })
    } finally {
      setSaving(false)
    }
  }

  const chooseRole = (defaultRole: AgentRole): Promise<void> =>
    update((current) => ({ ...current, defaultRole }))

  const chooseDlpMode = (mode: DlpMode): Promise<void> =>
    update((current) => ({ ...current, dlp: { ...current.dlp, mode } }))

  const inspect = async (): Promise<void> => {
    if (!sample.trim()) {
      setInspection(null)
      return
    }
    setScanning(true)
    setScanError(null)
    try {
      setInspection(await window.knight.inspectDlp(sample, governance.dlp.categories))
    } catch (error) {
      setScanError(errorMessage(error))
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="space-y-9">
      <EnterpriseControlPlane />

      <SettingsSection
        title="Agent tool capabilities"
                action={saving ? <Spin size={14} /> : undefined}
        >
        <div className="space-y-4">
          <div>
            <p className="text-[11.5px] font-medium text-ink">Default role for new tasks</p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-faint">
              Existing tasks keep their assigned role.
            </p>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {(Object.keys(ROLE_DETAILS) as AgentRole[]).map((role) => {
              const active = governance.defaultRole === role
              return (
                <button
                  key={role}
                  type="button"
                  disabled={saving}
                  onClick={() => void chooseRole(role)}
                  className={cn(
                    'rounded-xl border px-3.5 py-3 text-left transition-colors disabled:opacity-55',
                    active
                      ? 'border-accent/45 bg-accent-soft/45'
                      : 'border-line bg-canvas/50 hover:border-line-strong'
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        'flex h-4 w-4 items-center justify-center rounded-full border',
                        active ? 'border-accent bg-accent text-on-ink' : 'border-line-strong'
                      )}
                    >
                      {active ? <Icon name="confirm" size="xs" /> : null}
                    </span>
                    <span className="text-[12.5px] font-semibold text-ink">
                      {AGENT_ROLE_LABELS[role]}
                    </span>
                  </span>
                  <span className="mt-2 block text-[11px] leading-relaxed text-muted">
                    {ROLE_DETAILS[role].description}
                  </span>
                  <span className="mt-2 block text-[10px] leading-relaxed text-faint">
                    {ROLE_DETAILS[role].grants}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="flex items-start gap-2.5 rounded-lg border border-line bg-canvas/45 px-3 py-2.5">
            <Icon name="lock" size="xs" className="mt-0.5 text-accent" />
            <p className="text-[10.5px] leading-relaxed text-muted">
              Change a task&apos;s role from its task menu. These are local authorization roles —
              not hosted SSO or directory sync.
            </p>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Custom role definition"
        >
        <div className="space-y-5">
          <div className="grid gap-2 sm:grid-cols-2">
            {CAPABILITIES.map((capability) => {
              const checked = governance.custom.capabilities.includes(capability.id)
              return (
                <div
                  key={capability.id}
                  className="flex items-center gap-3 rounded-lg border border-line bg-canvas/45 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[11.5px] font-medium text-ink">{capability.label}</p>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-faint">
                      {capability.detail}
                    </p>
                  </div>
                  <Toggle
                    label={`${capability.label} capability`}
                    checked={checked}
                    disabled={saving}
                    onChange={(enabled) =>
                      void update((current) => ({
                        ...current,
                        custom: {
                          ...current.custom,
                          capabilities: enabled
                            ? [...current.custom.capabilities, capability.id]
                            : current.custom.capabilities.filter((id) => id !== capability.id)
                        }
                      }))
                    }
                  />
                </div>
              )
            })}
          </div>
          <label className="block max-w-xs">
            <span className="text-[11.5px] font-medium text-ink">Maximum tool risk</span>
            <select
              value={governance.custom.maxRisk}
              disabled={saving}
              onChange={(event) =>
                void update((current) => ({
                  ...current,
                  custom: {
                    ...current.custom,
                    maxRisk: event.target.value as AgentRiskCeiling
                  }
                }))
              }
              className={cn(inputClass, 'mt-2 h-9 py-0')}
            >
              <option value="low">Low only</option>
              <option value="medium">Low and medium</option>
              <option value="high">Low, medium, and high</option>
            </select>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <ListEditor
              label="Tool allowlist"
              description="One exact name or wildcard per line."
              value={governance.custom.toolAllowlist}
              placeholder={'mcp__docs__*\nread_file'}
              disabled={saving}
              onSave={(toolAllowlist) =>
                update((current) => ({
                  ...current,
                  custom: { ...current.custom, toolAllowlist }
                }))
              }
            />
            <ListEditor
              label="Tool denylist"
              description="Always evaluated first. Wildcards are supported."
              value={governance.custom.toolDenylist}
              placeholder={'*__delete\nrun_command'}
              disabled={saving}
              onSave={(toolDenylist) =>
                update((current) => ({
                  ...current,
                  custom: { ...current.custom, toolDenylist }
                }))
              }
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Data-loss prevention"
        >
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-2">
            {(['off', 'redact', 'block'] as DlpMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={saving}
                onClick={() => void chooseDlpMode(mode)}
                className={cn(
                  'rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-55',
                  governance.dlp.mode === mode
                    ? 'border-accent/45 bg-accent-soft/45'
                    : 'border-line bg-canvas/45 hover:border-line-strong'
                )}
              >
                <span className="block text-[12px] font-medium capitalize text-ink">{mode}</span>
                <span className="mt-0.5 block text-[10px] text-faint">
                  {mode === 'off'
                    ? 'No scanning'
                    : mode === 'redact'
                      ? 'Replace before sending'
                      : 'Block before sending'}
                </span>
              </button>
            ))}
          </div>
          <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
            {ALL_SENSITIVE_DATA_CATEGORIES.map((category) => (
              <div key={category} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 text-[11px] text-muted">
                  {SENSITIVE_DATA_LABELS[category]}
                </span>
                <Toggle
                  label={`Detect ${SENSITIVE_DATA_LABELS[category]}`}
                  checked={governance.dlp.categories.includes(category)}
                  disabled={saving}
                  onChange={(enabled) =>
                    void update((current) => ({
                      ...current,
                      dlp: {
                        ...current.dlp,
                        categories: enabled
                          ? [...current.dlp.categories, category]
                          : current.dlp.categories.filter((item) => item !== category)
                      }
                    }))
                  }
                />
              </div>
            ))}
          </div>
          {governance.dlp.mode !== 'off' && governance.dlp.categories.length === 0 ? (
            <div className="flex items-start gap-2 text-[10.5px] text-warn">
              <Icon name="caution" size="xs" className="mt-0.5" />
              DLP is enabled with no detectors selected, so nothing will match.
            </div>
          ) : null}
          <p className="text-[10.5px] leading-relaxed text-faint">
            Detection covers common credential, card and contact formats. Protection applies to the
            outbound copy; your local task transcript is not rewritten.
          </p>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Local DLP scanner"
        >
        <div className="space-y-3">
          <textarea
            value={sample}
            onChange={(event) => {
              setSample(event.target.value)
              setInspection(null)
              setScanError(null)
            }}
            rows={4}
            aria-label="Text to check for sensitive data"
            placeholder="Paste a test sample, for example an email or test token…"
            className={cn(inputClass, 'resize-y')}
          />
          <div className="flex items-center gap-2">
            <Button variant="secondary" loading={scanning} onClick={() => void inspect()}>
              <ScanEye size={13} /> Inspect locally
            </Button>
            {inspection ? (
              <span
                className={cn(
                  'text-[11px]',
                  inspection.total ? 'text-warn' : 'text-positive'
                )}
              >
                {inspection.total
                  ? `${inspection.total} sensitive ${inspection.total === 1 ? 'match' : 'matches'}`
                  : 'No selected sensitive-data patterns found'}
              </span>
            ) : null}
          </div>
          {scanError ? <p className="text-[11px] text-danger">{scanError}</p> : null}
          {inspection?.total ? (
            <div className="rounded-lg border border-line bg-canvas/55 p-3">
              <div className="flex flex-wrap gap-1.5">
                {inspection.findings.map((finding) => (
                  <span
                    key={finding.category}
                    className="rounded-full border border-warn/25 bg-warn/10 px-2 py-0.5 text-[10px] text-warn"
                  >
                    {SENSITIVE_DATA_LABELS[finding.category]} · {finding.count}
                  </span>
                ))}
              </div>
              <pre className="scroll-thin mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[10.5px] leading-relaxed text-muted">
                {inspection.redacted}
              </pre>
            </div>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Signed runtime evidence"
        >
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <ScrollText size={16} className="mt-0.5 shrink-0 text-accent" />
            <p className="text-[11px] leading-relaxed text-muted">
              Recent events, live integrity and a signed export — metadata and hashes only, never
              raw prompts or tool payloads.
            </p>
          </div>
          <Button variant="secondary" onClick={() => openSettings('audit')}>
            Open audit log <Icon name="arrowRight" size="md" />
          </Button>
        </div>
      </SettingsSection>
    </div>
  )
}
