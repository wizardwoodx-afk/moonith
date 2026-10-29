import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: class BrowserWindowStub {
    webContents = { printToPDF: async (): Promise<Buffer> => Buffer.alloc(0) }
    loadFile = async (): Promise<void> => undefined
    destroy = (): void => undefined
  }
}))

import { getBuiltinTools } from './index'
import { libraryTools } from './library'

describe('chat tool set', () => {
  it('can read, create, and convert documents without arbitrary file writes or shell', () => {
    const names = getBuiltinTools('chat').map((tool) => tool.name)

    expect(names).toContain('read_document')
    expect(names).toContain('create_document')
    expect(names).toContain('create_pdf')
    expect(names).toContain('convert_document')
    expect(names).not.toContain('write_file')
    expect(names).not.toContain('run_command')
  })
})

describe('chat Library gate', () => {
  const libraryToolNames = new Set(libraryTools.map((tool) => tool.name))

  it('lets Chat route a Library draft through review', () => {
    const names = getBuiltinTools('chat').map((tool) => tool.name)

    expect(names).toContain('list_library_pages')
    expect(names).toContain('read_library_page')
    expect(names).toContain('review_library_page')
  })

  it('gives Chat no Library write that bypasses the review approval', () => {
    const chatTools = getBuiltinTools('chat')
    const libraryWrites = chatTools
      .filter((tool) => libraryToolNames.has(tool.name) && tool.sideEffect === 'write')
      .map((tool) => tool.name)

    // Only the review tool may result in a saved page; nothing else in Chat
    // can write a Library page.
    expect(libraryWrites).toEqual(['review_library_page'])

    const review = chatTools.find((tool) => tool.name === 'review_library_page')
    expect(review?.approval).toBe('always')
    expect(review?.allowAlways).toBe(false)
    expect(review?.risk).toBe('medium')
    expect(review?.approvalReview).toBeTypeOf('function')
  })

  it('keeps the full Library tool set available in cowork mode', () => {
    const names = getBuiltinTools('cowork').map((tool) => tool.name)

    for (const tool of libraryTools) {
      expect(names).toContain(tool.name)
    }
  })

  it('equips Self mode with cyclical loops, time-travel, and stealth browser tools', () => {
    const names = getBuiltinTools('chat').map((tool) => tool.name)

    expect(names).toContain('rsirals_time_travel_rewind')
    expect(names).toContain('rsirals_run_workflow')
    expect(names).toContain('rsirals_dual_ledger_status')
    expect(names).toContain('browser_task_controller_act')
    expect(names).toContain('browser_visual_act')
    expect(names).toContain('browser_stealth_search')
  })

  it('equips Cowork mode with full collaborative workspace, dual ledger, and stealth browser tools', () => {
    const names = getBuiltinTools('cowork').map((tool) => tool.name)

    expect(names).toContain('write_file')
    expect(names).toContain('run_command')
    expect(names).toContain('rsirals_dual_ledger_status')
    expect(names).toContain('browser_task_controller_act')
    expect(names).toContain('browser_stealth_search')
  })
})
