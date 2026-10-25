export class DurableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DurableError'
  }
}

/** A failure that must not be retried by the durable retry policy. */
export class TerminalError extends DurableError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TerminalError'
  }
}

/** An explicit request for another attempt when the policy permits one. */
export class RetryableError extends DurableError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RetryableError'
  }
}

export class CancelledError extends DurableError {
  constructor(message = 'The durable operation was cancelled.', options?: ErrorOptions) {
    super(message, options)
    this.name = 'CancelledError'
  }
}

export class DurableJournalCorruptError extends DurableError {
  constructor(runId: string, options?: ErrorOptions) {
    super(`The durable journal for "${runId}" is damaged. It was not replaced with an empty journal.`, options)
    this.name = 'DurableJournalCorruptError'
  }
}

export function serializeError(error: unknown): {
  name: string
  message: string
  stack?: string
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {})
    }
  }
  return { name: 'Error', message: String(error) }
}

export function deserializeError(value: { name: string; message: string; stack?: string }): Error {
  const error = new Error(value.message)
  error.name = value.name
  if (value.stack) error.stack = value.stack
  return error
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
