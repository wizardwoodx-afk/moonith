/**
 * PROPRIETARY - SelfImpulse RSIRALS
 * Module 1: SENTRIX — Belief State + Risk-Aware Action Control (Fast Loop)
 */

import crypto from 'node:crypto';
import type { 
  ActionRequest, 
  ActionSideEffectClass, 
  BeliefFact, 
  BeliefUncertainty, 
  BeliefStatePacket 
} from './types';

export class SentrixController {
  private knownFacts: Map<string, BeliefFact> = new Map();
  private uncertainties: Map<string, BeliefUncertainty> = new Map();
  private idempotencyRegistry: Map<string, { timestamp: string; actionId: string; status: 'pending' | 'settled' }> = new Map();
  private interceptedCount = 0;
  private blockedCount = 0;
  private totalRiskAccumulator = 0;

  constructor() {
    this.seedDefaultBeliefs();
  }

  private seedDefaultBeliefs(): void {
    this.registerFact('system.mode', 'agentic-autonomous', 'sentrix-boot', 1.0);
    this.registerFact('filesystem.boundary', 'workspace-jailed', 'security-guard', 1.0);
    this.registerUncertainty('external.network.availability', 'Dynamic connectivity to third-party providers', 0.2);
  }

  public registerFact(key: string, value: unknown, source: string, confidence = 1.0): void {
    this.knownFacts.set(key, {
      key,
      value,
      source,
      timestamp: new Date().toISOString(),
      confidence: Math.max(0, Math.min(1, confidence))
    });
  }

  public registerUncertainty(dimension: string, description: string, entropy = 0.5): void {
    this.uncertainties.set(dimension, {
      dimension,
      description,
      entropy: Math.max(0, Math.min(1, entropy))
    });
  }

  public resolveUncertainty(dimension: string): void {
    this.uncertainties.delete(dimension);
  }

  /**
   * Classify action side-effect class based on tool name and target
   */
  public classifySideEffect(action: ActionRequest): ActionSideEffectClass {
    const name = action.name.toLowerCase();
    
    // Read-only operations
    if (
      name.startsWith('read_') || 
      name.startsWith('list_') || 
      name.startsWith('search_') || 
      name === 'get_file_info' ||
      name === 'outline_symbols' ||
      name === 'rook_query_state'
    ) {
      return 'read-only';
    }

    // Irreversible operations
    if (
      name.includes('delete') || 
      name.includes('unlink') || 
      name.includes('drop') || 
      name.includes('purge') ||
      name.includes('rmdir')
    ) {
      return 'irreversible';
    }

    // External network calls
    if (
      name.includes('http') || 
      name.includes('web_fetch') || 
      name.includes('curl') ||
      name.includes('browser_navigate')
    ) {
      return 'external-network';
    }

    // Workspace modifications
    if (
      name.startsWith('write_') || 
      name.startsWith('edit_') || 
      name.startsWith('patch_') || 
      name.startsWith('create_') ||
      name.includes('rook_execute_edit')
    ) {
      return 'workspace-mutation';
    }

    // Shell or process operations
    if (name.includes('shell') || name.includes('bash') || name.includes('exec')) {
      const cmd = String(action.parameters?.command || '').toLowerCase();
      if (cmd.includes('rm ') || cmd.includes('del ') || cmd.includes('format ') || cmd.includes('git reset --hard')) {
        return 'irreversible';
      }
      return 'workspace-mutation';
    }

    return 'local-state';
  }

