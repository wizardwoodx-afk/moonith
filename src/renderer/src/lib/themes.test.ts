/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ATELIER_THEME_IDS,
  DEFAULT_THEME,
  THEMES,
  colorContrast,
  themeById,
  themeCollection,
  type ThemeId
} from './themes'

const RARE = ['afterimage', 'resin', 'xanadu', 'wenge', 'glaucous'] as const
const DISTINCT = [
  'cinnabar-light',
  'cinnabar-dark',
  'viridian-light',
  'viridian-dark',
  'sulfur-light',
  'sulfur-dark',
  'glacial-light',
  'glacial-dark',
  'quartz-light',
  'quartz-dark'
] as const

const css = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')

function cssBlock(id: string): Record<string, string> {
  const start = css.indexOf(`[data-theme='${id}'] {`)
  if (start < 0) throw new Error(`no CSS block for theme ${id}`)
  const end = css.indexOf('}', start)
  const body = css.slice(start, end)
  const out: Record<string, string> = {}
  for (const line of body.split('\n')) {
    const match = /^\s*(--[a-z0-9-]+):\s*([^;]+);/.exec(line)
    if (match) out[match[1]] = match[2].trim()
  }
  return out
}

describe('the Rare Five palettes', () => {
  it('are registered and none is exclusive, so none can become the default', () => {
    for (const id of RARE) {
      const theme = themeById(id)
      expect(theme, `theme ${id} is missing`).toBeDefined()
      expect(theme.exclusive).toBeFalsy()
    }
    expect(RARE).not.toContain(DEFAULT_THEME)
    expect(DEFAULT_THEME).toBe('moonlight')
  })

  it('are all light palettes', () => {
    for (const id of RARE) expect(themeById(id).kind).toBe('light')
  })

  it('mirror the stylesheet exactly, so the preview swatches are truthful', () => {
    for (const id of RARE) {
      const declared = cssBlock(id)
      const tokens = themeById(id).tokens
      const keys = Object.keys(declared)
      expect(keys.length, `${id} declares too few tokens`).toBeGreaterThanOrEqual(24)
      for (const key of keys) {
        expect(tokens[key], `${id} ${key}`).toBe(declared[key])
      }
    }
  })

  it('keep the three source colours visible in the derived tokens', () => {
    expect(themeById('afterimage').tokens['--c-canvas']).toBe('#F5EFEA')
    expect(themeById('afterimage').tokens['--c-ink']).toBe('#1F151A')
    expect(themeById('afterimage').tokens['--c-accent']).toBe('#C27483')
  })

  it('does not change the house themes', () => {
    const optional: readonly string[] = [...RARE, ...DISTINCT, ...ATELIER_THEME_IDS]
    const house = THEMES.filter((theme) => !optional.includes(theme.id))
    expect(house.map((theme) => theme.id)).toEqual([
      'moonlight',
      'bee',
      'pulsidian',
      'patina',
      'celadon',
      'heliodor',
      'moon'
    ])
  })
})

const DISTINCT_SOURCES = {
  cinnabar: { canvas: '#F5F1EA', ink: '#140C0A', signal: '#D1553B' },
  viridian: { canvas: '#EDF2EE', ink: '#050D09', signal: '#218F6A' },
  sulfur: { canvas: '#F0F0E4', ink: '#12130D', signal: '#8F8B2D' },
  glacial: { canvas: '#E8F0F2', ink: '#0E161B', signal: '#4E8FA9' },
  quartz: { canvas: '#F0EAF2', ink: '#120B13', signal: '#A875B2' }
} as const

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
  const linear = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  )
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((left, right) => right - left)
  return (high + 0.05) / (low + 0.05)
}

