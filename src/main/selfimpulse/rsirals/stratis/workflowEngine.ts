import crypto from 'node:crypto'
import type { 
  WorkflowGraphDefinition, 
  WorkflowStep, 
  WorkflowExecutionResult, 
  StepStatus,
  WorkflowStepContext 
} from './types'

export class StratisWorkflowEngine {
  private activeWorkflows: Map<string, WorkflowGraphDefinition> = new Map();
  private suspendedExecutions: Map<string, {
    workflow: WorkflowGraphDefinition;
    stepIndex: number;
    state: Record<string, unknown>;
    stepResults: Record<string, any>;
  }> = new Map();

  public registerWorkflow(workflow: WorkflowGraphDefinition): void {
    this.activeWorkflows.set(workflow.id, workflow);
  }

  public getWorkflow(workflowId: string): WorkflowGraphDefinition | undefined {
    return this.activeWorkflows.get(workflowId);
  }

  public async executeWorkflow(
    workflowId: string,
    initialInput: Record<string, unknown> = {}
  ): Promise<WorkflowExecutionResult> {
    const workflow = this.activeWorkflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow '${workflowId}' is not registered`);
    }

    const executionId = `wf_exec_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const startTime = Date.now();
    const state: Record<string, unknown> = { ...initialInput };
    const stepResults: Record<string, { status: StepStatus; output?: unknown; error?: string; durationMs: number }> = {};

    let previousOutput: unknown = initialInput;

    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      const stepStartTime = Date.now();
      let suspended = false;
      let suspendReason = '';

      const ctx: WorkflowStepContext = {
        stepId: step.id,
        input: (state[step.id] || previousOutput || {}) as any,
        state,
        previousOutput,
        suspend: (reason: string) => {
          suspended = true;
          suspendReason = reason;
        }
      };

      try {
        let output: unknown;
        const retryLimit = step.retryPolicy?.maxRetries ?? 0;
        let attempts = 0;
        let lastError: unknown;

        while (attempts <= retryLimit) {
          try {
            attempts++;
            output = await step.execute(ctx);
            break;
          } catch (err) {
            lastError = err;
            if (attempts <= retryLimit) {
              const backoff = step.retryPolicy?.backoffMs ?? 50;
              await new Promise((r) => setTimeout(r, backoff));
            }
          }
        }

        if (lastError && attempts > retryLimit) {
          throw lastError;
        }

        if (suspended) {
          stepResults[step.id] = {
            status: 'suspended',
            durationMs: Date.now() - stepStartTime
          };

          this.suspendedExecutions.set(executionId, {
            workflow,
            stepIndex: i,
            state,
            stepResults
          });

          return {
            workflowId,
            executionId,
            status: 'suspended',
            state,
            stepResults,
            suspendedStepId: step.id,
            suspendReason,
            totalDurationMs: Date.now() - startTime
          };
        }

        // Validate output schema if defined
        if (step.outputSchema) {
          step.outputSchema.parse(output);
        }

        stepResults[step.id] = {
          status: 'completed',
          output,
          durationMs: Date.now() - stepStartTime
        };

        state[step.id] = output;
        previousOutput = output;

      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        stepResults[step.id] = {
          status: 'failed',
          error: errorMsg,
          durationMs: Date.now() - stepStartTime
        };

        return {
          workflowId,
          executionId,
          status: 'failed',
          state,
          stepResults,
          totalDurationMs: Date.now() - startTime
        };
      }
    }

    return {
      workflowId,
      executionId,
      status: 'completed',
      state,
      stepResults,
      totalDurationMs: Date.now() - startTime
    };
  }

  public async resumeWorkflow(
    executionId: string,
    humanPayload: Record<string, unknown>
  ): Promise<WorkflowExecutionResult> {
    const suspended = this.suspendedExecutions.get(executionId);
    if (!suspended) {
      throw new Error(`Suspended execution '${executionId}' not found or already resumed`);
    }

    this.suspendedExecutions.delete(executionId);
    const { workflow, stepIndex, state, stepResults } = suspended;
    const currentStep = workflow.steps[stepIndex];

    state[currentStep.id] = humanPayload;
    stepResults[currentStep.id] = {
      status: 'completed',
      output: humanPayload,
      durationMs: 10
    };

    let previousOutput: unknown = humanPayload;
    const startTime = Date.now();

    for (let i = stepIndex + 1; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      const stepStartTime = Date.now();

      const ctx: WorkflowStepContext = {
        stepId: step.id,
        input: (state[step.id] || previousOutput || {}) as any,
        state,
        previousOutput,
        suspend: () => {}
      };

      try {
        const output = await step.execute(ctx);
        stepResults[step.id] = {
          status: 'completed',
          output,
          durationMs: Date.now() - stepStartTime
        };
        state[step.id] = output;
        previousOutput = output;
      } catch (err: unknown) {
        stepResults[step.id] = {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - stepStartTime
        };
        return {
          workflowId: workflow.id,
          executionId,
          status: 'failed',
          state,
          stepResults,
          totalDurationMs: Date.now() - startTime
        };
      }
    }

    return {
      workflowId: workflow.id,
      executionId,
      status: 'completed',
      state,
      stepResults,
      totalDurationMs: Date.now() - startTime
    };
  }

  public listRegisteredWorkflows(): string[] {
    return Array.from(this.activeWorkflows.keys());
  }
}
