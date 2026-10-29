export * from './types'
export * from './passportManager'
export * from './blastRadiusArbiter'
export * from './verifiableKernel'
export * from './memoryGovernor'
export * from './evolutionEngine'

import { EnterprisePassportManager } from './passportManager'
import { BlastRadiusArbiter } from './blastRadiusArbiter'
import { VerifiableKernel } from './verifiableKernel'
import { MemoryGovernor } from './memoryGovernor'
import { EvolutionEngine } from './evolutionEngine'

export class CoworkEnterpriseSubsystem {
  public readonly passport: EnterprisePassportManager;
  public readonly blastRadius: BlastRadiusArbiter;
  public readonly verifier: VerifiableKernel;
  public readonly memory: MemoryGovernor;
  public readonly evolution: EvolutionEngine;

  constructor() {
    this.passport = new EnterprisePassportManager();
    this.blastRadius = new BlastRadiusArbiter();
    this.verifier = new VerifiableKernel();
    this.memory = new MemoryGovernor();
    this.evolution = new EvolutionEngine();
  }

  public getSummary() {
    return {
      activePassports: this.passport.listActivePassports().length,
      blastRadiusBudget: this.blastRadius.getBudgetStatus(),
      totalAttestedProofs: this.verifier.listProofs().length,
      memoryPartitions: this.memory.listPartitions().length,
      evolutionRules: this.evolution.listAllRules().length
    };
  }
}
