import { describe, expect, it } from 'vitest'
import { memoryTerms, parseMemoryLines, scoreMemory } from './memory'

describe('memory recall', () => {
  it('keeps meaningful terms, lowercased and de-duplicated', () => {
    expect(memoryTerms('Weekly REPORT, weekly report; PDF')).toEqual(['weekly', 'report', 'pdf'])
  })

  it('scores text and tags, with exact tag hits weighted higher', () => {
    const note = { text: 'The Friday report goes to finance.', tags: ['weekly', 'reporting'] }
    const terms = memoryTerms('report weekly')
    expect(scoreMemory(note, terms)).toBeGreaterThan(scoreMemory({ text: 'Unrelated note.', tags: [] }, terms))
    expect(scoreMemory(note, memoryTerms('weekly'))).toBe(3)
  })

  it('parses bullet lists and skips fragments', () => {
    expect(parseMemoryLines('Preferences:\n- Use British spelling\n* Prefer PDF\nab\n')).toEqual([
      'Preferences:',
      'Use British spelling',
      'Prefer PDF'
    ])
  })
})
