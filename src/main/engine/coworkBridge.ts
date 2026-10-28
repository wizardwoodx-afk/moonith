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

  public getStatus(): { ready: boolean; activeSession: string; totalSkills: number } {
    return {
      ready: true,
      activeSession: this.kernel.getSessionId(),
      totalSkills: this.registry.getTotalSkillCount()
    };
  }
}

export const coworkEngineBridge = CoworkEngineBridge.getInstance();
