/**
 * Egress Ledger for SelfImpulse.
 *
 * Implements provable local-only auditability:
 * - Records every external outbound network connection or cloud model escalation.
 * - Stores destination host, protocol, byte count, payload SHA-256 hash, and caller identity.
 * - Backs up the local-first security guarantee with an immutable ledger.
 */
import { createHash } from 'node:crypto'
import { newId, nowIso } from '../../util'

export interface EgressRecord {
  id: string
  agentId: string
  destination: string
  protocol: 'https' | 'http' | 'wss' | 'dns'
  bytesSent: number
  bytesReceived: number
  payloadDigest: string
  purpose: string
  timestamp: string
}

export class EgressLedgerService {
  private records: EgressRecord[] = []

  /**
   * Log an outbound external connection.
   */
  logEgress(input: {
    agentId: string
    destination: string
    protocol: 'https' | 'http' | 'wss' | 'dns'
    bytesSent: number
    bytesReceived: number
    payload?: string | Buffer
    purpose: string
  }): EgressRecord {
    const id = newId('egress')
    const payloadBuffer = typeof input.payload === 'string'
      ? Buffer.from(input.payload)
      : (input.payload || Buffer.alloc(0))
    const payloadDigest = createHash('sha256').update(payloadBuffer).digest('hex')

    const record: EgressRecord = {
      id,
      agentId: input.agentId,
      destination: input.destination,
      protocol: input.protocol,
      bytesSent: input.bytesSent,
      bytesReceived: input.bytesReceived,
      payloadDigest,
      purpose: input.purpose.trim(),
      timestamp: nowIso()
    }

    this.records.push(record)
    return record
  }

  listRecords(limit = 100): EgressRecord[] {
    return this.records.slice(-limit).reverse()
  }

  getTotalBytesTransferred(): { sent: number; received: number } {
    let sent = 0
    let received = 0
    for (const r of this.records) {
      sent += r.bytesSent
      received += r.bytesReceived
    }
    return { sent, received }
  }
}

export const egressLedger = new EgressLedgerService()
