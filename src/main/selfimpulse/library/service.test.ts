import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LibraryService } from './service'

const temporary: string[] = []
async function service(): Promise<{ service: LibraryService; file: string }> {
  const root = await mkdtemp(join(tmpdir(), 'selfimpulse-library-'))
  temporary.push(root)
  const file = join(root, 'library.json')
  return { service: new LibraryService({ file }), file }
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('native Library pages', () => {
  it('creates collections/pages and persists revision-checked updates', async () => {
    const { service: library, file } = await service()
    const collection = await library.createCollection(' Research ')
    const page = await library.createPage({
      collectionId: collection.id,
      title: 'Brief',
      content: 'First'
    })
    expect(collection.name).toBe('Research')
    expect(page.revision).toBe(1)
    const updated = await library.updatePage(page.id, { content: 'Second', expectedRevision: 1 })
    expect(updated.revision).toBe(2)

    const reopened = new LibraryService({ file })
    expect((await reopened.getPage(page.id)).content).toBe('Second')
    expect((await reopened.snapshot()).collections).toHaveLength(2)
  })

  it('rejects stale and concurrent writes without last-writer-wins data loss', async () => {
    const { service: library } = await service()
    const page = await library.createPage({ title: 'Concurrent', content: 'Original' })
    const results = await Promise.allSettled([
      library.updatePage(page.id, { content: 'A', expectedRevision: 1 }),
      library.updatePage(page.id, { content: 'B', expectedRevision: 1 })
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const current = await library.getPage(page.id)
    expect(current.revision).toBe(2)
    expect(['A', 'B']).toContain(current.content)
    await expect(library.updatePage(page.id, { content: 'Stale', expectedRevision: 1 })).rejects.toThrow(
      'This page changed'
    )
    expect((await library.getPage(page.id)).content).toBe(current.content)
  })

  it('prevents parent cycles and reparents children on delete', async () => {
    const { service: library } = await service()
    const parent = await library.createPage({ title: 'Parent' })
    const child = await library.createPage({ title: 'Child', parentId: parent.id })
    await expect(
      library.updatePage(parent.id, { parentId: child.id, expectedRevision: 1 })
    ).rejects.toThrow('itself or a descendant')
    expect(await library.deletePage(parent.id)).toBe(true)
    const surviving = await library.getPage(child.id)
    expect(surviving.parentId).toBeNull()
    expect(surviving.revision).toBe(2)
  })

  it('binds a review receipt to the exact draft and never duplicates on replay', async () => {
    const { service: library } = await service()
    const draft = { title: 'Approved brief', content: '# Approved\n\nExactly this draft.' }
    const first = await library.reviewDraft('task-1', 'call-1', draft)
    const replay = await library.reviewDraft('task-1', 'call-1', draft)
    expect(first.replayed).toBe(false)
    expect(replay.replayed).toBe(true)
    expect(replay.page?.id).toBe(first.page?.id)
    expect((await library.snapshot()).pages).toHaveLength(1)
    await expect(
      library.reviewDraft('task-1', 'call-1', { ...draft, content: 'A changed draft' })
    ).rejects.toThrow('different draft')
    expect((await library.snapshot()).pages).toHaveLength(1)
  })

  it('checks revisions for reviewed edits and does not resurrect a deleted page', async () => {
    const { service: library } = await service()
    const created = await library.reviewDraft('task-1', 'call-1', {
      title: 'Reviewed',
      content: 'One'
    })
    const id = created.page!.id
    const edited = await library.reviewDraft('task-1', 'call-2', {
      pageId: id,
      title: 'Reviewed edit',
      content: 'Two',
      expectedRevision: 1
    })
    expect(edited.page?.revision).toBe(2)
    await expect(
      library.reviewDraft('task-1', 'call-3', {
        pageId: id,
        title: 'Stale edit',
        content: 'Three',
        expectedRevision: 1
      })
    ).rejects.toThrow('This page changed')

    await library.deletePage(id)
    const replay = await library.reviewDraft('task-1', 'call-1', {
      title: 'Reviewed',
      content: 'One'
    })
    expect(replay.page).toBeNull()
    expect(replay.replayed).toBe(true)
    expect((await library.snapshot()).pages).toHaveLength(0)
  })

  it('requires a stable revision for agent-initiated edits', async () => {
    const { service: library } = await service()
    const page = await library.createPage({ title: 'Existing', content: 'Text' })
    await expect(
      library.reviewDraft('task-1', 'call-1', {
        pageId: page.id,
        title: 'Existing',
        content: 'Changed'
      })
    ).rejects.toThrow('expectedRevision')
    expect((await library.getPage(page.id)).content).toBe('Text')
  })

  it('fails visible on corrupt storage and never replaces it with an empty library', async () => {
    const { service: library, file } = await service()
    await writeFile(file, '{not-json', 'utf8')
    await expect(library.snapshot()).rejects.toThrow('damaged')
    expect(await readFile(file, 'utf8')).toBe('{not-json')
  })
})
