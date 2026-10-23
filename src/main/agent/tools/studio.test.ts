import { describe, expect, it } from 'vitest'
import { CLI_SHAPE, STUDIO_APPS, buildListArgs, buildRunArgs } from './studio'

const bare = { input: null, output: null, roots: [] }

describe('studio engine registry', () => {
  it('covers every engine the app ships', () => {
    expect(Object.keys(STUDIO_APPS)).toHaveLength(15)
  })

  it('gives every engine its own name rather than the upstream one', () => {
    for (const [id, app] of Object.entries(STUDIO_APPS)) {
      expect(app.label.toLowerCase()).not.toBe(app.upstream.toLowerCase())
      expect(app.greek.length).toBeGreaterThan(0)
      expect(app.upstream.length).toBeGreaterThan(0)
      // The id is the label lowercased, and must stay ASCII so it can travel as a tool argument.
      expect(id).toMatch(/^[a-z]+$/)
      expect(app.label.toLowerCase()).toBe(id)
    }
  })

  it('names a shape for every engine', () => {
    for (const id of Object.keys(STUDIO_APPS)) {
      expect(CLI_SHAPE[id]).toBeDefined()
    }
  })

  it('marks only the engines whose CLI was confirmed', () => {
    const verified = Object.entries(STUDIO_APPS)
      .filter(([, app]) => app.verified)
      .map(([id]) => id)
      .sort()
    expect(verified).toEqual(['chartes', 'eikon', 'logos', 'pinax', 'skene', 'techton', 'gramme'].sort())
  })
})

describe('studio run argv', () => {
  it('appends inline JSON params and saves a spreadsheet with --out', () => {
    const args = buildRunArgs(
      'pinax',
      { app: 'pinax', commands: [{ id: 'home.bold', params: { range: 'B4:F4' } }] },
      { input: 'budget.xlsx', output: 'out.xlsx', roots: ['/w'] }
    )
    expect(args).toEqual(['run', 'budget.xlsx', '--cmd', 'home.bold={"range":"B4:F4"}', '--out', 'out.xlsx'])
  })

  it('passes automation roots for the engines that support them', () => {
    const args = buildRunArgs(
      'skene',
      { app: 'skene', commands: [{ id: 'slide.new', params: { layout: 'titleOnly' } }] },
      { input: null, output: 'hello.deckcraft', roots: ['/w'] }
    )
    expect(Array.isArray(args)).toBe(true)
    const list = args as string[]
    expect(list.filter((token) => token === '--automation-read-root')).toHaveLength(1)
    expect(list.slice(-2)).toEqual(['--save', 'hello.deckcraft'])
  })

  it('does not invent automation roots for engines without them', () => {
    const args = buildRunArgs(
      'techton',
      { app: 'techton', commands: [{ id: 'zoom' }] },
      { input: 'd.dxf', output: 'd.png', roots: ['/w'] }
    ) as string[]
    expect(args.some((token) => token.startsWith('--automation'))).toBe(false)
  })

  it('uses key=value for the PDF engine and confines it with --root', () => {
    const args = buildRunArgs(
      'chartes',
      { app: 'chartes', commands: [{ id: 'text_find', params: { doc: 1, query: 'invoice' } }] },
      { input: null, output: 'out.pdf', roots: ['/w'] }
    ) as string[]
    expect(args).toEqual(['run', 'text_find', 'doc=1', 'query=invoice', '--root', '/w', '--out', 'out.pdf'])
  })

  it('refuses a command chain for the PDF engine, which runs one tool at a time', () => {
    const args = buildRunArgs(
      'chartes',
      { app: 'chartes', commands: [{ id: 'a' }, { id: 'b' }] },
      bare
    )
    expect(typeof args).toBe('string')
    expect(args as string).toContain('one tool per invocation')
  })

  it('explains instead of guessing when an engine cannot take commands', () => {
    const args = buildRunArgs('gramme', { app: 'gramme', commands: [{ id: 'x' }] }, bare)
    expect(typeof args).toBe('string')
    expect(args as string).toContain('control channel')
  })

  it('sends params in a separate flag for the image engine', () => {
    const args = buildRunArgs(
      'eikon',
      { app: 'eikon', commands: [{ id: 'filter.sharpen.smartSharpen', params: { amount: 80 } }] },
      { input: 'wave.psd', output: 'wave.png', roots: ['/w'] }
    ) as string[]
    expect(args).toEqual([
      'run',
      'wave.psd',
      '--cmd',
      'filter.sharpen.smartSharpen',
      '--params',
      '{"amount":80}',
      '--out',
      'wave.png'
    ])
  })

  it('never emits a document flag without a path', () => {
    for (const id of Object.keys(STUDIO_APPS)) {
      const args = buildRunArgs(id, { app: id, commands: [{ id: 'a' }] }, bare)
      if (typeof args === 'string') continue
      expect(args.some((token) => ['--save', '--out', '--export'].includes(token))).toBe(false)
    }
  })

  it('lists tools rather than commands for the PDF engine', () => {
    expect(buildListArgs('chartes')).toEqual(['tools'])
    expect(buildListArgs('pinax', 'chart')).toEqual(['commands', '--search', 'chart'])
  })
})
