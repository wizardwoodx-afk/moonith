import { MESSAGE_REACTIONS, type Task } from '@shared/types'

const ALLOWED = new Set<string>(MESSAGE_REACTIONS)

/** Toggle one local-profile reaction without inventing multi-user counts. */
export function toggleMessageReaction(task: Task, messageId: string, emoji: string): boolean {
  if (!ALLOWED.has(emoji)) throw new Error('Unsupported reaction.')
  const message = task.messages.find((item) => item.id === messageId && !item.hidden)
  if (!message) throw new Error('Message not found.')
  const current = (message.reactions ?? []).filter((item) => ALLOWED.has(item))
  message.reactions = current.includes(emoji)
    ? current.filter((item) => item !== emoji)
    : [...current, emoji]
  if (!message.reactions.length) delete message.reactions
  return true
}
