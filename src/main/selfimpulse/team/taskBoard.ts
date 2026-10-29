/**
 * Collaborative Task Board & Reasoning Handoff Protocol for SelfImpulse.
 *
 * Implements team-grade task coordination:
 * - Shared task board with columns: 'backlog' | 'in_progress' | 'review' | 'done'
 * - Private agent inboxes for targeted task assignments
 * - Explicit Handoff Protocol carrying the "Reasoning Trail":
 *   Ensures context is never lost when non-technical/technical handoffs occur by bundling
 *   hypotheses tested, trade-offs evaluated, and proof of work references.
 */
import { newId, nowIso } from '../../util'

export type BoardTaskStatus = 'backlog' | 'in_progress' | 'review' | 'done'

export interface TaskHandoffRecord {
  id: string
  fromAgentId: string
  toAgentId: string
  reasoningSummary: string
  hypothesesTested: string[]
  tradeoffsEvaluated: string[]
  proofOfWorkCertificateId?: string
  timestamp: string
}

export interface BoardTask {
  id: string
  title: string
  description: string
  status: BoardTaskStatus
  assigneeAgentId?: string
  creatorId: string
  handoffHistory: TaskHandoffRecord[]
  createdAt: string
  updatedAt: string
}

export class CollaborativeTaskBoardService {
  private tasks: Map<string, BoardTask> = new Map()

  createTask(input: {
    title: string
    description: string
    creatorId: string
    assigneeAgentId?: string
  }): BoardTask {
    const id = newId('board_task')
    const task: BoardTask = {
      id,
      title: input.title.trim(),
      description: input.description.trim(),
      status: 'backlog',
      assigneeAgentId: input.assigneeAgentId,
      creatorId: input.creatorId,
      handoffHistory: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    }
    this.tasks.set(id, task)
    return task
  }

  /**
   * Transfer task with an explicit reasoning handoff.
   */
  handoffTask(input: {
    taskId: string
    fromAgentId: string
    toAgentId: string
    reasoningSummary: string
    hypothesesTested: string[]
    tradeoffsEvaluated: string[]
    proofOfWorkCertificateId?: string
    newStatus?: BoardTaskStatus
  }): BoardTask {
    const task = this.tasks.get(input.taskId)
    if (!task) {
      throw new Error(`Task not found on board: ${input.taskId}`)
    }

    const handoff: TaskHandoffRecord = {
      id: newId('handoff'),
      fromAgentId: input.fromAgentId,
      toAgentId: input.toAgentId,
      reasoningSummary: input.reasoningSummary.trim(),
      hypothesesTested: input.hypothesesTested,
      tradeoffsEvaluated: input.tradeoffsEvaluated,
      proofOfWorkCertificateId: input.proofOfWorkCertificateId,
      timestamp: nowIso()
    }

    task.assigneeAgentId = input.toAgentId
    task.handoffHistory.push(handoff)
    if (input.newStatus) task.status = input.newStatus
    task.updatedAt = nowIso()

    return task
  }

  listTasks(status?: BoardTaskStatus): BoardTask[] {
    const list = Array.from(this.tasks.values())
    if (!status) return list
    return list.filter((t) => t.status === status)
  }

  getAgentInbox(agentId: string): BoardTask[] {
    return Array.from(this.tasks.values()).filter(
      (t) => t.assigneeAgentId === agentId && t.status !== 'done'
    )
  }
}

export const collaborativeTaskBoard = new CollaborativeTaskBoardService()
