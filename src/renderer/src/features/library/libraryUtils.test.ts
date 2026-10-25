import { describe, expect, it } from 'vitest'
import type { LibraryPage } from '@shared/library'
import { flattenLibraryPages, libraryPageCount } from './libraryUtils'

function page(id: string, parentId: string | null = null, collectionId = 'one'): LibraryPage {
  return {
    id,
    collectionId,
    parentId,
    title: id,
    content: '',
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

describe('Library tree presentation', () => {
  it('flattens parents before children and counts only the requested collection', () => {
    const rows = flattenLibraryPages([page('child', 'parent'), page('parent'), page('other', null, 'two')])
    expect(rows.map((row) => [row.page.id, row.depth])).toEqual([
      ['other', 0],
      ['parent', 0],
      ['child', 1]
    ])
    expect(libraryPageCount([page('a'), page('b', null, 'two')], 'one')).toBe(1)
  })

  it('keeps malformed legacy cycles visible instead of recursing forever', () => {
    const rows = flattenLibraryPages([page('a', 'b'), page('b', 'a')])
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((row) => row.page.id))).toEqual(new Set(['a', 'b']))
  })
})
