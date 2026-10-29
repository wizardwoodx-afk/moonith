import { Fragment, isValidElement, type ReactElement, type ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { SettingList } from './settingParts'

/**
 * A group of related settings. One card per group, the label small and quiet
 * above it, so the page title stays the only heading on screen.
 */
export function SettingsSection({
  title,
  action,
  body,
  children
}: {
  title: string
  action?: ReactNode
  body?: ReactNode
  children: ReactNode
}) {
  const rows = isRows(children)

  return (
    <section>
      <div className="mb-2.5 flex items-end justify-between gap-4 px-4">
        <h2 className="text-[12px] font-medium text-muted">{title}</h2>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className={cn(rows ? 'card overflow-hidden' : 'card p-6')}>
        {children}
        {body ? <div className="px-4 pt-4 pb-4">{body}</div> : null}
      </div>
    </section>
  )
}

/**
 * A row list fills the card: the rows sit flush against the card edge and
 * dashed hairlines separate them. A card inside a card would draw the border
 * twice and leave the rows floating in a second frame.
 */
function isRows(children: ReactNode): boolean {
  return flatten(children).some((node) => node.type === SettingList)
}

function flatten(children: ReactNode): ReactElement[] {
  if (Array.isArray(children)) return children.flatMap(flatten)
  if (!isValidElement(children)) return []
  if (children.type === Fragment) return flatten((children.props as { children?: ReactNode }).children)
  return [children]
}
