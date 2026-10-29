import type { MessageVote, Task } from '@shared/types'

/**
 * A vote is one state per message, never a tally: it records what this device's
 * owner thought of this turn and nothing more. Clearing removes the record.
 */
export function setMessageFeedback(
  task: Task,
  messageId: string,
  vote: MessageVote | null,
  note?: string
): void {
  const message = task.messages.find((item) => item.id === messageId && !item.hidden)
  if (!message) throw new Error('Message not found.')
  if (!vote) {
    delete message.feedback
    return
  }
  const trimmed = note?.trim()
  message.feedback = {
    vote,
    ...(vote === 'down' && trimmed ? { note: trimmed.slice(0, 500) } : {}),
    at: new Date().toISOString()
  }
}
