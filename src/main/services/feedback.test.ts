import { describe, expect, it } from 'vitest'
import type { ChatMessage, Task } from '@shared/types'
import { setMessageFeedback } from './feedback'

function taskWith(messages: ChatMessage[]): Task {
  return { messages } as unknown as Task
}

const assistant = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'message-1',
  role: 'assistant',
  content: 'Done.',
  createdAt: '2026-10-28T00:00:00.000Z',
  ...overrides
})

describe('message feedback', () => {
  it('records a vote with no note for an upvote', () => {
    const task = taskWith([assistant()])
    setMessageFeedback(task, 'message-1', 'up')
    expect(task.messages[0].feedback?.vote).toBe('up')
    expect(task.messages[0].feedback?.note).toBeUndefined()
  })

  it('keeps one reason with a downvote and replaces the earlier vote', () => {
    const task = taskWith([assistant()])
    setMessageFeedback(task, 'message-1', 'up')
    setMessageFeedback(task, 'message-1', 'down', '  it missed the point  ')
    expect(task.messages[0].feedback?.vote).toBe('down')
    expect(task.messages[0].feedback?.note).toBe('it missed the point')
  })

  it('drops a blank note and clears the record when the vote is removed', () => {
    const task = taskWith([assistant()])
    setMessageFeedback(task, 'message-1', 'down', '   ')
    expect(task.messages[0].feedback?.note).toBeUndefined()
    setMessageFeedback(task, 'message-1', null)
    expect(task.messages[0].feedback).toBeUndefined()
  })

  it('ignores a note on an upvote and refuses a hidden or missing message', () => {
    const task = taskWith([assistant(), assistant({ id: 'hidden-1', hidden: true })])
    setMessageFeedback(task, 'message-1', 'up', 'not stored here')
    expect(task.messages[0].feedback?.note).toBeUndefined()
    expect(() => setMessageFeedback(task, 'hidden-1', 'up')).toThrow('Message not found.')
    expect(() => setMessageFeedback(task, 'missing', 'up')).toThrow('Message not found.')
  })
})
