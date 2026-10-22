import { HelpCircle, Info, Keyboard, Plug, UserRound } from 'lucide-react'
import { useApp } from '../store'
import { Popover } from '../components/ui'

const HELP_ROWS = [
  { id: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard },
  { id: 'profile', label: 'Profile & usage', icon: UserRound },
  { id: 'mcp', label: 'Extension management', icon: Plug },
  { id: 'about', label: 'About Knight Cowork', icon: Info }
] as const

export function HelpButton() {
  const openSettings = useApp((state) => state.openSettings)

  return (
    <div className="fixed right-[18px] bottom-[18px] z-30">
      <Popover
        side="top"
        align="right"
        panelClassName="w-[250px]"
        trigger={(props) => (
          <button
            {...props}
            aria-label="Help"
            title="Help"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-[0_10px_30px_-12px_rgba(0,0,0,0.8)] transition-colors hover:border-line-strong hover:text-ink"
          >
            <HelpCircle size={16} strokeWidth={1.8} />
          </button>
        )}
      >
        {(close) => (
          <div>
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-[9.5px] font-semibold tracking-[0.13em] text-faint uppercase">
                Help
              </span>
              <span className="text-[9px] text-faint">Local-first</span>
            </div>
            {HELP_ROWS.map((row) => {
              const Icon = row.icon
              return (
                <button
                  key={row.id}
                  onClick={() => {
                    close()
                    openSettings(row.id)
                  }}
                  className="menu-item text-[12px]"
                >
                  <Icon size={13} className="text-faint" />
                  {row.label}
                </button>
              )
            })}
            <div className="mt-1 flex items-center gap-1.5 border-t border-line px-2 pt-2 pb-1 text-[10px] text-faint">
              <span className="h-1 w-1 rounded-full bg-warn" />
              SelfImpulse bridge · not connected
            </div>
          </div>
        )}
      </Popover>
    </div>
  )
}
