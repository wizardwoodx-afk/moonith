import { describe, expect, it } from 'vitest'
import { MESSAGE_REACTIONS, type Task } from '@shared/types'
import { toggleMessageReaction } from './reactions'

function fixture(): Task {
  return {
    messages: [
      { id: 'message-1', role: 'assistant', content: 'A real answer' },
      { id: 'hidden-1', role: 'assistant', content: 'Internal', hidden: true }
    ]
  } as Task
}

describe('local message reactions', () => {
  it('toggles an allow-listed reaction and removes an empty reaction list', () => {
    const task = fixture()
    expect(toggleMessageReaction(task, 'message-1', '👍')).toBe(true)
    expect(task.messages[0].reactions).toEqual(['👍'])
    expect(toggleMessageReaction(task, 'message-1', '👍')).toBe(true)
    expect(task.messages[0].reactions).toBeUndefined()
  })

  it('keeps independent local reactions in allow-list order of selection', () => {
    const task = fixture()
    toggleMessageReaction(task, 'message-1', '✅')
    toggleMessageReaction(task, 'message-1', '💡')
    expect(task.messages[0].reactions).toEqual(['✅', '💡'])
    toggleMessageReaction(task, 'message-1', '✅')
    expect(task.messages[0].reactions).toEqual(['💡'])
  })

  it('drops unsupported stored values on the next genuine toggle', () => {
    const task = fixture()
    task.messages[0].reactions = ['🔥', '👍']
    toggleMessageReaction(task, 'message-1', '🎉')
    expect(task.messages[0].reactions).toEqual(['👍', '🎉'])
  })

  it('rejects unknown emoji and missing or hidden messages', () => {
    const task = fixture()
    expect(() => toggleMessageReaction(task, 'message-1', '🔥')).toThrow('Unsupported reaction')
    expect(() => toggleMessageReaction(task, 'missing', '👍')).toThrow('Message not found')
    expect(() => toggleMessageReaction(task, 'hidden-1', '👍')).toThrow('Message not found')
  })

  it('shares the exact renderer allow-list', () => {
    expect(MESSAGE_REACTIONS).toEqual(['👍', '❤️', '🎉', '👀', '✅', '💡'])
  })
})
