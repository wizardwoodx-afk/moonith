import { describe, expect, it } from 'vitest'
import { StratisWorkflowEngine } from './workflowEngine'
import { StratisEvaluator } from './evaluator'
import { StratisRagEngine } from './ragEngine'
import { StratisTelemetryTracer } from './telemetryTracer'
import { StratisEngine } from './index'
import { RsiralsEngine } from '../rsiralsEngine'

describe('RSIRALS Stratis Engine (Debranded Workflows, Evals & RAG Subsystem)', () => {
  it('executes a multi-step deterministic DAG workflow with state chaining', async () => {
    const engine = new StratisWorkflowEngine();

    engine.registerWorkflow({
      id: 'pipeline_v1',
      name: 'Code Review & Validation Pipeline',
      steps: [
        {
          id: 'step_lint',
          name: 'Lint Source Files',
          execute: async (ctx) => {
            return { lintErrors: 0, filesChecked: 12 };
          }
        },
        {
          id: 'step_compile',
          name: 'Compile Types',
          execute: async (ctx) => {
            const prev = ctx.previousOutput as any;
            return { compiled: true, hadErrors: prev.lintErrors > 0 };
          }
        }
      ]
    });

    const result = await engine.executeWorkflow('pipeline_v1');
    expect(result.status).toBe('completed');
    expect(result.stepResults['step_lint'].status).toBe('completed');
    expect(result.stepResults['step_compile'].status).toBe('completed');
    expect((result.state['step_compile'] as any).compiled).toBe(true);
  });

  it('supports human-in-the-loop workflow suspension and resumption', async () => {
    const engine = new StratisWorkflowEngine();

    engine.registerWorkflow({
      id: 'approval_flow',
      name: 'Deploy Flow',
      steps: [
        {
          id: 'stage_assets',
          name: 'Stage Assets',
          execute: async () => ({ staged: true })
        },
        {
          id: 'human_gate',
          name: 'Production Approval Gate',
          execute: async (ctx) => {
            ctx.suspend('Approval needed before deploy to production');
            return null;
          }
        },
        {
          id: 'deploy',
          name: 'Push Live',
          execute: async (ctx) => {
            const approval = ctx.state['human_gate'] as any;
            return { deployed: approval.approved === true };
          }
        }
      ]
    });

    const suspended = await engine.executeWorkflow('approval_flow');
    expect(suspended.status).toBe('suspended');
    expect(suspended.suspendedStepId).toBe('human_gate');

    const resumed = await engine.resumeWorkflow(suspended.executionId, { approved: true });
    expect(resumed.status).toBe('completed');
    expect((resumed.state['deploy'] as any).deployed).toBe(true);
  });

  it('evaluates outputs for faithfulness, hallucination risk, and query relevance', () => {
    const evalSuite = new StratisEvaluator();

    const report = evalSuite.evaluateAll({
      prompt: 'Summarize the Q3 revenue results',
      output: 'In Q3, revenue reached $15M with 25% growth across results.',
      context: 'Q3 financial report shows revenue reached $15M with 25% growth.',
      groundTruth: 'Revenue $15M, 25% growth.'
    });

    expect(report.passed).toBe(true);
    expect(report.overallScore).toBeGreaterThanOrEqual(0.7);
    expect(report.scores.find((s) => s.metric === 'relevance')?.passed).toBe(true);
    expect(report.scores.find((s) => s.metric === 'hallucination')?.score).toBeLessThan(0.3);
  });

  it('chunks documents, indexes vectors, and performs hybrid RAG searches', () => {
    const rag = new StratisRagEngine();

    rag.ingestDocument(
      'doc_governance',
      'The SelfImpulse RSIRALS architecture guarantees verifiable empirical reasoning and fail-closed security assertions across all autonomous desktop actions.'
    );

    expect(rag.getIndexedChunkCount()).toBeGreaterThan(0);

    const results = rag.search('RSIRALS architecture verifiable reasoning');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThan(0.4);
    expect(results[0].chunk.text).toContain('verifiable empirical reasoning');
  });

  it('tracks OpenTelemetry-style parent-child execution spans', () => {
    const tracer = new StratisTelemetryTracer();

    const root = tracer.startSpan('root_workflow', 'workflow', { runId: 'run_1' });
    const child = tracer.startSpan('step_exec', 'step', { step: 1 }, root.spanId);

    tracer.endSpan(child.spanId, 'ok');
    tracer.endSpan(root.spanId, 'ok');

    const tree = tracer.getSpanTree(root.spanId);
    expect(tree.length).toBe(2);
    expect(tree[1].parentSpanId).toBe(root.spanId);
  });

  it('RsiralsEngine coordinates Stratis natively without third-party vendor lock-in', () => {
    const rsirals = RsiralsEngine.getInstance();
    expect(rsirals.stratis).toBeDefined();
    expect(rsirals.stratis.workflows).toBeDefined();
    expect(rsirals.stratis.evals).toBeDefined();
    expect(rsirals.stratis.rag).toBeDefined();
    expect(rsirals.stratis.telemetry).toBeDefined();
  });
});
