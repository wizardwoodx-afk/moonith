import { motion } from 'framer-motion'
import { Bot, Check, ChevronDown, Eye, Search, Settings2 } from 'lucide-react'
import type { AgentRole } from '@shared/governance'
import { AGENT_ROLE_LABELS } from '@shared/governance'
import { Popover } from '../components/ui'
import { cn } from '../lib/utils'

const ROLES: Array<{
  value: AgentRole
  detail: string
  icon: typeof Bot
}> = [
  { value: 'executor', detail: 'Read, write, execute, network, delegate', icon: Bot },
  { value: 'researcher', detail: 'Read, network, delegate · medium risk', icon: Search },
  { value: 'viewer', detail: 'Read only · low risk', icon: Eye },
  { value: 'custom', detail: 'Your custom capability policy', icon: Settings2 }
]

export function RolePicker({
  value,
  onChange,
  disabled
}: {
  value: AgentRole
  onChange: (role: AgentRole) => void
  disabled?: boolean
}) {
  const current = ROLES.find((role) => role.value === value) ?? ROLES[0]
  const CurrentIcon = current.icon

  return (
    <Popover
      align="left"
      panelClassName="w-[270px] p-1.5"
      trigger={(open) => (
        <button
          disabled={disabled}
          className={cn(
            'menu-item flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-xs text-muted hover:bg-hover hover:text-ink',
            open && 'bg-hover text-ink',
            disabled && 'cursor-not-allowed opacity-40'
          )}
        >
          <CurrentIcon size={14} />
          Agent role
          <span className="ml-auto flex items-center gap-1 text-[10px] text-faint">
            {AGENT_ROLE_LABELS[value]}
            <ChevronDown size={10} className={cn('transition-transform', open && 'rotate-180')} />
          </span>
        </button>
      )}
    >
      {(close) => (
        <div role="menu" aria-label="Agent role">
          <div className="px-2.5 pt-2 pb-1.5">
            <p className="text-[11px] font-medium text-ink">Task capability profile</p>
            <p className="mt-0.5 text-[10px] text-faint">Enforced when tools and memory are used.</p>
          </div>
          {ROLES.map((role, index) => {
            const Icon = role.icon
            const selected = role.value === value
            return (
              <motion.button
                key={role.value}
                role="menuitemradio"
                aria-checked={selected}
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.035 }}
                onClick={() => {
                  onChange(role.value)
                  close()
                }}
                className={cn(
                  'menu-item flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-hover',
                  selected && 'bg-accent-soft'
                )}
              >
                <Icon size={13} className={cn('mt-0.5 shrink-0', selected ? 'text-accent' : 'text-faint')} />
                <span className="min-w-0">
                  <span className="block text-[11.5px] text-ink">{AGENT_ROLE_LABELS[role.value]}</span>
                  <span className="mt-0.5 block text-[10px] leading-4 text-faint">{role.detail}</span>
                </span>
                {selected ? <Check size={12} className="mt-0.5 ml-auto shrink-0 text-accent" /> : null}
              </motion.button>
            )
          })}
        </div>
      )}
    </Popover>
  )
}
