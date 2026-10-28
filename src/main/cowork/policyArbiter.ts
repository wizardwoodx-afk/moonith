import type { ActionModality, HumanInterventionRequest, SecurityPolicyRule } from './types'
import { SurfaceStreamer } from './surfaceProtocol'

export interface EvaluationResult {
  allowed: boolean;
  requiresHumanApproval: boolean;
  matchedRule?: SecurityPolicyRule;
  reason: string;
}

export class PolicyArbiter {
  private rules: SecurityPolicyRule[] = [];

  constructor(customRules?: SecurityPolicyRule[]) {
    if (customRules && customRules.length > 0) {
      this.rules = customRules;
    } else {
      this.rules = [
        {
          ruleId: 'block_credential_dump',
          description: 'Prevent dumping environment variables or credentials',
          modality: 'tool',
          targetPattern: '.*(env|secret|token|password|credential).*',
          effect: 'require_approval',
          riskScore: 0.95
        },
        {
          ruleId: 'quarantine_fs_root_deletion',
          description: 'Block recursive deletion of system roots',
          modality: 'tool',
          targetPattern: '.*rm\\s+-rf\\s+[/~].*',
          effect: 'deny',
          riskScore: 1.0
        },
        {
          ruleId: 'os_payment_gate',
          description: 'Require human confirmation for payment or checkout submission',
          modality: 'kinetic',
          targetPattern: '.*(pay|checkout|buy|submit_order).*',
          effect: 'require_approval',
          riskScore: 0.9
        }
      ];
    }
  }

  public registerRule(rule: SecurityPolicyRule): void {
    this.rules.unshift(rule);
  }

  public evaluateAction(
    modality: ActionModality,
    actionIdentifier: string,
    payload: Record<string, unknown>
  ): EvaluationResult {
    const combinedString = `${actionIdentifier} ${JSON.stringify(payload)}`.toLowerCase();

    for (const rule of this.rules) {
      if (rule.modality === modality) {
        const regex = new RegExp(rule.targetPattern, 'i');
        if (regex.test(combinedString)) {
          if (rule.effect === 'deny') {
            return {
              allowed: false,
              requiresHumanApproval: false,
              matchedRule: rule,
              reason: `Security Policy Violation: Denied by rule '${rule.ruleId}' (${rule.description})`
            };
          }

          if (rule.effect === 'require_approval') {
            return {
              allowed: false,
              requiresHumanApproval: true,
              matchedRule: rule,
              reason: `Intervention Required: Rule '${rule.ruleId}' requires human sign-off.`
            };
          }
        }
      }
    }

    return {
      allowed: true,
      requiresHumanApproval: false,
      reason: 'Action passed all security assertions.'
    };
  }
}

export class QuarantineGate {
  private pendingRequests: Map<string, {
    request: HumanInterventionRequest;
    resolve: (approved: boolean) => void;
  }> = new Map();

  private surfaceStreamer?: SurfaceStreamer;

  constructor(surfaceStreamer?: SurfaceStreamer) {
    this.surfaceStreamer = surfaceStreamer;
  }

  public async holdForIntervention(params: {
    sessionId: string;
    actionName: string;
    reason: string;
    riskScore: number;
  }): Promise<{ approved: boolean; userInput?: Record<string, unknown> }> {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const interventionReq: HumanInterventionRequest = {
      requestId,
      sessionId: params.sessionId,
      timestamp: Date.now(),
      reason: params.reason,
      component: {
        id: `approval_${requestId}`,
        componentType: 'approval_dialog',
        title: `Verification Required: ${params.actionName}`,
        description: params.reason,
        props: { riskScore: params.riskScore, actionName: params.actionName },
        requiresUserAction: true,
        actionOptions: [
          { id: 'confirm', label: 'Approve & Execute', intent: 'confirm' },
          { id: 'reject', label: 'Deny Action', intent: 'reject' }
        ]
      },
      resolved: false
    };

    if (this.surfaceStreamer) {
      this.surfaceStreamer.mountWidget(params.sessionId, interventionReq.component);
    }

    return new Promise((resolve) => {
      this.pendingRequests.set(requestId, {
        request: interventionReq,
        resolve: (approved: boolean) => {
          resolve({ approved, userInput: interventionReq.userInput });
        }
      });
    });
  }

  public resolveIntervention(requestId: string, decision: 'approved' | 'rejected', userInput?: Record<string, unknown>): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return false;

    pending.request.resolved = true;
    pending.request.resolutionDecision = decision;
    pending.request.userInput = userInput;

    this.pendingRequests.delete(requestId);
    pending.resolve(decision === 'approved');
    return true;
  }
}
