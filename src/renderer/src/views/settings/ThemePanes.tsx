import { useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronRight, Moon, SwatchBook } from 'lucide-react'
import { useApp } from '../../store'
import {
  ATELIER_THEME_IDS,
  THEMES,
  themeCollection,
  useTheme,
  type Theme,
  type ThemeCollection
} from '../../lib/themes'
import { cn } from '../../lib/utils'
import { MOTION_PREFERENCES, useMotion } from '../../lib/motion'
import { NewCollectionBadge } from '../../motion/MetalAction'
import { CountTabs, SettingList, SettingRow } from './settingParts'
import { SettingsSection } from './SettingsSection'

function tokenStyle(theme: Theme): CSSProperties {
  return theme.tokens as unknown as CSSProperties
}

const MOON_THEME = THEMES.find((theme) => theme.exclusive) ?? THEMES[THEMES.length - 1]

function swatches(theme: Theme, keys: string[]): string[] {
  return keys.map((key) => theme.tokens[key]).filter(Boolean)
}

function Miniature({ theme }: { theme: Theme }) {
  return (
    <div className="relative h-[124px] overflow-hidden bg-canvas">
      <div className="flex h-full">
        <div className="flex w-[46px] flex-col gap-2 border-r border-line bg-sidebar px-2 py-3">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          <span className="mt-1 h-1 w-full rounded-full bg-ink/65" />
          <span className="h-1 w-3/4 rounded-full bg-ink/18" />
          <span className="h-1 w-2/3 rounded-full bg-ink/18" />
          <span className="mt-auto h-3 w-full rounded bg-surface-2" />
        </div>
        <div className="relative min-w-0 flex-1 px-3 py-3">
          <div className="flex items-center justify-between">
            <div className="h-1.5 w-[42%] rounded-full bg-ink/75" />
            <div className="h-2.5 w-2.5 rounded-full bg-accent/50" />
          </div>
          <div className="mt-1.5 h-1 w-[58%] rounded-full bg-ink/18" />
          <div className="mt-3 rounded-md border border-line bg-surface p-2">
            <div className="h-1 w-[74%] rounded-full bg-ink/25" />
            <div className="mt-1.5 h-1 w-[48%] rounded-full bg-ink/12" />
            <div className="mt-2.5 flex items-center justify-between">
              <span className="h-2.5 w-7 rounded-full border border-line bg-surface-2" />
              <span className="h-3 w-3 rounded-full bg-accent" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ThemeCard({ theme }: { theme: Theme }) {
  const themeId = useTheme((state) => state.themeId)
  const setTheme = useTheme((state) => state.setTheme)
  const active = theme.id === themeId

  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 7 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ type: 'spring', stiffness: 360, damping: 28 }}
      onClick={() => setTheme(theme.id)}
      aria-pressed={active}
      title={theme.description}
      style={tokenStyle(theme)}
      className={cn(
        'group relative overflow-hidden rounded-xl border bg-canvas text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        active
          ? 'border-line-strong ring-1 ring-accent/35'
          : 'border-line hover:border-line-strong hover:shadow-[0_16px_36px_-28px_rgba(0,0,0,0.75)]'
      )}
    >
      <Miniature theme={theme} />
      <div className="flex items-center gap-2 border-t border-line bg-canvas px-3 py-2.5">
        <span className="min-w-0 truncate text-[12px] font-medium text-ink" title={theme.label}>{theme.label}</span>
        <span className="text-[10px] text-faint">{theme.kind === 'dark' ? 'Dark' : 'Light'}</span>
        <span className="ml-auto flex h-[18px] w-[18px] items-center justify-center">
          {active ? (
            <span className="flex h-[16px] w-[16px] items-center justify-center rounded-full bg-accent text-on-ink">
              <Check size={10} strokeWidth={2.6} />
            </span>
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-line-strong transition-colors group-hover:bg-faint" />
          )}
        </span>
      </div>
      {theme.origin === 'atelier' ? (
        <span className="absolute top-2 right-2 rounded-full border border-line bg-canvas/85 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-muted uppercase backdrop-blur-sm">
          Atelier
        </span>
      ) : null}
    </motion.button>
  )
}

function PreviewRow({
  icon: Icon,
  title,
  detail,
  colors,
  onClick,
  exclusive
}: {
  icon: typeof SwatchBook
  title: string
  detail: string
  colors: string[]
  onClick: () => void
  exclusive?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className="group relative flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-surface-2/40"
    >
      <span
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border',
          exclusive
            ? 'border-accent/25 bg-accent-soft/60 text-accent'
            : 'border-line bg-surface text-muted'
        )}
      >
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
          {title}
          {exclusive ? (
            <span className="rounded-full border border-line px-1.5 py-px text-[10px] font-medium tracking-[0.04em] text-faint uppercase">
              Exclusive
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-[11px] text-faint">{detail}</span>
      </span>
      <span className="hidden items-center gap-1 sm:flex">
        {colors.map((color) => (
          <span
            key={color}
            className="h-4 w-4 rounded-full border border-line-strong/50"
            style={{ background: color }}
          />
        ))}
      </span>
      <ChevronRight
        size={14}
        className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-muted"
      />
    </button>
  )
}

export function AppearancePane() {
  return (
    <div className="space-y-10">
      <ColorsPane />
      <div className="pt-6 border-t border-line/60">
        <MotionPane />
      </div>
      <div className="pt-6 border-t border-line/60">
        <MoonPane />
      </div>
    </div>
  )
}

