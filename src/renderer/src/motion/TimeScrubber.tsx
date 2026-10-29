import type { CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Clock } from 'lucide-react'
import { cn } from '../lib/utils'

// The scrubber is a native range input (arrow keys keep working at five-minute
// steps). Chromium is the only engine this ships to, so the webkit pseudo-element
// rules below replace the system-blue native painting with the app's own tokens.
const scrubberStyles = `
.time-scrubber-input {
  -webkit-appearance: none;
  appearance: none;
  display: block;
  width: 100%;
  height: 6px;
  margin: 0;
  background: transparent;
  border-radius: 9999px;
  cursor: pointer;
}
.time-scrubber-input::-webkit-slider-runnable-track {
  box-sizing: border-box;
  height: 6px;
  border-radius: 9999px;
  border: 1px solid var(--color-line);
  background: linear-gradient(
    to right,
    var(--color-accent) 0%,
    var(--color-accent) var(--time-scrub-progress, 0%),
    var(--color-surface-2) var(--time-scrub-progress, 0%),
    var(--color-surface-2) 100%
  );
}
.time-scrubber-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  box-sizing: border-box;
  width: 16px;
  height: 16px;
  margin-top: -5px;
  border-radius: 9999px;
  background: var(--color-surface);
  border: 2px solid var(--color-accent);
  box-shadow: 0 0 0 1px var(--color-line-strong);
}
.time-scrubber-input:hover::-webkit-slider-thumb {
  border-color: var(--color-accent-ink);
}
.time-scrubber-input:active::-webkit-slider-thumb {
  background: var(--color-accent-soft);
}
.time-scrubber-input:focus {
  outline: none;
}
.time-scrubber-input:focus-visible {
  outline: 2px solid var(--color-accent-ink);
  outline-offset: 5px;
}
.time-scrubber-ticks span {
  width: 1px;
  height: 2px;
  background: var(--color-line-strong);
  opacity: 0.55;
}
.time-scrubber-ticks span.major {
  height: 4px;
  opacity: 0.9;
}
`

function Digit({ value }: { value: string }) {
  return (
    <span className="relative inline-block h-7 w-[14px] overflow-hidden text-center">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -12, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 430, damping: 31 }}
          className="absolute inset-0 font-mono text-[20px] leading-7 font-medium tracking-tight tabular-nums text-ink"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

export function TimeScrubber({ minutes, onChange }: { minutes: number; onChange: (minutes: number) => void }) {
  const value = Math.max(0, Math.min(1439, Math.round(minutes / 5) * 5))
  const hour = Math.floor(value / 60)
  const minute = value % 60
  const displayHour = hour % 12 || 12
  const period = hour < 12 ? 'AM' : 'PM'
  const digits = `${String(displayHour).padStart(2, '0')}${String(minute).padStart(2, '0')}`.split('')

  const setPeriod = (next: 'AM' | 'PM'): void => {
    const base = hour % 12
    onChange((next === 'PM' ? base + 12 : base) * 60 + minute)
  }

  return (
    <div className="rounded-xl border border-line bg-canvas/45 px-3.5 py-3">
      <style>{scrubberStyles}</style>
      <div className="flex items-center gap-3">
        <Clock size={13} className="shrink-0 text-accent" />
        <div className="flex items-center" aria-hidden="true">
          {digits.map((digit, index) => (
            <span key={index} className="flex items-center">
              {index === 2 ? (
                <span className="-mx-1 font-mono text-[18px] leading-7 text-faint">:</span>
              ) : null}
              <Digit value={digit} />
            </span>
          ))}
        </div>
        <div className="ml-auto flex rounded-lg border border-line bg-surface-2/60 p-0.5">
          {(['AM', 'PM'] as const).map((item) => (
            <button
              key={item}
              onClick={() => setPeriod(item)}
              aria-pressed={period === item}
              className={cn(
                'h-6 rounded-md px-2 text-[10px] font-medium transition-all',
                period === item ? 'bg-surface text-ink shadow-sm' : 'text-faint hover:text-ink'
              )}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="relative mt-3 px-0.5">
        <div className="time-scrubber-ticks absolute inset-x-0 top-[12px] flex justify-between" aria-hidden="true">
          {Array.from({ length: 25 }, (_, index) => <span key={index} className={index % 6 === 0 ? 'major' : ''} />)}
        </div>
        <input
          type="range"
          min={0}
          max={1435}
          step={5}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="time-scrubber-input relative z-10 w-full"
          style={{ '--time-scrub-progress': `${(value / 1435) * 100}%` } as CSSProperties}
          aria-label="Schedule time"
          aria-valuetext={`${displayHour}:${String(minute).padStart(2, '0')} ${period}`}
        />
        <div className="mt-3 flex justify-between font-mono text-[10px] tracking-tight tabular-nums text-faint" aria-hidden="true">
          <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
        </div>
      </div>
      <p className="mt-1 text-[10px] text-faint">Drag or use arrow keys · five-minute steps</p>
    </div>
  )
}
