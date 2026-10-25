import { AnimatePresence, motion } from 'framer-motion'
import { Clock } from 'lucide-react'
import { cn } from '../lib/utils'

function Digit({ value }: { value: string }) {
  return (
    <span className="relative inline-block h-7 w-[18px] overflow-hidden text-center">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -12, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 430, damping: 31 }}
          className="absolute inset-0 font-mono text-[20px] leading-7 font-medium text-ink"
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
      <div className="flex items-center gap-3">
        <Clock size={13} className="shrink-0 text-accent" />
        <div className="flex items-center" aria-hidden="true">
          {digits.map((digit, index) => (
            <span key={index} className="flex items-center">
              {index === 2 ? <span className="px-0.5 font-mono text-[18px] text-faint">:</span> : null}
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
                'h-6 rounded-md px-2 text-[9.5px] font-medium transition-all',
                period === item ? 'bg-surface text-ink shadow-sm' : 'text-faint hover:text-ink'
              )}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="relative mt-3 px-0.5">
        <div className="time-scrubber-ticks absolute inset-x-0 top-[7px] flex justify-between" aria-hidden="true">
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
          aria-label="Schedule time"
          aria-valuetext={`${displayHour}:${String(minute).padStart(2, '0')} ${period}`}
        />
        <div className="mt-1.5 flex justify-between font-mono text-[8px] text-faint" aria-hidden="true">
          <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
        </div>
      </div>
      <p className="mt-1 text-[9px] text-faint">Drag or use arrow keys · five-minute steps</p>
    </div>
  )
}
