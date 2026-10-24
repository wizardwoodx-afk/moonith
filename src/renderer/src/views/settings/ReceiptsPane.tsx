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
import { RefreshCw, ScrollText, ShieldCheck, Stamp } from 'lucide-react'
import type { ReceiptSummaryView, ReceiptVerifyView, ReceiptView } from '@shared/types'
import { Button, Spin } from '../../components/ui'
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
          message: `Verification passed — ${formatCount(result.receipts, 'receipt')} form an unbroken chain, every signature checks out, and every intent has its result.`
        })
      } else if (result.ok) {
        setOutcome({
          tone: 'neutral',
          message: `The chain is intact, but ${formatCount(result.receipts, 'receipt')} ${result.receipts === 1 ? 'is' : 'are'} unsigned — the signing key is unavailable on this machine, so nothing has been tampered with and nothing has been attested either.`
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
      description="An intent before a high-impact action, a result after it — each sealed to the one before. Evidence an auditor can check without trusting this app."
    >
      <div className="space-y-5">
        <PaneNote>
          Whenever the Captain or the Crew does something that executes, changes files or carries
          real risk, a signed intent receipt is written before it runs and a result receipt after.
          Each one is chained to the last and signed with a key sealed in your system keychain —
          edit, delete or reorder a line and verification fails and says where. Only digests are
          kept: the chain proves the action happened, not what it touched.
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
          <EmptyState icon={<ScrollText size={18} />} title="No receipts yet">
            Receipts are minted when the agent does something with a real side effect — running a
            command, writing a file, driving the browser. Low-risk reads are covered by the
            governance record alone, so the chain stays worth reading.
          </EmptyState>
        ) : null}

        {summary && !empty && summary.lastTs ? (
          <p className="text-[11.5px] leading-relaxed text-muted">
            Last receipt {formatWhen(summary.lastTs)}
            {summary.unsigned > 0
              ? ` — ${formatCount(summary.unsigned, 'receipt')} unsigned, because the keychain was unavailable when ${summary.unsigned === 1 ? 'it was' : 'they were'} written.`
              : ' — every receipt carries a signature.'}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button variant="primary" loading={verifying} onClick={() => void verify()}>
            <ShieldCheck size={13} /> Verify the receipt chain
          </Button>
          <Button variant="ghost" onClick={() => void load()}>
            <RefreshCw size={13} /> Refresh
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
                    meta={`#${receipt.seq} · ${formatWhen(receipt.ts)} · ${receipt.agentId}${
                      receipt.outcome ? ` · ${receipt.outcome}` : ''
                    }`}
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
              An intent with no result after it means the action was authorised and the process
              stopped before it could finish — the chain flags that rather than hiding it.
            </p>
          </div>
        ) : null}
      </div>
    </SettingsSection>
  )
}
