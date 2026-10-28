import { CognitiveLedger } from './cognitiveLedger'
import type {
  ActionModality,
  CoworkSessionStatus,
  CoworkStepResult,
  KineticInputEvent
} from './types'
import { KineticActuator } from './kineticActuator'
import { BrowserLens } from './perceptionMatrix'
import { SurfaceStreamer } from './surfaceProtocol'
import { PolicyArbiter, QuarantineGate } from './policyArbiter'
import { LobeSkillRegistry } from './lobeSkillRegistry'

export interface CoworkKernelConfig {
  sessionId: string;
  maxAutonomousSteps: number;
}

export class CoworkKernel {
  private config: CoworkKernelConfig;
  private status: CoworkSessionStatus = 'idle';
  private stepCount: number = 0;

  public readonly ledger: CognitiveLedger;
  public readonly kinetic: KineticActuator;
  public readonly lens: BrowserLens;
  public readonly surface: SurfaceStreamer;
  public readonly policy: PolicyArbiter;
  public readonly quarantine: QuarantineGate;
  public readonly registry: LobeSkillRegistry;

  constructor(config: Partial<CoworkKernelConfig> = {}) {
    this.config = {
      sessionId: config.sessionId || `cowork_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      maxAutonomousSteps: config.maxAutonomousSteps ?? 50
    };

    this.ledger = new CognitiveLedger();
    this.kinetic = new KineticActuator();
    this.lens = new BrowserLens();
    this.surface = new SurfaceStreamer();
    this.policy = new PolicyArbiter();
    this.quarantine = new QuarantineGate(this.surface);
    this.registry = new LobeSkillRegistry();
  }

  public getSessionId(): string {
    return this.config.sessionId;
  }

  public getStatus(): CoworkSessionStatus {
    return this.status;
  }

  public async executeStep(
    modality: ActionModality,
    actionName: string,
    payload: Record<string, unknown>
  ): Promise<CoworkStepResult> {
    const startTime = Date.now();
    this.stepCount++;

    if (this.stepCount > this.config.maxAutonomousSteps) {
      this.status = 'faulted';
      throw new Error(`Execution halted: Reached max autonomous steps threshold (${this.config.maxAutonomousSteps})`);
    }

    const divergenceRisk = this.ledger.assessDivergenceRisk(actionName, payload);
    if (divergenceRisk >= 0.9) {
      this.status = 'faulted';
      const result: CoworkStepResult = {
        stepIndex: this.stepCount,
        modality,
        actionName,
        inputPayload: payload,
        error: 'Execution halted by DivergenceGuard: Redundant cycle pattern detected.',
        elapsedMs: Date.now() - startTime,
        divergenceScore: divergenceRisk
      };
      this.ledger.record(result);
      return result;
    }

    const policyDecision = this.policy.evaluateAction(modality, actionName, payload);
    if (!policyDecision.allowed) {
      if (policyDecision.requiresHumanApproval) {
        this.status = 'awaiting_human';
        this.surface.emitStatus(this.config.sessionId, 'Awaiting Human Approval', 50, policyDecision.reason);

        const approval = await this.quarantine.holdForIntervention({
          sessionId: this.config.sessionId,
          actionName,
          reason: policyDecision.reason,
          riskScore: policyDecision.matchedRule?.riskScore ?? 0.8
        });

        if (!approval.approved) {
          this.status = 'quarantined';
          const result: CoworkStepResult = {
            stepIndex: this.stepCount,
            modality,
            actionName,
            inputPayload: payload,
            error: 'Action rejected by Human Operator during quarantine.',
            elapsedMs: Date.now() - startTime,
            divergenceScore: divergenceRisk
          };
          this.ledger.record(result);
          return result;
        }
      } else {
        this.status = 'quarantined';
        const result: CoworkStepResult = {
          stepIndex: this.stepCount,
          modality,
          actionName,
          inputPayload: payload,
          error: policyDecision.reason,
          elapsedMs: Date.now() - startTime,
          divergenceScore: divergenceRisk
        };
        this.ledger.record(result);
        return result;
      }
    }

    this.status = 'executing';
    let outputPayload: Record<string, unknown> = {};

    try {
      switch (modality) {
        case 'kinetic': {
          const kineticEvent = payload as unknown as KineticInputEvent;
          const res = await this.kinetic.dispatchKineticEvent(kineticEvent);
          outputPayload = { ...res };
          break;
        }
        case 'perception': {
          if (payload.action === 'navigate' && typeof payload.url === 'string') {
            const navRes = await this.lens.navigateTo(payload.url);
            outputPayload = { ...navRes };
          } else {
            const snapshot = this.lens.captureSnapshot();
            outputPayload = { nodeCount: snapshot.domTree.length, activeUrl: snapshot.activeUrl };
          }
          break;
        }
        case 'surface': {
          if (payload.action === 'thought' && typeof payload.text === 'string') {
            this.surface.streamThought(this.config.sessionId, payload.text);
            outputPayload = { streamed: true };
          }
          break;
        }
        case 'tool':
        case 'cognitive':
        default: {
          outputPayload = { acknowledged: true, processedAt: Date.now() };
          break;
        }
      }

      const result: CoworkStepResult = {
        stepIndex: this.stepCount,
        modality,
        actionName,
        inputPayload: payload,
        outputPayload,
        elapsedMs: Date.now() - startTime,
        divergenceScore: divergenceRisk
      };

      this.ledger.record(result);
      this.status = 'idle';
      return result;

    } catch (err: unknown) {
      this.status = 'faulted';
      const errMsg = err instanceof Error ? err.message : String(err);
      const result: CoworkStepResult = {
        stepIndex: this.stepCount,
        modality,
        actionName,
        inputPayload: payload,
        error: errMsg,
        elapsedMs: Date.now() - startTime,
        divergenceScore: divergenceRisk
      };
      this.ledger.record(result);
      return result;
    }
  }
}
