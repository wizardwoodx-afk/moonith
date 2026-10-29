import type { BlastRadiusBudget } from './types'

export class BlastRadiusArbiter {
  private budget: BlastRadiusBudget;

  constructor(customBudget?: Partial<BlastRadiusBudget>) {
    this.budget = {
      maxTokensPerRun: customBudget?.maxTokensPerRun ?? 500_000,
      maxSpendDollars: customBudget?.maxSpendDollars ?? 5.0,
      maxFileWritesPerHour: customBudget?.maxFileWritesPerHour ?? 100,
      maxNetworkRequestsPerHour: customBudget?.maxNetworkRequestsPerHour ?? 200,
      currentTokens: 0,
      currentSpendDollars: 0,
      currentWrites: 0,
      currentNetworkCalls: 0,
      escalationLevel: 'normal',
      lastResetAt: Date.now()
    };
  }

  public recordConsumption(tokens: number, spendEstimate: number = 0, writes: number = 0, networkCalls: number = 0): {
    allowed: boolean;
    escalationLevel: 'normal' | 'caution' | 'quarantined';
    reason?: string;
  } {
    // Reset hourly metrics if 1 hour has passed
    if (Date.now() - this.budget.lastResetAt > 3600_000) {
      this.budget.currentWrites = 0;
      this.budget.currentNetworkCalls = 0;
      this.budget.lastResetAt = Date.now();
    }

    this.budget.currentTokens += tokens;
    this.budget.currentSpendDollars += spendEstimate;
    this.budget.currentWrites += writes;
    this.budget.currentNetworkCalls += networkCalls;

    // Evaluate Blast Radius Hard Limits
    if (
      this.budget.currentTokens >= this.budget.maxTokensPerRun ||
      this.budget.currentSpendDollars >= this.budget.maxSpendDollars ||
      this.budget.currentWrites >= this.budget.maxFileWritesPerHour ||
      this.budget.currentNetworkCalls >= this.budget.maxNetworkRequestsPerHour
    ) {
      this.budget.escalationLevel = 'quarantined';
      return {
        allowed: false,
        escalationLevel: 'quarantined',
        reason: `Blast-radius budget exceeded: ${this.budget.currentTokens}/${this.budget.maxTokensPerRun} tokens, $${this.budget.currentSpendDollars.toFixed(2)}/$${this.budget.maxSpendDollars} spend.`
      };
    }

    // Evaluate Caution Warning (80% consumption)
    if (
      this.budget.currentTokens >= this.budget.maxTokensPerRun * 0.8 ||
      this.budget.currentSpendDollars >= this.budget.maxSpendDollars * 0.8 ||
      this.budget.currentWrites >= this.budget.maxFileWritesPerHour * 0.8
    ) {
      this.budget.escalationLevel = 'caution';
      return {
        allowed: true,
        escalationLevel: 'caution',
        reason: 'Approaching 80% blast-radius ceiling'
      };
    }

    this.budget.escalationLevel = 'normal';
    return {
      allowed: true,
      escalationLevel: 'normal'
    };
  }

  public getBudgetStatus(): BlastRadiusBudget {
    return { ...this.budget };
  }

  public resetRunBudget(): void {
    this.budget.currentTokens = 0;
    this.budget.currentSpendDollars = 0;
    this.budget.escalationLevel = 'normal';
  }
}
