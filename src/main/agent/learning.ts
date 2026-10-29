import type { Task } from '@shared/types'
import { memoryService } from '../services/memory'
import { proposeKnowledgeSkill } from '../selfimpulse/mission/knowledgeSkills'

/**
 * The learning loop: a finished task is read back, one durable fact is kept
 * about what worked, and the procedure is offered to the owner as a skill
 * proposal. Nothing here ever becomes a skill by itself — the proposal waits
 * for the same human decision every other skill needs.
 */

/** A one-off answer is not a lesson. Below this the task is not recorded. */
const MIN_STEPS = 3
/** One fact per task, kept short enough to be worth injecting every turn. */
const MAX_NOTE = 400

export interface LearningOutcome {
  recorded: boolean
  memory: 'written' | 'duplicate' | 'skipped'
  proposal: 'proposed' | 'skipped'
  reason?: string
}

function procedureDocument(task: Task): string {
  const steps = task.steps.filter((step) => step.messageId && task.messages.some((m) => m.id === step.messageId))
  const used = (steps.length ? steps : task.steps).map((step, index) => {
    const detail = step.detail ? ` — ${step.detail}` : ''
    return `${index + 1}. ${step.title}${detail}`
  })
  const delivered = task.artifacts.map((artifact) => artifact.name)
  const answer = [...task.messages].reverse().find((message) => message.role === 'assistant' && message.content.trim())
  const lines = [
    `Task: ${task.title || task.objective}`,
    `Objective: ${task.objective}`,
    used.length ? `Steps that worked:\n${used.join('\n')}` : '',
    delivered.length ? `Delivered: ${delivered.join(', ')}` : '',
    answer ? `Result: ${answer.content.trim().slice(0, 600)}` : ''
  ]
  return lines.filter(Boolean).join('\n\n')
}

function factNote(task: Task): string {
  const tools = [...new Set(task.steps.map((step) => step.title))].slice(0, 4).join(', ')
  const delivered = task.artifacts.length ? ` Produced ${task.artifacts.length} file(s).` : ''
  const note = `What worked for "${task.title || task.objective}": ${tools || 'answered directly'}.${delivered}`
  return note.length > MAX_NOTE ? `${note.slice(0, MAX_NOTE - 1)}…` : note
}

/**
 * Called once when a task finishes clean. A failed or denied task teaches
 * nothing reliable, so it is skipped rather than remembered wrongly.
 */
export async function learnFromTask(task: Task): Promise<LearningOutcome> {
  if (task.status !== 'done') return { recorded: false, memory: 'skipped', proposal: 'skipped', reason: 'task did not finish' }
  if (task.steps.length < MIN_STEPS) return { recorded: false, memory: 'skipped', proposal: 'skipped', reason: 'too few steps to be a lesson' }

  const note = factNote(task)
  const existing = await memoryService.list().catch(() => [])
  const duplicate = existing.some((item) => item.text === note)
  let memory: LearningOutcome['memory'] = 'duplicate'
  if (!duplicate) {
    await memoryService.add({ text: note, scope: 'global', tags: ['learned'] }, 'captain').catch(() => null)
    memory = 'written'
  }

  const document = procedureDocument(task)
  const proposed = await proposeKnowledgeSkill({ content: document, sourceName: task.title || task.objective })
  const proposal: LearningOutcome['proposal'] = proposed.ok ? 'proposed' : 'skipped'

  return {
    recorded: memory === 'written' || proposal === 'proposed',
    memory,
    proposal,
    ...(proposed.ok ? {} : { reason: proposed.error })
  }
}
