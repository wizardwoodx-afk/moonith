import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { z } from 'zod'
import type {
  LibraryCollection,
  LibraryDraft,
  LibraryPage,
  LibraryPageInput,
  LibraryPagePatch,
  LibraryReviewResult,
  LibrarySnapshot
} from '@shared/library'
import { atomicWriteJson, nowIso } from '../../util'

const DEFAULT_COLLECTION_ID = 'collection-inbox'
const MAX_COLLECTIONS = 100
const MAX_PAGES = 2000
const MAX_REVIEWS = 1000

const pageSchema = z.object({
  id: z.string().min(1),
  collectionId: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  title: z.string().min(1).max(160),
  content: z.string().max(100000),
  revision: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  sourceTaskId: z.string().optional()
})

const collectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  createdAt: z.string(),
  updatedAt: z.string()
})

const draftSchema = z
  .object({
    collectionId: z.string().min(1).optional(),
    pageId: z.string().min(1).optional(),
    parentId: z.string().min(1).nullable().optional(),
    title: z.string().trim().min(1).max(160),
    content: z.string().min(1).max(20000),
    expectedRevision: z.number().int().positive().optional()
  })
  .strict()
  .superRefine((draft, context) => {
    if (draft.pageId && draft.expectedRevision == null) {
      context.addIssue({
        code: 'custom',
        path: ['expectedRevision'],
        message: 'Editing a page requires its current expectedRevision.'
      })
    }
  })

const reviewSchema = z.object({
  taskId: z.string().min(1),
  callId: z.string().min(1),
  pageId: z.string().min(1),
  draft: draftSchema,
  createdAt: z.string()
})

const storedSchema = z.object({
  version: z.literal(1),
  collections: z.array(collectionSchema),
  pages: z.array(pageSchema),
  reviews: z.array(reviewSchema)
})

type StoredLibrary = z.infer<typeof storedSchema>

const pageInputSchema = z
  .object({
    collectionId: z.string().min(1).optional(),
    parentId: z.string().min(1).nullable().optional(),
    title: z.string().trim().min(1).max(160),
    content: z.string().max(100000).optional()
  })
  .strict()

const pagePatchSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    content: z.string().max(100000).optional(),
    parentId: z.string().min(1).nullable().optional(),
    expectedRevision: z.number().int().positive()
  })
  .strict()

export class LibraryError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid' | 'not-found' | 'conflict' | 'storage' = 'invalid'
  ) {
    super(message)
    this.name = 'LibraryError'
  }
}

export interface LibraryServiceOptions {
  file: string
  now?: () => string
  onChange?: () => void
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function invalid(message: string): never {
  throw new LibraryError(message, 'invalid')
}

/**
 * Product-native local Library. Adapted from OpenDots' optimistic page and
 * review-receipt semantics (MIT; see LICENSE.opendots.txt and PROVENANCE.json),
 * with SQLite/Intelligence/server access removed and SelfImpulse's atomic local
 * persistence and approval architecture retained.
 */
export class LibraryService {
  private readonly file: string
  private readonly now: () => string
  private readonly onChange?: () => void
  private state: StoredLibrary | null = null
  private loading: Promise<StoredLibrary> | null = null
  private writeChain: Promise<void> = Promise.resolve()

  constructor(options: LibraryServiceOptions) {
    this.file = options.file
    this.now = options.now ?? nowIso
    this.onChange = options.onChange
  }

