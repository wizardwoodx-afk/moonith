import { useState } from 'react'
import {
  ArrowRight,
  Handshake,
  KeyRound,
  LockKeyhole,
  Radio,
  Users,
  X
} from 'lucide-react'
import { BrandMark } from '../../components/BrandMark'
import { Button, Spin } from '../../components/ui'
import { cn } from '../../lib/utils'
import { getLocalProfile } from '../../lib/localProfile'
import { useTableStore } from './tableStore'

function EngineCard({
  name,
  label,
  waiting
}: {
  name: string
  label: string
  waiting?: boolean
}) {
  return (
    <div
      className={cn(
        'w-[188px] rounded-xl border bg-surface px-4 py-3.5 text-center',
        waiting ? 'border-dashed border-line' : 'border-line'
      )}
    >
      <div
        className={cn(
          'mx-auto flex h-9 w-9 items-center justify-center rounded-xl border',
          waiting
            ? 'border-line bg-canvas text-faint'
            : 'border-accent/25 bg-accent-soft/50 text-accent-ink'
        )}
      >
        {waiting ? <Users size={15} strokeWidth={1.9} /> : <BrandMark size={15} strokeWidth={1.9} />}
      </div>
      <p className={cn('mt-2.5 truncate text-[12px] font-medium', waiting ? 'text-muted' : 'text-ink')}>
        {name}
      </p>
      <p className="mt-0.5 text-[9.5px] text-faint">{label}</p>
      <div className="mt-2 flex items-center justify-center gap-1.5">
        <span className={cn('h-1.5 w-1.5 rounded-full', waiting ? 'bg-faint' : 'bg-positive')} />
        <span className="text-[9px] text-faint">
          {waiting ? 'Not connected' : 'Running'}
        </span>
      </div>
    </div>
  )
}

export function PairingPanel() {
  const profile = getLocalProfile()
  const busy = useTableStore((state) => state.busy)
  const error = useTableStore((state) => state.error)
  const hostTable = useTableStore((state) => state.host)
  const joinTable = useTableStore((state) => state.join)
  const clearError = useTableStore((state) => state.clearError)

  const [name, setName] = useState(profile.name)
  const [code, setCode] = useState('')
  const [address, setAddress] = useState('')
  const [useAddress, setUseAddress] = useState(false)

  const readyCode = code.length === 6

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[960px] flex-col justify-center px-8 py-12">
        <div className="flex flex-col items-center text-center">
          <h1 className="display text-[38px] leading-[1.05] text-ink">
            Two desks.
            <br />
            One table.
          </h1>
          <p className="mt-4 max-w-[420px] text-[12px] leading-relaxed text-muted">
            Each Captain keeps their own engine, files and keys. The table is the only thing two
            machines share.
          </p>
        </div>

        <div className="relative mt-8 overflow-hidden rounded-2xl border border-line bg-surface/40 px-6 py-6">
          <div className="pointer-events-none absolute inset-x-32 top-[54%] hidden border-t border-dashed border-line sm:block" />
          <div className="relative flex flex-col items-center justify-between gap-4 sm:flex-row">
            <EngineCard name={profile.name} label="You · this machine" />
            <div className="flex flex-col items-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-accent/30 bg-accent-soft/50 text-accent-ink">
                <Handshake size={20} strokeWidth={1.7} />
              </div>
              <p className="mt-2 text-[10px] font-medium text-ink">Shared table</p>
            </div>
            <EngineCard name="Second Captain" label="Their own machine" waiting />
          </div>
        </div>

        {error ? (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-danger/25 bg-danger/5 px-3.5 py-2.5">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />
            <p className="min-w-0 flex-1 text-[10.5px] leading-relaxed text-danger">{error}</p>
            <button
              onClick={clearError}
              className="rounded p-0.5 text-danger/70 hover:text-danger"
              aria-label="Dismiss"
            >
              <X size={12} />
            </button>
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!name.trim() || busy) return
              void hostTable(name.trim())
            }}
            className="card flex flex-col p-5"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-accent/25 bg-accent-soft/50 text-accent-ink">
                <Radio size={14} />
              </span>
              <div>
                <h2 className="text-[12.5px] font-semibold text-ink">Host this machine</h2>
              </div>
            </div>

            <label className="mt-4 block text-[10px] font-medium text-muted" htmlFor="table-host-name">
              Your name on the table
            </label>
            <input
              id="table-host-name"
              className="field mt-1.5"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={40}
            />

            <div className="flex-1" />
            <Button type="submit" variant="primary" size="sm" className="mt-4" disabled={busy || !name.trim()}>
              {busy ? <Spin size={12} /> : <Radio size={12} />}
              Host and get a code
            </Button>
          </form>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!readyCode || !name.trim() || busy) return
              void joinTable({
                code,
                name: name.trim(),
                address: useAddress ? address.trim() : undefined
              })
            }}
            className="card flex flex-col p-5"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-identity-b/30 bg-identity-b/10 text-identity-b">
                <KeyRound size={14} />
              </span>
              <div>
                <h2 className="text-[12.5px] font-semibold text-ink">Join a table</h2>
              </div>
            </div>

            <label className="mt-4 block text-[10px] font-medium text-muted" htmlFor="table-join-code">
              Table code
            </label>
            <input
              id="table-join-code"
              className="field mt-1.5 font-mono text-[15px] tracking-[0.34em] uppercase"
              value={code}
              onChange={(event) =>
                setCode(
                  event.target.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, '')
                    .slice(0, 6)
                )
              }
              maxLength={6}
              autoComplete="off"
              spellCheck={false}
              aria-describedby="table-join-code-hint"
            />
            <p id="table-join-code-hint" className="mt-1 text-[9px] text-faint">
              {code.length}/6
            </p>

            <label className="mt-3 block text-[10px] font-medium text-muted" htmlFor="table-join-name">
              Your name on the table
            </label>
            <input
              id="table-join-name"
              className="field mt-1.5"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={40}
            />

            <button
              type="button"
              onClick={() => setUseAddress((value) => !value)}
              className="mt-3 self-start text-[9.5px] font-medium text-muted underline decoration-line underline-offset-2 hover:text-ink"
            >
              {useAddress ? 'Use discovery' : 'Enter an address instead'}
            </button>
            {useAddress ? (
              <input
                className="field mt-2 font-mono text-[11px]"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                maxLength={120}
                spellCheck={false}
                aria-label="Host address"
              />
            ) : null}

            <Button
              type="submit"
              variant="accent"
              size="sm"
              className="mt-4"
              disabled={busy || !readyCode || !name.trim()}
            >
              {busy ? <Spin size={12} /> : <ArrowRight size={12} />}
              Join the table
            </Button>
          </form>
        </div>

        <p className="mt-6 flex items-center justify-center gap-2 text-[9.5px] text-faint">
          <LockKeyhole size={11} className="shrink-0" />
          Direct on your LAN. Every joint action needs both Captains.
        </p>
      </div>
    </div>
  )
}
