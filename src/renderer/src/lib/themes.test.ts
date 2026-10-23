/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, THEMES, themeById } from './themes'

const RARE = ['afterimage', 'resin', 'xanadu', 'wenge', 'glaucous'] as const

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
    const house = THEMES.filter((theme) => !RARE.includes(theme.id as (typeof RARE)[number]))
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