  private emptyState(): StoredLibrary {
    const timestamp = this.now()
    return {
      version: 1,
      collections: [
        {
          id: DEFAULT_COLLECTION_ID,
          name: 'Inbox',
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ],
      pages: [],
      reviews: []
    }
  }

  private async ready(): Promise<StoredLibrary> {
    if (this.state) return this.state
    if (this.loading) return this.loading
    this.loading = (async () => {
      let raw: string
      try {
        raw = await fs.readFile(this.file, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.emptyState()
        throw new LibraryError('The local Library could not be read.', 'storage')
      }
      let json: unknown
      try {
        json = JSON.parse(raw)
      } catch {
        throw new LibraryError(
          'The local Library is damaged. SelfImpulse will not replace it with an empty library.',
          'storage'
        )
      }
      const parsed = storedSchema.safeParse(json)
      if (!parsed.success) {
        throw new LibraryError('The local Library has an invalid or unsupported format.', 'storage')
      }
      return parsed.data
    })()
    try {
      this.state = await this.loading
      return this.state
    } finally {
      this.loading = null
    }
  }

  private async mutate<T>(operation: (state: StoredLibrary) => T | Promise<T>): Promise<T> {
    const run = this.writeChain.catch(() => undefined).then(async () => {
      const current = await this.ready()
      const next = clone(current)
      const result = await operation(next)
      await atomicWriteJson(this.file, next)
      this.state = next
      try {
        this.onChange?.()
      } catch {
        // Notifications are convenience only; the atomic save already succeeded.
      }
      return clone(result)
    })
    this.writeChain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private collection(state: StoredLibrary, id?: string): LibraryCollection {
    const collectionId = id ?? state.collections[0]?.id
    const collection = state.collections.find((item) => item.id === collectionId)
    if (!collection) throw new LibraryError('Library collection not found.', 'not-found')
    return collection
  }

  private page(state: StoredLibrary, id: string): LibraryPage {
    const page = state.pages.find((item) => item.id === id)
    if (!page) throw new LibraryError('Library page not found.', 'not-found')
    return page
  }

  private parent(
    state: StoredLibrary,
    collectionId: string,
    parentId: string | null,
    selfId?: string
  ): void {
    if (!parentId) return
    const seen = new Set<string>(selfId ? [selfId] : [])
    let cursor: string | null = parentId
    while (cursor) {
      if (seen.has(cursor)) invalid('A page cannot be moved into itself or a descendant.')
      seen.add(cursor)
      const parent = state.pages.find((item) => item.id === cursor && item.collectionId === collectionId)
      if (!parent) invalid('The parent page must be in the same collection.')
      cursor = parent.parentId
    }
  }

  private createInState(
    state: StoredLibrary,
    input: LibraryPageInput,
    sourceTaskId?: string
  ): LibraryPage {
    const parsed = pageInputSchema.safeParse(input)
    if (!parsed.success) invalid('A page needs a title up to 160 characters and content up to 100,000 characters.')
    if (state.pages.length >= MAX_PAGES) invalid('The local Library page limit has been reached.')
    const collection = this.collection(state, parsed.data.collectionId)
    const parentId = parsed.data.parentId ?? null
    this.parent(state, collection.id, parentId)
    const timestamp = this.now()
    const page: LibraryPage = {
      id: randomUUID(),
      collectionId: collection.id,
      parentId,
      title: parsed.data.title,
      content: parsed.data.content ?? '',
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      sourceTaskId
    }
    state.pages.push(page)
    return page
  }

  private updateInState(state: StoredLibrary, id: string, input: LibraryPagePatch): LibraryPage {
    const parsed = pagePatchSchema.safeParse(input)
    if (!parsed.success) invalid('A valid page patch and expectedRevision are required.')
    const page = this.page(state, id)
    if (page.revision !== parsed.data.expectedRevision) {
      throw new LibraryError(
        'This page changed. Reload the latest revision before saving your draft.',
        'conflict'
      )
    }
    const parentId = parsed.data.parentId === undefined ? page.parentId : parsed.data.parentId
    this.parent(state, page.collectionId, parentId, id)
    const title = parsed.data.title ?? page.title
    const content = parsed.data.content ?? page.content
    if (title === page.title && content === page.content && parentId === page.parentId) return page
    page.title = title
    page.content = content
    page.parentId = parentId
    page.revision += 1
    page.updatedAt = this.now()
    return page
  }

  async snapshot(): Promise<LibrarySnapshot> {
    await this.writeChain
    const state = await this.ready()
    return clone({ collections: state.collections, pages: state.pages })
  }

  async getPage(id: string): Promise<LibraryPage> {
    await this.writeChain
    return clone(this.page(await this.ready(), id))
  }

  async createCollection(name: string): Promise<LibraryCollection> {
    const parsed = z.string().trim().min(1).max(80).safeParse(name)
    if (!parsed.success) invalid('A collection name must be between 1 and 80 characters.')
    return this.mutate((state) => {
      if (state.collections.length >= MAX_COLLECTIONS) invalid('The local Library collection limit has been reached.')
      const timestamp = this.now()
      const collection: LibraryCollection = {
        id: randomUUID(),
        name: parsed.data,
        createdAt: timestamp,
        updatedAt: timestamp
      }
      state.collections.push(collection)
      return collection
    })
  }

  async createPage(input: LibraryPageInput): Promise<LibraryPage> {
    return this.mutate((state) => this.createInState(state, input))
  }

  async updatePage(id: string, patch: LibraryPagePatch): Promise<LibraryPage> {
    return this.mutate((state) => this.updateInState(state, id, patch))
  }

  async deletePage(id: string): Promise<boolean> {
    return this.mutate((state) => {
      const page = state.pages.find((item) => item.id === id)
      if (!page) return false
      const timestamp = this.now()
      for (const child of state.pages) {
        if (child.parentId === id) {
          child.parentId = page.parentId
          child.revision += 1
          child.updatedAt = timestamp
        }
      }
      state.pages = state.pages.filter((item) => item.id !== id)
      // Review receipts intentionally remain: a retried approval must not
      // recreate a page that a human deliberately deleted.
      return true
    })
  }

  /** Save a draft only after the existing runtime approval has been granted. */
  async reviewDraft(taskId: string, callId: string, input: LibraryDraft): Promise<LibraryReviewResult> {
    if (!taskId.trim() || !callId.trim() || taskId.length > 240 || callId.length > 240) {
      invalid('A stable task and tool-call identity are required for a reviewed page.')
    }
    const parsed = draftSchema.safeParse(input)
    if (!parsed.success) {
      invalid('A reviewed page needs a title, 1–20,000 characters of content, and expectedRevision for edits.')
    }
    const draft = parsed.data
    return this.mutate((state) => {
      const previous = state.reviews.find((item) => item.taskId === taskId && item.callId === callId)
      if (previous) {
        if (JSON.stringify(previous.draft) !== JSON.stringify(draft)) {
          throw new LibraryError(
            'This review was already saved with a different draft. Start a new review for the changed draft.',
            'conflict'
          )
        }
        return {
          page: state.pages.find((item) => item.id === previous.pageId) ?? null,
          replayed: true
        }
      }
      if (state.reviews.length >= MAX_REVIEWS) {
        throw new LibraryError('Review history is full; no unreviewed or duplicate page was written.', 'storage')
      }

      let page: LibraryPage
      if (draft.pageId) {
        const existing = this.page(state, draft.pageId)
        if (draft.collectionId && draft.collectionId !== existing.collectionId) {
          invalid('A reviewed edit cannot move a page to another collection.')
        }
        page = this.updateInState(state, draft.pageId, {
          title: draft.title,
          content: draft.content,
          parentId: draft.parentId,
          expectedRevision: draft.expectedRevision as number
        })
      } else {
        page = this.createInState(
          state,
          {
            collectionId: draft.collectionId,
            parentId: draft.parentId,
            title: draft.title,
            content: draft.content
          },
          taskId
        )
      }
      state.reviews.push({ taskId, callId, pageId: page.id, draft: clone(draft), createdAt: this.now() })
      return { page, replayed: false }
    })
  }
}