describe('the Distinct Color studies', () => {
  it('register light and dark variants without changing the default or exclusivity', () => {
    expect(DISTINCT).toHaveLength(10)
    for (const id of DISTINCT) {
      expect(themeById(id).exclusive).toBeFalsy()
      expect(themeById(id).kind).toBe(id.endsWith('-dark') ? 'dark' : 'light')
    }
    expect(DISTINCT).not.toContain(DEFAULT_THEME)
    expect(DEFAULT_THEME).toBe('moonlight')
  })

  it('mirror every derived stylesheet token exactly', () => {
    for (const id of DISTINCT) {
      const declared = cssBlock(id)
      const tokens = themeById(id).tokens
      expect(Object.keys(declared).length, `${id} declares too few tokens`).toBeGreaterThanOrEqual(24)
      for (const key of Object.keys(declared)) {
        expect(tokens[key], `${id} ${key}`).toBe(declared[key])
      }
    }
  })

  it('preserve canvas, ink, and signal in both modes with ink on signal CTAs', () => {
    for (const [family, source] of Object.entries(DISTINCT_SOURCES)) {
      const light = themeById(`${family}-light` as ThemeId)
      const dark = themeById(`${family}-dark` as ThemeId)
      expect(light.tokens).toMatchObject({
        '--c-canvas': source.canvas,
        '--c-ink': source.ink,
        '--c-accent': source.signal,
        '--c-ink-button': source.signal,
        '--c-on-ink': source.ink
      })
      expect(dark.tokens).toMatchObject({
        '--c-canvas': source.ink,
        '--c-ink': source.canvas,
        '--c-accent': source.signal,
        '--c-ink-button': source.signal,
        '--c-on-ink': source.ink
      })
    }
  })

  it('retain AAA body contrast, AA CTA labels, and AA non-text signal contrast', () => {
    for (const source of Object.values(DISTINCT_SOURCES)) {
      expect(contrast(source.canvas, source.ink)).toBeGreaterThanOrEqual(15)
      expect(contrast(source.ink, source.signal)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(source.canvas, source.signal)).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('readable secondary text', () => {
  it('keeps muted and faint text at AA contrast on product surfaces in every theme', () => {
    const surfaces = ['--c-canvas', '--c-panel', '--c-panel-2', '--c-surface', '--c-surface-2', '--c-surface-3', '--c-accent-soft']
    for (const theme of THEMES) {
      for (const foreground of ['--c-muted', '--c-faint']) {
        for (const surface of surfaces) {
          expect(
            colorContrast(theme.tokens[foreground], theme.tokens[surface]),
            `${theme.id} ${foreground} on ${surface}`
          ).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })
})

describe('Solo and Teams color collections', () => {
  it('mix every house and supplied Atelier theme into exactly two curated sets', () => {
    expect(ATELIER_THEME_IDS).toHaveLength(12)
    expect(new Set(THEMES.map((theme) => theme.id)).size).toBe(THEMES.length)
    expect(new Set(THEMES.map((theme) => themeCollection(theme.id)))).toEqual(
      new Set(['solo', 'teams'])
    )
    expect(themeCollection('moonlight')).toBe('solo')
    expect(themeCollection('bee')).toBe('teams')
    expect(themeCollection('atelier-harbor')).toBe('teams')
    expect(themeCollection('atelier-studio')).toBe('solo')
  })

  it('preserve supplied master colors and readable CTA labels', () => {
    expect(themeById('nocturne-light').tokens).toMatchObject({
      '--c-canvas': '#FFFBF5',
      '--c-surface-2': '#E8EDF1',
      '--c-accent': '#5C6B7A'
    })
    expect(themeById('atelier-harbor').tokens).toMatchObject({
      '--c-canvas': '#F2F7FB',
      '--c-surface-2': '#DCE6F0',
      '--c-ink': '#0F1E2E',
      '--c-accent': '#2F5A94'
    })
    expect(themeById('atelier-void').tokens).toMatchObject({
      '--c-canvas': '#07070A',
      '--c-surface-2': '#13151A',
      '--c-ink': '#F5F7FB'
    })
    for (const id of ATELIER_THEME_IDS) {
      const theme = themeById(id)
      expect(
        colorContrast(theme.tokens['--c-accent'], theme.tokens['--c-on-ink']),
        `${id} CTA label contrast`
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        colorContrast(theme.tokens['--c-canvas'], theme.tokens['--c-ink']),
        `${id} body contrast`
      ).toBeGreaterThanOrEqual(7)
    }
  })
})