  /**
   * Evaluate belief packet and risk gate for any candidate action
   */
  public evaluateAction(action: ActionRequest): BeliefStatePacket {
    this.interceptedCount++;
    const actionClass = this.classifySideEffect(action);
    const idempotencyKey = action.idempotencyKey || this.generateIdempotencyKey(action);

    // Check duplicate pending idempotency
    const existing = this.idempotencyRegistry.get(idempotencyKey);
    if (existing && existing.status === 'pending' && actionClass !== 'read-only') {
      this.blockedCount++;
      return {
        observedStateRef: `sentrix-state-${Date.now()}`,
        knownFacts: Array.from(this.knownFacts.values()).slice(0, 10),
        uncertainties: Array.from(this.uncertainties.values()),
        actionClass,
        idempotencyKey,
        riskScore: 0.95,
        policyDecision: 'deny',
        decisionReason: `Idempotency lock: Action ${action.name} with key ${idempotencyKey} is already executing.`
      };
    }

    let riskScore = 0.05;
    let decisionReason = 'Action verified safe under standard belief state.';

    switch (actionClass) {
      case 'read-only':
        riskScore = 0.02;
        break;
      case 'local-state':
        riskScore = 0.15;
        break;
      case 'workspace-mutation':
        riskScore = 0.40;
        decisionReason = 'Workspace mutation requires state checkpointing.';
        break;
      case 'external-network':
        riskScore = 0.55;
        decisionReason = 'External network operation subject to sandbox quarantine.';
        break;
      case 'irreversible':
        riskScore = 0.88;
        decisionReason = 'Irreversible state modification requires explicit authorization or CoW sandbox.';
        break;
    }

    // Additional boundary and target inspection
    if (action.target) {
      const targetStr = action.target.toLowerCase();
      if (targetStr.includes('node_modules') || targetStr.includes('.git') || targetStr.includes('.env')) {
        riskScore = Math.max(riskScore, 0.75);
        decisionReason = `Critical path targeted: ${action.target}.`;
      }
    }

    this.totalRiskAccumulator += riskScore;

    let policyDecision: BeliefStatePacket['policyDecision'] = 'allow';
    if (riskScore >= 0.85) {
      policyDecision = 'require_approval';
    } else if (riskScore >= 0.60) {
      policyDecision = 'sandbox';
    } else if (riskScore >= 0.35 && this.uncertainties.size > 2) {
      policyDecision = 'probe';
    }

    if (policyDecision !== 'allow' && policyDecision !== 'sandbox') {
      if (policyDecision === 'deny') this.blockedCount++;
    }

    // Register idempotency
    this.idempotencyRegistry.set(idempotencyKey, {
      timestamp: new Date().toISOString(),
      actionId: action.id,
      status: 'pending'
    });

    return {
      observedStateRef: `sentrix-obs-${crypto.randomBytes(4).toString('hex')}`,
      knownFacts: Array.from(this.knownFacts.values()).slice(0, 15),
      uncertainties: Array.from(this.uncertainties.values()),
      actionClass,
      idempotencyKey,
      riskScore,
      policyDecision,
      decisionReason
    };
  }

  public settleIdempotency(idempotencyKey: string): void {
    const entry = this.idempotencyRegistry.get(idempotencyKey);
    if (entry) {
      entry.status = 'settled';
    }
  }

  /**
   * Diagnostic read-only reconciliation probe:
   * When an action outcome is ambiguous, reconcile state before allowing blind retries.
   */
  public generateReconciliationProbe(action: ActionRequest): {
    probeAction: string;
    target: string;
    expectedVerification: string;
  } {
    return {
      probeAction: 'verify_state_integrity',
      target: action.target || 'current_workspace',
      expectedVerification: `Reconcile actual filesystem/process state for ${action.name} without repeating side-effects.`
    };
  }

  private generateIdempotencyKey(action: ActionRequest): string {
    const str = `${action.name}-${action.target || ''}-${JSON.stringify(action.parameters)}`;
    return crypto.createHash('sha256').update(str).digest('hex').substring(0, 16);
  }

  public getTelemetry(): {
    activeBeliefsCount: number;
    activeUncertaintiesCount: number;
    interceptedActions: number;
    blockedActions: number;
    averageRiskScore: number;
  } {
    return {
      activeBeliefsCount: this.knownFacts.size,
      activeUncertaintiesCount: this.uncertainties.size,
      interceptedActions: this.interceptedCount,
      blockedActions: this.blockedCount,
      averageRiskScore: this.interceptedCount > 0 
        ? Number((this.totalRiskAccumulator / this.interceptedCount).toFixed(4))
        : 0.05
    };
  }
}
