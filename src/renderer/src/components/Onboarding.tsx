import { Laptop } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../store'
import { saveLocalProfile, useLocalProfile } from '../lib/localProfile'
import { Button, Modal } from './ui'
import { ICON_SIZES, Icon } from './icons'

export function Onboarding() {
  const settings = useApp((state) => state.settings)
  const openSettings = useApp((state) => state.openSettings)
  const saveSettings = useApp((state) => state.saveSettings)
  const profile = useLocalProfile()
  const [name, setName] = useState(profile.name === 'You' ? '' : profile.name)

  const open = Boolean(settings && !settings.onboardingComplete)

  const finish = (tab: 'providers' | null): void => {
    const trimmed = name.trim()
    if (trimmed) saveLocalProfile({ name: trimmed })
    void saveSettings({ onboardingComplete: true })
    if (tab) openSettings(tab)
  }

  return (
    <Modal open={open} onClose={() => finish(null)} width="max-w-[560px]" bodyClassName="p-0">
      <div className="relative overflow-hidden px-8 pt-9 pb-8">
        <div className="pointer-events-none absolute -top-24 -right-20 h-64 w-64 rounded-full bg-accent-soft/80 blur-3xl" />
        <div className="relative">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ink-button text-on-ink shadow-sm">
            <Icon name="spark" size="xl" />
          </div>
          <h1 className="display mt-5 text-[30px] leading-[1.1] font-normal text-ink">
            A quieter way to get
            <br />
            real work done.
          </h1>
          <p className="mt-3 max-w-[430px] text-[13px] leading-relaxed text-muted">
            SelfImpulse plans the work, uses real tools on your computer, and leaves finished
            files behind. Bring your own model.
          </p>

          <div className="mt-6 space-y-2.5">
            {([
              {
                icon: Laptop,
                title: 'Runs locally',
                text: 'Tasks, files, and encrypted API keys stay on this machine.'
              },
              {
                icon: 'folderOpen',
                title: 'Works in your folders',
                text: 'You choose exactly which folders SelfImpulse can touch.'
              },
              {
                icon: 'key',
                title: 'Your keys, your models',
                text: 'Any chat-completion endpoint.'
              }
            ] as const).map((item) => {
              const Glyph = item.icon
              return (
                <div key={item.title} className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-canvas text-muted">
                    {typeof Glyph === 'string' ? (
                      <Icon name={Glyph} size="md" />
                    ) : (
                      <Glyph size={ICON_SIZES.md} />
                    )}
                  </div>
                  <div>
                    <p className="text-[12.5px] font-medium">{item.title}</p>
                    <p className="text-[11.5px] leading-relaxed text-faint">{item.text}</p>
                  </div>
                </div>
              )
            })}
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              finish('providers')
            }}
          >
            <label
              className="mt-7 block text-[11px] font-medium text-muted"
              htmlFor="onboarding-name"
            >
              Your name
            </label>
            <input
              id="onboarding-name"
              className="field mt-1.5"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={40}
              placeholder="What SelfImpulse should call you"
              autoComplete="name"
            />

            <div className="mt-6 flex items-center gap-2">
              <Button type="submit" variant="primary" size="lg">
                Connect a model
                <Icon name="arrowRight" size="md" />
              </Button>
              <Button type="button" variant="ghost" size="lg" onClick={() => finish(null)}>
                Explore first
              </Button>
            </div>
          </form>
          <p className="mt-3 flex items-center gap-1.5 text-[10.5px] text-faint">
            <Icon name="confirm" size="xs" />
            Next, add your API key. You can change all of this later in Settings.
          </p>
        </div>
      </div>
    </Modal>
  )
}
