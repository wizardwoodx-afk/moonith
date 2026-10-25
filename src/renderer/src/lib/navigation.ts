import { useApp } from '../store'

function beginTask(prefill: string): void {
  useApp.getState().openSurface('chat')
  window.setTimeout(
    () => window.dispatchEvent(new CustomEvent('knight:new-task', { detail: { draft: prefill } })),
    0
  )
}

export function startNewTask(): void {
  beginTask('')
}

export function startNewTaskWithDraft(prefill: string): void {
  beginTask(prefill)
}
