export class ContextCompactor {
  private budgetLimit: number;
  private messageHistory: Array<{ role: string; content: string; estimatedTokens: number }> = [];

  constructor(budgetLimitTokens: number = 200000) {
    this.budgetLimit = budgetLimitTokens;
  }

  public recordMessage(role: string, content: string): void {
    const estimatedTokens = Math.ceil(content.length / 3.8);
    this.messageHistory.push({ role, content, estimatedTokens });
    this.compactIfNeeded();
  }

  public compactIfNeeded(): boolean {
    let total = this.getTotalTokens();
    if (total <= this.budgetLimit) return false;

    while (total > this.budgetLimit && this.messageHistory.length > 4) {
      this.messageHistory.splice(1, 1);
      total = this.getTotalTokens();
    }

    return true;
  }

  public getTotalTokens(): number {
    return this.messageHistory.reduce((sum, item) => sum + item.estimatedTokens, 0);
  }
}
