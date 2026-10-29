/**
 * Toffoli Fault Classifier.
 *
 * Named in homage to Tommaso Toffoli (reversible computing).
 * Inspects execution faults, error codes, and tool metadata to categorize
 * the failure into actionable fault categories.
 */

export type FaultCategory =
  | 'transient_network'
  | 'resource_conflict'
  | 'parameter_validation'
  | 'side_effect_failure'
  | 'permission_denial'
  | 'fatal_error'

export interface ClassifiedFault {
  category: FaultCategory
  message: string
  retryable: boolean
  requiresRollback: boolean
  details?: Record<string, unknown>
}

export class ToffoliClassifier {
  classify(error: unknown, context?: { tool?: string; isSideEffect?: boolean }): ClassifiedFault {
    const message = error instanceof Error ? error.message : String(error)
    const errObj = error as { code?: string | number; status?: number }

    // 1. Transient Network / Rate Limit
    if (
      /timeout|ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|429|502|503|504/i.test(message) ||
      errObj.code === 'ETIMEDOUT' ||
      errObj.code === 'ECONNRESET' ||
      errObj.status === 429
    ) {
      return {
        category: 'transient_network',
        message: `Transient network or rate-limit failure: ${message}`,
        retryable: true,
        requiresRollback: false
      }
    }

    // 2. Resource Conflict / Stale Version
    if (/conflict|version\s+conflict|locked|EBUSY|EEXIST/i.test(message)) {
      return {
        category: 'resource_conflict',
        message: `Resource version or concurrency conflict: ${message}`,
        retryable: true,
        requiresRollback: true
      }
    }

    // 3. Permission or Governance Denial
    if (/blocked by|permission|denied|kill\s+switch|unauthorized|forbidden/i.test(message)) {
      return {
        category: 'permission_denial',
        message: `Governance or policy restriction: ${message}`,
        retryable: false,
        requiresRollback: false
      }
    }

    // 4. Parameter / Schema Validation Error
    if (/validation|invalid\s+argument|expected\s+type|zod/i.test(message)) {
      return {
        category: 'parameter_validation',
        message: `Tool argument or schema validation failure: ${message}`,
        retryable: false,
        requiresRollback: false
      }
    }

    // 5. Side Effect Failure (Partially executed mutating action)
    if (context?.isSideEffect || /failed to write|write error|process exit/i.test(message)) {
      return {
        category: 'side_effect_failure',
        message: `Mutating side effect failure: ${message}`,
        retryable: false,
        requiresRollback: true
      }
    }

    return {
      category: 'fatal_error',
      message: `Fatal or unclassified execution error: ${message}`,
      retryable: false,
      requiresRollback: false
    }
  }
}

export const toffoliClassifier = new ToffoliClassifier()
