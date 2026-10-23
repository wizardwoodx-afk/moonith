import { describe, expect, it } from 'vitest'
import { CRAFT_APPS, buildRunArgs } from './craft'

const noRoots = { input: null, output: null, readRoots: [], writeRoots: [] }

describe('craft run argv', () => {
  it('appends inline JSON params for gridcraft and saves with --out', () => {
    const args = buildRunArgs(
      CRAFT_APPS.gridcraft,
      {
        app: 'gridcraft',
        commands: [{ id: 'home.bold', params: { range: 'B4:F4' } }]
      },
      { input: 'budget.xlsx', output: 'out.xlsx', readRoots: ['/w'], writeRoots: ['/w'] }
    )
    expect(args).toEqual([
      'run',
      'budget.xlsx',
      '--cmd',
      'home.bold={"range":"B4:F4"}',
      '--out',
      'out.xlsx'
    ])
  })

  it('omits the equals sign when a command takes no params', () => {
    const args = buildRunArgs(
      CRAFT_APPS.wordcraft,
      { app: 'wordcraft', commands: [{ id: 'format.bold' }] },
      noRoots
    )
    expect(args).toEqual(['run', '--cmd', 'format.bold'])
  })

  it('passes automation roots for the apps that support them', () => {
    const args = buildRunArgs(
      CRAFT_APPS.deckcraft,
      { app: 'deckcraft', commands: [{ id: 'slide.new', params: { layout: 'titleOnly' } }] },
      { input: null, output: 'hello.deckcraft', readRoots: ['/w'], writeRoots: ['/w'] }
    )
    expect(args).toContain('--automation-read-root')
    expect(args).toContain('--automation-write-root')
    expect(args.slice(-2)).toEqual(['--save', 'hello.deckcraft'])
  })

  it('does not invent automation roots for apps without them', () => {
    const args = buildRunArgs(
      CRAFT_APPS.cadcraft,
      { app: 'cadcraft', commands: [{ id: 'zoom' }] },
      { input: 'd.dxf', output: 'd.png', readRoots: ['/w'], writeRoots: ['/w'] }
    )
    expect(args.some((token) => token.startsWith('--automation'))).toBe(false)
  })

  it('sends params in a separate flag for photocraft', () => {
    const args = buildRunArgs(
      CRAFT_APPS.photocraft,
      { app: 'photocraft', commands: [{ id: 'filter.sharpen.smartSharpen', params: { amount: 80 } }] },
      { input: 'wave.psd', output: 'wave.png', readRoots: ['/w'], writeRoots: ['/w'] }
    )
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

  it('keeps one --cmd pair per command, in order', () => {
    const args = buildRunArgs(
      CRAFT_APPS.wordcraft,
      {
        app: 'wordcraft',
        commands: [
          { id: 'select.text', params: { text: 'Membership' } },
          { id: 'format.bold' }
        ]
      },
      noRoots
    )
    expect(args).toEqual(['run', '--cmd', 'select.text={"text":"Membership"}', '--cmd', 'format.bold'])
  })

  it('never emits an empty document flag', () => {
    for (const app of Object.values(CRAFT_APPS)) {
      const args = buildRunArgs(app, { app: 'x', commands: [{ id: 'a' }] }, noRoots)
      expect(args.some((token) => token === '--save' || token === '--out')).toBe(false)
    }
  })
})
