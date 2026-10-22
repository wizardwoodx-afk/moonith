const RETRIABLE_STATUS = new Set([402, 408, 409, 425, 429, 500, 502, 503, 504])

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const value = (error as { status?: unknown; statusCode?: unknown }).status
  if (typeof value === 'number') return value
  const code = (error as { statusCode?: unknown }).statusCode
  return typeof code === 'number' ? code : undefined
}

/**
 * A fallback is only safe before the model has produced any text. Once text has
 * streamed, retrying on another provider would duplicate what the user saw.
 */
export function isFailoverWorthy(error: unknown, producedOutput: boolean): boolean {
  if (producedOutput) return false
  if (!error) return false
  const status = statusOf(error)
  if (status !== undefined) return RETRIABLE_STATUS.has(status)
  const message = error instanceof Error ? error.message : String(error)
  return /quota|credits|rate.?limit|temporar|overloaded|timed? ?out|timeout|ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed/i.test(
    message
  )
}
