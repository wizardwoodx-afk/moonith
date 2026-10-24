/**
 * The enterprise layers, exposed to the renderer.
 *
 * One door per question the audit pane asks:
 *
 *   Nomos    — what has the gate decided lately, and the emergency control.
 *             Engaging the kill switch denies every governed action for every
 *             agent until it is released, and survives a restart; the renderer
 *             never holds that state itself, it reads it back from the gate.
 *   Sphragis — what does the receipt chain say, and does it still verify.
 *             Verification runs over the journal as written, independently of
 *             the minting path, so a "passed" here means an auditor with the
 *             same file would agree.
 *   Aion     — what durable missions exist, and the two things a human may do
 *             to a parked one: approve it or cancel it.
 *
 * Nothing here decides anything. These are read-and-command doors over layers
 * whose semantics live in their own modules; the renderer gets views, never
 * the layers' own objects.
 */
import { promises as fs } from 'node:fs'
import { ipcMain } from 'electron'
import {
  AION_IPC,
  NOMOS_IPC,
  SPHRAGIS_IPC,
  type GovernanceRecordView,
  type GovernanceSummaryView,
  type MissionSummaryView,
  type ReceiptSummaryView,
  type ReceiptVerifyView,
  type ReceiptView
} from '@shared/enterprise'
import { LOCAL_PRINCIPAL_ID, nomosGate } from '../nomos'
import { receiptService } from '../sphragis'
import { aionOrchestrator, startRepoScanMissionForRoot, toMissionView } from '../aion'
import { taskWorkspace } from '../paths'
import { isWithin } from '../security'
import { store } from '../store'

/* ── Nomos ───────────────────────────────────────────────────────────────── */

function governanceSummary(): GovernanceSummaryView {
  const gate = nomosGate()
  const summary = gate.summary()
  const kill = gate.killState()
  /* The switch's details live on the switch, not in the counts — a released
   * switch keeps its last reason for the record but is not engaged. */
  return {
    ...summary,
    killReason: kill.reason,
    killAt: kill.at,
    killBy: kill.by
  }
}

function governanceRecent(limit = 60): GovernanceRecordView[] {
  return nomosGate()
    .recent(limit)
    .map((record) => ({
      actionId: record.actionId,
      ts: record.ts,
      decision: record.decision,
      rule: record.rule,
      reason: record.reason,
      detail: record.detail,
      tool: record.tool,
      agentId: record.agentId,
      trust: record.trust,
      outcome: record.outcome,
      approvedBy: record.approvedBy
    }))
}

/* ── Sphragis ────────────────────────────────────────────────────────────── */

async function receiptSummary(): Promise<ReceiptSummaryView> {
  const service = receiptService()
  await service.load()
  return service.summary()
}

async function receiptRecent(limit = 40): Promise<ReceiptView[]> {
  const service = receiptService()
  await service.load()
  return service.recent(limit).map((receipt) => ({
    seq: receipt.seq,
    ts: receipt.ts,
    kind: receipt.kind,
    tool: receipt.tool,
    action: receipt.action,
    actionId: receipt.ids.actionId,
    agentId: receipt.ids.agentId,
    outcome: receipt.outcome ?? null,
    signed: Boolean(receipt.signature)
  }))
}

async function receiptVerify(): Promise<ReceiptVerifyView> {
  const report = await receiptService().verify()
  return { ok: report.ok, signed: report.signed, receipts: report.receipts, problems: report.problems }
}

/* ── Aion ─────────────────────────────────────────────────────────────────── */

async function missionList(): Promise<MissionSummaryView[]> {
  const missions = await aionOrchestrator().list()
  return missions.map(toMissionView)
}

async function missionGet(missionId: string): Promise<MissionSummaryView | null> {
  const state = await aionOrchestrator().query(missionId)
  return state ? toMissionView(state) : null
}

async function missionApprove(input: {
  missionId: string
  approve: boolean
  /** Accepted for wire compatibility and deliberately ignored: the actor is
   *  the main process's own local identity, not a renderer-supplied string. */
  by?: string
  note?: string
}): Promise<MissionSummaryView | null> {
  const state = await aionOrchestrator().approve(
    String(input?.missionId ?? ''),
    input?.approve === true,
    LOCAL_PRINCIPAL_ID,
    input?.note
  )
  return state ? toMissionView(state) : null
}

async function missionCancel(missionId: string): Promise<MissionSummaryView | null> {
  const state = await aionOrchestrator().cancel(missionId)
  return state ? toMissionView(state) : null
}

async function missionResume(missionId: string): Promise<MissionSummaryView | null> {
  const state = await aionOrchestrator().resume(missionId)
  return state ? toMissionView(state) : null
}

/** Settle an interrupted mission. Without a verdict the orchestrator asks the
 *  interrupted step's own hook; with one, the human overrides it. An
 *  unresolved mission comes back still parked, which is the honest answer. */
