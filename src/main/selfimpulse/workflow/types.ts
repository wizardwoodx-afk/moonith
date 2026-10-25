import type { z } from 'zod'
import type { DurableContext, DurableRunOptions, SerializedDurableError } from '../durable/index'

export interface WorkflowSuspension {
  stepId: string
  path: string
  payload?: unknown
}

export type WorkflowRunStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'suspended'
  | 'canceled'

export interface WorkflowStepRecord {
  stepId: string
  path: string
  status: 'running' | 'success' | 'failed' | 'suspended'
  replayed: boolean
  startedAt: string
  endedAt?: string
  error?: string
}

export interface WorkflowSnapshot<Result = unknown> {
  workflowId: string
  runId: string
  status: WorkflowRunStatus
  result?: Result
  error?: SerializedDurableError
  suspended?: WorkflowSuspension
  steps: WorkflowStepRecord[]
  updatedAt: string
}

export interface WorkflowEvent<Snapshot = WorkflowSnapshot> {
  type:
    | 'run_started'
    | 'run_success'
    | 'run_failed'
    | 'run_suspended'
    | 'run_canceled'
    | 'step_started'
    | 'step_replayed'
    | 'step_completed'
    | 'step_failed'
  workflowId: string
  runId: string
  stepId?: string
  path?: string
  status?: WorkflowRunStatus
  payload?: unknown
  snapshot?: Snapshot
}

export interface StepExecutionContext<Input> {
  input: Input
  runId: string
  stepId: string
  path: string
  signal: AbortSignal
  resumeData?: unknown
  durable?: DurableContext
  suspend: (payload?: unknown) => never
}

export interface StepDefinition<Input = unknown, Output = unknown> {
  id: string
  inputSchema?: z.ZodTypeAny
  outputSchema?: z.ZodTypeAny
  suspendSchema?: z.ZodTypeAny
  resumeSchema?: z.ZodTypeAny
  retry?: DurableRunOptions
  execute: (context: StepExecutionContext<Input>) => Promise<Output> | Output
}

export interface StepExecutionOptions {
  durable?: DurableContext
  signal?: AbortSignal
  runId?: string
  path?: string
  resumeData?: unknown
  /** Runs inside the durable boundary, before a successful output is committed. */
  validateOutput?: (output: unknown) => void | Promise<void>
  onEvent?: (event: {
    type: 'step_started' | 'step_replayed' | 'step_completed' | 'step_failed'
    stepId: string
    path: string
    replayed: boolean
    error?: unknown
  }) => void
}

export interface WorkflowConfig<Input = unknown, Output = unknown> {
  id: string
  inputSchema?: z.ZodTypeAny
  outputSchema?: z.ZodTypeAny
  /** Optional documentation only; execution remains SelfImpulse-owned. */
  description?: string
  /** Generic markers retained for inferred builder types. */
  _types?: { input: Input; output: Output }
}

export interface CreateWorkflowRunOptions {
  runId: string
  durable?: DurableContext
}
