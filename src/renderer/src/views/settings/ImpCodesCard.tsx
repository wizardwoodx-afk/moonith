/**
 * The ImpCodes hand-off card.
 *
 * ImpCodes is the coding engine this user already runs on this device. The
 * card is deliberately read-only until Import is pressed: it lists what the
 * import would bring across (provider endpoints, model ids, tool servers) so
 * the decision is made with the facts in view. The key moves straight from the
 * access file into the encrypted store inside the main process; it never
 * reaches this component.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Icon } from '../../components/icons'
import { toast } from 'sonner'
import type { ImpCodesAccess } from '@shared/types'
import { cn, errorMessage, plural } from '../../lib/utils'
import { useApp } from '../../store'
import { Button, IconButton } from '../../components/ui'

export function ImpCodesCard() {
  const refreshSettings = useApp((state) => state.refreshSettings)
  const [access, setAccess] = useState<ImpCodesAccess | null>(null)
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setAccess(await window.knight.getImpCodesAccess())
    } catch (caught) {
      setAccess(null)
      setError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const models = useMemo(() => {
    const seen = new Set<string>()
    const list: string[] = []
    for (const provider of access?.providers ?? []) {
      for (const model of provider.models) {
        if (seen.has(model)) continue
        seen.add(model)
        list.push(model)
      }
    }
    return list
  }, [access])

  const importAccess = async (): Promise<void> => {
    setImporting(true)
    try {
      const result = await window.knight.importImpCodesAccess()
      setAccess(result.access)
      await refreshSettings()
      toast.success(
        `Imported ${plural(result.providerCount, 'provider')} and ${plural(
          result.serverCount,
          'tool server'
        )}.`
      )
      if (result.becameDefault) {
        toast.success('ImpCodes is now the default for new tasks.')
      }
    } catch (caught) {
      toast.error(errorMessage(caught))
    } finally {
      setImporting(false)
    }
  }

  const available = Boolean(access?.available) && !loading
  const failure = error
  const unavailableReason = access && !access.available ? access.error : undefined
  const providerCount = access?.providers.length ?? 0
  const serverCount = access?.servers.length ?? 0
  const keyCount = access?.providers.filter((provider) => provider.hasKey).length ?? 0
  const nothingToImport = available && providerCount === 0 && serverCount === 0

  const refreshButton = (
    <Button variant="secondary" size="sm" disabled={importing} onClick={() => void load()}>
      <Icon name="refresh" size="md" />
      Refresh
    </Button>
  )

  return (
    <div className="card tab-enter overflow-hidden">
      <div className="flex items-start gap-3 p-4">
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border',
            available
              ? 'border-accent/25 bg-accent-soft/60 text-accent-ink'
              : 'border-line bg-surface-2 text-muted'
          )}
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" aria-hidden />
          ) : failure ? (
            <Icon name="caution" size="xl" className="text-danger" />
          ) : (
            <Icon name="model" size="xl" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-[13px] font-semibold text-ink">ImpCodes</h3>
            {available ? (
              <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent-ink">
                Engine access
              </span>
            ) : null}
          </div>

          {loading ? (
            <p
              className="mt-1 text-[11.5px] text-faint"
              role="status"
              aria-live="polite"
            >
              Looking for engine access on this device…
            </p>
          ) : failure ? (
            <>
              <p className="mt-1 text-[11.5px] leading-relaxed text-danger">{failure}</p>
              <p className="mt-1 text-[10.5px] text-faint">
                Refresh to check again. Your providers are unchanged.
              </p>
            </>
          ) : available ? (
            <>
              <p className="mt-1 max-w-[54ch] text-[11.5px] leading-relaxed text-muted">
                Coding-engine access found on this device. Imported models run on
                SelfImpulse&apos;s own tool loop, with your files, documents and tool servers.
              </p>

              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-faint">
                <span className="flex items-center gap-1">
                  <Icon name="quick" size="xs" />
                  {plural(providerCount, 'provider')}
                </span>
                <span className="flex items-center gap-1">
                  <Icon name="connector" size="xs" />
                  {plural(serverCount, 'tool server')}
                </span>
                {keyCount > 0 ? (
                  <span className="flex items-center gap-1">
                    <Icon name="key" size="xs" />
                    {plural(keyCount, 'key')} found
                  </span>
                ) : null}
              </p>

              {models.length > 0 ? (
                <div className="mt-2.5 flex flex-wrap gap-1">
                  {models.slice(0, 6).map((model, index) => (
                    <span
                      key={model}
                      className="run-in rounded-md border border-line bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-muted"
                      style={{ animationDelay: `${Math.min(index, 6) * 20}ms` }}
                    >
                      {model}
                    </span>
                  ))}
                  {models.length > 6 ? (
                    <span className="px-1 py-0.5 whitespace-nowrap text-[10px] text-faint">
                      +{models.length - 6} more
                    </span>
                  ) : null}
                </div>
              ) : null}

              {serverCount > 0 ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {access?.servers.map((server, index) => (
                    <span
                      key={server.name}
                      className="run-in inline-flex items-center gap-1 rounded-md border border-line bg-surface-2/70 px-1.5 py-0.5 text-[10px] text-muted"
                      style={{ animationDelay: `${Math.min(index, 6) * 20}ms` }}
                    >
                      <Icon name="connector" size="xs" />
                      {server.name}
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <p className="mt-1 max-w-[54ch] text-[11.5px] leading-relaxed text-muted">
                {nothingToImport
                  ? 'The access file is here, but it lists no providers or tool servers.'
                  : 'No engine access found on this device.'}
              </p>
              <p className="mt-1 max-w-[54ch] text-[10.5px] leading-relaxed text-faint">
                {nothingToImport
                  ? 'Add an endpoint in ImpCodes, then refresh.'
                  : unavailableReason ||
                    'Set it up in ImpCodes, then refresh — the import finds it automatically.'}
              </p>
            </>
          )}
        </div>
      </div>

      {loading ? null : (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-canvas/40 px-4 py-2.5">
          <span className="flex items-center gap-1.5 text-[10.5px] text-faint">
            {available ? (
              <>
                <Icon name="key" size="xs" />
                The key goes straight into the OS keychain and never reaches this screen.
              </>
            ) : failure ? (
              'Retry whenever the device setup changes.'
            ) : (
              'You can import at any time once access is found.'
            )}
          </span>
          <div className="flex items-center gap-1.5">
            {failure ? (
              <IconButton
                onClick={() => void load()}
                aria-label="Refresh engine access"
                disabled={importing}
              >
                <Icon name="refresh" size="md" />
              </IconButton>
            ) : (
              <>
                {available && !nothingToImport ? (
                  <Button
                    variant="primary"
                    size="sm"
                    loading={importing}
                    onClick={() => void importAccess()}
                  >
                    <Icon name="quick" size="md" />
                    Import access
                  </Button>
                ) : null}
                {refreshButton}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
