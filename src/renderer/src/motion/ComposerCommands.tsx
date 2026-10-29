import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent
} from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AtSign, Command } from 'lucide-react'
import { cn } from '../lib/utils'

export interface ComposerCommand {
  id: string
  kind: '@' | '/'
  label: string
  detail?: string
  keywords?: string
  icon?: ReactNode
  insert?: string
  run?: () => void
}

interface OpenState {
  kind: '@' | '/'
  query: string
  start: number
  end: number
}

export function useComposerCommands({
  textareaRef,
  text,
  onTextChange,
  items
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  text: string
  onTextChange: (text: string) => void
  items: ComposerCommand[]
}) {
  const [open, setOpen] = useState<OpenState | null>(null)
  const [active, setActive] = useState(0)

  const inspect = useCallback(
    (caret: number) => {
      const before = text.slice(0, caret)
      const match = /(^|\s)([@\/])([^\s@\/]*)$/.exec(before)
      if (!match) {
        setOpen(null)
        return
      }
      const token = match[3] ?? ''
      const kind = match[2] as '@' | '/'
      const remainder = /^[^\s]*/.exec(text.slice(caret))?.[0] ?? ''
      setOpen({ kind, query: token, start: caret - token.length - 1, end: caret + remainder.length })
      setActive(0)
    },
    [text]
  )

  const filtered = useMemo(() => {
    if (!open) return []
    const query = open.query.toLowerCase()
    return items
      .filter((item) => item.kind === open.kind)
      .filter((item) =>
        !query
          ? true
          : `${item.label} ${item.keywords ?? ''} ${item.detail ?? ''}`.toLowerCase().includes(query)
      )
      .slice(0, 24)
  }, [items, open])

  useEffect(() => {
    if (active < filtered.length) return
    setActive(Math.max(0, filtered.length - 1))
  }, [active, filtered.length])

  const close = useCallback(() => setOpen(null), [])

  const select = useCallback(
    (item: ComposerCommand) => {
      if (!open) return
      const inserted = item.insert ?? ''
      const next = `${text.slice(0, open.start)}${inserted}${text.slice(open.end)}`
      onTextChange(next)
      setOpen(null)
      const caret = open.start + inserted.length
      window.setTimeout(() => {
        textareaRef.current?.focus()
        textareaRef.current?.setSelectionRange(caret, caret)
        item.run?.()
      }, 0)
    },
    [onTextChange, open, text, textareaRef]
  )

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    onTextChange(event.target.value)
    const caret = event.target.selectionStart
    const value = event.target.value
    const before = value.slice(0, caret)
    const match = /(^|\s)([@\/])([^\s@\/]*)$/.exec(before)
    if (!match) {
      setOpen(null)
      return
    }
    const token = match[3] ?? ''
    const remainder = /^[^\s]*/.exec(value.slice(caret))?.[0] ?? ''
    setOpen({
      kind: match[2] as '@' | '/',
      query: token,
      start: caret - token.length - 1,
      end: caret + remainder.length
    })
    setActive(0)
  }

  const onSelect = (event: SyntheticEvent<HTMLTextAreaElement>): void => {
    inspect(event.currentTarget.selectionStart)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(null)
      return true
    }
    if (!filtered.length) return false
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      setActive((current) => (current + delta + filtered.length) % filtered.length)
      return true
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.nativeEvent.isComposing) {
      event.preventDefault()
      select(filtered[active] ?? filtered[0])
      return true
    }
    return false
  }

  const menu = (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0, y: 7, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.99 }}
          transition={{ duration: 0.15, ease: [0.22, 0.61, 0.36, 1] }}
          className="dropdown-panel absolute right-2 bottom-full left-2 z-50 mb-2 max-h-[290px] overflow-y-auto p-1.5"
          role="listbox"
          aria-label={open.kind === '/' ? 'Composer commands' : 'Composer context'}
        >
          <div className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold tracking-[0.12em] text-faint uppercase">
            {open.kind === '/' ? <Command size={11} /> : <AtSign size={11} />}
            {open.kind === '/' ? 'Commands' : 'Real context'}
          </div>
          {filtered.length ? (
            filtered.map((item, index) => (
              <button
                id={`composer-command-${item.id}`}
                key={item.id}
                role="option"
                aria-selected={index === active}
                data-active={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => select(item)}
                className={cn('menu-item items-center', index === active && 'bg-surface-3 text-ink')}
              >
                {item.icon ? <span className="flex h-4 w-4 shrink-0 items-center justify-center text-faint">{item.icon}</span> : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px]" title={item.label}>{item.label}</span>
                  {item.detail ? <span className="mt-0.5 block truncate text-[10px] text-faint" title={item.detail}>{item.detail}</span> : null}
                </span>
                {item.insert ? <span className="text-[10px] text-faint">insert</span> : null}
              </button>
            ))
          ) : (
            <p className="px-2.5 py-3 text-[11px] text-faint">No matching actions.</p>
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )

  return {
    menu,
    onChange,
    onKeyDown,
    onSelect,
    close,
    activeId: open && filtered[active] ? `composer-command-${filtered[active].id}` : undefined
  }
}
