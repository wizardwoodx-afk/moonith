import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/selfimpulse-marketspace-tool-test' },
  BrowserWindow: { getAllWindows: () => [] },
  session: {}
}))

import { getBuiltinTools } from './index'

const names = (mode: 'chat' | 'cowork') => getBuiltinTools(mode).map((tool) => tool.name)

describe('native Marketspace tool registration', () => {
  it('exposes read/search in chat and all lifecycle tools in cowork mode', () => {
    expect(names('chat')).toEqual(expect.arrayContaining(['marketspace_search', 'marketspace_read']))
    expect(names('chat')).not.toEqual(expect.arrayContaining(['marketspace_install', 'marketspace_apply']))
    expect(names('cowork')).toEqual(expect.arrayContaining([
      'marketspace_search',
      'marketspace_read',
      'marketspace_install',
      'marketspace_apply'
    ]))
  })

  it('keeps writes on the existing always-approval path', () => {
    const tools = getBuiltinTools('cowork').filter((tool) => tool.name.startsWith('marketspace_'))
    expect(tools).toHaveLength(4)
    for (const tool of tools.filter((entry) => entry.name.endsWith('_install') || entry.name.endsWith('_apply'))) {
      expect(tool.sideEffect).toBe('write')
      expect(tool.approval).toBe('always')
      expect(tool.allowAlways).toBe(false)
    }
    expect(new Set(getBuiltinTools('cowork').map((tool) => tool.name)).size).toBe(getBuiltinTools('cowork').length)
  })
})
