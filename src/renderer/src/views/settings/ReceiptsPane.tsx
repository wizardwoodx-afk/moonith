/**
 * Sphragis — the signed receipt chain, as the audit pane shows it.
 *
 * A receipt is evidence: this action was authorised like this, and this is
 * what became of it. Two things about it matter enough to put on screen.
 * First, it stores digests, not content — so the pane can be honest that the
 * chain proves the action happened without keeping what it touched. Second,
 * verification here runs the same way an independent auditor's would: over
 * the file as written, with nothing from the minting path held back.
 */
import { useCallback, useEffect, useState } from 'react'
import { ScrollText, Stamp } from 'lucide-react'
import { Icon } from '../../components/icons'
import type { ReceiptSummaryView, ReceiptVerifyView, ReceiptView } from '@shared/types'
import { Button, Spin } from '../../components/ui'
import { agentName } from '../../lib/localProfile'
import { errorMessage } from '../../lib/utils'
import { SettingsSection } from './SettingsSection'
import {
  Badge,
  EmptyState,
  OutcomeBanner,
  PaneNote,
  Row,
  RowList,
  Stat,
  StatGrid,
  formatCount,
  formatWhen,
  type Outcome
} from './paneBits'

export function ReceiptsPane() {
  const [summary, setSummary] = useState<ReceiptSummaryView | null>(null)
  const [receipts, setReceipts] = useState<ReceiptView[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const load = useCallback(async () => {
    try {
      const [nextSummary, nextReceipts] = await Promise.all([
        window.knight.receiptSummary(),
        window.knight.receiptRecent(40)
      ])
      setSummary(nextSummary)
      setReceipts(nextReceipts)
      setLoadError(null)
    } catch (error) {
      setLoadError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const verify = async (): Promise<void> => {
    setVerifying(true)
    setOutcome(null)
    try {
      const result: ReceiptVerifyView = await window.knight.receiptVerify()
      if (result.receipts === 0) {
        setOutcome({ tone: 'neutral', message: 'There are no receipts to verify yet.' })
        return
      }
      if (result.ok && result.signed) {
        setOutcome({
          tone: 'positive',
          message: `Verification passed — ${formatCount(result.receipts, 'receipt')}, chain intact and signed.`
        })
      } else if (result.ok) {
        setOutcome({
          tone: 'neutral',
          message: `Chain intact, but ${formatCount(result.receipts, 'receipt')} unsigned — no signing key available on this machine.`
        })
      } else {
        setOutcome({
          tone: 'danger',
          message: `Verification failed: ${result.problems.slice(0, 3).join('; ')}${
            result.problems.length > 3 ? ` (and ${result.problems.length - 3} more)` : ''
          }`
        })
      }
    } catch (error) {
      setOutcome({ tone: 'danger', message: errorMessage(error) })
    } finally {
      setVerifying(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted">
        <Spin size={20} />
      </div>
    )
  }

  const empty = summary !== null && summary.intents + summary.results === 0

  return (
    <SettingsSection
      title="Signed action receipts"
      
    >
      <div className="space-y-5">
        <PaneNote>
          A signed receipt is written before each risky action runs and after it finishes. Only
          digests are kept, never the content.
        </PaneNote>

        {loadError ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-danger/25 bg-danger/10 px-3.5 py-3">
            <Stamp size={14} className="mt-0.5 shrink-0 text-danger" />
            <p className="text-[11.5px] leading-relaxed text-danger">
              The receipt chain could not be read: {loadError}
            </p>
          </div>
        ) : null}

        {summary && !empty ? (
          <StatGrid>
            <Stat label="Intents" value={summary.intents} hint="authorised before running" />
            <Stat label="Results" value={summary.results} hint="closed out afterwards" />
            <Stat
              label="Signed"
              value={summary.signed}
              tone={summary.signed > 0 ? 'positive' : 'default'}
              hint={summary.keyId ? `key ${summary.keyId.slice(0, 8)}…` : 'no signing key'}
            />
            <Stat
              label="Open intents"
              value={summary.openIntents}
              tone={summary.openIntents > 0 ? 'warn' : 'default'}
              hint="started, never finished"
            />
          </StatGrid>
        ) : null}

        {empty ? (
          <EmptyState icon={<ScrollText size={18} />} title="No receipts yet" />
        ) : null}

        {summary && !empty && summary.lastTs ? (
          <p className="text-[11.5px] leading-relaxed text-muted">
            Last receipt {formatWhen(summary.lastTs)}
            {summary.unsigned > 0
              ? ` — ${formatCount(summary.unsigned, 'receipt')} unsigned.`
              : ' — every receipt carries a signature.'}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button variant="primary" loading={verifying} onClick={() => void verify()}>
            <Icon name="shield" size="md" /> Verify the receipt chain
          </Button>
          <Button variant="ghost" onClick={() => void load()}>
            <Icon name="refresh" size="md" /> Refresh
          </Button>
        </div>

        {outcome ? <OutcomeBanner outcome={outcome} /> : null}

        {receipts.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[12px] font-medium text-ink">Recent receipts</p>
            <RowList>
              {receipts
                .slice()
                .reverse()
                .map((receipt) => (
                  <Row
                    key={receipt.seq}
                    leading={
                      <Badge tone={receipt.kind === 'intent' ? 'accent' : 'default'}>
                        {receipt.kind === 'intent' ? 'intent' : 'result'}
                      </Badge>
                    }
                    title={`${receipt.tool} — ${receipt.action}`}
                    meta={`#${receipt.seq} · ${formatWhen(receipt.ts)} · ${
                      receipt.agentId === 'Captain' ? agentName() : receipt.agentId
                    }${receipt.outcome ? ` · ${receipt.outcome}` : ''}`}
                    trailing={
                      receipt.signed ? (
                        <Badge tone="positive">signed</Badge>
                      ) : (
                        <Badge tone="warn">unsigned</Badge>
                      )
                    }
                  />
                ))}
            </RowList>
            <p className="px-2.5 text-[10.5px] text-faint">
              An intent with no result means the action was authorised but never finished.
            </p>
          </div>
        ) : null}
      </div>
    </SettingsSection>
  )
}
