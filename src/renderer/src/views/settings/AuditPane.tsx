/**
 * The trust pane — four layers of evidence, one surface.
 *
 *   Audit log      the record the Captain keeps as it works: plans, tools,
 *                  approvals, receipts. Exportable and verifiable.
 *   Nomos          the gate that judged every one of those tool calls, and
 *                  the emergency stop that refuses them all.
 *   Sphragis       the signed receipt chain, checkable without this app.
 *   Aion           the durable missions that outlive a restart.
 *
 * They are shown together because they answer one question from four angles:
 * can you tell what the agent did, and prove it? Each pane owns its own
 * loading, errors and controls; the section order runs from what the agent
 * wrote down, to what decided it, to what attests it, to what outlived it.
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Download, ScrollText, ShieldCheck } from 'lucide-react'
import type { AuditExportResult, AuditSummary, AuditVerifyResult } from '@shared/audit'
import { Button, Spin } from '../../components/ui'
import { errorMessage } from '../../lib/utils'
import { SettingsSection } from './SettingsSection'
import {
  EmptyState,
  OutcomeBanner,
  Stat,
  StatGrid,
  formatWhen,
  type Outcome
} from './paneBits'
import { GovernancePane } from './GovernancePane'
import { ReceiptsPane } from './ReceiptsPane'
import { MissionsPane } from './MissionsPane'

function AuditLogSection() {
  const [summary, setSummary] = useState<AuditSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const load = useCallback(async () => {
    try {
      setSummary(await window.knight.auditSummary())
    } catch (error) {
      setLoadError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const runExport = async (): Promise<void> => {
    setExporting(true)
    setOutcome(null)
    try {
      const result: AuditExportResult | null = await window.knight.auditExport()
      if (result) {
        setOutcome({
          tone: 'positive',
          message: `Exported ${result.entries} recorded ${result.entries === 1 ? 'entry' : 'entries'} to ${result.path}`
        })
      }
    } catch (error) {
      setOutcome({ tone: 'danger', message: errorMessage(error) })
    } finally {
      setExporting(false)
    }
  }

  const runVerify = async (): Promise<void> => {
    setVerifying(true)
    setOutcome(null)
    try {
      const result: AuditVerifyResult | null = await window.knight.auditVerify()
      if (!result) return
      if (result.ok) {
        setOutcome({
          tone: 'positive',
          message: `Verification passed — ${result.entries} ${result.entries === 1 ? 'entry' : 'entries'}, and the signature is valid.`
        })
      } else if (result.line !== null) {
        setOutcome({
          tone: 'danger',
          message: `Tampering detected at line ${result.line}: ${result.reason}`
        })
      } else {
        setOutcome({ tone: 'danger', message: `Verification failed: ${result.reason}` })
      }
    } catch (error) {
      setOutcome({ tone: 'danger', message: errorMessage(error) })
    } finally {
      setVerifying(false)
    }
  }

  /* Only a loaded, empty record disables the export — a failed summary must
   * not block exporting, and verification is always available (you may be
   * checking a file exported on another machine). */
  const empty = summary !== null && summary.entries === 0

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted">
        <Spin size={20} />
      </div>
    )
  }

  return (
    <SettingsSection
      title="Audit log"
      description="Every decision the Captain makes is written down as it happens. Export that record — signed — and hand it to an auditor."
    >
      <div className="space-y-5">
        <p className="text-[11.5px] leading-relaxed text-muted">
          Whenever the Captain plans work, runs a tool, asks your permission or finishes a job, it
          records what it did and why. The audit log is that record: the plans it made, the tools it
          ran, the approvals you granted or denied, and the signed receipt each completed run leaves
          behind.
        </p>
        <p className="text-[11.5px] leading-relaxed text-muted">
          Exporting writes the record to a file you choose. Each line is chained to the line before
          it, and the whole file is signed with a key kept in your computer's keychain — if anyone
          edits, deletes or reorders a line afterwards, verification fails and points at the exact
          line. Treat the file as confidential: it can contain the content of your work.
        </p>

        {loadError ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-danger/25 bg-danger/10 px-3.5 py-3">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
            <p className="text-[11.5px] leading-relaxed text-danger">
              The recorded decisions could not be read: {loadError}
            </p>
          </div>
        ) : null}

        {summary && !empty ? (
          <StatGrid>
            <Stat label="Recorded entries" value={summary.entries} />
            <Stat label="Signed receipts" value={summary.receipts} />
            <Stat label="Approval decisions" value={summary.approvals} />
            <Stat label="Traces" value={summary.traces} />
          </StatGrid>
        ) : null}

        {summary && !empty && summary.firstTs && summary.lastTs ? (
          <p className="text-[11.5px] leading-relaxed text-muted">
            Covers {formatWhen(summary.firstTs)} to {formatWhen(summary.lastTs)} — every decision in
            that range, exactly as recorded.
          </p>
        ) : null}

        {empty ? (
          <EmptyState icon={<ScrollText size={18} />} title="Nothing recorded yet">
            The log fills up as the Captain works — plans, tool runs, approvals and finished jobs all
            appear here, and can then be exported for an auditor. Until something is recorded there
            is nothing to export. You can still verify an audit log exported from another machine.
          </EmptyState>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button variant="primary" loading={exporting} disabled={empty} onClick={() => void runExport()}>
            <Download size={13} /> Export audit log
          </Button>
          <Button variant="secondary" loading={verifying} onClick={() => void runVerify()}>
            <ShieldCheck size={13} /> Verify an audit log
          </Button>
          {empty ? (
            <span className="text-[11px] text-faint">Export unlocks once something is recorded.</span>
          ) : null}
        </div>

        {outcome ? <OutcomeBanner outcome={outcome} /> : null}
      </div>
    </SettingsSection>
  )
}

export function AuditPane() {
  if (typeof window === 'undefined') return null
  return (
    <div className="space-y-9">
      <AuditLogSection />
      <GovernancePane />
      <ReceiptsPane />
      <MissionsPane />
    </div>
  )
}
