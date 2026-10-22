import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, X } from 'lucide-react'
import { cn } from '../lib/utils'

type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'soft' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-on-ink hover:brightness-110 border border-transparent disabled:opacity-40',
  accent:
    'bg-accent text-on-ink hover:brightness-110 border border-transparent disabled:opacity-40',
  secondary:
    'bg-surface text-ink border border-line hover:bg-surface-2 hover:border-line-strong disabled:opacity-45',
  ghost:
    'bg-transparent text-muted border border-transparent hover:bg-surface-2 hover:text-ink disabled:opacity-40',
  soft: 'bg-surface-2 text-ink border border-transparent hover:bg-surface-3 disabled:opacity-45',
  danger:
    'bg-transparent text-danger border border-danger/25 hover:bg-danger/10 disabled:opacity-40'
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[12.5px] rounded-lg gap-1.5',
  md: 'h-9 px-3.5 text-[13px] rounded-[10px] gap-2',
  lg: 'h-11 px-5 text-[13.5px] rounded-xl gap-2',
  icon: 'h-8 w-8 rounded-lg justify-center'
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-default',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : null}
      {children}
    </button>
  )
}

export function IconButton({
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors outline-none hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40',
        className
      )}
    >
      {children}
    </button>
  )
}

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label?: string
}

export function Toggle({ checked, onChange, disabled, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-[22px] w-[38px] shrink-0 rounded-full border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        checked
          ? 'border-transparent bg-accent'
          : 'border-line-strong bg-surface-2',
        disabled && 'opacity-40'
      )}
    >
      <span
        className={cn(
          'absolute top-[2px] h-[16px] w-[16px] rounded-full shadow-sm transition-transform',
          checked ? 'bg-on-ink translate-x-[18px]' : 'bg-ink translate-x-[3px]'
        )}
      />
    </button>
  )
}

interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  hint?: string
}

interface SegmentedProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: SegmentedOption<T>[]
  className?: string
  size?: 'sm' | 'md'
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md'
}: SegmentedProps<T>) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-[10px] border border-line bg-surface-2/70 p-0.5',
        className
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.hint}
          onClick={() => onChange(option.value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg font-medium transition-all',
            size === 'sm' ? 'h-6 px-2 text-[11.5px]' : 'h-7 px-2.5 text-[12px]',
            value === option.value
              ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(30,24,18,0.12)]'
              : 'text-muted hover:text-ink'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: string
  icon?: ReactNode
  className?: string
  bodyClassName?: string
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'max-w-lg',
  icon,
  className,
  bodyClassName
}: ModalProps) {
  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          <div
            className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={{ duration: 0.18, ease: [0.2, 0.7, 0.3, 1] }}
            className={cn(
              'relative flex max-h-[86vh] w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_40px_100px_-40px_rgba(25,18,10,0.5)]',
              width,
              className
            )}
          >
            {(title || subtitle) && (
              <div className="flex items-start gap-3 border-b border-line px-6 py-4">
                {icon ? (
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink">
                    {icon}
                  </div>
                ) : null}
                <div className="min-w-0 flex-1">
                  {title ? (
                    <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
                  ) : null}
                  {subtitle ? (
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{subtitle}</p>
                  ) : null}
                </div>
                <IconButton onClick={onClose} aria-label="Close">
                  <X size={15} />
                </IconButton>
              </div>
            )}
            <div className={cn('scroll-thin min-h-0 flex-1 overflow-y-auto px-6 py-5', bodyClassName)}>
              {children}
            </div>
            {footer ? (
              <div className="flex items-center justify-end gap-2 border-t border-line bg-canvas/40 px-6 py-3.5">
                {footer}
              </div>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  )
}

interface PopoverProps {
  trigger: (props: {
    onClick: (event: React.MouseEvent) => void
    'aria-expanded': boolean
  }) => ReactNode
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
  side?: 'top' | 'bottom'
  className?: string
  panelClassName?: string
}

export function Popover({
  trigger,
  children,
  align = 'left',
  side = 'bottom',
  className,
  panelClassName
}: PopoverProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      {trigger({
        onClick: (event) => {
          event.stopPropagation()
          setOpen((value) => !value)
        },
        'aria-expanded': open
      })}
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: side === 'top' ? 4 : -4, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: side === 'top' ? 2 : -2 }}
            transition={{ duration: 0.13 }}
            className={cn(
              'dropdown-panel absolute z-40 min-w-[200px] p-1.5',
              side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
              align === 'left' ? 'left-0' : 'right-0',
              panelClassName
            )}
          >
            {children(() => setOpen(false))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

export function FieldGroup({
  label,
  hint,
  children,
  className
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-[12.5px] font-medium text-ink">{label}</label>
        {hint ? <span className="text-[11.5px] text-faint">{hint}</span> : null}
      </div>
      {children}
    </div>
  )
}

export function Spin({ size = 14, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cn('animate-spin', className)} />
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[5px] border border-line bg-surface/70 px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted">
      {children}
    </kbd>
  )
}
