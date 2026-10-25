import { createHash } from 'node:crypto'
import { z } from 'zod'
import { abortableDelay } from '../durable/index'
import { nowIso } from '../../util'
import { WorkflowStateError, WorkflowSuspendedError, WorkflowValidationError } from './errors'
import { createStep, executeStep } from './step'
import type {
  CreateWorkflowRunOptions,
  StepDefinition,
  WorkflowConfig,
  WorkflowEvent,
  WorkflowRunStatus,
  WorkflowSnapshot,
  WorkflowStepRecord
} from './types'

type AnyStep = StepDefinition<any, any>
type Operation =
  | { kind: 'step'; step: AnyStep }
  | { kind: 'parallel'; steps: AnyStep[] }
  | {
      kind: 'branch'
      branches: Array<{ when: (input: any) => boolean | Promise<boolean>; step: AnyStep }>
      otherwise?: AnyStep
    }
  | { kind: 'foreach'; step: AnyStep; concurrency: number }
  | {
      kind: 'loop'
      step: AnyStep
      until: (context: { input: any; output: any; iteration: number }) => boolean | Promise<boolean>
      maxIterations: number
    }

export class WorkflowBuilder<Input = unknown, Current = Input> {
  private readonly operations: Operation[] = []

  constructor(private readonly config: WorkflowConfig<Input, Current>) {}

  then<Next>(step: StepDefinition<Current, Next>): WorkflowBuilder<Input, Next> {
    this.operations.push({ kind: 'step', step })
    return this as unknown as WorkflowBuilder<Input, Next>
  }

  parallel<Output extends Record<string, unknown> = Record<string, unknown>>(
    steps: Array<StepDefinition<Current, unknown>>
  ): WorkflowBuilder<Input, Output> {
    assertUniqueSteps(steps)
    this.operations.push({ kind: 'parallel', steps })
    return this as unknown as WorkflowBuilder<Input, Output>
  }

  branch<Next>(
    branches: Array<{
      when: (input: Current) => boolean | Promise<boolean>
      step: StepDefinition<Current, Next>
    }>,
    otherwise?: StepDefinition<Current, Next>
  ): WorkflowBuilder<Input, Next | Current> {
    if (!branches.length) throw new Error('A workflow branch needs at least one condition.')
    this.operations.push({ kind: 'branch', branches, otherwise })
    return this as unknown as WorkflowBuilder<Input, Next | Current>
  }

  foreach<Item, Next>(
    step: StepDefinition<Item, Next>,
    options: { concurrency?: number } = {}
  ): WorkflowBuilder<Input, Next[]> {
    const concurrency = Math.max(1, Math.floor(options.concurrency ?? 4))
    this.operations.push({ kind: 'foreach', step, concurrency })
    return this as unknown as WorkflowBuilder<Input, Next[]>
  }

  loop<Next>(
    step: StepDefinition<Current, Next>,
    options: {
      until: (context: {
        input: Current
        output: Next
        iteration: number
      }) => boolean | Promise<boolean>
      maxIterations?: number
    }
  ): WorkflowBuilder<Input, Next> {
    this.operations.push({
      kind: 'loop',
      step,
      until: options.until,
      maxIterations: Math.max(1, Math.floor(options.maxIterations ?? 20))
    })
    return this as unknown as WorkflowBuilder<Input, Next>
  }

  commit(): Workflow<Input, Current> {
    if (!this.operations.length) throw new Error('A workflow needs at least one operation.')
    return new Workflow(this.config, [...this.operations], definitionDigest(this.operations))
  }
}

/**
 * Replay keys are positional (`op:<index>:<stepId>`), so inserting, removing or
 * reshaping a step can silently point a new definition at output another step
 * already committed. Every durable key is therefore namespaced under a
 * fingerprint of the committed definition: an edited workflow reads a different
 * namespace and re-executes instead of replaying foreign output.
 *
 * The fingerprint covers operation kind, step IDs and the numeric bounds only -
 * never a function body. A predicate's source text changes when the bundler
 * minifies it, and a key that moved on every build would re-run every unfinished
 * side effect after an upgrade. A step whose `execute` body changed while its
 * ID and position stayed the same is a definition change this cannot see; that
 * is the documented boundary of the fingerprint.
 */
