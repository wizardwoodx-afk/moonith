/**
 * ImpDesk — the desktop cockpit.
 *
 * The pane reports only what the machine can verify right now: the protection
 * checks the backend computed, the connections this profile actually carries,
 * and the behaviour those settings already imply. Nothing here is a promise
 * the runtime does not keep, and nothing here is a toggle that pretends to
 * save something.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Cpu, Radio, Wrench } from 'lucide-react'
import { Icon } from '../../components/icons'
import type { PublicSettings, SecurityPosture, SecurityPostureItem } from '@shared/types'
import { useApp } from '../../store'
import { cn, errorMessage } from '../../lib/utils'
import { StatusChip } from './settingParts'
import type { SettingsPaneId } from '../../lib/settingsNav'

type ChipTone = 'neutral' | 'positive' | 'warn' | 'accent'

const STATE_LABEL: Record<SecurityPostureItem['state'], string> = {
  good: 'Good',
  attention: 'Needs attention',
  off: 'Off'
}

/** A dot that reports one posture state, with the word kept for screen readers. */
function StateDot({ state }: { state: SecurityPostureItem['state'] }) {
  return (
    <span className="mt-[6px] flex h-1.5 w-1.5 shrink-0 items-center justify-center">
      <span
        aria-hidden
        className={cn(
          'block h-1.5 w-1.5 rounded-full',
          state === 'good' && 'bg-positive',
          state === 'attention' && 'bg-warn',
          state === 'off' && 'bg-faint/70'
        )}
      />
      <span className="sr-only">{STATE_LABEL[state]}</span>
    </span>
  )
}

/** The one quiet way out of a row: the pane that can act on it. */
function PaneLink({ pane, label }: { pane: SettingsPaneId; label: string }) {
  const openSettings = useApp((state) => state.openSettings)
  return (
    <button
      type="button"
      onClick={() => openSettings(pane)}
      aria-label={`Open ${label} settings`}
      className="shrink-0 self-center rounded-md px-1.5 py-1 text-[11px] text-muted transition-colors duration-150 ease-out hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      Open
    </button>
  )
}

interface ConnectionTile {
  pane: SettingsPaneId
  labelOne: string
  labelMany: string
  line: string
  count: number
  icon: typeof Cpu
}

