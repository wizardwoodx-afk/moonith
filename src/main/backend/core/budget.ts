/**
 * ImpulseCore agent — per-agent iteration budget.
 *
 * Ported from agent/iteration_budget.py: a thread-safe consume/refund counter.
 * The parent's cap is `maxIterations`; every sub-agent gets its own budget so
 * total iterations across parent + children may exceed the parent's cap.
 * Programmatic tool calls refund their iteration instead of consuming it.
 */
export class IterationBudget {
  private maxTotal: number;
  private used = 0;

  constructor(maxTotal: number) {
    this.maxTotal = Math.max(0, maxTotal);
  }

  /** Try to consume one iteration. Returns false when the budget is spent. */
  consume(): boolean {
    if (this.used >= this.maxTotal) return false;
    this.used += 1;
    return true;
  }

  /** Give an iteration back (programmatic tool calling does this). */
  refund(): void {
    if (this.used > 0) this.used -= 1;
  }

  get usedCount(): number {
    return this.used;
  }

  get remaining(): number {
    return Math.max(0, this.maxTotal - this.used);
  }

  get total(): number {
    return this.maxTotal;
  }

  /**
   * The loop condition upstream:
   *   api_call_count < max_iterations && iteration_budget.remaining > 0 || budget_grace_call
   */
  allows(apiCallCount: number, maxIterations: number, graceCall = false): boolean {
    if (graceCall) return true;
    return apiCallCount < maxIterations && this.remaining > 0;
  }
}

/**
 * The warning ratio: a finite number strictly between 0 and 1, or null (feature off).
 * Upstream normalises the same way, so a bad config disables the warning rather
 * than warning on every iteration.
 */
export function normalizeBudgetWarningRatio(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  const ratio = Number(value);
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) return null;
  return ratio;
}
