/**
 * PROPRIETARY - SelfImpulse RSIRALS
 * Master RSIRALS Engine: Tri-Loop Octa-Modular Cognitive Substrate Coordinator
 */

import { SentrixController } from './sentrix';
import { AurixRouter } from './aurix';
import { VorcisSimulator } from './vorcis';
import { CorvexDiagnostician } from './corvex';
import { KavyraSkillEngine } from './kavyra';
import { NexalisKnowledgeExchange } from './nexalis';
import { VantageTaskAcquisition } from './vantage';
import { MiralyxMetaOptimizer } from './miralyx';
import { verifyProprietaryIntegrity, RSIRALS_PROPRIETARY_MANIFEST } from './proprietary';
import type { 
  ActionRequest, 
  BeliefStatePacket, 
  ComputeEnvelope, 
  CounterfactualReport, 
  TrajectoryTrace, 
  VerifiedCausalGraph, 
  SkillCandidate, 
  SignedEpistemicClaim, 
  TaskCharter, 
  MetaCandidate, 
  RsiralsOctaModuleStatus 
} from './types';

export class RsiralsEngine {
  private static instance: RsiralsEngine;

  // 8 Core Specialized Modules
  public readonly sentrix: SentrixController;
  public readonly aurix: AurixRouter;
  public readonly vorcis: VorcisSimulator;
  public readonly corvex: CorvexDiagnostician;
  public readonly kavyra: KavyraSkillEngine;
  public readonly nexalis: NexalisKnowledgeExchange;
  public readonly vantage: VantageTaskAcquisition;
  public readonly miralyx: MiralyxMetaOptimizer;

  private constructor() {
    this.sentrix = new SentrixController();
    this.aurix = new AurixRouter();
    this.vorcis = new VorcisSimulator();
    this.corvex = new CorvexDiagnostician();
    this.kavyra = new KavyraSkillEngine();
    this.nexalis = new NexalisKnowledgeExchange();
    this.vantage = new VantageTaskAcquisition();
    this.miralyx = new MiralyxMetaOptimizer();
  }

  public static getInstance(): RsiralsEngine {
    if (!RsiralsEngine.instance) {
      RsiralsEngine.instance = new RsiralsEngine();
    }
    return RsiralsEngine.instance;
  }

  /* -----------------------------------------------------------------------
   * 1. FAST LOOP: Observe -> Belief -> Route -> Simulate -> Enforce -> Reconcile
   * ----------------------------------------------------------------------- */
  public executeFastLoopAction(
    action: ActionRequest,
    context?: { taskComplexity?: 'trivial' | 'simple' | 'complex' | 'critical'; maxTokens?: number }
  ): {
    permitted: boolean;
    beliefPacket: BeliefStatePacket;
    computeEnvelope: ComputeEnvelope;
    counterfactualReport: CounterfactualReport;
    executionPlan: string;
  } {
    // 1. Sentrix belief state and risk check
    const beliefPacket = this.sentrix.evaluateAction(action);

    // 2. Aurix compute routing
    const hasSkill = Boolean(this.kavyra.getSkill(`skill-${action.name.toLowerCase()}-v1`));
    const defaultComplexity = beliefPacket.riskScore > 0.6 
      ? 'critical' 
      : (beliefPacket.actionClass === 'read-only' ? 'simple' : 'complex');

    const computeEnvelope = this.aurix.routeCompute({
      taskId: action.id,
      taskComplexity: context?.taskComplexity || defaultComplexity,
      beliefPacket,
      hasVerifiedSkill: hasSkill,
      maxTokenBudget: context?.maxTokens
    });

    // 3. Vorcis counterfactual simulation
    const counterfactualReport = this.vorcis.simulateAction(action, beliefPacket);

    const permitted = beliefPacket.policyDecision !== 'deny';
    const executionPlan = permitted
      ? `Action ${action.name} permitted under tier ${computeEnvelope.selectedTier} (${counterfactualReport.probeRecommendation}).`
      : `Action ${action.name} blocked by Sentrix: ${beliefPacket.decisionReason}`;

    return {
      permitted,
      beliefPacket,
      computeEnvelope,
      counterfactualReport,
      executionPlan
    };
  }

