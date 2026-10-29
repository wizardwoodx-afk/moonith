import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Boxes, ExternalLink, RefreshCw } from 'lucide-react'
import type { ConnectorsState } from '@shared/types'
import { useApp } from '../../store'
import { Spin } from '../ui'
import { Icon } from '../icons'

export function ConnectorsPanel() {
  const openSettings = useApp((state) => state.openSettings)
  const [state, setState] = useState<ConnectorsState | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    window.knight
      .connectorsState(false)
      .then(setState)
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-muted">
        <Spin size={16} />
        <span className="text-[10.5px]">Loading connectors...</span>
      </div>
    )
  }

  const query = filter.trim().toLowerCase()
  const toolkits = (state?.toolkits ?? []).filter(
    (t) =>
      !query ||
      t.name.toLowerCase().includes(query) ||
      t.description.toLowerCase().includes(query) ||
      t.categories.some((c) => c.toLowerCase().includes(query))
  )

  const activeCount = state?.toolkits.filter((t) => t.enabled || t.connected).length ?? 0

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2.5 pt-3 pb-4">
      <div className="mb-3 rounded-xl border border-line bg-canvas/45 px-3 py-2.5">
        <div className="flex items-center justify-between">
          <p className="text-[10.5px] leading-relaxed text-muted">
            <span className="font-medium text-ink">{activeCount} active</span> ·{' '}
            <span className="font-medium text-ink">{state?.toolkits.length ?? 0}</span> enterprise toolkits
          </p>
          <button
            onClick={() => openSettings('connectors')}
            className="flex items-center gap-1 text-[10px] text-accent hover:underline cursor-pointer"
          >
            <Boxes size={11} /> Matrix Settings
          </button>
        </div>
        <div className="mt-2">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search GitHub, Slack, Notion, ERPNext..."
            className="w-full rounded-lg border border-line bg-surface/70 px-2.5 py-1 text-[11px] text-ink outline-none placeholder:text-faint focus:border-accent"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        {toolkits.map((toolkit, index) => (
          <motion.div
            key={toolkit.slug}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(index, 8) * 0.02 }}
            className="flex items-start gap-2.5 rounded-xl border border-line bg-surface/40 p-2.5 hover:bg-surface/65 transition-colors"
          >
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-canvas text-accent">
              <Boxes size={13} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[11.5px] font-semibold text-ink truncate" title={toolkit.name}>
                  {toolkit.name}
                </span>
                <span
                  className={`ml-auto shrink-0 rounded px-1.5 py-0.2 text-[9px] font-mono border ${
                    toolkit.connected || toolkit.enabled
                      ? 'border-positive/30 bg-positive/10 text-positive'
                      : 'border-line bg-surface-2 text-faint'
                  }`}
                >
                  {toolkit.connected || toolkit.enabled ? 'Active' : `${toolkit.tools} tools`}
                </span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-muted" title={toolkit.description}>
                {toolkit.description}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {toolkit.categories.map((c) => (
                  <span key={c} className="rounded bg-surface-2 px-1 py-0.2 text-[8.5px] text-faint">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <button
        onClick={() => openSettings('connectors')}
        className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[10.5px] text-muted hover:bg-surface/50 hover:text-ink cursor-pointer"
      >
        <ExternalLink size={12} /> Open Full Connectors Matrix
      </button>
    </div>
  )
}
