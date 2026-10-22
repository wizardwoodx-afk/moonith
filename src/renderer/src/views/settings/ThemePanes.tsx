import type { CSSProperties } from 'react'
import { Check, ChevronRight, Moon, SwatchBook } from 'lucide-react'
import { useApp } from '../../store'
import { THEMES, useTheme, type Theme } from '../../lib/themes'
import { cn } from '../../lib/utils'

function tokenStyle(theme: Theme): CSSProperties {
  return theme.tokens as unknown as CSSProperties
}

const STARTER_THEMES = THEMES.filter((theme) => !theme.exclusive)
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
    <button
      onClick={() => setTheme(theme.id)}
      aria-pressed={active}
      title={theme.description}
      style={tokenStyle(theme)}
      className={cn(
        'group relative overflow-hidden rounded-xl border bg-canvas text-left transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        active
          ? 'border-line-strong ring-1 ring-accent/35'
          : 'border-line hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[0_16px_36px_-28px_rgba(0,0,0,0.75)]'
      )}
    >
      <Miniature theme={theme} />
      <div className="flex items-center gap-2 border-t border-line bg-canvas px-3 py-2.5">
        <span className="truncate text-[12px] font-medium text-ink">{theme.label}</span>
        <span className="text-[9.5px] text-faint">{theme.kind === 'dark' ? 'Dark' : 'Light'}</span>
        <span className="ml-auto flex h-[18px] w-[18px] items-center justify-center">
          {active ? (
            <span className="flex h-[16px] w-[16px] items-center justify-center rounded-full bg-ink text-on-ink">
              <Check size={10} strokeWidth={2.6} />
            </span>
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-line-strong transition-colors group-hover:bg-faint" />
          )}
        </span>
      </div>
    </button>
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
            <span className="rounded-full border border-line px-1.5 py-px text-[8.5px] font-medium tracking-[0.04em] text-faint uppercase">
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
  const openSettings = useApp((state) => state.openSettings)
  const themeId = useTheme((state) => state.themeId)
  const current = THEMES.find((theme) => theme.id === themeId) ?? THEMES[0]

  return (
    <div className="card divide-y divide-line overflow-hidden">
      <PreviewRow
        icon={SwatchBook}
        title="Colors"
        detail={current.label}
        colors={swatches(current, ['--c-canvas', '--c-surface', '--c-ink', '--c-accent'])}
        onClick={() => openSettings('colors')}
      />
      <PreviewRow
        icon={Moon}
        title="Moon"
        detail="The exclusive night"
        colors={swatches(MOON_THEME, ['--c-canvas', '--c-ink', '--c-accent'])}
        onClick={() => openSettings('moon')}
        exclusive
      />
    </div>
  )
}

export function ColorsPane() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {STARTER_THEMES.map((theme) => (
        <ThemeCard key={theme.id} theme={theme} />
      ))}
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
        <p className="mt-4 max-w-[380px] text-[12px] leading-[1.8] text-muted">
          Deep black. Moon white. One cool light.
        </p>

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
              <p className="mt-0.5 font-mono text-[8px] text-faint">{swatch.value}</p>
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
