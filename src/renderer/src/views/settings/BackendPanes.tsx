import { agentName } from '../../lib/localProfile'
import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  Check,
  Copy,
  Files,
  Inbox,
  KeyRound,
  Monitor,
  Power,
  Radio,
  RefreshCw,
  Sparkles
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  BackendGatewayState,
  BackendWorkFile,
  BackendWorkMail
} from '@shared/types'
import { errorMessage } from '../../lib/utils'
import { Button, Spin, Toggle } from '../../components/ui'
import { SettingsSection } from './SettingsSection'
import { SettingList, SettingRow, StatusChip } from './settingParts'

/**
 * The panes that surface the transplanted the earlier shell backend: the Moon
 * Gateway, Work Files, and the desktop capabilities (computer use and the
 * grounded action model).
 */

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
    <div className="space-y-9">
      <SettingsSection
        title="Moon Gateway"
        action={
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void toggle()}>
            {busy ? <Spin size={12} /> : <Power size={13} />}
            {state?.running ? 'Stop' : 'Start'}
          </Button>
        }
      >
        <SettingList>
          <SettingRow
            icon={<Radio size={14} />}
            title="Gateway"
            description="Accept remote requests for this account from any device."
          >
            <StatusChip tone={state?.running ? 'positive' : 'neutral'}>
              {state?.running ? 'Listening' : 'Stopped'}
            </StatusChip>
          </SettingRow>
          <SettingRow
            icon={<Activity size={14} />}
            title="Endpoint"
            description={state?.running ? undefined : 'Start the gateway to get an address.'}
          >
            {state?.running ? (
              <code className="font-mono text-[11.5px] text-muted">{state.url}</code>
            ) : null}
          </SettingRow>
          <SettingRow
            icon={<KeyRound size={14} />}
            title="Access token"
            description="Shown once — copy it now; it is not stored in plain text."
          >
            <Button variant="secondary" size="sm" onClick={() => void revealToken()}>
              <Copy size={12} />
              Copy token
            </Button>
          </SettingRow>
        </SettingList>
        {token ? (
          <div className="px-4 pt-4 pb-4">
            <p className="font-mono text-[11px] text-faint">{token.slice(0, 8)}••••••••••</p>
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection title="Traffic">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Agents" value={state?.agents.length ?? 0} />
          <Stat label="Bindings" value={state?.bindings.length ?? 0} />
          <Stat label="Automations" value={state?.automations.length ?? 0} />
        </div>
      </SettingsSection>
    </div>
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

export function WorkFilesPane() {
  const [connected, setConnected] = useState(false)
  const [email, setEmail] = useState<string | undefined>()
  const [prompt, setPrompt] = useState('')
  const [files, setFiles] = useState<BackendWorkFile[]>([])
  const [mail, setMail] = useState<BackendWorkMail[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const status = await window.knight.backend.workStatus()
    setConnected(status.connected)
    setEmail(status.account?.email)
    if (status.connected) {
      setFiles(await window.knight.backend.workFiles())
      setMail(await window.knight.backend.workMail())
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const begin = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.knight.backend.workBeginSignIn()
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
      const result = await window.knight.backend.workCompleteSignIn()
      if (!result.ok) {
        toast.error(result.error ?? 'The sign-in is not finished yet.')
        return
      }
      toast.success('Work Files connected.')
      await load()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async (): Promise<void> => {
    await window.knight.backend.workDisconnect()
    setConnected(false)
    setFiles([])
    setMail([])
    toast.success('Work Files disconnected.')
  }

  return (
    <div className="space-y-9">
      <SettingsSection
        title="Account"
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
        <SettingList>
          <SettingRow
            icon={<Files size={14} />}
            title="Microsoft 365"
            description={
              connected
                ? 'Files, mail and calendar read from this account.'
                : 'Sign-in uses the device code flow, so no browser is required on this machine.'
            }
          >
            <StatusChip tone={connected ? 'positive' : 'neutral'}>
              {connected ? 'Connected' : 'Not connected'}
            </StatusChip>
          </SettingRow>
          {connected && email ? (
            <SettingRow
              icon={<Inbox size={14} />}
              title="Account"
            >
              <code className="font-mono text-[11.5px] text-muted">{email}</code>
            </SettingRow>
          ) : null}
        </SettingList>
        {prompt ? (
          <div className="px-4 pt-4 pb-4">
            <p className="text-[12px] leading-relaxed text-muted">{prompt}</p>
            <Button
              variant="primary"
              size="sm"
              className="mt-3"
              disabled={busy}
              onClick={() => void complete()}
            >
              {busy ? <Spin size={12} /> : <Check size={13} />}
              I finished signing in
            </Button>
          </div>
        ) : null}
      </SettingsSection>

      {connected ? (
        <>
          <SettingsSection title="Files">
            {files.length === 0 ? (
              <p className="text-[12px] text-faint">No files in the root folder.</p>
            ) : (
              <ul className="max-h-52 space-y-1 overflow-auto">
                {files.slice(0, 20).map((file) => (
                  <li key={file.id} className="truncate text-[12px] text-muted" title={file.name}>
                    {file.name}
                  </li>
                ))}
              </ul>
            )}
          </SettingsSection>

          <SettingsSection title="Inbox">
            {mail.length === 0 ? (
              <p className="text-[12px] text-faint">The inbox is empty.</p>
            ) : (
              <ul className="max-h-52 space-y-1 overflow-auto">
                {mail.slice(0, 20).map((message) => (
                  <li key={message.id} className="truncate text-[12px] text-muted" title={message.subject}>
                    {message.subject}
                  </li>
                ))}
              </ul>
            )}
          </SettingsSection>
        </>
      ) : null}
    </div>
  )
}

export function DesktopPane() {
  const [computer, setComputer] = useState(false)
  const [groundedActions, setUiTars] = useState({ enabled: false, model: '', baseUrl: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [computerStatus, tarsStatus] = await Promise.all([
      window.knight.backend.computerStatus(),
      window.knight.backend.groundedActionsStatus()
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
    <div className="space-y-9">
      <SettingsSection title="Computer use">
        <SettingList>
          <SettingRow
            icon={<Monitor size={14} />}
            title="Screen control"
            description={`Let the ${agentName()} see the screen and move the pointer. Every action still passes the gates.`}
          >
            <Toggle
              checked={computer}
              disabled={busy}
              onChange={(checked) => void save({ computerUse: checked })}
              label="Screen control"
            />
          </SettingRow>
        </SettingList>
      </SettingsSection>

      <SettingsSection
        title="Grounded actions"
        action={
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void save({ groundedActions })}
          >
            Save
          </Button>
        }
      >
        <SettingList>
          <SettingRow
            icon={<Sparkles size={14} />}
            title="Grounded actions"
            description={`Point the ${agentName()} at real UI elements instead of guessing coordinates.`}
          >
            <Toggle
              checked={groundedActions.enabled}
              disabled={busy}
              onChange={(checked) =>
                void save({ groundedActions: { ...groundedActions, enabled: checked } })
              }
              label="Grounded actions"
            />
          </SettingRow>
        </SettingList>
        <div className="grid gap-2.5 px-4 pt-4 pb-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-muted">Base URL</span>
            <input
              value={groundedActions.baseUrl}
              onChange={(event) =>
                setUiTars({ ...groundedActions, baseUrl: event.target.value })
              }
              placeholder="https://your-endpoint/v1"
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[12px] text-ink outline-none focus:border-accent"
            />
            <span className="mt-1 block text-[10.5px] text-faint">
              Required. Endpoint serving the grounding model.
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-muted">Model</span>
            <input
              value={groundedActions.model}
              onChange={(event) =>
                setUiTars({ ...groundedActions, model: event.target.value })
              }
              placeholder="grounded-v1"
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[12px] text-ink outline-none focus:border-accent"
            />
            <span className="mt-1 block text-[10.5px] text-faint">
              Required. Model name the endpoint expects.
            </span>
          </label>
        </div>
      </SettingsSection>
    </div>
  )
}
