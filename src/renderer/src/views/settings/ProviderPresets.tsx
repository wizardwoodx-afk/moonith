/**
 * Endpoint presets for the provider modal. A preset only fills the form — it
 * never saves, tests, or hides a field, so the user can correct anything the
 * preset guessed. Categories come from the shared preset table so the copy
 * here can never drift from the data.
 */
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ProviderPreset, ProviderPresetCategory } from '@shared/providerPresets'
import { PRESET_CATEGORY_LABELS, PROVIDER_PRESETS } from '@shared/providerPresets'
import { cn } from '../../lib/utils'

interface PresetGroup {
  category: ProviderPresetCategory
  label: string
  presets: { preset: ProviderPreset; delay: number }[]
}

const PRESET_GROUPS: PresetGroup[] = (() => {
  const order: ProviderPresetCategory[] = []
  const byCategory = new Map<ProviderPresetCategory, ProviderPreset[]>()
  for (const preset of PROVIDER_PRESETS) {
    const list = byCategory.get(preset.category)
    if (list) {
      list.push(preset)
    } else {
      byCategory.set(preset.category, [preset])
      order.push(preset.category)
    }
  }
  let index = 0
  return order.map((category) => ({
    category,
    label: PRESET_CATEGORY_LABELS[category],
    presets: (byCategory.get(category) ?? []).map((preset) => ({
      preset,
      delay: Math.min(index++, 8) * 20
    }))
  }))
})()

export function ProviderPresets({ onPick }: { onPick: (preset: ProviderPreset) => void }) {
  const [open, setOpen] = useState(false)

  return (
    <section aria-labelledby="provider-presets-heading" className="rounded-xl border border-line bg-surface-2/40">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="provider-presets"
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <span className="min-w-0">
          <span id="provider-presets-heading" className="block text-[12.5px] font-medium text-ink">
            Start from a preset
            <span className="ml-1.5 font-normal text-faint">· {PROVIDER_PRESETS.length} endpoints</span>
          </span>
          <span className="mt-0.5 block text-[10.5px] text-faint">
            Pick an endpoint to fill the form. Everything stays editable.
          </span>
        </span>
        <ChevronDown
          aria-hidden
          size={14}
          className={cn('shrink-0 text-muted transition-transform duration-200 ease-out', open && 'rotate-180')}
        />
      </button>

      {open ? (
        <div id="provider-presets" className="tab-enter space-y-2 border-t border-line px-3 py-2.5">
          {PRESET_GROUPS.map((group) => (
            <div key={group.category} className="flex flex-wrap items-start gap-1.5">
              <span className="mt-1.5 w-[74px] shrink-0 text-[10px] font-medium tracking-wide text-faint uppercase">
                {group.label}
              </span>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {group.presets.map(({ preset, delay }) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => onPick(preset)}
                    className="run-in min-w-[132px] rounded-lg border border-line bg-canvas/70 px-2 py-1.5 text-left transition-colors outline-none hover:border-accent/40 hover:bg-accent-soft/20 focus-visible:ring-2 focus-visible:ring-accent/40"
                    style={{ animationDelay: `${delay}ms` }}
                  >
                    <span className="block text-[11.5px] font-medium text-ink">{preset.name}</span>
                    <span className="mt-0.5 block text-[10px] leading-snug text-faint">
                      {preset.note}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
