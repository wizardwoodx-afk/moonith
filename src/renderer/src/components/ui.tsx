import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { cn } from '../lib/utils'
import { Icon } from './icons'

type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'soft' | 'danger'
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

/* The elevation ladder: four levels, defined once, and every surface in the
 * renderer takes its hairline and its ambient shadow from one of them. A
 * component that needs a depth between two levels is a bug in the ladder, not
 * a licence to write a shadow by hand — the per-component `shadow-[...]`
 * values this replaced were warm-brown constants that read as dirt under the
 * cool palettes.
 *
 * `Elev` is the neutral recipe (hairline + shadow). `ElevShadow` is the depth
 * on its own, for surfaces that bring a state colour to the border: a failed
 * turn or a draft awaiting review still sits at Lv2, it just does not wear the
 * neutral line. Values resolve against the palette through `--elev-*`, so all
 * the themes get their own separation strength without a single override. */
export const Elev = {
  /** Lv1 — content on its own plane: rails, rows, chips, separators. */
  hairline: 'border border-line',
  /** Lv2 — cards and controls. The only level a body surface may use. */
  raised: 'border border-line shadow-[var(--elev-raised)]',
  /** Lv3 — floating above content: popovers, menus, transient panels. */
  floating: 'border border-line shadow-[var(--elev-floating)]',
  /** Lv4 — above a scrim: modals and drawers. */
  overlay: 'border border-line-strong shadow-[var(--elev-overlay)]'
} as const

export const ElevShadow = {
  raised: 'shadow-[var(--elev-raised)]',
  floating: 'shadow-[var(--elev-floating)]',
  overlay: 'shadow-[var(--elev-overlay)]'
} as const

/* Press feedback is deliberate: the tactile dip stays, only softened. Both
 * pairs are declared once so the variants that must press to the same depth
 * cannot drift apart. */
const pressDeep = 'active:translate-y-[1px] active:scale-[0.985]'
const pressLight = 'active:translate-y-[0.5px] active:scale-[0.985]'

/* The lit top edge of a filled control. It is bevel, not elevation, so it is
 * not on the ladder — but it is declared once here so the two accent variants
 * cannot disagree. */
const accentFace = 'shadow-[var(--elev-raised),inset_0_1px_0_rgba(255,255,255,0.22)]'
const accentFacePressed = 'active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.35)]'

/* Hover no longer deepens the shadow. A control that cast a bigger shadow two
 * pixels off its rest position made whole toolbars shimmer under the pointer;
 * the lift and the brightness step carry the same message flatly. */
const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-on-ink border border-transparent ' +
    accentFace +
    ' hover:brightness-105 hover:-translate-y-[0.5px] ' +
    pressDeep +
    ' ' +
    accentFacePressed +
    ' disabled:opacity-40 disabled:transform-none disabled:shadow-none',
  accent:
    'bg-accent text-on-ink border border-transparent ' +
    accentFace +
    ' hover:brightness-105 hover:-translate-y-[0.5px] ' +
    pressDeep +
    ' ' +
    accentFacePressed +
    ' disabled:opacity-40 disabled:transform-none disabled:shadow-none',
  secondary:
    'bg-surface text-ink ' +
    Elev.raised +
    ' hover:bg-surface-2 hover:border-line-strong hover:-translate-y-[0.5px] ' +
    pressDeep +
    ' active:shadow-[inset_0_2px_3.5px_rgba(0,0,0,0.22)] disabled:opacity-45 disabled:transform-none disabled:shadow-none',
  ghost:
    'bg-transparent text-muted border border-transparent hover:bg-surface-2 hover:text-ink active:scale-[0.97] active:translate-y-[0.5px] disabled:opacity-40 disabled:transform-none',
  soft:
    'bg-surface-2 text-ink border border-transparent ' +
    ElevShadow.raised +
    ' hover:bg-surface-3 hover:-translate-y-[0.5px] ' +
    pressLight +
    ' active:shadow-[inset_0_1.5px_2.5px_rgba(0,0,0,0.18)] disabled:opacity-45 disabled:transform-none disabled:shadow-none',
  danger:
    'bg-transparent text-danger border border-danger/25 hover:bg-danger/10 hover:border-danger/45 hover:-translate-y-[0.5px] ' +
    pressLight +
    ' active:bg-danger/15 disabled:opacity-40 disabled:transform-none'
}