export function ImpDeskPane({ settings }: { settings: PublicSettings }) {
  const openSettings = useApp((state) => state.openSettings)
  const [posture, setPosture] = useState<SecurityPosture | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef(0)

  const settingsKey = `${settings.providers.length}:${settings.mcpServers.length}:${settings.channels.length}`

  const load = useCallback(async (): Promise<void> => {
    const request = requestRef.current + 1
    requestRef.current = request
    setLoading(true)
    try {
      const next = await window.knight.getSecurityPosture()
      if (request !== requestRef.current) return
      setPosture(next)
      setError(null)
    } catch (cause) {
      if (request !== requestRef.current) return
      setError(errorMessage(cause) || 'The local service gave no reason.')
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, settingsKey])

  const items = posture?.items ?? []
  const planDefault = settings.defaultPermissionMode === 'plan'
  const hasImpCodes = settings.providers.some(
    (provider) => provider.name === 'ImpCodes' || provider.name.startsWith('ImpCodes ·')
  )

  const connections: ConnectionTile[] = [
    {
      pane: 'providers',
      labelOne: 'Model',
      labelMany: 'Models',
      line: 'Model endpoints',
      count: settings.providers.length,
      icon: Cpu
    },
    {
      pane: 'mcp',
      labelOne: 'Tool server',
      labelMany: 'Tool servers',
      line: 'MCP tools',
      count: settings.mcpServers.length,
      icon: Wrench
    },
    {
      pane: 'channels',
      labelOne: 'Channel',
      labelMany: 'Channels',
      line: 'Remote reach',
      count: settings.channels.length,
      icon: Radio
    }
  ]

  const behaviour: Array<{
    title: string
    detail: string
    chip: string
    tone: ChipTone
    pane?: SettingsPaneId
  }> = [
    {
      title: 'Messages queue while a run is active.',
      detail: 'A message sent mid-run joins the active turn as steering.',
      chip: 'On',
      tone: 'positive'
    },
    {
      title: 'Plan mode reviews work before it starts.',
      detail: planDefault
        ? 'Plan mode is the default for new work.'
        : 'Plan mode is available for work that needs review.',
      chip: planDefault ? 'Default' : 'Available',
      tone: planDefault ? 'positive' : 'neutral'
    },
    hasImpCodes
      ? {
          title: 'Imported ImpCodes models use the same in-house tool loop.',
          detail: 'Imports run on the same providers, permissions and tools as every other endpoint.',
          chip: 'Same loop',
          tone: 'positive'
        }
      : {
          title: 'Model access is managed in Models.',
          detail: 'Add or switch endpoints from the Models pane.',
          chip: 'Managed',
          tone: 'neutral',
          pane: 'providers'
        }
  ]

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="tab-enter card relative overflow-hidden p-5">
        <div className="flex items-start gap-4">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-[15px] border border-line bg-surface-2">
            <span
              aria-hidden
              className="presence-orbit pointer-events-none absolute inset-[5px] rounded-full border border-dashed border-line-strong/70"
            >
              <span className="absolute -top-[2.5px] left-1/2 h-[5px] w-[5px] -translate-x-1/2 rounded-full bg-accent/80" />
            </span>
            <span
              aria-hidden
              className="breathing absolute inset-2 rounded-full bg-accent-soft/70 blur-[6px]"
            />
            <Icon name="shield" size="xl" className="relative text-accent-ink" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold tracking-[0.16em] text-faint uppercase">
              Desktop cockpit
            </p>
            <p className="display mt-1.5 text-[22px] leading-none text-ink">At a glance</p>
            <p className="mt-2 max-w-[420px] text-[12px] leading-[1.6] text-muted">
              What the runtime can prove right now.
            </p>
          </div>
        </div>
      </section>

      {/* Protection */}
      <section aria-labelledby="impdesk-protection" className="run-in" style={{ animationDelay: '50ms' }}>
        <div className="mb-2.5 flex items-end justify-between gap-4 px-4">
          <h2 id="impdesk-protection" className="text-[12px] font-medium text-muted">
            Protection
          </h2>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh protection state"
            title="Refresh"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-surface-2/60 text-muted transition-colors duration-150 ease-out hover:border-line-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
          >
            <Icon name="refresh" size="md" className={cn(loading && 'animate-spin')} />
          </button>
        </div>

        <div className="card overflow-hidden" aria-busy={loading}>
          {error ? (
            <div className="flex items-start gap-2.5 border-b border-line px-4 py-3">
              <Icon name="caution" size="sm" className="mt-0.5 text-warn" />
              <div className="min-w-0">
                <p className="text-[11.5px] leading-[1.55] text-muted">
                  {items.length > 0
                    ? 'Could not refresh protection state. Showing the last reading.'
                    : 'Protection state could not be read just now. Connections below still work.'}
                </p>
                <p className="mt-0.5 text-[10.5px] leading-[1.5] break-words text-faint">{error}</p>
              </div>
            </div>
          ) : null}

          {loading && !posture ? (
            <div className="animate-pulse divide-y divide-dashed divide-line" aria-hidden>
              {[0, 1, 2].map((row) => (
                <div key={row} className="px-4 py-3.5">
                  <div className="h-2 w-28 rounded-full bg-surface-2" />
                  <div className="mt-2 h-2 w-3/5 rounded-full bg-surface-3/70" />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="px-4 py-3.5 text-[11.5px] leading-[1.6] text-muted">
              No protection checks reported on this machine yet.
            </p>
          ) : (
            <div className="divide-y divide-dashed divide-line">
              {items.map((item) => (
                <div key={item.id} className="flex items-start gap-3 px-4 py-3">
                  <StateDot state={item.state} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] leading-snug font-medium text-ink">{item.label}</p>
                    <p className="mt-0.5 text-[11.5px] leading-[1.55] text-muted">{item.detail}</p>
                  </div>
                  {item.pane ? (
                    <PaneLink pane={item.pane as SettingsPaneId} label={item.label} />
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Connections */}
      <section aria-labelledby="impdesk-connections" className="run-in" style={{ animationDelay: '100ms' }}>
        <div className="mb-2.5 px-4">
          <h2 id="impdesk-connections" className="text-[12px] font-medium text-muted">
            Connections
          </h2>
        </div>
        <div className="card p-3">
          <div className="grid gap-2.5 sm:grid-cols-3">
            {connections.map((tile) => {
              const Icon = tile.icon
              return (
                <button
                  key={tile.pane}
                  type="button"
                  onClick={() => openSettings(tile.pane)}
                  className="group flex flex-col items-start gap-3 rounded-[10px] border border-line bg-surface-2/45 p-3.5 text-left transition-[transform,border-color,background-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-line-strong hover:bg-surface-2/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:translate-y-0"
                >
                  <span className="flex w-full items-center justify-between">
                    <span className="flex h-6 w-6 items-center justify-center rounded-[8px] border border-line bg-surface/60 text-muted transition-colors duration-200 group-hover:text-ink">
                      <Icon aria-hidden size={12} strokeWidth={1.7} />
                    </span>
                    <ArrowUpRight
                      aria-hidden
                      size={12}
                      className="text-faint transition-colors duration-200 group-hover:text-muted"
                    />
                  </span>
                  <span className="flex items-baseline gap-1.5">
                    <span className="font-data text-[20px] leading-none font-semibold text-ink">
                      {tile.count}
                    </span>
                    <span className="whitespace-nowrap text-[11.5px] text-muted">
                      {tile.count === 1 ? tile.labelOne : tile.labelMany}
                    </span>
                  </span>
                  <span className="text-[10.5px] leading-[1.5] text-faint">{tile.line}</span>
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {/* Behaviour */}
      <section aria-labelledby="impdesk-behaviour" className="run-in" style={{ animationDelay: '150ms' }}>
        <div className="mb-2.5 px-4">
          <h2 id="impdesk-behaviour" className="text-[12px] font-medium text-muted">
            Behaviour
          </h2>
        </div>
        <div className="card overflow-hidden">
          <div className="divide-y divide-dashed divide-line">
            {behaviour.map((row) => (
              <div key={row.title} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] leading-snug font-medium text-ink">{row.title}</p>
                  <p className="mt-0.5 text-[11.5px] leading-[1.55] text-muted">{row.detail}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 pt-px">
                  <StatusChip tone={row.tone}>{row.chip}</StatusChip>
                  {row.pane ? <PaneLink pane={row.pane} label="Models" /> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
