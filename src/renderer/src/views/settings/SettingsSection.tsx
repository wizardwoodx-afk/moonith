import type { ReactNode } from 'react'

export function SettingsSection({
  title,
  description,
  action,
  children
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section>
      <div className="mb-3.5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
          {description ? (
            <p className="mt-1 max-w-[600px] text-[11.5px] leading-[1.65] text-faint">
              {description}
            </p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="card p-5">{children}</div>
    </section>
  )
}
