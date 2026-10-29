import { Icon } from '../../components/icons'
import type { RuntimeAuditIntegrity } from '@shared/audit'
import { cn } from '../../lib/utils'

export function AuditHealth({ integrity }: { integrity: RuntimeAuditIntegrity }) {
  return (
    <div className="space-y-3">
      {integrity.lastRecordError ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-warn/25 bg-warn/10 px-3.5 py-3"
        >
          <Icon name="caution" size="sm" className="mt-0.5 text-warn" />
          <div className="min-w-0">
            <p className="text-[11.5px] font-medium text-warn">
              Audit recording failed — some events may be missing.
            </p>
            <p className="mt-1 break-words font-mono text-[10px] leading-relaxed text-warn">
              {integrity.lastRecordError}
            </p>
            {integrity.lastRecordFailedAt ? (
              <p className="mt-1 text-[10px] leading-relaxed text-warn">
                Last recording failure:{' '}
                <time dateTime={integrity.lastRecordFailedAt}>
                  {new Date(integrity.lastRecordFailedAt).toLocaleString()}
                </time>
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      <div
        className={cn(
          'flex items-start gap-2.5 rounded-xl border px-3.5 py-3',
          integrity.ok
            ? 'border-positive/25 bg-positive/10'
            : 'border-danger/25 bg-danger/10'
        )}
      >
        {integrity.ok ? (
          <Icon name="shield" size="sm" className="mt-0.5 text-positive" />
        ) : (
          <Icon name="caution" size="sm" className="mt-0.5 text-danger" />
        )}
        <div>
          <p
            className={cn(
              'text-[11.5px] font-medium',
              integrity.ok ? 'text-positive' : 'text-danger'
            )}
          >
            {integrity.ok
              ? `Live ledger verified: ${integrity.entries} runtime ${integrity.entries === 1 ? 'entry' : 'entries'}`
              : 'Live ledger integrity needs attention'}
          </p>
          <p
            className={cn(
              'mt-1 break-all font-mono text-[10px] leading-relaxed',
              integrity.ok ? 'text-positive/80' : 'text-danger/85'
            )}
          >
            {integrity.ok
              ? `Signed head ${integrity.head ?? '0'.repeat(64)}`
              : integrity.reason}
          </p>
        </div>
      </div>
      <p className="text-[11.5px] leading-relaxed text-muted">
        Integrity checks cover only the active ledger segment. Preserve exported evidence independently.
      </p>
    </div>
  )
}
