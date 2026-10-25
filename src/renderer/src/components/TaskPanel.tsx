import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity,
  Bot,
  FolderOpen,
  PanelRightClose,
  RefreshCw,
  Wrench
} from 'lucide-react'
import type { Task } from '@shared/types'
import { useApp } from '../store'
import { cn } from '../lib/utils'
import { IconButton } from './ui'
import { ArtifactPanelBody } from './Artifacts'
import { CrewPanel } from './task-panel/CrewRuns'
import { NowPanel } from './task-panel/NowPanel'
import { SourcesPanel } from './task-panel/SourcesPanel'
import { ToolsPanel } from './task-panel/ToolsPanel'
import { useTaskCapabilities } from './task-panel/useTaskCapabilities'

type PanelTab = 'now' | 'crew' | 'tools' | 'files'

const TABS = [
  { id: 'now', label: 'Now', icon: Activity },
  { id: 'crew', label: 'Crew', icon: Bot },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'files', label: 'Files', icon: FolderOpen }
] as const

export function TaskPanel({ task, onClose }: { task: Task; onClose: () => void }) {
  const [tab, setTab] = useState<PanelTab>('now')
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
    if (id === 'tools') return capabilities.loading ? null : capabilities.skills.length + capabilities.configs.length || null
    if (id === 'files') return task.artifacts.length || null
    return null
  }

  return (
    <aside aria-label="Task workspace" className="panel-in flex h-full w-[380px] max-w-[92vw] shrink-0 flex-col border-l border-line bg-canvas-deep/65">
      <div className="flex h-[54px] shrink-0 items-center gap-2.5 border-b border-line px-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-surface text-accent">
          <Activity size={13} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[12px] font-semibold tracking-[-0.01em] text-ink">Task workspace</h2>
          <p className="mt-0.5 text-[8.5px] text-faint">Live activity, capabilities, and output</p>
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton
            onClick={() => void Promise.all([refreshSubAgents(), capabilities.refresh()])}
            aria-label="Refresh Crew, skills, and MCP"
            title="Refresh Crew, skills, and MCP"
            disabled={capabilities.refreshing}
          >
            <RefreshCw size={13} className={capabilities.refreshing ? 'animate-spin' : ''} />
          </IconButton>
          <IconButton onClick={onClose} aria-label="Close workspace panel">
            <PanelRightClose size={14} />
          </IconButton>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-4 border-b border-line px-2" role="tablist" aria-label="Task workspace sections">
        {TABS.map((item) => {
          const Icon = item.icon
          const active = tab === item.id
          const count = countFor(item.id)
          return (
            <button
              key={item.id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(item.id)}
              className={cn(
                'relative flex h-11 items-center justify-center gap-1.5 text-[10px] font-medium transition-colors outline-none focus-visible:bg-surface-2/50',
                active ? 'text-ink' : 'text-faint hover:text-muted'
              )}
            >
              <Icon size={11} />
              {item.label}
              {count !== null ? <span className={cn('font-mono text-[8px]', item.id === 'crew' && liveCrew ? 'text-accent' : 'text-faint')}>{count}</span> : null}
              {active ? <motion.span layoutId="task-workspace-tab" className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" transition={{ type: 'spring', stiffness: 420, damping: 32 }} /> : null}
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
          {tab === 'now' ? <NowPanel task={task} capabilities={capabilities} onNavigate={setTab} /> : null}
          {tab === 'crew' ? <CrewPanel taskId={task.id} /> : null}
          {tab === 'tools' ? <ToolsPanel capabilities={capabilities} /> : null}
          {tab === 'files' ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <SourcesPanel task={task} />
              <ArtifactPanelBody task={task} />
            </div>
          ) : null}
        </motion.div>
      </AnimatePresence>

      <div className="shrink-0 border-t border-line px-4 py-2.5 text-[9px] leading-relaxed text-faint">
        {tab === 'crew'
          ? 'Crew inherits Captain’s role and tool gates. Runs are stored on this device.'
          : tab === 'tools'
            ? 'Installed skills and ready, exposed MCP tools are available to Captain.'
            : tab === 'files'
              ? 'Sources are explicit. Created files stay attached to this task.'
              : 'Live task state only · no synthetic activity or usage claims.'}
      </div>
    </aside>
  )
}
