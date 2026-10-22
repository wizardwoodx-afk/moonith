import { ArrowRight, Check, FolderOpen, KeyRound, Laptop, Sparkles } from 'lucide-react'
import { useApp } from '../store'
import { Button, Modal } from './ui'

export function Onboarding() {
  const settings = useApp((state) => state.settings)
  const openSettings = useApp((state) => state.openSettings)
  const saveSettings = useApp((state) => state.saveSettings)

  const open = Boolean(settings && !settings.onboardingComplete)

  const finish = (tab: 'providers' | null): void => {
    void saveSettings({ onboardingComplete: true })
    if (tab) openSettings(tab)
  }

  return (
    <Modal open={open} onClose={() => finish(null)} width="max-w-[560px]" bodyClassName="p-0">
      <div className="relative overflow-hidden px-8 pt-9 pb-8">
        <div className="pointer-events-none absolute -top-24 -right-20 h-64 w-64 rounded-full bg-accent-soft/80 blur-3xl" />
        <div className="relative">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ink-button text-on-ink shadow-sm">
            <Sparkles size={19} />
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
            {[
              {
                icon: Laptop,
                title: 'Runs locally',
                text: 'Tasks, files, and encrypted API keys stay on this machine.'
              },
              {
                icon: FolderOpen,
                title: 'Works in your folders',
                text: 'You choose exactly which folders SelfImpulse can touch.'
              },
              {
                icon: KeyRound,
                title: 'Your keys, your models',
                text: 'Any chat-completion endpoint.'
              }
            ].map((item) => {
              const Icon = item.icon
              return (
                <div key={item.title} className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-canvas text-muted">
                    <Icon size={13} />
                  </div>
                  <div>
                    <p className="text-[12.5px] font-medium">{item.title}</p>
                    <p className="text-[11.5px] leading-relaxed text-faint">{item.text}</p>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-7 flex items-center gap-2">
            <Button variant="primary" size="lg" onClick={() => finish('providers')}>
              Connect a model
              <ArrowRight size={14} />
            </Button>
            <Button variant="ghost" size="lg" onClick={() => finish(null)}>
              Explore first
            </Button>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-[10.5px] text-faint">
            <Check size={11} />
            You can add providers and tools later in Settings.
          </p>
        </div>
      </div>
    </Modal>
  )
}
