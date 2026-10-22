import { useApp } from '../store'

export function startNewTask(): void {
  useApp.getState().openSurface('chat')
  window.setTimeout(() => window.dispatchEvent(new Event('knight:new-task')), 0)
}
