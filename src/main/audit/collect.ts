/**
 * The decision record, read straight out of the engine session. This module
 * never writes to the engine: it copies what the engine recorded into plain
 * entries, and if the engine did not record something it is simply not in
 * the export — nothing is fabricated here.
 *
 * What counts as the record:
 *   receipt  — every signed run receipt the engine minted (with its full
 *              ProofReceipt: the chained events and seal)
 *   approval — every gate decision, including WHO settled it ("human" or
 *              "client"), which is what lets an auditor tell which actions
 *              had a person in the loop
 *   trace    — every trace step of every message: routing, recall, plans,
 *              simulations, tool calls, dispatches and council deliberations
 */
import type { SelfImpulseSession } from '../selfimpulse/selfimpulse/engine/selfimpulse'
import type { AuditEntry } from '@shared/audit'

export function collectAuditEntries(session: SelfImpulseSession): AuditEntry[] {
  const entries: AuditEntry[] = []

  for (const receipt of session.receipts) {
    entries.push({ kind: 'receipt', ts: receipt.startedAt, data: { ...receipt } })
  }
  for (const approval of session.approvals) {
    entries.push({ kind: 'approval', ts: approval.ts, data: { ...approval } })
  }
  for (const thread of session.threads) {
    for (const message of thread.messages) {
      for (const step of message.trace) {
        entries.push({
          kind: 'trace',
          ts: message.ts,
          data: {
            threadId: thread.id,
            threadTitle: thread.title,
            messageId: message.id,
            role: message.role,
            step
          }
        })
      }
    }
  }

  /* Chronological order for whoever reads the export. Array#sort is stable,
   * so entries sharing a timestamp keep the recorded order above, and the
   * comparison is plain string ordering — never localeCompare — so the
   * byte output is identical on every machine. */
  return entries.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
}
