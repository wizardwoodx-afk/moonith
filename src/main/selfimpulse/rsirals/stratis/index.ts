export * from './types'
export * from './workflowEngine'
export * from './evaluator'
export * from './ragEngine'
export * from './telemetryTracer'
export * from './cyclicalGraph'
export * from './dualLedger'

import { StratisWorkflowEngine } from './workflowEngine'
import { StratisEvaluator } from './evaluator'
import { StratisRagEngine } from './ragEngine'
import { StratisTelemetryTracer } from './telemetryTracer'
import { StateCheckpointer } from './cyclicalGraph'
import { DualLedgerOrchestrator } from './dualLedger'

export class StratisEngine {
  public readonly workflows: StratisWorkflowEngine;
  public readonly evals: StratisEvaluator;
  public readonly rag: StratisRagEngine;
  public readonly telemetry: StratisTelemetryTracer;
  public readonly checkpointer: StateCheckpointer;
  public readonly dualLedger: DualLedgerOrchestrator;

  constructor() {
    this.workflows = new StratisWorkflowEngine();
    this.evals = new StratisEvaluator();
    this.rag = new StratisRagEngine();
    this.telemetry = new StratisTelemetryTracer();
    this.checkpointer = new StateCheckpointer();
    this.dualLedger = new DualLedgerOrchestrator();
  }

  public getSummary() {
    return {
      registeredWorkflows: this.workflows.listRegisteredWorkflows().length,
      indexedChunks: this.rag.getIndexedChunkCount(),
      activeSpans: this.telemetry.listSpans().length,
      ledger: this.dualLedger.getSnapshot()
    };
  }
}
