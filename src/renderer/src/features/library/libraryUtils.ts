import type { LibraryPage } from '@shared/library'

export interface LibraryListRow {
  page: LibraryPage
  depth: number
}

/** Stable tree flattening with a cycle guard for defensive rendering of old data. */
export function flattenLibraryPages(pages: LibraryPage[]): LibraryListRow[] {
  const byParent = new Map<string | null, LibraryPage[]>()
  const ids = new Set(pages.map((page) => page.id))
  for (const page of pages) {
    const parent = page.parentId && ids.has(page.parentId) ? page.parentId : null
    const siblings = byParent.get(parent) ?? []
    siblings.push(page)
    byParent.set(parent, siblings)
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.title.localeCompare(b.title) || a.createdAt.localeCompare(b.createdAt))
  }
  const rows: LibraryListRow[] = []
  const visited = new Set<string>()
  const walk = (parent: string | null, depth: number): void => {
    for (const page of byParent.get(parent) ?? []) {
      if (visited.has(page.id)) continue
      visited.add(page.id)
      rows.push({ page, depth })
      walk(page.id, depth + 1)
    }
  }
  walk(null, 0)
  // Malformed legacy cycles remain visible rather than disappearing from the UI.
  for (const page of pages) {
    if (!visited.has(page.id)) rows.push({ page, depth: 0 })
  }
  return rows
}

export function libraryPageCount(pages: LibraryPage[], collectionId: string): number {
  return pages.reduce((count, page) => count + (page.collectionId === collectionId ? 1 : 0), 0)
}
