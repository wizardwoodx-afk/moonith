/**
 * The audit log, exposed to the renderer.
 *
 * Three doors, matching the three things the pane does: summarise the record,
 * export it signed to a user-chosen path, and verify a previously exported
 * file. Export and verify both go through the OS keychain first — if it is
 * unavailable the user hears that instead of receiving an unsigned file.
 */
import { dialog, ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import { selfimpulseSession } from '../selfimpulse/selfimpulse/engine/selfimpulse'
import {
  AUDIT_IPC,
  type AuditExportResult,
  type AuditSummary,
  type AuditVerifyResult
} from '@shared/audit'
import { buildAuditChain, verifyAuditChain } from './chain'
import { collectAuditEntries } from './collect'
import { loadAuditSigningKey } from './keychain'

const FILE_FILTERS = [
  { name: 'Audit log (JSON lines)', extensions: ['jsonl'] },
  { name: 'All Files', extensions: ['*'] }
]

export function auditSummary(): AuditSummary {
  const entries = collectAuditEntries(selfimpulseSession())
  let firstTs: string | null = null
  let lastTs: string | null = null
  for (const entry of entries) {
    if (firstTs === null || entry.ts < firstTs) firstTs = entry.ts
    if (lastTs === null || entry.ts > lastTs) lastTs = entry.ts
  }
  return {
    entries: entries.length,
    receipts: entries.filter((entry) => entry.kind === 'receipt').length,
    approvals: entries.filter((entry) => entry.kind === 'approval').length,
    traces: entries.filter((entry) => entry.kind === 'trace').length,
    firstTs,
    lastTs
  }
}

export async function exportAuditLog(): Promise<AuditExportResult | null> {
  const entries = collectAuditEntries(selfimpulseSession())
  /* The key is loaded BEFORE the save dialog: if the keychain is
   * unavailable the user must hear it now, not after choosing a path. */
  const sealKey = await loadAuditSigningKey()
  const lines = buildAuditChain(entries, sealKey)
  const result = await dialog.showSaveDialog({
    title: 'Export audit log',
    /* Named from the recorded range, not the clock — the export itself
     * stays deterministic. */
    defaultPath: `selfimpulse-audit-${entries[0]?.ts.slice(0, 10) ?? 'log'}.jsonl`,
    filters: FILE_FILTERS
  })
  if (result.canceled || !result.filePath) return null
  await fs.writeFile(result.filePath, `${lines.join('\n')}\n`, 'utf8')
  return { path: result.filePath, entries: entries.length }
}

export async function verifyAuditLog(): Promise<AuditVerifyResult | null> {
  const picked = await dialog.showOpenDialog({
    title: 'Verify an audit log',
    properties: ['openFile'],
    filters: FILE_FILTERS
  })
  const path = picked.filePaths[0]
  if (picked.canceled || !path) return null
  const sealKey = await loadAuditSigningKey()
  const text = await fs.readFile(path, 'utf8')
  /* A trailing newline leaves one empty element; blank lines carry no
   * entry and would otherwise fail the chain as a malformed line. */
  const report = verifyAuditChain(
    text.split('\n').filter((line) => line.trim().length > 0),
    sealKey
  )
  if (report.ok) return { ok: true, path, entries: report.entries ?? 0 }
  return { ok: false, path, line: report.line ?? null, reason: report.reason ?? 'verification failed' }
}

export function registerAuditIpc(): void {
  ipcMain.handle(AUDIT_IPC.summary, () => auditSummary())
  ipcMain.handle(AUDIT_IPC.export, () => exportAuditLog())
  ipcMain.handle(AUDIT_IPC.verify, () => verifyAuditLog())
}
