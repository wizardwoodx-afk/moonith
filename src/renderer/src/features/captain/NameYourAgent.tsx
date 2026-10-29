import { useState } from 'react'
import { Icon } from '../../components/icons'
import { Button } from '../../components/ui'
import { BrandGlyph } from '../../components/BrandMarks'
import { hasNamedAgent, saveLocalProfile, useLocalProfile } from '../../lib/localProfile'

const DISMISS_KEY = 'selfimpulse.name-agent-dismissed'
const LEGACY_DISMISS_KEY = 'knight.name-agent-dismissed'

/**
 * An invitation to name the agent, not a setup step.
 *
 * The agent is deliberately unnamed until this is filled in. A name is the
 * cheapest thing that turns "a feature in an app" into "my agent", and the
 * prompt takes it from here, so the agent ends up calling itself what its owner
 * decided rather than what a developer hardcoded.
 *
 * It dismisses permanently on close. A reminder that returns after being
 * declined is not a reminder.
 */
export function NameYourAgent() {
  const profile = useLocalProfile()
  const [draft, setDraft] = useState('')
  const [dismissed, setDismissed] = useState(() => {
    try {
      return (
        window.localStorage.getItem(DISMISS_KEY) === '1' ||
        window.localStorage.getItem(LEGACY_DISMISS_KEY) === '1'
      )
    } catch {
      return false
    }
  })
  const [saving, setSaving] = useState(false)

  if (hasNamedAgent(profile) || dismissed) return null

  const dismiss = (): void => {
    try {
      window.localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* nowhere to remember it; it will simply show again next launch */
    }
    setDismissed(true)
  }

  const commit = async (): Promise<void> => {
    const name = draft.trim().slice(0, 24)
    if (!name || saving) return
    setSaving(true)
    saveLocalProfile({ agentName: name })
    try {
      // The prompt lives in the main process; without this the agent would keep
      // introducing itself as the placeholder name.
      await window.knight.saveSettings({ agentName: name })
    } catch {
      /* the UI already renamed it; the prompt catches up on the next save */
    }
    setSaving(false)
  }

  return (
    <section className="card mx-auto mt-7 w-full max-w-[520px] overflow-hidden">
      <div className="flex items-start gap-3.5 px-5 py-4.5">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-canvas text-ink">
          <BrandGlyph height={17} />
        </span>

        <div className="min-w-0 flex-1">
          <label
            className="block text-[12.5px] font-semibold text-ink"
            htmlFor="name-your-agent"
          >
            Name your agent
          </label>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              void commit()
            }}
            className="mt-3 flex items-center gap-2"
          >
            <input
              id="name-your-agent"
              className="field h-9 min-w-0 flex-1"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="One word works best"
              maxLength={24}
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" variant="primary" size="sm" disabled={!draft.trim() || saving}>
              Name it
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
              Later
            </Button>
          </form>
        </div>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="-mr-1 mt-0.5 shrink-0 rounded p-1 text-faint transition-colors hover:text-ink"
        >
          <Icon name="close" size="md" />
        </button>
      </div>
    </section>
  )
}
