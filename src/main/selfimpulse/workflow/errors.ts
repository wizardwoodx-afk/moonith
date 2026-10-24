export class WorkflowValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WorkflowValidationError'
  }
}

export class WorkflowSuspendedError extends Error {
  constructor(
    readonly stepId: string,
    readonly path: string,
    readonly payload?: unknown
  ) {
    super(`Workflow step "${stepId}" suspended.`)
    this.name = 'WorkflowSuspendedError'
  }
}

export class WorkflowStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowStateError'
  }
}
