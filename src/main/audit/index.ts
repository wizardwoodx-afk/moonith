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
  type AuditEntry,
  type AuditEventQuery,
  type AuditExportResult,
  type AuditSummary,
  type AuditVerifyResult
} from '@shared/audit'
import {
  ALL_SENSITIVE_DATA_CATEGORIES,
  GOVERNANCE_IPC,
  type SensitiveDataCategory
} from '@shared/governance'
import { buildAuditChain, verifyAuditChain } from './chain'
import { collectAuditEntries } from './collect'
import { runtimeAudit } from './runtime'
import { inspectSensitiveText } from '../selfimpulse/governance/dlp'

const FILE_FILTERS = [
  { name: 'Audit log (JSON lines)', extensions: ['jsonl'] },
  { name: 'All Files', extensions: ['*'] }
]

async function signingKey(): Promise<Buffer> {
  const { loadAuditSigningKey } = await import('./keychain')
  return loadAuditSigningKey()
}

function chronological(entries: AuditEntry[]): AuditEntry[] {
  return entries.sort((left, right) =>
    left.ts < right.ts ? -1 : left.ts > right.ts ? 1 : 0
  )
}

async function collectAllEntries(): Promise<AuditEntry[]> {
  const runtime = await runtimeAudit.entries()
  return chronological([...collectAuditEntries(selfimpulseSession()), ...runtime])
}

export async function auditSummary(): Promise<AuditSummary> {
  const base = collectAuditEntries(selfimpulseSession())
  let runtime: AuditEntry[] = []
  try {
    runtime = await runtimeAudit.entries()
  } catch {
    /* status() below returns the concrete integrity/keychain failure. */
  }
  const runtimeIntegrity = await runtimeAudit.status()
  const entries = chronological([...base, ...runtime])
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
    runtime: runtime.length,
    runtimeIntegrity,
    firstTs,
    lastTs
  }
}

export async function exportAuditLog(): Promise<AuditExportResult | null> {
  /* Export is all-or-nothing: an unreadable runtime ledger must never result
   * in a plausible but incomplete compliance file. */
  const entries = await collectAllEntries()
  /* The key is loaded BEFORE the save dialog: if the keychain is
   * unavailable the user must hear it now, not after choosing a path. */
  const sealKey = await signingKey()
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
  const sealKey = await signingKey()
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
  ipcMain.handle(AUDIT_IPC.events, (_event, query: AuditEventQuery) =>
    runtimeAudit.events(query ?? {})
  )
  ipcMain.handle(AUDIT_IPC.export, () => exportAuditLog())
  ipcMain.handle(AUDIT_IPC.verify, () => verifyAuditLog())
  ipcMain.handle(
    GOVERNANCE_IPC.inspect,
    (_event, text: unknown, categories: unknown) => {
      if (typeof text !== 'string') throw new Error('Text to inspect must be a string.')
      if (text.length > 200_000) throw new Error('Inspect at most 200,000 characters at a time.')
      const selected = Array.isArray(categories)
        ? categories.filter((category): category is SensitiveDataCategory =>
            ALL_SENSITIVE_DATA_CATEGORIES.includes(category as SensitiveDataCategory)
          )
        : undefined
      return inspectSensitiveText(text, selected)
    }
  )
}
