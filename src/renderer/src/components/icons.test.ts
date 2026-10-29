import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ICONS,
  ICON_SIZES,
  ICON_STROKE_PX,
  STATEFUL_ICON_NAMES,
  Icon,
  iconStrokeWidth,
  type IconName,
  type IconSize,
  type StatefulIconName
} from './icons'

const render = (name: IconName, options: { size?: IconSize; active?: boolean } = {}): string =>
  renderToStaticMarkup(createElement(Icon, { name, ...options }))

const attr = (markup: string, attribute: string): string =>
  markup.match(new RegExp(`${attribute}="([^"]*)"`))?.[1] ?? ''

const SIZES: IconSize[] = ['xs', 'sm', 'md', 'lg', 'xl']

describe('icon size scale', () => {
  it('is the five fixed steps, and only those', () => {
    expect(ICON_SIZES).toEqual({ xs: 11, sm: 12, md: 14, lg: 16, xl: 20 })
    expect(Object.keys(ICON_SIZES)).toEqual(SIZES)
  })

  it('climbs and never drops under the smallest text in the app', () => {
    SIZES.forEach((size, index) => {
      expect(ICON_SIZES[size]).toBeGreaterThanOrEqual(11)
      if (index > 0) expect(ICON_SIZES[size]).toBeGreaterThan(ICON_SIZES[SIZES[index - 1]])
    })
  })

  it('draws one optical stroke weight at every size', () => {
    for (const size of SIZES) {
      // stroke-width lives on a 24-unit grid, so this is the rendered thickness.
      const renderedPx = (iconStrokeWidth(size) * ICON_SIZES[size]) / 24
      expect(renderedPx).toBeCloseTo(ICON_STROKE_PX, 1)
    }
    // 16px is where Lucide's own 1.5 stroke lands, so the family is anchored there.
    expect(iconStrokeWidth('lg')).toBe(1.5)
  })

  it('applies the size and the stroke to the svg it renders', () => {
    const markup = render('spark', { size: 'md' })
    expect(attr(markup, 'width')).toBe('14')
    expect(attr(markup, 'stroke-width')).toBe(String(iconStrokeWidth('md')))
  })
})

describe('state pairs', () => {
  it('covers every concept that carries a state', () => {
    for (const concept of [
      'spark', // skill installed vs not, model chosen vs not
      'connector', // ready vs failed
      'crew', // run live vs nothing live
      'folder', // working folder attached vs detached
      'folderOpen', // source granted vs none
      'file', // attached vs detached
      'shield', // guarding vs awaiting you
      'pin', // pinned vs not
      'stop', // running vs resting
      'voteUp',
      'voteDown'
    ]) {
      expect(STATEFUL_ICON_NAMES).toContain(concept)
    }
  })

  it('pairs each stateful glyph with the same geometry, filled', () => {
    expect(STATEFUL_ICON_NAMES.length).toBeGreaterThan(0)
    for (const name of STATEFUL_ICON_NAMES) {
      const line = render(name, { size: 'sm', active: false })
      const filled = render(name, { size: 'sm', active: true })
      // Same geometry means fill is the only difference between the halves.
      expect(filled.replace('fill="currentColor"', 'fill="none"')).toBe(line)
      expect(attr(line, 'fill')).toBe('none')
      expect(attr(filled, 'fill')).toBe('currentColor')
    }
  })

  it('refuses to fill a glyph that has no state', () => {
    const lineOnly = (Object.keys(ICONS) as IconName[]).filter(
      (name) => !STATEFUL_ICON_NAMES.includes(name as StatefulIconName)
    )
    expect(lineOnly.length).toBeGreaterThan(0)
    for (const name of lineOnly) {
      expect(attr(render(name, { active: true }), 'fill')).toBe('none')
    }
  })
})

describe('registry', () => {
  it("is the app's glyph set, not a re-export of all of Lucide", () => {
    const names = Object.keys(ICONS) as IconName[]
    expect(names.length).toBeGreaterThan(30)
    expect(names.length).toBeLessThan(60)
    for (const name of names) {
      expect(render(name)).toContain('<svg')
      // Every glyph is decorative: the control or the word beside it names it.
      expect(render(name)).toContain('aria-hidden="true"')
    }
  })
})
