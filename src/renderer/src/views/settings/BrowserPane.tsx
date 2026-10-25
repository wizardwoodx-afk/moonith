import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  Bot,
  Check,
  CheckCircle2,
  Globe2,
  MonitorUp,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert
} from 'lucide-react'
import { toast } from 'sonner'
import type { BrowserEngine, BrowserRuntimeStatus, PublicSettings } from '@shared/types'
import { useApp } from '../../store'
import { cn, errorMessage } from '../../lib/utils'
import { Button, Spin, Toggle } from '../../components/ui'
import { SettingsSection } from './SettingsSection'

export function BrowserPane({ settings }: { settings: PublicSettings }) {
  const saveSettings = useApp((state) => state.saveSettings)
  const reduceMotion = useReducedMotion()
  const [status, setStatus] = useState<BrowserRuntimeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setStatus(await window.knight.getBrowserStatus())
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = async (patch: { engine?: BrowserEngine; headless?: boolean }): Promise<void> => {
    setBusy(true)
    try {
      const saved = await saveSettings({ browser: patch })
      if (!saved) throw new Error('Browser settings could not be saved.')
      await refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const engines = [
    {
      id: 'stagehand' as const,
      icon: Sparkles,
      title: 'Stagehand AI',
      description: 'Natural-language observe, act, and schema-validated extraction on a local browser.',
      badge: 'Default'
    },
    {
      id: 'chromium' as const,
      icon: Globe2,
      title: 'Built-in Chromium',
      description: 'Deterministic selector controls inside Electron, with no separate Chrome requirement.',
      badge: 'Fallback'
    }
  ]

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Native AI browser"
        description="One browser runtime beneath the Captain and every Crew specialist. No Browserbase account, MCP server, external CLI, or hosted browser is used."
        action={
          <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
            {loading ? <Spin size={12} /> : <RefreshCw size={12} />}
            Refresh
          </Button>
        }
      >
        <div className="grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="Browser engine">
          {engines.map((engine) => {
            const active = settings.browser.engine === engine.id
            const Icon = engine.icon
            return (
              <motion.button
                layout={!reduceMotion}
                key={engine.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={busy}
                onClick={() => void save({ engine: engine.id })}
                className={cn(
                  'relative rounded-xl border p-3.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-60',
                  active ? 'border-accent/45 bg-accent-soft/45' : 'border-line bg-canvas hover:border-line-strong'
                )}
              >
                <div className="flex items-center gap-2.5">
                  <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', active ? 'bg-accent-soft text-accent-ink' : 'bg-surface-2 text-muted')}>
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
                      {engine.title}
                      <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[8.5px] font-medium text-faint">
                        {engine.badge}
                      </span>
                    </span>
                  </span>
                  <AnimatePresence initial={false}>
                    {active ? (
                      <motion.span
                        initial={reduceMotion ? false : { opacity: 0, scale: 0.7 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={reduceMotion ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
                        transition={{ duration: reduceMotion ? 0 : 0.16 }}
                        className="text-accent"
                      >
                        <Check size={14} />
                      </motion.span>
                    ) : null}
                  </AnimatePresence>
                </div>
                <p className="mt-2.5 text-[11px] leading-relaxed text-faint">{engine.description}</p>
              </motion.button>
            )
          })}
        </div>

        <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2 text-muted">
            <MonitorUp size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-ink">Headless new sessions</p>
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-faint">
              Run without a visible window. “Open browser window” relaunches the same isolated profile for takeover.
            </p>
          </div>
          <Toggle
            checked={settings.browser.headless}
            onChange={(headless) => void save({ headless })}
            disabled={busy}
            label="Headless new browser sessions"
          />
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-faint">
          Engine changes apply to new sessions. An active browser keeps its current engine until that session is closed.
        </p>
      </SettingsSection>

      <SettingsSection title="Runtime and containment" description="Live local status, not a remote service health check.">
        <div className="grid gap-2 sm:grid-cols-3">
          <StatusTile
            label="Stagehand runtime"
            value={status?.stagehandReady ? 'Ready' : status?.chromeAvailable ? 'Launch blocked' : 'Chrome not found'}
            ok={status?.stagehandReady ?? false}
            loading={loading && !status}
          />
          <StatusTile label="Active sessions" value={String(status?.activeSessions ?? 0)} ok loading={loading && !status} />
          <StatusTile label="SDK" value={status ? `v${status.stagehandVersion}` : '—'} ok loading={loading && !status} />
        </div>
        <div className="mt-4 flex gap-3 rounded-xl bg-canvas p-3.5">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-positive" />
          <div className="text-[11px] leading-relaxed text-muted">
            <p className="font-medium text-ink">Fail-closed browser boundary</p>
            <p className="mt-1 text-faint">
              Public HTTP(S) only · DNS/private-address checks · redirect and subresource interception · downloads denied · per-Captain/Crew profiles · OS credential storage for model keys.
            </p>
          </div>
        </div>
        {status && !status.stagehandReady && !loading ? (
          <div className="mt-3 flex items-start gap-2.5 text-[10.5px] leading-relaxed text-warn">
            <TriangleAlert size={13} className="mt-0.5 shrink-0" />
            <p>{status.notice ?? 'Stagehand is not ready. Built-in Chromium remains available for deterministic browsing.'}</p>
          </div>
        ) : null}
        <div className="mt-3 flex items-center gap-2 text-[10px] text-faint">
          <Bot size={12} />
          AI actions use the task’s selected model and appear in its usage ledger.
        </div>
      </SettingsSection>
    </div>
  )
}

function StatusTile({ label, value, ok, loading }: { label: string; value: string; ok: boolean; loading: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-canvas p-3">
      <div className="flex items-center gap-1.5 text-[9.5px] text-faint">
        {loading ? <Spin size={10} /> : ok ? <CheckCircle2 size={10} className="text-positive" /> : <TriangleAlert size={10} className="text-warn" />}
        {label}
      </div>
      <p className="mt-1.5 truncate text-[12px] font-medium text-ink">{loading ? 'Checking…' : value}</p>
    </div>
  )
}
