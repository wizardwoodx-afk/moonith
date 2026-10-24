import {
  RetryableError,
  TerminalError,
  abortableDelay,
  isAbortError
} from '../durable/index'
import type { DurableRunOptions } from '../durable/index'
import { WorkflowSuspendedError, WorkflowValidationError } from './errors'
import type { StepDefinition, StepExecutionOptions } from './types'

export function createStep<Input = unknown, Output = unknown>(
  definition: StepDefinition<Input, Output>
): StepDefinition<Input, Output> {
  if (!definition.id.trim()) throw new Error('A workflow step ID is required.')
  return definition
}

/** Shared by standalone workflows and the Captain engine's model/tool nodes. */
export async function executeStep<Input, Output>(
  step: StepDefinition<Input, Output>,
  rawInput: Input,
  options: StepExecutionOptions = {}
): Promise<Output> {
  const path = options.path ?? step.id
  const runId = options.runId ?? options.durable?.runId ?? 'local'
  const signal = options.signal ?? new AbortController().signal
  const replayed = options.durable?.hasCompleted(path) ?? false
  options.onEvent?.({ type: replayed ? 'step_replayed' : 'step_started', stepId: step.id, path, replayed })

  const invoke = async (): Promise<Output> => {
    if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    const input = parseSchema<Input>(step.inputSchema, rawInput, `Input for workflow step "${step.id}"`)
    const resumeData =
      options.resumeData === undefined
        ? undefined
        : parseSchema<unknown>(
            step.resumeSchema,
            options.resumeData,
            `Resume data for workflow step "${step.id}"`
          )
    const output = await step.execute({
      input,
      runId,
      stepId: step.id,
      path,
      signal,
      resumeData,
      durable: options.durable,
      suspend: (payload) => {
        const validated = parseSchema<unknown>(
          step.suspendSchema,
          payload,
          `Suspend payload for workflow step "${step.id}"`
        )
        throw new WorkflowSuspendedError(step.id, path, validated)
      }
    })
    const parsed = parseSchema<Output>(step.outputSchema, output, `Output for workflow step "${step.id}"`)
    await options.validateOutput?.(parsed)
    return parsed
  }

  try {
    const retry = withControlFlowPolicy(step.retry)
    const output = options.durable
      ? await options.durable.run(path, invoke, { ...retry, signal })
      : await executeLocally(invoke, retry, signal)
    options.onEvent?.({ type: 'step_completed', stepId: step.id, path, replayed })
    return output
  } catch (error) {
    options.onEvent?.({ type: 'step_failed', stepId: step.id, path, replayed, error })
    throw error
  }
}

async function executeLocally<Output>(
  callback: () => Promise<Output>,
  retry: DurableRunOptions,
  signal: AbortSignal
): Promise<Output> {
  const maxAttempts = Math.max(1, Math.floor(retry.maxAttempts ?? 1))
  const initialDelay = Math.max(0, retry.initialDelayMs ?? 200)
  const maxDelay = Math.max(0, retry.maxDelayMs ?? 10_000)
  const multiplier = Math.max(1, retry.backoffMultiplier ?? 2)
  const retryOn = retry.retryOn ?? ((error: unknown) => !(error instanceof TerminalError))

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await callback()
    } catch (error) {
      const shouldRetry =
        attempt < maxAttempts &&
        !signal.aborted &&
        (error instanceof RetryableError || retryOn(error))
      if (!shouldRetry) throw error
      await abortableDelay(Math.min(maxDelay, initialDelay * multiplier ** (attempt - 1)), signal)
    }
  }
}

function withControlFlowPolicy(retry: DurableRunOptions = {}): DurableRunOptions {
  const custom = retry.retryOn
  return {
    ...retry,
    retryOn: (error) => {
      if (
        error instanceof WorkflowSuspendedError ||
        error instanceof WorkflowValidationError ||
        error instanceof TerminalError ||
        isAbortError(error)
      ) {
        return false
      }
      return custom ? custom(error) : true
    }
  }
}

function parseSchema<Input>(
  schema: StepDefinition<Input, unknown>['inputSchema'],
  value: unknown,
  label: string
): Input {
  if (!schema) return value as Input
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`)
      .join('; ')
    throw new WorkflowValidationError(`${label} is invalid: ${issues}`)
  }
  return parsed.data as Input
}