function operationFingerprint(operation: Operation): string {
  switch (operation.kind) {
    case 'step':
      return `step:${operation.step.id}`
    case 'parallel':
      return `parallel:[${operation.steps.map((step) => step.id).join(',')}]`
    case 'branch':
      return `branch:[${operation.branches
        .map((branch) => branch.step.id)
        .join(',')}]:${operation.otherwise?.id ?? '-'}`
    case 'foreach':
      return `foreach:${operation.step.id}:${operation.concurrency}`
    case 'loop':
      return `loop:${operation.step.id}:${operation.maxIterations}`
  }
}

function definitionDigest(operations: Operation[]): string {
  const signature = operations
    .map((operation) => operationFingerprint(operation))
    .join(String.fromCharCode(0))
  return createHash('sha256').update(signature).digest('hex').slice(0, 16)
}

export function createWorkflow<Input = unknown>(
  config: WorkflowConfig<Input, Input>
): WorkflowBuilder<Input, Input> {
  if (!config.id.trim()) throw new Error('A workflow ID is required.')
  return new WorkflowBuilder(config)
}

export class Workflow<Input = unknown, Output = unknown> {
  constructor(
    private readonly config: WorkflowConfig<Input, Output>,
    private readonly operations: Operation[],
    private readonly definition: string = definitionDigest(operations)
  ) {}

  get id(): string {
    return this.config.id
  }

  /** Fingerprint of the committed definition; part of every durable key. */
  get fingerprint(): string {
    return this.definition
  }

  createRun(options: CreateWorkflowRunOptions): WorkflowRun<Input, Output> {
    if (options.durable && options.durable.runId !== options.runId) {
      throw new Error('The workflow run ID must match its durable context run ID.')
    }
    return new WorkflowRun(this.config, this.operations, options, this.definition)
  }
}

export class WorkflowRun<Input = unknown, Output = unknown> {
  private current: WorkflowSnapshot<Output>
  private readonly listeners = new Set<(event: WorkflowEvent<WorkflowSnapshot<Output>>) => void>()
  private controller = new AbortController()
  private resumeTarget?: { path: string; data: unknown }
  private input?: Input
  private hasInput = false
  private active = false
  private cancelRequested = false
  private executing: Promise<WorkflowSnapshot<Output>> | null = null

  constructor(
    private readonly config: WorkflowConfig<Input, Output>,
    private readonly operations: Operation[],
    private readonly options: CreateWorkflowRunOptions,
    private readonly definition: string = definitionDigest(operations)
  ) {
    this.current = {
      workflowId: config.id,
      runId: options.runId,
      status: 'pending',
      steps: [],
      updatedAt: nowIso()
    }
  }

  snapshot(): WorkflowSnapshot<Output> {
    return clone(this.current)
  }

