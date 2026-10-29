import { describe, it, expect, beforeEach } from 'vitest';
import { RsiralsEngine } from './rsiralsEngine';
import { SentrixController } from './sentrix';
import { AurixRouter } from './aurix';
import { VorcisSimulator } from './vorcis';
import { CorvexDiagnostician } from './corvex';
import { KavyraSkillEngine } from './kavyra';
import { NexalisKnowledgeExchange } from './nexalis';
import { VantageTaskAcquisition } from './vantage';
import { MiralyxMetaOptimizer } from './miralyx';
import { RSIRALS_PROPRIETARY_MANIFEST, verifyProprietaryIntegrity } from './proprietary';

describe('RSIRALS Octa-Module Tri-Loop Proprietary Engine', () => {
  let engine: RsiralsEngine;

  beforeEach(() => {
    engine = RsiralsEngine.getInstance();
  });

  describe('Proprietary Manifest & Verification', () => {
    it('verifies proprietary license, brand fingerprint, and 8 modules', () => {
      const integrity = verifyProprietaryIntegrity();
      expect(integrity.verified).toBe(true);
      expect(integrity.fingerprint).toBe(RSIRALS_PROPRIETARY_MANIFEST.securityFingerprint);
      expect(RSIRALS_PROPRIETARY_MANIFEST.modules.length).toBe(8);
      expect(RSIRALS_PROPRIETARY_MANIFEST.loops.length).toBe(3);
    });
  });

  describe('Module 1: SENTRIX (Belief State + Risk Gate)', () => {
    it('classifies read-only actions with low risk and permits them', () => {
      const sentrix = new SentrixController();
      const packet = sentrix.evaluateAction({
        id: 'act-1',
        name: 'read_file',
        target: 'src/main.ts',
        parameters: { path: 'src/main.ts' }
      });
      expect(packet.actionClass).toBe('read-only');
      expect(packet.riskScore).toBeLessThan(0.1);
      expect(packet.policyDecision).toBe('allow');
    });

    it('classifies irreversible operations with high risk requiring approval/sandbox', () => {
      const sentrix = new SentrixController();
      const packet = sentrix.evaluateAction({
        id: 'act-2',
        name: 'delete_directory',
        target: 'src/dist',
        parameters: { recursive: true }
      });
      expect(packet.actionClass).toBe('irreversible');
      expect(packet.riskScore).toBeGreaterThan(0.7);
      expect(['require_approval', 'sandbox', 'deny']).toContain(packet.policyDecision);
    });

    it('enforces idempotency locking on duplicate non-read actions', () => {
      const sentrix = new SentrixController();
      const action = {
        id: 'act-3',
        name: 'write_file',
        target: 'test.txt',
        parameters: { text: 'hello' },
        idempotencyKey: 'idem-test-123'
      };
      const p1 = sentrix.evaluateAction(action);
      expect(p1.policyDecision).toBe('allow');

      const p2 = sentrix.evaluateAction(action);
      expect(p2.policyDecision).toBe('deny');
      expect(p2.decisionReason).toContain('Idempotency lock');
    });
  });

  describe('Module 2: AURIX (Adaptive Compute Routing)', () => {
    it('routes low-risk simple tasks to T1 compact model', () => {
      const aurix = new AurixRouter();
      const envelope = aurix.routeCompute({
        taskId: 't-1',
        taskComplexity: 'simple',
        beliefPacket: {
          observedStateRef: 'ref',
          knownFacts: [],
          uncertainties: [],
          actionClass: 'read-only',
          idempotencyKey: 'k',
          riskScore: 0.1,
          policyDecision: 'allow',
          decisionReason: 'ok'
        }
      });
      expect(envelope.selectedTier).toBe('T1');
      expect(envelope.tokenBudget).toBe(4000);
    });

    it('routes critical high-consequence tasks to T3 MCTS parallel search', () => {
      const aurix = new AurixRouter();
      const envelope = aurix.routeCompute({
        taskId: 't-2',
        taskComplexity: 'critical',
        beliefPacket: {
          observedStateRef: 'ref',
          knownFacts: [],
          uncertainties: [],
          actionClass: 'irreversible',
          idempotencyKey: 'k2',
          riskScore: 0.9,
          policyDecision: 'require_approval',
          decisionReason: 'critical'
        }
      });
      expect(envelope.selectedTier).toBe('T3');
      expect(envelope.topology).toBe('mcts-tree');
      expect(envelope.verifierLevel).toBe('dual-independent');
    });
  });

  describe('Module 3: VORCIS (World Model Simulation & CoW)', () => {
    it('generates counterfactual report and recommends CoW for dangerous actions', () => {
      const vorcis = new VorcisSimulator();
      const report = vorcis.simulateAction(
        { id: 'a1', name: 'delete_file', parameters: {} },
        {
          observedStateRef: 'ref',
          knownFacts: [],
          uncertainties: [],
          actionClass: 'irreversible',
          idempotencyKey: 'idem',
          riskScore: 0.88,
          policyDecision: 'require_approval',
          decisionReason: 'irreversible'
        }
      );
      expect(report.probeRecommendation).toBe('execute-in-cow-sandbox');
      expect(report.predictedOutcomes.length).toBeGreaterThan(0);
    });

    it('detects surprises and triggers causal diagnosis upon divergence', () => {
      const vorcis = new VorcisSimulator();
      const report = vorcis.simulateAction(
        { id: 'a2', name: 'read_file', parameters: {} },
        {
          observedStateRef: 'ref',
          knownFacts: [],
          uncertainties: [],
          actionClass: 'read-only',
          idempotencyKey: 'idem-2',
          riskScore: 0.05,
          policyDecision: 'allow',
          decisionReason: 'ok'
        }
      );

      const reconciliation = vorcis.reconcileOutcome(report, {
        success: false,
        resultDigest: 'err',
        error: 'Critical system crash'
      });
      expect(reconciliation.triggerCausalDiagnosis).toBe(true);
      expect(reconciliation.surprises.length).toBeGreaterThan(0);
    });
  });

  describe('Module 4: CORVEX (Causal Diagnosis & Blame)', () => {
    it('localizes path faults and recommends minimal discriminating intervention', () => {
      const corvex = new CorvexDiagnostician();
      const graph = corvex.diagnoseTrajectory(
        {
          traceId: 'tr-1',
          environmentFingerprint: 'win32',
          checkpointRefs: [],
          events: [],
          toolOutputs: [],
          totalCostUsd: 0,
          totalLatencyMs: 0
        },
        {
          errorMessage: 'ENOENT: no such file or directory, open "missing.txt"',
          failingAction: 'read_file'
        }
      );
      expect(graph.reproductionStatus).toBe('confirmed');
      expect(graph.hypotheses[0].suspectedFactor).toContain('filesystem');
      expect(graph.minimalIntervention).toContain('Resolve absolute path');
      expect(graph.subsystemBlame['environment']).toBeGreaterThan(0.4);
    });
  });

  describe('Module 5: KAVYRA (Verified Skill Induction)', () => {
    it('induces and verifies skill contracts with multi-tier retrieval', () => {
      const kavyra = new KavyraSkillEngine();
      const skill = kavyra.induceSkill({
        skillName: 'atomic_rename',
        description: 'Atomically rename file with rollback backup',
        sourceTrajectory: {
          traceId: 't-1',
          environmentFingerprint: 'win32',
          checkpointRefs: [],
          events: [],
          toolOutputs: [],
          totalCostUsd: 0,
          totalLatencyMs: 0
        },
        inputsSchema: { oldPath: 'string', newPath: 'string' },
        preconditions: ['oldPath exists'],
        postconditions: ['newPath exists', 'oldPath removed'],
        executableSource: 'export function run(args) { return true; }',
        testCases: [
          {
            name: 'renames-successfully',
            input: { oldPath: 'a.txt', newPath: 'b.txt' },
            expectedOutput: { ok: true }
          }
        ]
      });

      expect(skill.status).toBe('verified');
      expect(skill.signature).toContain('atomic_rename');

      const l0 = kavyra.retrieveSkills('L0');
      expect(l0.some((s) => s.id === skill.id)).toBe(true);
    });
  });

  describe('Module 6: NEXALIS (Signed Epistemic Claims)', () => {
    it('cryptographically signs claims and verifies tamper detection', () => {
      const nexalis = new NexalisKnowledgeExchange();
      const claim = nexalis.publishClaim({
        topic: 'performance-benchmark',
        assertion: 'Tree-search reduces regression rate by 42%',
        evidenceRefs: ['ev-001'],
        verifierIdentity: 'BENCHMARK-RUNNER-V1',
        confidence: 0.96,
        reproducibilityProof: '100 randomized runs with zero drift'
      });

      expect(claim.signature).toBeDefined();
      expect(claim.payloadHash.length).toBe(64); // SHA-256

      const verification = nexalis.verifyClaimCompatibility(claim.claimId, claim.environmentFingerprint);
      expect(verification.valid).toBe(true);

      // Revocation test
      nexalis.revokeClaim(claim.claimId, 'New benchmark counter-evidence');
      const postRevoke = nexalis.verifyClaimCompatibility(claim.claimId, claim.environmentFingerprint);
      expect(postRevoke.valid).toBe(false);
      expect(postRevoke.reason).toContain('revoked');
    });
  });

  describe('Module 7: VANTAGE (Goal-Directed Task Acquisition)', () => {
    it('formulates formal TaskCharter with SLA and blast-radius caps', () => {
      const vantage = new VantageTaskAcquisition();
      const charter = vantage.generateTaskCharter({
        goalSpec: 'Deploy new release candidate to staging environment',
        successCriteria: ['All integration suites pass', 'Zero memory leaks detected']
      });

      expect(charter.authTier).toBe('T2_ScopedHumanApproval');
      expect(charter.blastRadiusCap.forbiddenPaths).toContain('.git/**');
      expect(charter.rollbackPlan).toContain('checkpoint');
    });
  });

  describe('Module 8: MIRALYX (Recursive Meta-Improvement)', () => {
    it('promotes candidate when golden suites pass and rejects on regression', () => {
      const miralyx = new MiralyxMetaOptimizer();
      const candidate = miralyx.proposeCandidate({
        targetSubsystem: 'harness.reviewDepth',
        rationale: 'Increase review depth to eliminate silent hallucinations',
        proposedMutation: 'reviewDepth: 3',
        diffPayload: { reviewDepth: 3 }
      });

      const passingResult = miralyx.evaluateCandidate(candidate, {
        verifiedPassRate: 0.98,
        heldOutPassRate: 0.94,
        tokenEfficiencyDelta: 0.05,
        regressionDetected: false
      });
      expect(passingResult.promoted).toBe(true);

      const candidate2 = miralyx.proposeCandidate({
        targetSubsystem: 'harness.checkBias',
        rationale: 'Aggressive bias',
        proposedMutation: 'checkBias: 0.9',
        diffPayload: { checkBias: 0.9 }
      });

      const failingResult = miralyx.evaluateCandidate(candidate2, {
        verifiedPassRate: 0.80,
        heldOutPassRate: 0.75,
        tokenEfficiencyDelta: -0.20,
        regressionDetected: true
      });
      expect(failingResult.promoted).toBe(false);
      expect(failingResult.reason).toContain('failed transfer gate');
    });
  });

  describe('End-to-End Tri-Loop Master Coordination', () => {
    it('executes Fast Loop through Sentrix, Aurix, and Vorcis seamlessly', () => {
      const fastResult = engine.executeFastLoopAction({
        id: 'fast-act-1',
        name: 'read_file',
        target: 'package.json',
        parameters: { path: 'package.json' }
      });
      expect(fastResult.permitted).toBe(true);
      expect(fastResult.computeEnvelope.selectedTier).toBe('T1');
      expect(fastResult.counterfactualReport.probeRecommendation).toBe('proceed');

      const reconcileResult = engine.reconcileFastLoopAction(
        { id: 'fast-act-1', name: 'read_file', parameters: {} },
        fastResult.counterfactualReport,
        { success: true, resultDigest: 'digest-ok' }
      );
      expect(reconcileResult.reconciled).toBe(true);
    });

    it('aggregates live telemetry across all 8 modules in getOctaStatus()', () => {
      const status = engine.getOctaStatus();
      expect(status.sentrix.interceptedActions).toBeGreaterThan(0);
      expect(status.aurix.routedEnvelopesCount).toBeGreaterThan(0);
      expect(status.vorcis.simulationsRun).toBeGreaterThan(0);
      expect(status.kavyra.activeVerifiedSkills).toBeGreaterThan(0);
      expect(status.miralyx.anchorEvaluatorHealth).toBe('immutably-locked');
    });
  });
});