/**
 * One row per choice, with the mode spelled out. The person sets this
 * themselves: a machine that reports "reduce motion" should not quietly freeze
 * the interface, and the working loaders keep moving either way.
 */
export function MotionPane() {
  const preference = useMotion((state) => state.preference)
  const setPreference = useMotion((state) => state.setPreference)

  return (
    <SettingsSection title="Motion">
      <SettingList>
        {MOTION_PREFERENCES.map((option) => (
          <SettingRow
            key={option.value}
            title={option.label}
            description={option.detail}
            tone={preference === option.value ? 'accent' : 'default'}
          >
            <button
              type="button"
              role="radio"
              aria-checked={preference === option.value}
              aria-label={`Motion: ${option.label}`}
              onClick={() => setPreference(option.value)}
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full border transition-colors',
                preference === option.value
                  ? 'border-accent/40 bg-accent-soft/70 text-accent-ink'
                  : 'border-line bg-surface-2/60 text-transparent hover:border-line-strong'
              )}
            >
              <Check size={12} strokeWidth={2.6} />
            </button>
          </SettingRow>
        ))}
      </SettingList>
    </SettingsSection>
  )
}

const COLLECTION_COPY: Record<ThemeCollection, { title: string; detail: string }> = {
  solo: {
    title: 'Solo',
    detail: 'Quiet neutrals, editorial papers, and spatial darks for individual focus.'
  },
  teams: {
    title: 'Teams',
    detail: 'Distinct operational hues and agent-friendly identities for collaborative work.'
  }
}

export function ColorsPane() {
  const themeId = useTheme((state) => state.themeId)
  const [collection, setCollection] = useState<ThemeCollection>(() => themeCollection(themeId))
  const themes = THEMES.filter((theme) => themeCollection(theme.id) === collection)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h2 className="text-[12px] font-medium text-muted">Color collections</h2>
        </div>
        <NewCollectionBadge>{`${ATELIER_THEME_IDS.length} new`}</NewCollectionBadge>
      </div>

      <CountTabs
        value={collection}
        onChange={setCollection}
        tabs={(Object.keys(COLLECTION_COPY) as ThemeCollection[]).map((value) => ({
          value,
          label: COLLECTION_COPY[value].title,
          count: THEMES.filter((theme) => themeCollection(theme.id) === value).length
        }))}
      />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={collection}
          initial={{ opacity: 0, x: collection === 'solo' ? -10 : 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: collection === 'solo' ? 8 : -8 }}
          transition={{ duration: 0.18 }}
          className="space-y-5"
        >
          <div className="px-1">
            <h3 className="text-[12px] font-medium text-muted">{COLLECTION_COPY[collection].title}</h3>
            <p className="mt-1 text-[12px] leading-[1.6] text-faint">{COLLECTION_COPY[collection].detail}</p>
          </div>
          {(['light', 'dark'] as const).map((kind) => {
            const group = themes.filter((theme) => theme.kind === kind)
            return (
              <section key={kind} className="space-y-2.5" aria-labelledby={`${collection}-${kind}-heading`}>
                <div className="flex items-center gap-2 px-1">
                  <h4 id={`${collection}-${kind}-heading`} className="text-[10px] font-semibold tracking-[0.13em] text-faint uppercase">
                    {kind === 'light' ? 'Day' : 'Night'}
                  </h4>
                  <span className="h-px flex-1 bg-line" />
                  <span className="font-mono text-[10px] text-faint">{group.length}</span>
                </div>
                <motion.div layout className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {group.map((theme) => <ThemeCard key={theme.id} theme={theme} />)}
                </motion.div>
              </section>
            )
          })}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

export function MoonPane() {
  const themeId = useTheme((state) => state.themeId)
  const setTheme = useTheme((state) => state.setTheme)
  const openSettings = useApp((state) => state.openSettings)
  const active = themeId === 'moon'

  return (
    <div
      data-theme="moon"
      className="relative overflow-hidden rounded-2xl border border-line bg-canvas text-ink"
    >
      <div className="moon-halo pointer-events-none absolute inset-0" />
      <div className="relative px-8 py-8 sm:px-10 sm:py-10">
        <h2 className="serif-display text-[58px] leading-[0.92] text-ink">Moon</h2>

        <div className="mt-8 grid grid-cols-3 gap-2.5">
          {[
            { name: 'Canvas', value: '#050506' },
            { name: 'Moon white', value: '#E6E4DE' },
            { name: 'Glow', value: '#C7C4E8' }
          ].map((swatch) => (
            <div key={swatch.name} className="rounded-xl border border-line bg-surface/60 px-2.5 py-2.5">
              <span
                className="block h-7 w-full rounded-md border border-line"
                style={{ background: swatch.value }}
              />
              <p className="mt-2 text-[10px] font-medium text-ink">{swatch.name}</p>
              <p className="mt-0.5 font-mono text-[10px] text-faint">{swatch.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button
            onClick={() => setTheme('moon')}
            disabled={active}
            className={cn(
              'inline-flex h-8 items-center gap-2 rounded-full px-3.5 text-[11.5px] font-medium transition-colors',
              active ? 'border border-line text-muted' : 'bg-ink-button text-on-ink hover:opacity-90'
            )}
          >
            {active ? (
              <>
                <Check size={12} />
                Moon is on
              </>
            ) : (
              <>
                <Moon size={12} />
                Use Moon
              </>
            )}
          </button>
          <button
            onClick={() => openSettings('colors')}
            className="text-[11.5px] text-muted transition-colors hover:text-ink"
          >
            Colors
          </button>
        </div>
      </div>
    </div>
  )
}
