import { sendApprovalRequest } from './emitter'
import { newId, nowIso } from './util'
import type { ApprovalRequest, ApprovalReview } from '@shared/types'

interface Pending {
  request: ApprovalRequest
  resolve: (approved: boolean) => void
  timer: NodeJS.Timeout
}

type PendingChangedListener = () => void

class ApprovalBroker {
  private pending = new Map<string, Pending>()
  private always = new Map<string, Set<string>>()
  /* Every path that adds or removes a pending request announces itself here, so
   * the main process can raise and drop its out-of-window signal from one place
   * instead of having to remember each of them. */
  private pendingChangedListeners = new Set<PendingChangedListener>()

  onPendingChanged(listener: PendingChangedListener): () => void {
    this.pendingChangedListeners.add(listener)
    return () => {
      this.pendingChangedListeners.delete(listener)
    }
  }

  private notifyPendingChanged(): void {
    for (const listener of this.pendingChangedListeners) {
      try {
        listener()
      } catch {
        /* The signal lives outside the approval flow; a failure in it must never
         * decide the outcome of the request itself. */
      }
    }
  }

  request(
    taskId: string,
    input: {
      tool: string
      title: string
      summary: string
      details?: string
      risk: 'low' | 'medium' | 'high'
      allowAlways?: boolean
      review?: ApprovalReview
    }
  ): Promise<boolean> {
    const request: ApprovalRequest = {
      id: newId('approval'),
      taskId,
      tool: input.tool,
      title: input.title,
      summary: input.summary,
      details: input.details,
      risk: input.risk,
      allowAlways: input.allowAlways ?? true,
      review: input.review,
      createdAt: nowIso()
    }

    sendApprovalRequest(request)

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id)
        this.notifyPendingChanged()
        resolve(false)
      }, 10 * 60 * 1000)
      this.pending.set(request.id, { request, resolve, timer })
      this.notifyPendingChanged()
    })
  }

  respond(id: string, approved: boolean, always = false): void {
    const item = this.pending.get(id)
    if (!item) return
    clearTimeout(item.timer)
    this.pending.delete(id)
    this.notifyPendingChanged()
    if (approved && always && item.request.allowAlways) {
      const set = this.always.get(item.request.taskId) ?? new Set<string>()
      set.add(item.request.tool)
      this.always.set(item.request.taskId, set)
    }
    item.resolve(approved)
  }

  isAlwaysAllowed(taskId: string, tool: string): boolean {
    return this.always.get(taskId)?.has(tool) ?? false
  }

  listPending(): ApprovalRequest[] {
    return Array.from(this.pending.values()).map((item) => item.request)
  }

  cancelTask(taskId: string): void {
    let changed = false
    for (const [id, item] of this.pending) {
      if (item.request.taskId === taskId) {
        clearTimeout(item.timer)
        this.pending.delete(id)
        item.resolve(false)
        changed = true
      }
    }
    if (changed) this.notifyPendingChanged()
  }

  cancelAll(): void {
    if (this.pending.size === 0) return
    for (const [, item] of this.pending) {
      clearTimeout(item.timer)
      item.resolve(false)
    }
    this.pending.clear()
    this.notifyPendingChanged()
  }
}

export const approvals = new ApprovalBroker()
