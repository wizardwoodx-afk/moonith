import { useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import type { SkillDetail } from '@shared/types'
import { useApp } from '../../store'
import { errorMessage } from '../../lib/utils'
import { Button, Modal, Spin } from '../ui'
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
  action?: React.ReactNode
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

export function SkillsPanel({ capabilities }: { capabilities: TaskCapabilities }) {
  const openSettings = useApp((state) => state.openSettings)
  const [reading, setReading] = useState<string | null>(null)
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [filter, setFilter] = useState('')

  const readSkill = async (id: string): Promise<void> => {
    setReading(id)
    try {
      const skill = await window.knight.readSkill(id)
      if (skill) setDetail(skill)
      else toast.error('That skill could not be read.')
    } catch (cause) {
      toast.error(errorMessage(cause))
    } finally {
      setReading(null)
    }
  }

  if (capabilities.loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-3 text-muted">
        <TaskOrb state="connecting" label="Loading skills" />
        <span className="text-[10.5px]">Loading skills</span>
      </div>
    )
  }

  const query = filter.trim().toLowerCase()
  const filteredSkills = capabilities.skills.filter(
    (s) => !query || s.name.toLowerCase().includes(query) || s.description.toLowerCase().includes(query)
  )

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2.5 pt-3 pb-4">
      <div className="mb-3 rounded-xl border border-line bg-canvas/45 px-3 py-2.5">
        <div className="flex items-center justify-between">
          <p className="text-[10.5px] leading-relaxed text-muted">
            <span className="font-medium text-ink">{capabilities.skills.length} skills</span> in Impulse Skill Hub
          </p>
          <button
            onClick={() => openSettings('skills')}
            className="flex items-center gap-1 text-[10px] text-accent hover:underline cursor-pointer"
          >
            <Icon name="spark" size="xs" active /> Browse Hub
          </button>
        </div>
        <div className="mt-2">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search skills & playbooks..."
            className="w-full rounded-lg border border-line bg-surface/70 px-2.5 py-1 text-[11px] text-ink outline-none placeholder:text-faint focus:border-accent"
          />
        </div>
      </div>

      <section>
        <SectionHeading
          icon="spark"
          title="Impulse Skills & Playbooks"
          detail="Extensible capabilities loaded into this agent"
          action={
            <button
              onClick={() => openSettings('skills')}
              className="flex items-center gap-1 text-[10px] text-faint hover:text-ink cursor-pointer"
            >
              <Icon name="settingsFine" size="xs" /> Manage
            </button>
          }
        />
        {filteredSkills.length ? (
          <div className="space-y-1.5">
            {filteredSkills.map((skill, index) => (
              <motion.button
                key={skill.id}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index, 8) * 0.02 }}
                onClick={() => void readSkill(skill.id)}
                className="flex w-full items-start gap-2.5 rounded-xl border border-line bg-surface/40 px-3 py-2.5 text-left hover:border-line-strong hover:bg-surface/65 transition-colors cursor-pointer"
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-ink">
                  {reading === skill.id ? <Spin size={ICON_SIZES.sm} /> : <Icon name="spark" size="sm" active />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 truncate text-[11px] font-medium text-ink" title={skill.name}>
                      {skill.name}
                    </span>
                    <span className="ml-auto shrink-0 rounded px-1.5 py-0.2 bg-surface-2 text-[9px] text-faint font-mono">
                      {skill.id.startsWith('impulse_') ? 'Skill Hub' : skill.source === 'local' ? 'Local' : 'Installed'}
                    </span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-muted" title={skill.description}>
                    {skill.description}
                  </span>
                </span>
              </motion.button>
            ))}
          </div>
        ) : (
          <button
            onClick={() => openSettings('skills')}
            className="w-full rounded-xl border border-dashed border-line px-4 py-6 text-center hover:bg-surface/40 cursor-pointer"
          >
            <Icon name="spark" size="lg" className="mx-auto text-faint" />
            <span className="mt-2 block text-[10.5px] font-medium text-ink">No skills match search</span>
            <span className="mt-0.5 block text-[10px] text-faint">Click to open Impulse Skill Hub catalog</span>
          </button>
        )}
      </section>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.name}
        subtitle={detail ? `${detail.description} · ${detail.files} file${detail.files === 1 ? '' : 's'}` : undefined}
        width="max-w-2xl"
        icon={<Icon name="spark" size="lg" active />}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>
            <Button variant="secondary" onClick={() => { setDetail(null); openSettings('skills') }}>Manage skills</Button>
          </>
        }
      >
        <pre className="scroll-thin max-h-[58vh] overflow-auto rounded-xl border border-line bg-canvas px-4 py-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink/85">
          {detail?.content}
        </pre>
      </Modal>
    </div>
  )
}
