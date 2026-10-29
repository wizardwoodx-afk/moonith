import { CoworkKernel } from '../cowork/coworkKernel'
import { LobeSkillRegistry } from '../cowork/lobeSkillRegistry'
import type { ActionModality, CoworkStepResult } from '../cowork/types'

/**
 * CoworkEngineBridge
 * Connects the Cowork subsystem into SelfImpulse's engine lifecycle
 * without altering or compromising SelfImpulse's primary state graph.
 */
export class CoworkEngineBridge {
  private static instance: CoworkEngineBridge;
  private kernel: CoworkKernel;
  private registry: LobeSkillRegistry;

  private constructor() {
    this.kernel = new CoworkKernel({ sessionId: 'selfimpulse_bridge_engine' });
    this.registry = new LobeSkillRegistry();
  }

  public static getInstance(): CoworkEngineBridge {
    if (!CoworkEngineBridge.instance) {
      CoworkEngineBridge.instance = new CoworkEngineBridge();
    }
    return CoworkEngineBridge.instance;
  }

  public getKernel(): CoworkKernel {
    return this.kernel;
  }

  public getRegistry(): LobeSkillRegistry {
    return this.registry;
  }

  public async executeAutonomousStep(
    modality: ActionModality,
    actionName: string,
    payload: Record<string, unknown>
  ): Promise<CoworkStepResult> {
    return this.kernel.executeStep(modality, actionName, payload);
  }

  public getStatus(): {
    ready: boolean;
    activeSession: string;
    totalSkills: number;
    enterprise: {
      activePassports: number;
      blastRadius: ReturnType<CoworkKernel['enterprise']['blastRadius']['getBudgetStatus']>;
      totalAttestedProofs: number;
      memoryPartitions: number;
      evolutionRules: number;
    };
  } {
    const ent = this.kernel.enterprise.getSummary();
    return {
      ready: true,
      activeSession: this.kernel.getSessionId(),
      totalSkills: this.registry.getTotalSkillCount(),
      enterprise: {
        activePassports: ent.activePassports,
        blastRadius: ent.blastRadiusBudget,
        totalAttestedProofs: ent.totalAttestedProofs,
        memoryPartitions: ent.memoryPartitions,
        evolutionRules: ent.evolutionRules
      }
    };
  }

  public getEnterprise() {
    return this.kernel.enterprise;
  }
}

export const coworkEngineBridge = CoworkEngineBridge.getInstance();