const sizeClasses: Record<ButtonSize, string> = {
  xs: 'h-6 px-3 text-[12px] rounded-lg gap-1.5',
  sm: 'h-8 px-3 text-[12px] rounded-lg gap-1.5',
  md: 'h-9 px-4 text-[13px] rounded-[10px] gap-2',
  lg: 'h-11 px-5 text-[14px] rounded-xl gap-2',
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
        'inline-flex items-center justify-center whitespace-nowrap font-medium transition-[transform,box-shadow,background-color,border-color,opacity,filter] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-accent/40 cursor-pointer disabled:cursor-default',
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
        'inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-[transform,background-color,color] duration-150 ease-out outline-none hover:bg-surface-2 hover:text-ink hover:-translate-y-[0.5px] active:translate-y-[0.5px] active:scale-[0.95] active:bg-surface-3 active:duration-75 focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40 disabled:transform-none cursor-pointer disabled:cursor-default',
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
        'relative h-5 w-8 shrink-0 rounded-full border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        checked
          ? 'border-transparent bg-positive'
          : 'border-line-strong bg-surface-2',
        disabled && 'opacity-40'
      )}
    >
      {/* The track is 32x20 with a 1px border, so its inner box is 30x18. The
       * knob is 14px: top = (18-14)/2 centres it, and the travel is
       * 30-14-2*2 = 12px so both states keep the same 2px inset. */}
      <span
        className={cn(
          'absolute top-[2px] left-[2px] h-[14px] w-[14px] rounded-full transition-transform',
          ElevShadow.raised,
          checked ? 'bg-on-ink translate-x-[12px]' : 'bg-ink translate-x-0'
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
        'inline-flex items-center gap-0.5 rounded-[10px] p-0.5 bg-surface-2',
        Elev.hairline,
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
            size === 'sm' ? 'h-6 px-2 text-[12px]' : 'h-7 px-3 text-[12px]',
            value === option.value
              ? cn('bg-surface text-ink', ElevShadow.raised)
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
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  const subtitleId = useId()
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusable = (): HTMLElement[] => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ) ?? []).filter((element) => element.getAttribute('aria-hidden') !== 'true')
    /* Direct focus, not requestAnimationFrame: the frame loop is paused while
     * the window is hidden, and a dialog that opens without focus is a trap for
     * the keyboard. */
    const preferred = dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]')
    ;(preferred ?? focusable()[0] ?? dialogRef.current)?.focus()
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const elements = focusable()
      if (!elements.length) {
        event.preventDefault()
        dialogRef.current?.focus()
        return
      }
      const first = elements[0]
      const last = elements[elements.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [open])

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
            aria-hidden="true"
            className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-describedby={subtitle ? subtitleId : undefined}
            aria-label={title ? undefined : 'Dialog'}
            tabIndex={-1}
            initial={{ opacity: 0, y: 10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={{ duration: 0.18, ease: [0.2, 0.7, 0.3, 1] }}
            className={cn(
              'relative flex max-h-[86vh] w-full flex-col overflow-hidden rounded-[var(--r-modal)] bg-surface',
              Elev.overlay,
              width,
              className
            )}
          >
            {(title || subtitle) && (
              <div className="flex items-start gap-3 border-b border-line px-6 py-4">
                {icon ? (
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-card)] bg-accent-soft text-accent-ink">
                    {icon}
                  </div>
                ) : null}
                <div className="min-w-0 flex-1">
                  {title ? (
                    <h2 id={titleId} className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
                  ) : null}
                  {subtitle ? (
                    <p id={subtitleId} className="mt-1 text-[12px] leading-relaxed text-muted">{subtitle}</p>
                  ) : null}
                </div>
                <IconButton onClick={onClose} aria-label="Close">
                  <Icon name="close" size="lg" />
                </IconButton>
              </div>
            )}
            <div className={cn('scroll-thin min-h-0 flex-1 overflow-y-auto px-6 py-5', bodyClassName)}>
              {children}
            </div>
            {footer ? (
              <div className="flex items-center justify-end gap-2 border-t border-line bg-canvas px-6 py-4">
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
    'aria-haspopup': boolean
    'aria-controls': string | undefined
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
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  /* A popover that opens on a click but leaves the keyboard behind on the
   * trigger is a dead end: the panel's own rows cannot be reached. Focus moves
   * in, Tab cycles inside, and Escape returns focus to where it came from —
   * the same contract Modal already honours. */
  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusable = (): HTMLElement[] =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((element) => element.getAttribute('aria-hidden') !== 'true')
    /* Focus moves in the same commit that mounts the panel. A
     * requestAnimationFrame here would look equivalent but is not: the frame
     * loop is paused while the window is hidden, so the focus step would never
     * run at all. */
    const preferred = panelRef.current?.querySelector<HTMLElement>('[data-autofocus]')
    ;(preferred ?? focusable()[0] ?? panelRef.current)?.focus()
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const elements = focusable()
      if (!elements.length) {
        event.preventDefault()
        panelRef.current?.focus()
        return
      }
      const first = elements[0]
      const last = elements[elements.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !panelRef.current?.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !panelRef.current?.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
      previousFocus?.focus()
    }
  }, [open])

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      {trigger({
        onClick: (event) => {
          event.stopPropagation()
          setOpen((value) => !value)
        },
        'aria-expanded': open,
        'aria-haspopup': true,
        'aria-controls': open ? panelId : undefined
      })}
      <AnimatePresence>
        {open ? (
          <motion.div
            ref={panelRef}
            id={panelId}
            role="group"
            tabIndex={-1}
            initial={{ opacity: 0, y: side === 'top' ? 4 : -4, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: side === 'top' ? 2 : -2 }}
            transition={{ duration: 0.13 }}
            /* Lv3. The skin comes from `.dropdown-panel`, which four other
             * surfaces share and which still carries its own hard-coded shadow:
             * because that rule is unlayered it wins over `Elev.floating`, so
             * the ladder's `--elev-floating` value is written to match it and
             * styles.css needs the one-line swap to read the token instead. */
            className={cn(
              'dropdown-panel absolute z-40 min-w-[200px] p-1.5 outline-none',
              Elev.floating,
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
  htmlFor,
  children,
  className
}: {
  label: ReactNode
  hint?: ReactNode
  /** When the field has an id, this makes the visible label its real accessible name. */
  htmlFor?: string
  children: ReactNode
  className?: string
}) {
  const Label = htmlFor ? 'label' : 'span'
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Label {...(htmlFor ? { htmlFor } : {})} className="text-[12px] font-medium text-ink">
          {label}
        </Label>
        {hint ? <span className="text-[11px] text-faint">{hint}</span> : null}
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
    <kbd
      className={cn(
        'rounded-[5px] bg-surface/70 px-1.5 py-0.5 font-sans font-medium text-muted',
        'border border-line text-[length:var(--text-micro)]'
      )}
    >
      {children}
    </kbd>
  )
}
