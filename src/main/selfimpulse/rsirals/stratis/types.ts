/**
 * PROPRIETARY - SelfImpulse RSIRALS Stratis Engine
 * Debranded Deterministic Workflow, Continuous Evals, Agentic RAG & Telemetry Substrate.
 */

import { z } from 'zod'

export type StepStatus = 'pending' | 'running' | 'completed' | 'suspended' | 'failed' | 'skipped';

export interface WorkflowRetryPolicy {
  maxRetries: number;
  backoffMs: number;
  exponential?: boolean;
}

export interface WorkflowStepContext<TInput = Record<string, unknown>, TState = Record<string, unknown>> {
  stepId: string;
  input: TInput;
  state: TState;
  previousOutput?: unknown;
  suspend: (reason: string, resumeSchema?: Record<string, unknown>) => void;
}

export interface WorkflowStep<TInput = any, TOutput = any> {
  id: string;
  name: string;
  description?: string;
  inputSchema?: z.ZodType<TInput>;
  outputSchema?: z.ZodType<TOutput>;
  retryPolicy?: WorkflowRetryPolicy;
  parallelWith?: string[]; // IDs of steps that run in parallel
  execute: (ctx: WorkflowStepContext<TInput>) => Promise<TOutput>;
}

export interface WorkflowGraphDefinition {
  id: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
}

export interface WorkflowExecutionResult {
  workflowId: string;
  executionId: string;
  status: 'completed' | 'suspended' | 'failed';
  state: Record<string, unknown>;
  stepResults: Record<string, { status: StepStatus; output?: unknown; error?: string; durationMs: number }>;
  suspendedStepId?: string;
  suspendReason?: string;
  totalDurationMs: number;
}

/* -------------------------------------------------------------------------
 * EVALUATIONS (EVALS)
 * ------------------------------------------------------------------------- */
export type EvalMetricKind = 
  | 'faithfulness'
  | 'hallucination'
  | 'relevance'
  | 'toxicity'
  | 'completeness'
  | 'tool_accuracy';

export interface EvalScore {
  metric: EvalMetricKind;
  score: number; // 0.0 to 1.0
  passed: boolean;
  threshold: number;
  reason: string;
  details?: Record<string, unknown>;
}

export interface ComprehensiveEvalReport {
  targetOutputId: string;
  timestamp: number;
  overallScore: number;
  passed: boolean;
  scores: EvalScore[];
}

/* -------------------------------------------------------------------------
 * AGENTIC RAG & SEMANTIC VECTOR RETRIEVAL
 * ------------------------------------------------------------------------- */
export interface RagDocumentChunk {
  chunkId: string;
  documentId: string;
  text: string;
  metadata: Record<string, unknown>;
  tokenCount: number;
  vector?: number[];
}

export interface RagSearchResult {
  chunk: RagDocumentChunk;
  score: number; // Hybrid relevance score (0.0 to 1.0)
  matchType: 'semantic' | 'keyword' | 'hybrid';
}

/* -------------------------------------------------------------------------
 * STEP-LEVEL TRACING & OBSERVABILITY
 * ------------------------------------------------------------------------- */
export interface StratisSpan {
  spanId: string;
  parentSpanId?: string;
  name: string;
  spanType: 'workflow' | 'step' | 'tool' | 'eval' | 'rag';
  startTime: number;
  endTime?: number;
  status: 'ok' | 'error';
  metadata: Record<string, unknown>;
  errorMessage?: string;
}
