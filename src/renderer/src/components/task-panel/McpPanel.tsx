import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion'
import type { McpServerConfig, McpServerStatus } from '@shared/types'
import { useApp } from '../../store'
import { mcpExposure } from '../../lib/taskOperations'
import { cn } from '../../lib/utils'
import { IconButton, Spin, Toggle } from '../ui'
import { ICON_SIZES, Icon, type IconName } from '../icons'
import { TaskOrb } from '../../motion/TaskOrb'
import type { TaskCapabilities } from './useTaskCapabilities'

function SectionHeading({
  icon,
  title,
  detail,
  action
}: {
  icon: IconName
  title: string
  detail: string
  action?: ReactNode
}) {
  return (
    <div className="mb-2 flex items-center gap-2 px-1">
      <span className="text-accent">
        <Icon name={icon} size="sm" />
      </span>
      <div className="min-w-0">
        <h3 className="text-[10px] font-semibold tracking-[0.11em] text-muted uppercase">{title}</h3>
        <p className="mt-0.5 text-[10px] text-faint">{detail}</p>
      </div>
      {action ? <div className="ml-auto shrink-0">{action}</div> : null}
    </div>
  )
}

function McpCard({
  config,
  status,
  busy,
  locked,
  onToggle,
  onRestart
}: {
  config: McpServerConfig
  status?: McpServerStatus
  busy: boolean
  locked: boolean
  onToggle: () => void
  onRestart: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const reduced = useReducedMotionConfig()
  const state = status?.status ?? 'stopped'
  const exposure = mcpExposure(config, status)
  const exposedNames = new Set(exposure.tools.map((tool) => tool.name))
  const stateLabel =
    state === 'ready' ? 'Ready' : state === 'starting' ? 'Starting' : state === 'error' ? 'Error' : config.enabled ? 'Not connected' : 'Disabled'

  return (
    <motion.article layout className="overflow-hidden rounded-xl border border-line bg-surface/45">
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <span className={cn(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-canvas',
          state === 'ready' ? 'text-positive' : state === 'error' ? 'text-danger' : 'text-muted'
        )}>
          <Icon
            name={config.preset === 'rea' ? 'builtin' : 'connector'}
            size="sm"
            active={state === 'ready'}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="min-w-0 truncate text-[11.5px] font-medium text-ink" title={config.name}>{config.name}</p>
            <span className={cn(
              'ml-auto flex shrink-0 items-center gap-1 text-[10px]',
              state === 'ready' ? 'text-positive' : state === 'error' ? 'text-danger' : 'text-faint'
            )}>
              {state === 'starting' || busy ? <Spin size={ICON_SIZES.xs} /> : <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', state === 'ready' ? 'bg-positive' : state === 'error' ? 'bg-danger' : 'bg-faint')} />}
              {busy ? 'Updating' : stateLabel}
            </span>
          </div>
          <p className="mt-0.5 truncate font-mono text-[10px] text-faint" title={`${config.command} ${config.args.join(' ')}`}>
            {config.command} {config.args.join(' ')}
          </p>
          <p className="mt-1 truncate text-[10px] text-faint">
            {state === 'ready'
              ? `${exposure.exposed} available · ${exposure.discovered} found`
              : state === 'error'
                ? 'Local server did not start'
                : config.enabled
                  ? 'No tools available'
                  : 'Turned off'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Toggle checked={config.enabled} onChange={onToggle} disabled={locked} label={`${config.enabled ? 'Disable' : 'Enable'} ${config.name}`} />
          <IconButton onClick={onRestart} disabled={!config.enabled || locked} aria-label={`Restart ${config.name}`} title="Restart local server" className="h-7 w-7">
            <Icon name="refresh" size="sm" className={busy ? 'animate-spin' : ''} />
          </IconButton>
        </div>
      </div>

      {status?.error ? <p className="mx-3 mb-2 line-clamp-2 text-[10px] leading-relaxed text-danger/90" title={status.error}>{status.error}</p> : null}

      {(status?.tools.length || status?.error) ? (
        <button
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="flex w-full items-center gap-1.5 border-t border-line/70 px-3 py-1.5 text-[10px] whitespace-nowrap text-faint hover:bg-surface-2/40 hover:text-muted cursor-pointer"
        >
          <Icon name="chevronDown" size="xs" className={cn('shrink-0 transition-transform', expanded && 'rotate-180')} />
          {expanded ? 'Hide tools' : 'Tools and status'}
          {config.toolAllowlist?.length ? <span className="ml-auto shrink-0">{config.toolAllowlist.length} allowed</span> : <span className="ml-auto shrink-0">All tools allowed</span>}
        </button>
      ) : null}

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            initial={reduced ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: reduced ? 0 : 0.18 }}
            className="overflow-hidden"
          >
            <div className="border-t border-line/70 bg-canvas/40 px-3 py-2">
              {status?.error ? <p className="mb-2 whitespace-pre-wrap text-[10px] leading-relaxed text-danger/90">{status.error}</p> : null}
              <div className="scroll-thin max-h-56 space-y-1 overflow-y-auto pr-1">
                {status?.tools.map((tool) => {
                  const exposed = exposedNames.has(tool.name)
                  return (
                    <div key={tool.name} className={cn('rounded-lg px-2 py-1.5', exposed ? 'bg-surface/60' : 'opacity-55')}>
                      <div className="flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate text-[10px] text-ink" title={tool.name}>{tool.name}</code>
                        <span className="shrink-0 whitespace-nowrap text-[10px] text-faint">{exposed ? 'Available' : 'Not available'}</span>
                      </div>
                      {tool.description ? <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-faint" title={tool.description}>{tool.description}</p> : null}
                    </div>
                  )
                })}
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.article>
  )
}

export function McpPanel({ capabilities }: { capabilities: TaskCapabilities }) {
  const openSettings = useApp((state) => state.openSettings)

  if (capabilities.loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-3 text-muted">
        <TaskOrb state="connecting" label="Loading MCP services" />
        <span className="text-[10.5px]">Loading MCP services</span>
      </div>
    )
  }

  const ready = capabilities.statuses.filter((status) => status.status === 'ready').length

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2.5 pt-3 pb-4">
      <div className="mb-3 rounded-xl border border-line bg-canvas/45 px-3 py-2.5">
        <p className="text-[10.5px] leading-relaxed text-muted">
          <span className="font-medium text-ink">{ready} of {capabilities.configs.length} MCP services ready</span>
          {' · '}
          <span className="font-medium text-ink">{capabilities.builtinTools.length} built-in tools</span>
        </p>
      </div>

      <section>
        <SectionHeading
          icon="connector"
          title="Local MCP Services"
          detail="Model Context Protocol servers running locally"
          action={
            <button
              onClick={() => openSettings('mcp')}
              className="flex items-center gap-1 text-[10px] text-faint hover:text-ink cursor-pointer"
            >
              <Icon name="settingsFine" size="xs" /> Manage
            </button>
          }
        />
        {capabilities.configs.length ? (
          <div className="space-y-2">
            {capabilities.configs.map((config) => (
              <McpCard
                key={config.id}
                config={config}
                status={capabilities.statuses.find((status) => status.id === config.id)}
                busy={capabilities.busyServer === config.id}
                locked={Boolean(capabilities.busyServer)}
                onToggle={() => void capabilities.toggleServer(config)}
                onRestart={() => void capabilities.restartServer(config)}
              />
            ))}
          </div>
        ) : (
          <button
            onClick={() => openSettings('mcp')}
            className="w-full rounded-xl border border-dashed border-line px-4 py-6 text-center hover:bg-surface/40 cursor-pointer"
          >
            <Icon name="connector" size="lg" className="mx-auto text-faint" />
            <span className="mt-2 block text-[10.5px] font-medium text-ink">No MCP services configured</span>
            <span className="mt-0.5 block text-[10px] text-faint">Add local servers or browse market</span>
          </button>
        )}
      </section>

      {capabilities.builtinTools.length ? (
        <section className="mt-5">
          <SectionHeading
            icon="builtin"
            title="Core Built-In Tools"
            detail="Native system & execution primitives"
          />
          <div className="space-y-1.5">
            {capabilities.builtinTools.map((tool, index) => (
              <motion.div
                key={tool.name}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index, 8) * 0.02 }}
                className="flex items-start gap-2.5 rounded-xl border border-line bg-surface/40 px-3 py-2.5"
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-ink">
                  <Icon name="builtin" size="sm" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-medium text-ink">{tool.title}</span>
                  <span className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-muted" title={tool.description}>
                    {tool.description}
                  </span>
                </span>
              </motion.div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
