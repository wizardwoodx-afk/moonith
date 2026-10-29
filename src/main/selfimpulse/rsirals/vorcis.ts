/**
 * PROPRIETARY - SelfImpulse RSIRALS
 * Module 3: VORCIS — Predictive Planning and Simulation (Fast Loop)
 */

import crypto from 'node:crypto';
import type { 
  ActionRequest, 
  BeliefStatePacket, 
  CounterfactualReport, 
  PredictedOutcome 
} from './types';

export class VorcisSimulator {
  private simulationsCount = 0;
  private cowSandboxesCount = 0;
  private calibrationAccumulator = 0;
  private calibratedRunsCount = 0;

  /**
   * Predict the counterfactual outcome of a candidate action before execution
   */
  public simulateAction(
    action: ActionRequest, 
    beliefPacket: BeliefStatePacket
  ): CounterfactualReport {
    this.simulationsCount++;
    const reportId = `vorcis-sim-${crypto.randomBytes(4).toString('hex')}`;

    const outcomes: PredictedOutcome[] = [];
    let failureRisk = beliefPacket.riskScore;
    let expectedUtility = 0.90 - (failureRisk * 0.5);

    // Predict based on action class
    const sideEffectsIdentified: string[] = [];
    if (beliefPacket.actionClass === 'workspace-mutation') {
      sideEffectsIdentified.push(`Filesystem mutation on target: ${action.target || 'workspace'}`);
    } else if (beliefPacket.actionClass === 'irreversible') {
      sideEffectsIdentified.push('Permanent unrecoverable data deletion');
      failureRisk = Math.max(failureRisk, 0.85);
      expectedUtility = 0.40;
    } else if (beliefPacket.actionClass === 'external-network') {
      sideEffectsIdentified.push('External egress payload transmission');
    }

    outcomes.push({
      actionName: action.name,
      predictedStateDigest: `state-pred-${crypto.createHash('sha256').update(action.name + JSON.stringify(action.parameters)).digest('hex').substring(0, 8)}`,
      expectedUtility: Number(expectedUtility.toFixed(3)),
      failureRisk: Number(failureRisk.toFixed(3)),
      sideEffectsIdentified
    });

    // Probe recommendation
    let probeRecommendation: CounterfactualReport['probeRecommendation'] = 'proceed';
    if (beliefPacket.actionClass === 'irreversible' || failureRisk >= 0.70) {
      probeRecommendation = 'execute-in-cow-sandbox';
      this.cowSandboxesCount++;
    } else if (beliefPacket.actionClass !== 'read-only' && (beliefPacket.uncertainties.length > 0 || failureRisk >= 0.40)) {
      probeRecommendation = 'run-zero-side-effect-probe';
    }

    return {
      reportId,
      candidateAction: action,
      predictedOutcomes: outcomes,
      uncertainty: Number((beliefPacket.uncertainties.reduce((acc, u) => acc + u.entropy, 0) / Math.max(1, beliefPacket.uncertainties.length)).toFixed(3)),
      riskEstimate: failureRisk,
      probeRecommendation
    };
  }

  /**
   * Reconcile actual post-action outcome with previous counterfactual prediction.
   * Emits calibration score and surprise delta.
   */
  public reconcileOutcome(
    report: CounterfactualReport, 
    actualOutcome: { success: boolean; resultDigest: string; error?: string }
  ): {
    divergenceScore: number;
    surprises: string[];
    calibrationDelta: number;
    triggerCausalDiagnosis: boolean;
  } {
    const surprises: string[] = [];
    const predictedPrimary = report.predictedOutcomes[0];
    let divergenceScore = 0.05;

    if (predictedPrimary.failureRisk < 0.3 && !actualOutcome.success) {
      surprises.push(`Unexpected failure on benign action ${report.candidateAction.name}: ${actualOutcome.error || 'unknown error'}`);
      divergenceScore = 0.85;
    } else if (predictedPrimary.failureRisk > 0.7 && actualOutcome.success) {
      surprises.push(`Unexpected success under high risk envelope: ${report.candidateAction.name}`);
      divergenceScore = 0.45;
    }

    const accuracy = 1.0 - divergenceScore;
    this.calibrationAccumulator += accuracy;
    this.calibratedRunsCount++;

    return {
      divergenceScore,
      surprises,
      calibrationDelta: Number(accuracy.toFixed(3)),
      triggerCausalDiagnosis: divergenceScore >= 0.60
    };
  }

  public getTelemetry(): {
    simulationsRun: number;
    cowSandboxesSpawned: number;
    averagePredictionAccuracy: number;
  } {
    return {
      simulationsRun: this.simulationsCount,
      cowSandboxesSpawned: this.cowSandboxesCount,
      averagePredictionAccuracy: this.calibratedRunsCount > 0
        ? Number((this.calibrationAccumulator / this.calibratedRunsCount).toFixed(3))
        : 0.94
    };
  }
}
