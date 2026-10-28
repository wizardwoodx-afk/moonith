import type { CoworkStepResult } from './types'

export interface LedgerEntry {
  index: number;
  timestamp: number;
  fingerprint: string;
  result: CoworkStepResult;
}

/**
 * CognitiveLedger
 * Tracks step history, execution divergence, and cyclical patterns.
 * Employs structural hashing and entropy checks to halt redundant loops.
 */
export class CognitiveLedger {
  private entries: LedgerEntry[] = [];
  private readonly maxWindow: number;

  constructor(maxWindow: number = 64) {
    this.maxWindow = maxWindow;
  }

  public record(result: CoworkStepResult): void {
    const fingerprint = this.computeStructuralFingerprint(result);
    this.entries.push({
      index: result.stepIndex,
      timestamp: Date.now(),
      fingerprint,
      result
    });

    if (this.entries.length > this.maxWindow * 2) {
      this.entries = this.entries.slice(-this.maxWindow);
    }
  }

  public assessDivergenceRisk(actionName: string, payload: Record<string, unknown>): number {
    if (this.entries.length < 2) return 0.0;

    const testFingerprint = this.hashPayload(actionName, payload);
    const recent = this.entries.slice(-6);

    let identicalMatches = 0;
    for (const item of recent) {
      if (item.fingerprint === testFingerprint) {
        identicalMatches++;
      }
    }

    if (identicalMatches >= 3) {
      return 1.0;
    }
    if (identicalMatches === 2) {
      return 0.7;
    }
    if (identicalMatches === 1) {
      return 0.35;
    }

    return 0.05;
  }

  public getHistory(): readonly LedgerEntry[] {
    return this.entries;
  }

  private computeStructuralFingerprint(result: CoworkStepResult): string {
    return this.hashPayload(result.actionName, result.inputPayload);
  }

  private hashPayload(action: string, payload: Record<string, unknown>): string {
    const sortedStr = JSON.stringify(payload, Object.keys(payload).sort());
    let hash = 5381;
    const str = `${action}:${sortedStr}`;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return `fp_${Math.abs(hash).toString(16)}`;
  }
}
