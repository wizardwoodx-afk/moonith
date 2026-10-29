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
  it('allows an emoji when the moment calls for one, never as decoration', () => {
    const text = prompt()
    expect(text).toContain('the way a colleague would')
    expect(text).toContain('At most one in a reply')
    expect(text).toContain('never on bad news')
    expect(text).not.toContain('Actively and naturally include emojis')
  })

  it('still reads the intent behind a reaction the user sends', () => {
    expect(prompt()).toContain('reaction feedback')
  })
})
