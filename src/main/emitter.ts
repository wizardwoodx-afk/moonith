import { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import type { ApprovalRequest, TaskEvent } from '@shared/types'

const localListeners = new Set<(event: TaskEvent) => void>()

export function subscribeTaskEvents(listener: (event: TaskEvent) => void): () => void {
  localListeners.add(listener)
  return () => localListeners.delete(listener)
}

export function sendTaskEvent(event: TaskEvent): void {
  for (const listener of localListeners) {
    try {
      listener(event)
    } catch {
      // A failing local listener must not break broadcasting.
    }
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.eventTask, event)
  }
}

export function sendLibraryChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.eventLibrary)
  }
}

export function sendApprovalRequest(request: ApprovalRequest): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.eventApproval, request)
  }
}

export function toast(level: 'info' | 'success' | 'error', message: string): void {
  sendTaskEvent({ type: 'toast', level, message })
}
