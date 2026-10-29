import { useState } from 'react'
import { ArrowRight, KeyRound, LockKeyhole, Radio, X } from 'lucide-react'
import { Button, Spin } from '../../components/ui'
import { cn } from '../../lib/utils'
import { getLocalProfile } from '../../lib/localProfile'
import { useTableStore } from './tableStore'

type Path = 'host' | 'join'

function Choice({
  icon: Icon,
  title,
  active,
  onSelect
}: {
  icon: typeof Radio
  title: string
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        'flex flex-1 items-center gap-3 rounded-[var(--r-card)] border px-4 py-3.5 text-left transition-colors',
        active ? 'border-accent/50 bg-accent-soft/25' : 'border-line hover:border-line-strong'
      )}
    >
      <Icon size={16} className={cn('shrink-0', active ? 'text-accent' : 'text-muted')} />
      <span className="min-w-0 whitespace-nowrap text-[13px] font-medium text-ink">{title}</span>
    </button>
  )
}

export function PairingPanel() {
  const profile = getLocalProfile()
  const busy = useTableStore((state) => state.busy)
  const error = useTableStore((state) => state.error)
  const hostTable = useTableStore((state) => state.host)
  const joinTable = useTableStore((state) => state.join)
  const clearError = useTableStore((state) => state.clearError)

  const [path, setPath] = useState<Path | null>(null)
  const [hostName, setHostName] = useState(profile.name)
  const [joinName, setJoinName] = useState(profile.name)
  const [code, setCode] = useState('')
  const [address, setAddress] = useState('')
  const [useAddress, setUseAddress] = useState(false)

  const readyCode = code.length === 6

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[620px] flex-col justify-center px-8 py-12">
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">
          Pair a machine
        </h1>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Choice
            icon={Radio}
            title="Start here"
            active={path === 'host'}
            onSelect={() => setPath('host')}
          />
          <Choice
            icon={KeyRound}
            title="Join from here"
            active={path === 'join'}
            onSelect={() => setPath('join')}
          />
        </div>

        {error ? (
          <div className="mt-4 flex items-start gap-2.5 rounded-[var(--r-card)] border border-danger/25 bg-danger/5 px-3.5 py-2.5">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />
            <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-danger">{error}</p>
            <button
              onClick={clearError}
              className="rounded p-0.5 text-danger/70 hover:text-danger"
              aria-label="Dismiss"
            >
              <X size={12} />
            </button>
          </div>
        ) : null}

        {path === 'host' ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!hostName.trim() || busy) return
              void hostTable(hostName.trim())
            }}
            className="mt-4 rounded-[var(--r-card)] border border-line bg-surface/40 p-5"
          >
            <label className="block text-[11.5px] font-medium text-muted" htmlFor="table-host-name">
              Your name on the table
            </label>
            <input
              id="table-host-name"
              className="field mt-1.5"
              value={hostName}
              onChange={(event) => setHostName(event.target.value)}
              maxLength={40}
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              className="mt-4"
              disabled={busy || !hostName.trim()}
            >
              {busy ? <Spin size={12} /> : <Radio size={12} />}
              Get a code
            </Button>
          </form>
        ) : null}

        {path === 'join' ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!readyCode || !joinName.trim() || busy) return
              void joinTable({
                code,
                name: joinName.trim(),
                address: useAddress ? address.trim() : undefined
              })
            }}
            className="mt-4 rounded-[var(--r-card)] border border-line bg-surface/40 p-5"
          >
            <label className="block text-[11.5px] font-medium text-muted" htmlFor="table-join-code">
              Code from the other machine
            </label>
            <input
              id="table-join-code"
              className="field mt-1.5 font-mono text-[15px] uppercase tracking-[0.34em]"
              value={code}
              onChange={(event) =>
                setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))
              }
              maxLength={6}
              autoComplete="off"
              spellCheck={false}
              aria-describedby="table-join-code-hint"
            />
            <p id="table-join-code-hint" className="mt-1 text-[11px] text-faint">
              {code.length} of 6 characters
            </p>

            <label className="mt-4 block text-[11.5px] font-medium text-muted" htmlFor="table-join-name">
              Your name on the table
            </label>
            <input
              id="table-join-name"
              className="field mt-1.5"
              value={joinName}
              onChange={(event) => setJoinName(event.target.value)}
              maxLength={40}
            />

            <button
              type="button"
              onClick={() => setUseAddress((value) => !value)}
              className="mt-4 block text-[11.5px] font-medium text-muted underline decoration-line underline-offset-2 hover:text-ink"
            >
              {useAddress ? 'Find the other machine automatically' : 'Type its address instead'}
            </button>
            {useAddress ? (
              <input
                className="field mt-2 font-mono text-[12px]"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                maxLength={120}
                placeholder="192.168.1.20"
                spellCheck={false}
                aria-label="Host address"
              />
            ) : null}

            <Button
              type="submit"
              variant="primary"
              size="sm"
              className="mt-4"
              disabled={busy || !readyCode || !joinName.trim()}
            >
              {busy ? <Spin size={12} /> : <ArrowRight size={12} />}
              Join
            </Button>
          </form>
        ) : null}

        <p className="mt-8 flex items-center justify-center gap-2 whitespace-nowrap text-[11px] text-faint">
          <LockKeyhole size={11} className="shrink-0" />
          Stays on your local network.
        </p>
      </div>
    </div>
  )
}
