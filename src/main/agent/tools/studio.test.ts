import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CLI_SHAPE, STUDIO_APPS, buildListArgs, buildRunArgs, resolveStudioBinary, safeCommandToken, studioCommandsTool, studioRunTool } from './studio'
import { requiresReceipt } from '../../sphragis/schema'
import { capabilityForTool } from '../../nomos/policy'
import type { ToolContext } from './types'

const bare = { input: null, output: null, roots: [] }

describe('studio engine registry', () => {
  it('covers every engine the app ships', () => {
    expect(Object.keys(STUDIO_APPS)).toHaveLength(14)
  })

  it('gives every engine its own name rather than the upstream one', () => {
    for (const [id, app] of Object.entries(STUDIO_APPS)) {
      expect(app.label.toLowerCase()).not.toBe(app.upstream.toLowerCase())
      expect(app.greek.length).toBeGreaterThan(0)
      expect(app.upstream.length).toBeGreaterThan(0)
      // The id is the label lowercased, and must stay ASCII so it can travel as a tool argument.
      expect(id).toMatch(/^[a-z]+$/)
      expect(app.label.toLowerCase()).toBe(id)
      expect(app.env).toBe(`SELFIMPULSE_STUDIO_${id.toUpperCase()}`)
    }
  })

  it('names a shape for every engine', () => {
    for (const id of Object.keys(STUDIO_APPS)) {
      expect(CLI_SHAPE[id]).toBeDefined()
    }
  })
})

describe('binary resolution', () => {
  const app = STUDIO_APPS.pinax
  const originalOverride = process.env[app.env]
  afterAll(() => {
    if (originalOverride === undefined) delete process.env[app.env]
    else process.env[app.env] = originalOverride
  })

  it('prefers the explicit override, then the tools folder, then PATH', () => {
    delete process.env[app.env]
    expect(resolveStudioBinary(app)).toBe('gridcraft-cli')
    const dir = mkdtempSync(join(tmpdir(), 'studio-'))
    try {
      writeFileSync(join(dir, 'gridcraft-cli.exe'), '')
      const found = resolveStudioBinary(app, dir)
      expect(found).toContain('studio-')
      expect(found.toLowerCase()).toContain('gridcraft-cli.exe')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    process.env[app.env] = 'D:/tools/gridcraft-cli.exe'
    expect(resolveStudioBinary(app, join(tmpdir(), 'nowhere'))).toBe('D:/tools/gridcraft-cli.exe')
  })
})

describe('command token safety', () => {
  it('accepts plain dotted ids and rejects flag-shaped or control-bearing ones', () => {
    expect(safeCommandToken('home.bold')).toBe(true)
    expect(safeCommandToken('text_find')).toBe(true)
    expect(safeCommandToken('slide.new')).toBe(true)
    expect(safeCommandToken('--root')).toBe(false)
    expect(safeCommandToken('-x')).toBe(false)
    expect(safeCommandToken('a b')).toBe(false)
    expect(safeCommandToken('a\tb')).toBe(false)
    expect(safeCommandToken('')).toBe(false)
    expect(safeCommandToken('a'.repeat(129))).toBe(false)
  })

  it('refuses a flag-shaped command id instead of spawning it', () => {
    const args = buildRunArgs('pinax', { app: 'pinax', commands: [{ id: '--root' }] }, bare)
    expect(typeof args).toBe('string')
    expect(args as string).toContain('not a valid command id')
  })

  it('refuses a flag-shaped parameter name', () => {
    const args = buildRunArgs(
      'pinax',
      { app: 'pinax', commands: [{ id: 'home.bold', params: { '--out': '/etc' } }] },
      bare
    )
    expect(typeof args).toBe('string')
    expect(args as string).toContain('not a valid parameter name')
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

describe('studio tool classification', () => {
  it('classifies studio_commands as a spawned, high-risk, approval-required action', () => {
    /* It spawns an external CLI, so it is executable — not a read. The old
     * 'read' classification skipped receipts, the shell.exec capability and
     * the human approval that studio_run gets. */
    expect(studioCommandsTool.sideEffect).toBe('execute')
    expect(studioCommandsTool.risk).toBe('high')
    expect(studioCommandsTool.approval).toBe('always')
    expect(
      requiresReceipt({ sideEffect: studioCommandsTool.sideEffect, risk: studioCommandsTool.risk })
    ).toBe(true)
    expect(capabilityForTool(studioCommandsTool.name, studioCommandsTool.sideEffect)).toBe('shell.exec')
  })

  it('mirrors studio_run, which is the same class of action', () => {
    expect(studioCommandsTool.risk).toBe(studioRunTool.risk)
    expect(studioCommandsTool.approval).toBe(studioRunTool.approval)
    expect(
      requiresReceipt({ sideEffect: studioRunTool.sideEffect, risk: studioRunTool.risk })
    ).toBe(true)
    /* Still distinct: listing is not a document run. */
    expect(studioCommandsTool.sideEffect).toBe('execute')
    expect(studioRunTool.sideEffect).toBe('write')
  })

  it('still lists every engine without spawning anything', async () => {
    /* The no-app path is pure: it keeps studio_commands useful as the
     * discovery door without any subprocess. */
    const result = await studioCommandsTool.execute({}, {} as ToolContext)
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('pinax')
    expect(Object.keys(STUDIO_APPS)).toHaveLength(14)
  })
})
