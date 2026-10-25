import { createHash } from 'node:crypto'

export function coworkerSegment(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}

export function requireTaskId(value: string): void {
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(value)) throw new Error('Invalid task identifier.')
}

export function requireActorId(value: string): void {
  if (!value || value.length > 240 || /[\u0000-\u001f\\/]/.test(value)) {
    throw new Error('Invalid coworker identifier.')
  }
}

/** Stable opaque browser key. Captain keeps the task id for compatibility. */
export function browserScope(taskId: string, actorId?: string): string {
  requireTaskId(taskId)
  if (!actorId) return taskId
  requireActorId(actorId)
  return `${taskId}:crew:${actorId}`
}

export function taskIdForBrowserScope(scope: string): string | null {
  if (typeof scope !== 'string') return null
  const separator = scope.indexOf(':crew:')
  const taskId = separator < 0 ? scope : scope.slice(0, separator)
  try {
    requireTaskId(taskId)
    if (separator >= 0) requireActorId(scope.slice(separator + 6))
  } catch {
    return null
  }
  return taskId
}