  public reconcileFastLoopAction(
    action: ActionRequest,
    counterfactualReport: CounterfactualReport,
    actualOutcome: { success: boolean; resultDigest: string; error?: string }
  ): {
    reconciled: boolean;
    surprises: string[];
    triggeredCorvex: boolean;
  } {
    this.sentrix.settleIdempotency(counterfactualReport.candidateAction.idempotencyKey || '');

    const reconciliation = this.vorcis.reconcileOutcome(counterfactualReport, actualOutcome);

    // If unexpected failure or major surprise occurred, trigger Corvex causal diagnosis
    if (reconciliation.triggerCausalDiagnosis && !actualOutcome.success) {
      const mockTrace: TrajectoryTrace = {
        traceId: `trace-${Date.now()}`,
        environmentFingerprint: `local-${process.platform}`,
        checkpointRefs: [],
        events: [],
        toolOutputs: [{ toolName: action.name, success: false, error: actualOutcome.error }],
        totalCostUsd: 0.005,
        totalLatencyMs: 350
      };
      this.corvex.diagnoseTrajectory(mockTrace, {
        errorMessage: actualOutcome.error || 'Unexpected runtime error',
        failingAction: action.name
      });
    }

    return {
      reconciled: true,
      surprises: reconciliation.surprises,
      triggeredCorvex: reconciliation.triggerCausalDiagnosis
    };
  }

  /* -----------------------------------------------------------------------
   * 2. MESO LOOP: Trace -> Causal Diagnosis -> Skill Induction -> Signed Claim
   * ----------------------------------------------------------------------- */
  public diagnoseEpisodeFailure(
    trace: TrajectoryTrace,
    failure: { errorMessage: string; failingAction: string }
  ): VerifiedCausalGraph {
    return this.corvex.diagnoseTrajectory(trace, failure);
  }

  public induceSkill(req: Parameters<KavyraSkillEngine['induceSkill']>[0]): SkillCandidate {
    const candidate = this.kavyra.induceSkill(req);

    // If verified, publish signed epistemic claim through Nexalis
    if (candidate.status === 'verified') {
      this.nexalis.publishClaim({
        topic: `skill-induction:${candidate.contract.name}`,
        assertion: `Skill ${candidate.signature} verified with held-out pass rate ${candidate.transferMetrics.heldOutPassRate}.`,
        evidenceRefs: [candidate.id, candidate.bodyRef],
        verifierIdentity: 'KAVYRA-INDUCTION-VERIFIER',
        confidence: 0.95,
        reproducibilityProof: `Unit tests: ${candidate.unitTests.length} passed.`
      });
    }

    return candidate;
  }

  public publishVerifiedClaim(params: Parameters<NexalisKnowledgeExchange['publishClaim']>[0]): SignedEpistemicClaim {
    return this.nexalis.publishClaim(params);
  }

  /* -----------------------------------------------------------------------
   * 3. SLOW LOOP: Roadmap -> Task Charter -> Meta-Evolution -> Promotion
   * ----------------------------------------------------------------------- */
  public acquireTaskCharter(params: Parameters<VantageTaskAcquisition['generateTaskCharter']>[0]): TaskCharter {
    return this.vantage.generateTaskCharter(params);
  }

  public proposeMetaMutation(params: Parameters<MiralyxMetaOptimizer['proposeCandidate']>[0]): MetaCandidate {
    return this.miralyx.proposeCandidate(params);
  }

  public evaluateMetaEvolution(
    candidate: MetaCandidate,
    evidence: Parameters<MiralyxMetaOptimizer['evaluateCandidate']>[1]
  ): ReturnType<MiralyxMetaOptimizer['evaluateCandidate']> {
    return this.miralyx.evaluateCandidate(candidate, evidence);
  }

  /* -----------------------------------------------------------------------
   * TELEMETRY AND PRODUCT SNAPSHOT
   * ----------------------------------------------------------------------- */
  public getOctaStatus(): RsiralsOctaModuleStatus {
    return {
      sentrix: this.sentrix.getTelemetry(),
      aurix: this.aurix.getTelemetry(),
      vorcis: this.vorcis.getTelemetry(),
      corvex: this.corvex.getTelemetry(),
      kavyra: this.kavyra.getTelemetry(),
      nexalis: this.nexalis.getTelemetry(),
      vantage: this.vantage.getTelemetry(),
      miralyx: this.miralyx.getTelemetry()
    };
  }

  public getProprietaryManifest() {
    return {
      manifest: RSIRALS_PROPRIETARY_MANIFEST,
      integrity: verifyProprietaryIntegrity(),
      telemetry: this.getOctaStatus()
    };
  }
}
