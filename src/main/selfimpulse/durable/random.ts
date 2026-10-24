import { createHash } from 'node:crypto'

/** Deterministic randomness for replay-sensitive control flow. */
export class DurableRandom {
  private sequence = 0

  constructor(private readonly runId: string) {}

  get position(): number {
    return this.sequence
  }

  restore(position: number): void {
    if (Number.isInteger(position) && position >= 0) this.sequence = position
  }

  random(): number {
    const bytes = this.digest()
    return bytes.readUInt32BE(0) / 0x1_0000_0000
  }

  uuidv4(): string {
    const bytes = this.digest()
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = bytes.subarray(0, 16).toString('hex')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
  }

  private digest(): Buffer {
    const sequence = this.sequence++
    return createHash('sha256').update(`${this.runId}\u0000${sequence}`).digest()
  }
}
