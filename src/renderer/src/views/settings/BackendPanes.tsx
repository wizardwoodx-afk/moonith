import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  Check,
  Copy,
  Globe,
  Monitor,
  Power,
  RefreshCw,
  Sparkles,
  TriangleAlert
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  BackendGatewayState,
  BackendM365File,
  BackendM365Mail,
  BackendProviderInfo,
  BackendTierInfo
} from '@shared/types'
import { errorMessage } from '../../lib/utils'
import { Button, Spin, Toggle } from '../../components/ui'
import { SettingsSection } from './SettingsSection'

/**
 * The panes that surface the transplanted Seamoon backend: the model tiers and
 * the provider registry, the Moon Gateway, Microsoft 365, and the desktop
 * capabilities (computer use and the UI-TARS grounding model).
 */

const TIER_ACCENT: Record<string, string> = {
  auto: 'text-accent-ink',
  swift: 'text-muted',
  balanced: 'text-accent-ink',
  deep: 'text-accent-ink',
  agentic: 'text-accent-ink',
  lean: 'text-muted'
}

export function TiersPane() {
  const [tiers, setTiers] = useState<BackendTierInfo[]>([])
  const [providers, setProviders] = useState<BackendProviderInfo[]>([])
  const [settings, setSettings] = useState<{ tier: string; resolvedModel: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [tierList, providerList, backendSettings] = await Promise.all([
      window.knight.backend.tiers(),
      window.knight.backend.providers(),
      window.knight.backend.settings()
    ])
    setTiers(tierList)
    setProviders(providerList)
    setSettings({ tier: backendSettings.tier, resolvedModel: backendSettings.resolvedModel })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const choose = async (id: string): Promise<void> => {
    setBusy(true)
    try {
      const saved = await window.knight.backend.saveSettings({ tier: id })
      setSettings({ tier: saved.tier, resolvedModel: saved.resolvedModel })
      toast.success('Model tier updated.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Model tiers"
        description="A tier decides how much reasoning and how many tokens a turn may spend. The backend resolves the tier to a concrete model and falls over to another credentialed provider when one runs out."
      >
        <div className="space-y-2">
          {tiers.map((tier) => {
            const active = settings?.tier === tier.id
            return (
              <button
                key={tier.id}
                type="button"
                disabled={busy}
                onClick={() => void choose(tier.id)}
                className="flex w-full items-start gap-3 rounded-lg border border-line bg-canvas px-3.5 py-3 text-left transition-colors hover:border-line-strong disabled:opacity-60"
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    active ? 'border-accent bg-accent-soft' : 'border-line-strong'
                  }`}
                >
                  {active ? <Check size={10} className="text-accent-ink" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-ink">{tier.name}</span>
                    <span
                      className={`rounded-full bg-surface-2 px-1.5 py-0.5 text-[9.5px] font-medium ${TIER_ACCENT[tier.id] ?? 'text-muted'}`}
                    >
                      {tier.multiplier}
                    </span>
                    {tier.thinking ? (
                      <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[9.5px] font-medium text-accent-ink">
                        thinks
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] leading-relaxed text-faint">
                    {tier.desc}
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-muted">
                    {tier.model || 'uses the selected provider model'}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Provider registry"
        description="The endpoints the backend can reach. Any of them with a credential can take a turn, so a rate-limited provider does not end the task."
      >
        <div className="space-y-1.5">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className="flex items-center gap-3 rounded-lg border border-line bg-canvas px-3.5 py-2.5"
            >
              <Globe size={13} className="shrink-0 text-faint" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium text-ink">{provider.name}</p>
                <p className="truncate text-[11px] text-faint">
                  {provider.baseUrl || 'reads the base URL from the environment'}
                </p>
              </div>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-medium ${
                  provider.available
                    ? 'bg-positive-soft text-positive'
                    : 'bg-surface-2 text-faint'
                }`}
              >
                {provider.available ? 'ready' : 'no key'}
              </span>
            </div>
          ))}
        </div>
      </SettingsSection>
    </div>
  )
}

export function GatewayPane() {
  const [state, setState] = useState<BackendGatewayState | null>(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setState(await window.knight.backend.gatewayStatus())
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async (): Promise<void> => {
    setBusy(true)
    try {
      const next = state?.running
        ? await window.knight.backend.stopGateway()
        : await window.knight.backend.startGateway()
      setState(next)
      toast.success(next.running ? 'The gateway is listening.' : 'The gateway stopped.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const revealToken = async (): Promise<void> => {
    try {
      const value = await window.knight.backend.gatewayToken()
      setToken(value)
      await navigator.clipboard.writeText(value)
      toast.success('Token copied.')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <SettingsSection
      title="Moon Gateway"
      description="A local HTTP surface for the backend. Channels post to it, the router picks the agent, the turn runs through Moonwright and the reply goes back out. Every request needs the bearer token."
      action={
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void toggle()}>
          {busy ? <Spin size={12} /> : <Power size={13} />}
          {state?.running ? 'Stop' : 'Start'}
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2.5">
          <span
            className={`h-2 w-2 rounded-full ${state?.running ? 'bg-positive' : 'bg-line-strong'}`}
          />
          <span className="text-[12.5px] text-ink">
            {state?.running ? 'Listening' : 'Stopped'}
          </span>
          {state?.running ? (
            <span className="truncate font-mono text-[11.5px] text-faint">{state.url}</span>
          ) : null}
        </div>

        {state?.running ? (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => void revealToken()}>
              <Copy size={12} />
              Copy token
            </Button>
            {token ? (
              <span className="truncate font-mono text-[11px] text-faint">
                {token.slice(0, 8)}••••
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-3 gap-2">
          <Stat label="Agents" value={state?.agents.length ?? 0} />
          <Stat label="Bindings" value={state?.bindings.length ?? 0} />
          <Stat label="Automations" value={state?.automations.length ?? 0} />
        </div>
      </div>
    </SettingsSection>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-canvas px-3 py-2.5">
      <p className="text-[17px] font-semibold text-ink">{value}</p>
      <p className="text-[11px] text-faint">{label}</p>
    </div>
  )
}

export function MicrosoftPane() {
  const [connected, setConnected] = useState(false)
  const [email, setEmail] = useState<string | undefined>()
  const [prompt, setPrompt] = useState('')
  const [files, setFiles] = useState<BackendM365File[]>([])
  const [mail, setMail] = useState<BackendM365Mail[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const status = await window.knight.backend.m365Status()
    setConnected(status.connected)
    setEmail(status.account?.email)
    if (status.connected) {
      setFiles(await window.knight.backend.m365Files())
      setMail(await window.knight.backend.m365Mail())
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const begin = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.knight.backend.m365BeginSignIn()
      setPrompt(result.prompt)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const complete = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.knight.backend.m365CompleteSignIn()
      if (!result.ok) {
        toast.error(result.error ?? 'The sign-in is not finished yet.')
        return
      }
      toast.success('Microsoft 365 connected.')
      await load()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async (): Promise<void> => {
    await window.knight.backend.m365Disconnect()
    setConnected(false)
    setFiles([])
    setMail([])
    toast.success('Microsoft 365 disconnected.')
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Microsoft 365"
        description="When connected, the Captain can read files, mail and the calendar through Graph, and the M365 tools join every turn."
        action={
          connected ? (
            <Button variant="ghost" size="sm" onClick={() => void disconnect()}>
              Disconnect
            </Button>
          ) : (
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void begin()}>
              {busy ? <Spin size={12} /> : <RefreshCw size={13} />}
              Connect
            </Button>
          )
        }
      >
        {connected ? (
          <div className="space-y-2">
            <p className="text-[12px] text-ink">{email ?? 'Connected'}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-line bg-canvas p-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted">
                  <Activity size={11} />
                  Files
                </p>
                <ul className="max-h-40 space-y-1 overflow-auto">
                  {files.length === 0 ? (
                    <li className="text-[11.5px] text-faint">No files in the root folder.</li>
                  ) : (
                    files.slice(0, 12).map((file) => (
                      <li key={file.id} className="truncate text-[11.5px] text-muted">
                        {file.name}
                      </li>
                    ))
                  )}
                </ul>
              </div>
              <div className="rounded-lg border border-line bg-canvas p-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted">
                  <TriangleAlert size={11} />
                  Inbox
                </p>
                <ul className="max-h-40 space-y-1 overflow-auto">
                  {mail.length === 0 ? (
                    <li className="text-[11.5px] text-faint">The inbox is empty.</li>
                  ) : (
                    mail.slice(0, 12).map((message) => (
                      <li key={message.id} className="truncate text-[11.5px] text-muted">
                        {message.subject}
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>
          </div>
        ) : prompt ? (
          <div className="space-y-2.5">
            <p className="text-[12px] leading-relaxed text-muted">{prompt}</p>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void complete()}>
              {busy ? <Spin size={12} /> : <Check size={13} />}
              I finished signing in
            </Button>
          </div>
        ) : (
          <p className="text-[12px] leading-relaxed text-faint">
            Not connected. Sign-in uses the device code flow, so no browser is required on this
            machine.
          </p>
        )}
      </SettingsSection>
    </div>
  )
}

export function DesktopPane() {
  const [computer, setComputer] = useState(false)
  const [uiTars, setUiTars] = useState({ enabled: false, model: '', baseUrl: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [computerStatus, tarsStatus] = await Promise.all([
      window.knight.backend.computerStatus(),
      window.knight.backend.uiTarsStatus()
    ])
    setComputer(computerStatus.enabled)
    setUiTars(tarsStatus)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (patch: Record<string, unknown>): Promise<void> => {
    setBusy(true)
    try {
      await window.knight.backend.saveSettings(patch)
      toast.success('Saved.')
      await load()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Computer use"
        description="Lets the Captain look at the screen, move the mouse and type. It only runs when a turn asks for it, and only while this switch is on."
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Monitor size={15} className="text-faint" />
            <span className="text-[12.5px] text-ink">Screen control</span>
          </div>
          <Toggle
            checked={computer}
            disabled={busy}
            onChange={(checked) => void save({ computerUse: checked })}
            label="Computer use"
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="UI-TARS"
        description="A grounded action model for GUI tasks. Point it at an OpenAI-compatible endpoint and the Captain can hand it a desktop instruction."
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Sparkles size={15} className="text-faint" />
              <span className="text-[12.5px] text-ink">Grounded actions</span>
            </div>
            <Toggle
              checked={uiTars.enabled}
              disabled={busy}
              onChange={(checked) =>
                void save({ uiTars: { ...uiTars, enabled: checked } })
              }
              label="UI-TARS"
            />
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted">Base URL</span>
              <input
                value={uiTars.baseUrl}
                onChange={(event) => setUiTars({ ...uiTars, baseUrl: event.target.value })}
                placeholder="https://your-endpoint/v1"
                className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[12px] text-ink outline-none focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted">Model</span>
              <input
                value={uiTars.model}
                onChange={(event) => setUiTars({ ...uiTars, model: event.target.value })}
                placeholder="UI-TARS-7B"
                className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[12px] text-ink outline-none focus:border-accent"
              />
            </label>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void save({ uiTars })}
          >
            Save UI-TARS
          </Button>
        </div>
      </SettingsSection>
    </div>
  )
}
