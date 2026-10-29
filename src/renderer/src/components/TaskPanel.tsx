import { AnimatePresence, motion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import { Activity, Boxes, PanelRightClose, Sun } from 'lucide-react'
import type { Task } from '@shared/types'
import { useApp } from '../store'
import { cn } from '../lib/utils'
import { IconButton } from './ui'
import { ICON_SIZES, Icon, type IconName } from './icons'
import { ArtifactPanelBody } from './Artifacts'
import { CrewPanel } from './task-panel/CrewRuns'
import { NowPanel } from './task-panel/NowPanel'
import { SourcesPanel } from './task-panel/SourcesPanel'
import { SkillsPanel } from './task-panel/SkillsPanel'
import { McpPanel } from './task-panel/McpPanel'
import { ConnectorsPanel } from './task-panel/ConnectorsPanel'
import { RookWorkerPanel } from './task-panel/RookWorkerPanel'
import { PromeyDuetPanel } from './task-panel/PromeyDuetPanel'
import { useTaskCapabilities } from './task-panel/useTaskCapabilities'

export type PanelTab = 'now' | 'crew' | 'skills' | 'mcp' | 'connectors' | 'files' | 'rook' | 'promey'

const TABS: readonly { id: PanelTab; label: string; icon: IconName | LucideIcon }[] = [
  { id: 'now', label: 'Now', icon: Activity },
  { id: 'crew', label: 'Sub-agents', icon: 'crew' },
  { id: 'skills', label: 'Skills', icon: 'spark' },
  { id: 'mcp', label: 'MCPs', icon: 'connector' },
  { id: 'connectors', label: 'Connectors', icon: Boxes },
  { id: 'files', label: 'Files', icon: 'folderOpen' },
  { id: 'rook', label: 'Worker', icon: 'model' },
  { id: 'promey', label: 'Promey', icon: Sun }
]

const FOOTER: Record<PanelTab, string | null> = {
  now: null,
  crew: 'Agent delegations stored on this device',
  skills: 'Impulse Skill Hub & installed playbooks',
  mcp: 'Model Context Protocol servers and tool schemas',
  connectors: 'Impulse Connectors Matrix with external platforms',
  files: 'Created files stay in this task',
  rook: 'Background jobs and approvals',
  promey: 'Proactive briefing, triage, and human-in-the-loop approvals'
}

export function TaskPanel({ task, onClose }: { task: Task; onClose: () => void }) {
  const tab = useApp((state) => state.panelTab)
  const setTab = useApp((state) => state.setPanelTab)
  const capabilities = useTaskCapabilities()
  const refreshSubAgents = useApp((state) => state.refreshSubAgents)
  const liveCrew = useApp(
    (state) => state.subagents.filter((run) => run.taskId === task.id && run.status === 'running').length
  )
  const crewCount = useApp(
    (state) => state.subagents.filter((run) => run.taskId === task.id).length
  )

  const countFor = (id: PanelTab): string | number | null => {
    if (id === 'crew') return liveCrew || crewCount || null
    if (id === 'skills') return capabilities.loading ? null : capabilities.skills.length || null
    if (id === 'mcp') {
      if (capabilities.loading) return null
      const ready = capabilities.statuses.filter((s) => s.status === 'ready').length
      return capabilities.configs.length ? `${ready}/${capabilities.configs.length}` : null
    }
    if (id === 'files') return task.artifacts.length || null
    return null
  }

  const footer = FOOTER[tab]

  return (
    <aside aria-label="Task workspace" className="panel-in flex h-full w-[390px] max-w-[92vw] shrink-0 flex-col border-l border-line bg-canvas-deep/65">
      <div className="flex h-[54px] shrink-0 items-center gap-2.5 border-b border-line px-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-surface text-accent">
          <Activity size={ICON_SIZES.md} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[12px] font-semibold tracking-[-0.01em] text-ink">Task workspace</h2>
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton
            onClick={() => void Promise.all([refreshSubAgents(), capabilities.refresh()])}
            aria-label="Refresh capabilities"
            title="Refresh Sub-agents, skills, and MCP"
            disabled={capabilities.refreshing}
          >
            <Icon name="refresh" size="md" className={capabilities.refreshing ? 'animate-spin' : ''} />
          </IconButton>
          <IconButton onClick={onClose} aria-label="Close workspace panel">
            <PanelRightClose size={14} />
          </IconButton>
        </div>
      </div>

      <div className="scroll-thin flex shrink-0 overflow-x-auto border-b border-line px-2" role="tablist" aria-label="Task workspace sections">
        {TABS.map((item) => {
          const Glyph = item.icon
          const active = tab === item.id
          const count = countFor(item.id)
          return (
            <button
              key={item.id}
              role="tab"
              aria-selected={active}
              aria-label={count === null ? item.label : `${item.label}, ${count}`}
              title={count === null ? item.label : `${item.label} · ${count}`}
              onClick={() => setTab(item.id)}
              className={cn(
                'relative flex h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap px-2 text-[10px] font-medium transition-colors outline-none focus-visible:bg-surface-2/50 cursor-pointer',
                active ? 'text-ink font-semibold' : 'text-faint hover:text-muted'
              )}
            >
              {typeof Glyph === 'string' ? (
                <Icon name={Glyph} size="xs" className="shrink-0" />
              ) : (
                <Glyph size={ICON_SIZES.xs} className="shrink-0" />
              )}
              {item.label}
              {count !== null ? (
                <span className={cn('rounded px-1 text-[9px]', active ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-faint')}>
                  {count}
                </span>
              ) : null}
              {active ? (
                <motion.span
                  layoutId="task-workspace-tab"
                  className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent"
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                />
              ) : null}
            </button>
          )
        })}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, x: 5 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -4 }}
          transition={{ duration: 0.15 }}
          className="flex min-h-0 flex-1 flex-col"
        >
          {tab === 'now' ? <NowPanel task={task} capabilities={capabilities} onNavigate={(next) => setTab(next === 'tools' ? 'skills' : next)} /> : null}
          {tab === 'crew' ? <CrewPanel taskId={task.id} /> : null}
          {tab === 'skills' ? <SkillsPanel capabilities={capabilities} /> : null}
          {tab === 'mcp' ? <McpPanel capabilities={capabilities} /> : null}
          {tab === 'connectors' ? <ConnectorsPanel /> : null}
          {tab === 'files' ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <SourcesPanel task={task} />
              <ArtifactPanelBody task={task} />
            </div>
          ) : null}
          {tab === 'rook' ? <RookWorkerPanel /> : null}
          {tab === 'promey' ? <PromeyDuetPanel /> : null}
        </motion.div>
      </AnimatePresence>

      {footer ? (
        <div className="shrink-0 border-t border-line px-4 py-2.5 text-[10px] leading-relaxed text-faint">
          {footer}
        </div>
      ) : null}
    </aside>
  )
}
