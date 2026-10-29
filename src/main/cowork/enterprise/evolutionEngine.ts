import crypto from 'node:crypto'
import type { HarnessEvolutionRule } from './types'

export class EvolutionEngine {
  private rules: Map<string, HarnessEvolutionRule> = new Map();

  public distillEvolutionRule(
    domain: string,
    patternDetected: string,
    distilledStrategy: string,
    initialConfidence: number = 0.85
  ): HarnessEvolutionRule {
    const ruleId = `evolve_${domain}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const rule: HarnessEvolutionRule = {
      ruleId,
      domain,
      patternDetected,
      distilledStrategy,
      confidenceScore: initialConfidence,
      appliedRunsCount: 1,
      createdAt: Date.now()
    };

    this.rules.set(ruleId, rule);
    return rule;
  }

  public recordRuleApplication(ruleId: string, success: boolean): void {
    const rule = this.rules.get(ruleId);
    if (!rule) return;
    rule.appliedRunsCount += 1;
    if (success) {
      rule.confidenceScore = Math.min(1.0, rule.confidenceScore + 0.03);
    } else {
      rule.confidenceScore = Math.max(0.1, rule.confidenceScore - 0.08);
    }
  }

  public getRulesForDomain(domain: string): HarnessEvolutionRule[] {
    return Array.from(this.rules.values()).filter(
      (r) => (r.domain === domain || r.domain === 'general') && r.confidenceScore >= 0.5
    );
  }

  public listAllRules(): HarnessEvolutionRule[] {
    return Array.from(this.rules.values());
  }
}
