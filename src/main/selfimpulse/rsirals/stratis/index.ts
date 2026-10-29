export * from './types'
export * from './workflowEngine'
export * from './evaluator'
export * from './ragEngine'
export * from './telemetryTracer'

import { StratisWorkflowEngine } from './workflowEngine'
import { StratisEvaluator } from './evaluator'
import { StratisRagEngine } from './ragEngine'
import { StratisTelemetryTracer } from './telemetryTracer'

export class StratisEngine {
  public readonly workflows: StratisWorkflowEngine;
  public readonly evals: StratisEvaluator;
  public readonly rag: StratisRagEngine;
  public readonly telemetry: StratisTelemetryTracer;

  constructor() {
    this.workflows = new StratisWorkflowEngine();
    this.evals = new StratisEvaluator();
    this.rag = new StratisRagEngine();
    this.telemetry = new StratisTelemetryTracer();
  }

  public getSummary() {
    return {
      registeredWorkflows: this.workflows.listRegisteredWorkflows().length,
      indexedChunks: this.rag.getIndexedChunkCount(),
      activeSpans: this.telemetry.listSpans().length
    };
  }
}
