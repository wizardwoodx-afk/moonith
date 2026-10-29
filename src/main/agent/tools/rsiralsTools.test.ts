import { describe, it, expect } from 'vitest';
import { 
  rsiralsQueryBeliefTool, 
  rsiralsEvaluateRiskTool, 
  rsiralsSimulateActionTool, 
  rsiralsDiagnoseFailureTool, 
  rsiralsInduceSkillTool, 
  rsiralsPublishClaimTool, 
  rsiralsAcquireTaskTool, 
  rsiralsRunWorkflowTool,
  rsiralsEvaluateOutputTool,
  rsiralsSemanticSearchTool,
  rsiralsTimeTravelRewindTool,
  rsiralsDualLedgerStatusTool,
  rsiralsTools 
} from './rsiralsTools';
import type { ToolContext } from './types';

const dummyCtx = {} as ToolContext;

describe('RSIRALS Native Agent Tools', () => {
  it('exposes all 12 core native tools', () => {
    expect(rsiralsTools.length).toBe(12);
  });

  it('queries SENTRIX belief state', async () => {
    const res = (await rsiralsQueryBeliefTool.execute({}, dummyCtx)) as any;
    expect(res.status).toBe('success');
    expect(res.content).toBeDefined();
    expect(res.telemetry).toBeDefined();
  });

  it('evaluates action risk with SENTRIX', async () => {
    const res = (await rsiralsEvaluateRiskTool.execute({
      actionName: 'write_file',
      target: 'src/index.ts',
      parameters: { content: 'test' }
    }, dummyCtx)) as any;
    expect(res.status).toBe('evaluated');
    expect(res.content).toBeDefined();
    expect(res.riskScore).toBeDefined();
    expect(res.actionClass).toBe('workspace-mutation');
  });

  it('simulates counterfactual action with VORCIS', async () => {
    const res = (await rsiralsSimulateActionTool.execute({
      actionName: 'patch_file',
      parameters: { path: 'a.ts' }
    }, dummyCtx)) as any;
    expect(res.status).toBe('simulated');
    expect(res.content).toBeDefined();
    expect(res.selectedComputeTier).toBeDefined();
    expect(res.predictedOutcomes.length).toBeGreaterThan(0);
  });

  it('diagnoses failure with CORVEX', async () => {
    const res = (await rsiralsDiagnoseFailureTool.execute({
      errorMessage: 'EACCES: permission denied',
      failingAction: 'write_file'
    }, dummyCtx)) as any;
    expect(res.status).toBe('diagnosed');
    expect(res.content).toBeDefined();
    expect(res.minimalIntervention).toBeDefined();
    expect(res.subsystemBlame).toBeDefined();
  });

  it('induces and tests skill with KAVYRA', async () => {
    const res = (await rsiralsInduceSkillTool.execute({
      skillName: 'quick_lint_check',
      description: 'Lints target file'
    }, dummyCtx)) as any;
    expect(res.status).toBe('induced');
    expect(res.content).toBeDefined();
    expect(res.signature).toContain('quick_lint_check');
  });

  it('publishes signed claim with NEXALIS', async () => {
    const res = (await rsiralsPublishClaimTool.execute({
      topic: 'test-topic',
      assertion: 'Test passed',
      proof: 'Reproduced in test suite'
    }, dummyCtx)) as any;
    expect(res.status).toBe('published');
    expect(res.content).toBeDefined();
    expect(res.signature).toBeDefined();
  });

  it('acquires task charter with VANTAGE', async () => {
    const res = (await rsiralsAcquireTaskTool.execute({
      goalSpec: 'Optimize bundle size by 10%'
    }, dummyCtx)) as any;
    expect(res.status).toBe('acquired');
    expect(res.content).toBeDefined();
    expect(res.authTier).toBeDefined();
    expect(res.blastRadiusCap).toBeDefined();
  });

  it('runs deterministic DAG workflow with STRATIS', async () => {
    const res = (await rsiralsRunWorkflowTool.execute({
      workflowName: 'Test Pipeline',
      steps: [
        { id: 'step_1', name: 'Step 1' },
        { id: 'step_2', name: 'Step 2' }
      ]
    }, dummyCtx)) as any;
    expect(res.status).toBe('completed');
    expect(res.content).toBeDefined();
    expect(res.workflowId).toBeDefined();
    expect(res.stepResults['step_1'].status).toBe('completed');
  });

  it('evaluates candidate outputs with STRATIS evals', async () => {
    const res = (await rsiralsEvaluateOutputTool.execute({
      prompt: 'Check system health',
      output: 'System health is optimal with 100% services online.',
      context: 'Health status: 100% services online'
    }, dummyCtx)) as any;
    expect(res.status).toBe('evaluated');
    expect(res.content).toBeDefined();
    expect(res.overallScore).toBeGreaterThan(0.5);
  });

  it('ingests and searches documentation with STRATIS Agentic RAG', async () => {
    const ingest = (await rsiralsSemanticSearchTool.execute({
      action: 'ingest',
      documentId: 'doc_rsirals',
      content: 'RSIRALS octa-module architecture enforces tri-loop cognition.'
    }, dummyCtx)) as any;
    expect(ingest.status).toBe('ingested');
    expect(ingest.content).toBeDefined();
    expect(ingest.chunksCreated).toBeGreaterThan(0);

    const search = (await rsiralsSemanticSearchTool.execute({
      action: 'search',
      query: 'RSIRALS cognition'
    }, dummyCtx)) as any;
    expect(search.status).toBe('success');
    expect(search.content).toBeDefined();
    expect(search.resultsCount).toBeGreaterThan(0);
  });

  it('inspects dual-ledger status and milestones', async () => {
    const res = (await rsiralsDualLedgerStatusTool.execute({}, dummyCtx)) as any;
    expect(res.status).toBe('success');
    expect(res.content).toBeDefined();
    expect(res.taskLedger).toBeDefined();
    expect(res.progressLedger).toBeDefined();
  });

  it('performs time-travel forking from checkpoint', async () => {
    const rsiralsInstance = (await import('../../selfimpulse/rsirals/rsiralsEngine')).RsiralsEngine.getInstance();
    const chk = rsiralsInstance.stratis.checkpointer.saveCheckpoint('thread_test', 1, 'node_init', { stateVar: 100 });

    const res = (await rsiralsTimeTravelRewindTool.execute({
      checkpointId: chk.checkpointId,
      patchState: { stateVar: 200 }
    }, dummyCtx)) as any;

    expect(res.status).toBe('rewound_and_forked');
    expect(res.content).toBeDefined();
    expect(res.forkedThreadId).toContain('fork_thread_test_');
    expect((res.restoredState as any).stateVar).toBe(200);
  });
});