  watch(listener: (event: WorkflowEvent<WorkflowSnapshot<Output>>) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  stream(): AsyncIterable<WorkflowEvent<WorkflowSnapshot<Output>>> {
    const queue: Array<WorkflowEvent<WorkflowSnapshot<Output>>> = []
    let finished = isTerminal(this.current.status)
    let wake: (() => void) | undefined
    const unwatch = this.watch((event) => {
      queue.push(event)
      if (isTerminal(event.status ?? this.current.status)) finished = true
      wake?.()
      wake = undefined
    })
    return {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<WorkflowEvent<WorkflowSnapshot<Output>>>> => {
          while (!queue.length) {
            if (finished) {
              unwatch()
              return { done: true, value: undefined }
            }
            await new Promise<void>((resolve) => {
              wake = resolve
            })
          }
          return { done: false, value: queue.shift()! }
        },
        return: async (): Promise<IteratorResult<WorkflowEvent<WorkflowSnapshot<Output>>>> => {
          finished = true
          unwatch()
          wake?.()
          return { done: true, value: undefined }
        }
      })
    }
  }

  async start(
    input: Input,
    options: { signal?: AbortSignal } = {}
  ): Promise<WorkflowSnapshot<Output>> {
    if (this.active || this.executing || this.current.status !== 'pending') {
      throw new WorkflowStateError(`Cannot start a workflow run in "${this.current.status}" state.`)
    }
    const parsed = parse<Input>(this.config.inputSchema, input, `Input for workflow "${this.config.id}"`)
    this.active = true
    // Installed before the first await so a cancel() landing during the journal
    // write below aborts the controller this execution actually runs under.
    this.armController()
    try {
      this.input = parsed
      this.hasInput = true
      if (this.options.durable) {
        await this.options.durable.set(this.inputKey, { value: parsed })
        await this.saveSnapshot()
      }
      return await this.execute(parsed, false, options.signal)
    } finally {
      this.active = false
    }
  }

  async resume(stepId: string, resumeData: unknown): Promise<WorkflowSnapshot<Output>> {
    if (this.active || this.executing || this.current.status === 'running') {
      throw new WorkflowStateError('The workflow is already running.')
    }
    this.active = true
    this.armController()
    try {
      await this.loadPersisted()
      const suspended = this.current.suspended
      if (this.current.status !== 'suspended' || !suspended) {
        throw new WorkflowStateError('The workflow run is not suspended.')
      }
      if (suspended.stepId !== stepId) {
        throw new WorkflowStateError(`Workflow is suspended at "${suspended.stepId}", not "${stepId}".`)
      }
      const input = await this.storedInput()
      this.resumeTarget = { path: suspended.path, data: resumeData }
      if (this.options.durable) {
        await this.options.durable.set(this.resumeKey, { path: suspended.path, data: resumeData })
      }
      return await this.execute(input, true)
    } finally {
      this.active = false
    }
  }

  async recover(options: { signal?: AbortSignal } = {}): Promise<WorkflowSnapshot<Output>> {
    if (this.active || this.executing || this.current.status === 'running') return this.snapshot()
    this.active = true
    this.armController()
    try {
      const loaded = await this.loadPersisted()
      const status = loaded.status
      if (status === 'pending') {
        throw new WorkflowStateError('No persisted workflow run exists to recover.')
      }
      if (status !== 'running') return this.snapshot()
      const resume = this.options.durable?.get<{ path: string; data: unknown }>(this.resumeKey)
      if (resume) this.resumeTarget = resume
      return await this.execute(await this.storedInput(), true, options.signal)
    } finally {
      this.active = false
    }
  }

  /**
   * A cancel is never discarded: it records the request even when no execution
   * is running yet, and `execute()` aborts the controller it installs when the
   * request is already set.
   */
  cancel(): void {
    if (isTerminal(this.current.status)) return
    this.cancelRequested = true
    this.controller.abort(new DOMException('The workflow was cancelled.', 'AbortError'))
  }

  /** Installs the controller an execution runs under, honouring a pending cancel. */
  private armController(): void {
    this.controller = new AbortController()
    if (this.cancelRequested) {
      this.controller.abort(new DOMException('The workflow was cancelled.', 'AbortError'))
    }
  }

  private execute(
    input: Input,
    resumed: boolean,
    externalSignal?: AbortSignal
  ): Promise<WorkflowSnapshot<Output>> {
    if (this.executing) {
      throw new WorkflowStateError('The workflow run is already executing.')
    }
    this.armController()
    const execution = this.runExecution(input, resumed, externalSignal)
    this.executing = execution
    return execution.finally(() => {
      if (this.executing === execution) this.executing = null
    })
  }

  private async runExecution(
    input: Input,
    resumed: boolean,
    externalSignal?: AbortSignal
  ): Promise<WorkflowSnapshot<Output>> {
    const forwardAbort = () => this.controller.abort(externalSignal?.reason)
    if (externalSignal?.aborted) forwardAbort()
    else externalSignal?.addEventListener('abort', forwardAbort, { once: true })

    this.current.status = 'running'
    this.current.error = undefined
    this.current.result = undefined
    if (!resumed) this.current.suspended = undefined
    await this.saveSnapshot()
    this.emit({ type: 'run_started', status: 'running', payload: { resumed } })

    try {
      let value: unknown = input
      for (let index = 0; index < this.operations.length; index += 1) {
        value = await this.executeOperation(this.operations[index], value, index)
      }
      if (this.controller.signal.aborted) {
        throw this.controller.signal.reason ?? new DOMException('The workflow was cancelled.', 'AbortError')
      }
      const result = parse<Output>(
        this.config.outputSchema,
        value,
        `Output for workflow "${this.config.id}"`
      )
      this.current.status = 'success'
      this.current.result = result
      this.current.suspended = undefined
      if (this.options.durable) await this.options.durable.delete(this.resumeKey)
      await this.saveSnapshot()
      this.emit({ type: 'run_success', status: 'success', payload: result })
    } catch (error) {
      if (error instanceof WorkflowSuspendedError) {
        this.current.status = 'suspended'
        this.current.suspended = {
          stepId: error.stepId,
          path: error.path,
          payload: error.payload
        }
        await this.saveSnapshot()
        this.emit({ type: 'run_suspended', status: 'suspended', payload: error.payload })
      } else if (this.controller.signal.aborted || isAbort(error)) {
        this.current.status = 'canceled'
        this.current.error = serialize(error)
        await this.saveSnapshot()
        this.emit({ type: 'run_canceled', status: 'canceled' })
      } else {
        this.current.status = 'failed'
        this.current.error = serialize(error)
        await this.saveSnapshot()
        this.emit({ type: 'run_failed', status: 'failed', payload: this.current.error })
      }
    } finally {
      externalSignal?.removeEventListener('abort', forwardAbort)
      this.resumeTarget = undefined
      this.cancelRequested = false
    }
    return this.snapshot()
  }

  private async executeOperation(
    operation: Operation,
    input: unknown,
    index: number
  ): Promise<unknown> {
    switch (operation.kind) {
      case 'step':
        return this.runSingle(operation.step, input, this.stepPath(index, operation.step.id))
      case 'parallel': {
        const entries = await Promise.all(
          operation.steps.map(
            async (step) =>
              [
                step.id,
                await this.runSingle(step, input, this.stepPath(index, step.id))
              ] as const
          )
        )
        return Object.fromEntries(entries)
      }
      case 'branch': {
        for (const branch of operation.branches) {
          if (await branch.when(input)) {
            return this.runSingle(branch.step, input, this.stepPath(index, branch.step.id))
          }
        }
        return operation.otherwise
          ? this.runSingle(operation.otherwise, input, this.stepPath(index, operation.otherwise.id))
          : input
      }
      case 'foreach': {
        if (!Array.isArray(input)) {
          throw new WorkflowValidationError(`Foreach operation ${index} expected an array input.`)
        }
        const output = new Array<unknown>(input.length)
        let next = 0
        const workers = Array.from(
          { length: Math.min(operation.concurrency, Math.max(1, input.length)) },
          async () => {
            while (next < input.length) {
              const itemIndex = next++
              output[itemIndex] = await this.runSingle(
                operation.step,
                input[itemIndex],
                this.stepPath(index, operation.step.id, itemIndex)
              )
            }
          }
        )
        await Promise.all(workers)
        return output
      }
      case 'loop': {
        let current = input
        for (let iteration = 1; iteration <= operation.maxIterations; iteration += 1) {
          const output = await this.runSingle(
            operation.step,
            current,
            this.stepPath(index, operation.step.id, iteration),
            async (candidate) => {
              // This check belongs inside the durable callback. A final
              // iteration is only cached when the loop really terminated.
              if (
                iteration === operation.maxIterations &&
                !(await operation.until({ input: current, output: candidate, iteration }))
              ) {
                throw new WorkflowValidationError(
                  `Loop step "${operation.step.id}" did not finish within ${operation.maxIterations} iterations.`
                )
              }
            }
          )
          if (await operation.until({ input: current, output, iteration })) return output
          current = output
        }
        throw new WorkflowValidationError(`Loop step "${operation.step.id}" ended unexpectedly.`)
      }
    }
  }

  private async runSingle(
    step: AnyStep,
    input: unknown,
    path: string,
    validateOutput?: (output: unknown) => void | Promise<void>
  ): Promise<unknown> {
    const replayed = this.options.durable?.hasCompleted(path) ?? false
    const target = this.resumeTarget
    const resuming = target?.path === path
    const resumeData = resuming && target ? target.data : undefined
    if (resuming) this.resumeTarget = undefined

    try {
      const output = await executeStep(step, input, {
        durable: this.options.durable,
        signal: this.controller.signal,
        runId: this.options.runId,
        path,
        resumeData,
        validateOutput,
        onEvent: (event) => {
          this.recordStep(event, step.id, path, replayed)
          this.emit({
            type: event.type,
            status: this.current.status,
            stepId: step.id,
            path,
            payload: event.error
          })
        }
      })
      if (resuming && this.options.durable) await this.options.durable.delete(this.resumeKey)
      await this.saveSnapshot()
      return output
    } catch (error) {
      await this.saveSnapshot()
      throw error
    }
  }

  private recordStep(
    event: {
      type: 'step_started' | 'step_replayed' | 'step_completed' | 'step_failed'
      error?: unknown
    },
    stepId: string,
    path: string,
    replayed: boolean
  ): void {
    const existing = this.current.steps.find((step) => step.path === path)
    const record: WorkflowStepRecord = existing ?? {
      stepId,
      path,
      status: 'running',
      replayed,
      startedAt: nowIso()
    }
    if (!existing) this.current.steps.push(record)
    if (event.type === 'step_started' || event.type === 'step_replayed') {
      record.status = 'running'
      record.replayed = event.type === 'step_replayed'
      record.error = undefined
      record.endedAt = undefined
    } else if (event.type === 'step_completed') {
      record.status = 'success'
      record.replayed = replayed
      record.endedAt = nowIso()
    } else {
      record.status = event.error instanceof WorkflowSuspendedError ? 'suspended' : 'failed'
      record.error = event.error instanceof Error ? event.error.message : String(event.error)
      record.endedAt = nowIso()
    }
  }

  /**
   * Every durable key is namespaced under the definition fingerprint. Replay
   * keys are otherwise positional (`op:<index>:<stepId>`), so inserting or
   * reshaping a step could point a new definition at output an older step
   * committed. A changed definition reads and writes a different namespace.
   */
  private get keyPrefix(): string {
    return `def:${this.definition}:`
  }

  private stepPath(operation: number, stepId: string, item?: number): string {
    return `${this.keyPrefix}workflow:${this.config.id}:op:${operation}:${stepId}${item === undefined ? '' : `:${item}`}`
  }

  private get inputKey(): string {
    return `${this.keyPrefix}__workflow:${this.config.id}:${this.options.runId}:input`
  }

  private get snapshotKey(): string {
    return `${this.keyPrefix}__workflow:${this.config.id}:${this.options.runId}:snapshot`
  }

  private get resumeKey(): string {
    return `${this.keyPrefix}__workflow:${this.config.id}:${this.options.runId}:resume`
  }

  private async storedInput(): Promise<Input> {
    const envelope = this.options.durable?.get<{ value: Input }>(this.inputKey)
    if (envelope && 'value' in envelope) return envelope.value
    if (this.hasInput) return this.input as Input
    throw new WorkflowStateError('The persisted workflow input is missing.')
  }

  private async loadPersisted(): Promise<WorkflowSnapshot<Output>> {
    const stored = this.options.durable?.get<WorkflowSnapshot<Output>>(this.snapshotKey)
    if (stored) this.current = clone(stored)
    return this.current
  }

  private async saveSnapshot(): Promise<void> {
    this.current.updatedAt = nowIso()
    if (this.options.durable) await this.options.durable.set(this.snapshotKey, this.current)
  }

  private emit(event: {
    type: WorkflowEvent<WorkflowSnapshot<Output>>['type']
    status?: WorkflowRunStatus
    stepId?: string
    path?: string
    payload?: unknown
  }): void {
    const complete: WorkflowEvent<WorkflowSnapshot<Output>> = {
      ...event,
      workflowId: this.config.id,
      runId: this.options.runId,
      snapshot: this.snapshot()
    }
    for (const listener of this.listeners) listener(complete)
  }
}

export function createSleepStep<Input = unknown>(
  id: string,
  durationMs: number
): StepDefinition<Input, Input> {
  return createStep({
    id,
    execute: async ({ input, durable, path, signal }) => {
      if (durable) await durable.sleep(`${path}:wait`, durationMs, { signal })
      else await abortableDelay(durationMs, signal)
      return input
    }
  })
}

function assertUniqueSteps(steps: AnyStep[]): void {
  if (!steps.length) throw new Error('A parallel operation needs at least one step.')
  const ids = new Set<string>()
  for (const step of steps) {
    if (ids.has(step.id)) throw new Error(`Duplicate parallel step ID "${step.id}".`)
    ids.add(step.id)
  }
}

function parse<Output>(
  schema: z.ZodTypeAny | undefined,
  value: unknown,
  label: string
): Output {
  if (!schema) return value as Output
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new WorkflowValidationError(
      `${label} is invalid: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`
    )
  }
  return parsed.data as Output
}

function serialize(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {})
    }
  }
  return { name: 'Error', message: String(error) }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function isTerminal(status: WorkflowRunStatus): boolean {
  return status === 'success' || status === 'failed' || status === 'suspended' || status === 'canceled'
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
