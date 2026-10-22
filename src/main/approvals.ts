import { sendApprovalRequest } from './emitter'
import { newId, nowIso } from './util'
import type { ApprovalRequest } from '@shared/types'

interface Pending {
  request: ApprovalRequest
  resolve: (approved: boolean) => void
  timer: NodeJS.Timeout
}

class ApprovalBroker {
  private pending = new Map<string, Pending>()
  private always = new Map<string, Set<string>>()

  request(
    taskId: string,
    input: {
      tool: string
      title: string
      summary: string
      details?: string
      risk: 'low' | 'medium' | 'high'
      allowAlways?: boolean
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
      createdAt: nowIso()
    }

    sendApprovalRequest(request)

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id)
        resolve(false)
      }, 10 * 60 * 1000)
      this.pending.set(request.id, { request, resolve, timer })
    })
  }

  respond(id: string, approved: boolean, always = false): void {
    const item = this.pending.get(id)
    if (!item) return
    clearTimeout(item.timer)
    this.pending.delete(id)
    if (approved && always) {
      const set = this.always.get(item.request.taskId) ?? new Set<string>()
      set.add(item.request.tool)
      this.always.set(item.request.taskId, set)
    }
    item.resolve(approved)
  }

  isAlwaysAllowed(taskId: string, tool: string): boolean {
    return this.always.get(taskId)?.has(tool) ?? false
  }

  cancelTask(taskId: string): void {
    for (const [id, item] of this.pending) {
      if (item.request.taskId === taskId) {
        clearTimeout(item.timer)
        this.pending.delete(id)
        item.resolve(false)
      }
    }
  }

  cancelAll(): void {
    for (const [, item] of this.pending) {
      clearTimeout(item.timer)
      item.resolve(false)
    }
    this.pending.clear()
  }
}

export const approvals = new ApprovalBroker()