async function missionReconcile(input: {
  missionId: string
  resolution?: 'done' | 'failed'
}): Promise<MissionSummaryView | null> {
  const resolution =
    input?.resolution === 'done' || input?.resolution === 'failed' ? input.resolution : undefined
  const state = await aionOrchestrator().reconcile(String(input?.missionId ?? ''), resolution)
  return state ? toMissionView(state) : null
}

/* ── scan roots ───────────────────────────────────────────────────────────── */

/**
 * Folders a human chose through one of the app's native folder dialogs this
 * session. A renderer may only ask a repository mission to read a path a
 * person actually pointed at: the string it sends is a request, not an
 * authority. Task workspaces count too — the app mints those itself.
 *
 * A task's `folders` list is deliberately NOT trusted here: that list is
 * persisted state the renderer can write through `taskCreate`, so trusting it
 * would just move the hole.
 */
const grantedFolders = new Set<string>()
const GRANTED_FOLDER_MEMORY = 50

/** Remember a folder chosen in a native dialog. Called from the main
 *  process's own dialog handlers, never from IPC input. */
export function noteGrantedFolder(folder: string): void {
  const value = String(folder ?? '').trim()
  if (!value) return
  // Re-insert on every pick so the eviction below stays least-recent-first.
  grantedFolders.delete(value)
  grantedFolders.add(value)
  while (grantedFolders.size > GRANTED_FOLDER_MEMORY) {
    const oldest = grantedFolders.values().next()
    if (oldest.done) break
    grantedFolders.delete(oldest.value)
  }
}

function allowedScanRoots(): string[] {
  const roots = [...grantedFolders]
  for (const summary of store.listTasks()) {
    const workspace = taskWorkspace(summary.id)
    if (workspace) roots.push(workspace)
  }
  return roots
}

async function realOrEmpty(path: string): Promise<string> {
  try {
    return await fs.realpath(path)
  } catch {
    return ''
  }
}

/**
 * Resolve a requested scan root and guarantee it is a directory inside a
 * folder the user granted. The mission walks up to 5,000 files wherever it is
 * pointed, so the boundary has to live here: this is the only arbitrary
 * directory the renderer can ask the main process to read in bulk.
 */
export async function resolveScanRoot(requested: string): Promise<string> {
  const target = String(requested ?? '').trim()
  if (!target || target.includes('\0')) throw new Error('Choose a folder to scan.')
  const real = await realOrEmpty(target)
  if (!real) throw new Error(`The folder to scan does not exist or cannot be read: ${target}`)
  const stat = await fs.stat(real).catch(() => null)
  if (!stat?.isDirectory()) throw new Error(`The scan root is not a folder: ${target}`)
  const granted = (await Promise.all(allowedScanRoots().map(realOrEmpty))).filter(Boolean)
  if (!granted.some((root) => isWithin(root, real))) {
    throw new Error(
      'Repository scans are limited to folders you chose in SelfImpulse. Grant this folder to a task, or pick it again with “Scan a repository”.'
    )
  }
  return real
}

async function missionStartRepoScan(input: { root: string }): Promise<MissionSummaryView> {
  const root = await resolveScanRoot(String(input?.root ?? ''))
  return startRepoScanMissionForRoot(root)
}

/* ── registration ─────────────────────────────────────────────────────────── */

export function registerEnterpriseIpc(): void {
  ipcMain.handle(NOMOS_IPC.summary, () => governanceSummary())
  ipcMain.handle(NOMOS_IPC.recent, (_event, limit?: number) =>
    governanceRecent(typeof limit === 'number' ? limit : undefined)
  )
  ipcMain.handle(NOMOS_IPC.kill, (_event, input: { reason?: string }) => {
    const gate = nomosGate()
    return gate.engageKill(String(input?.reason ?? 'Engaged from the audit pane'), LOCAL_PRINCIPAL_ID)
  })
  ipcMain.handle(NOMOS_IPC.release, () => nomosGate().releaseKill(LOCAL_PRINCIPAL_ID))

  ipcMain.handle(SPHRAGIS_IPC.summary, () => receiptSummary())
  ipcMain.handle(SPHRAGIS_IPC.recent, (_event, limit?: number) =>
    receiptRecent(typeof limit === 'number' ? limit : undefined)
  )
  ipcMain.handle(SPHRAGIS_IPC.verify, () => receiptVerify())

  ipcMain.handle(AION_IPC.list, () => missionList())
  ipcMain.handle(AION_IPC.get, (_event, missionId: string) => missionGet(String(missionId ?? '')))
  ipcMain.handle(AION_IPC.approve, (_event, input) => missionApprove(input))
  ipcMain.handle(AION_IPC.cancel, (_event, missionId: string) =>
    missionCancel(String(missionId ?? ''))
  )
  ipcMain.handle(AION_IPC.resume, (_event, missionId: string) =>
    missionResume(String(missionId ?? ''))
  )
  ipcMain.handle(AION_IPC.reconcile, (_event, input) => missionReconcile(input))
  ipcMain.handle(AION_IPC.startRepoScan, (_event, input) => missionStartRepoScan(input))
}
