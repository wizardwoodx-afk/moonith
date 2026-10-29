import { describe, expect, it } from 'vitest'
import type { PublicSettings, Task } from '@shared/types'
import { buildSystemPrompt } from './prompt'

const settings = {
  agentName: 'Vesta',
  defaultProviderId: 'p1',
  defaultModel: 'model-a',
  customInstructions: ''
} as unknown as PublicSettings

const task = {
  id: 't1',
  title: 'A task',
  objective: 'Do the thing',
  mode: 'chat',
  permissionMode: 'auto',
  folders: [],
  messages: []
} as unknown as Task

function prompt(): string {
  return buildSystemPrompt({ task, workspace: 'C:\\work', settings })
}

describe('system prompt voice', () => {
  it('asks for plain words and forbids emoji in replies', () => {
    const text = prompt()
    expect(text).toContain('no emoji')
    expect(text).not.toContain('Emoji usage')
    expect(text).not.toContain('Actively and naturally include emojis')
  })

  it('still reads the intent behind a reaction the user sends', () => {
    expect(prompt()).toContain('reaction feedback')
  })
})
