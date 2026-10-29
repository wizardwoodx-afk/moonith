export interface LibraryCollection {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface LibraryPage {
  id: string
  collectionId: string
  parentId: string | null
  title: string
  content: string
  revision: number
  createdAt: string
  updatedAt: string
  sourceTaskId?: string
}

export interface LibrarySnapshot {
  collections: LibraryCollection[]
  pages: LibraryPage[]
}

export interface LibraryPageInput {
  collectionId?: string
  parentId?: string | null
  title: string
  content?: string
}

export interface LibraryPagePatch {
  title?: string
  content?: string
  parentId?: string | null
  expectedRevision: number
}

export interface LibraryDraft {
  collectionId?: string
  pageId?: string
  parentId?: string | null
  title: string
  content: string
  expectedRevision?: number
}

export interface LibraryReviewResult {
  page: LibraryPage | null
  replayed: boolean
}
