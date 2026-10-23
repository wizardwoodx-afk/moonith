/**
 * this app's interface styles, ported into SelfImpulse's backend.
 *
 * One table, one source of truth: it generates the CSS custom-property blocks
 * AND drives the theme cards in Settings → Appearance, so a colour can never
 * drift between the stylesheet and the picker.
 *
 * Each palette is a set of real swatches; every style derives its canvas,
 * surfaces, text ramp and accent from them.
 */

/** The swatches, exactly as sampled. */
export interface Swatch {
  name: string
  hex: string
}

/** A sampled palette: a label, a note and its swatches. */
export interface Palette {
  label: string
  note: string
  swatches: Swatch[]
}

/** The palettes the earlier shell ships with. */
export type PaletteId = 'moonlight' | 'meadow' | 'slate' | 'monolith' | 'ferrous' | 'sky'

/** A style can be rendered light or dark. */
export type ThemeMode = 'light' | 'dark'

/** One of the four styles recovered from the original design system. */
export interface BuiltinStyle {
  id: string
  label: string
  accent: string
  swatches: string[]
}

/** A style as shown on an appearance card. */
export interface ThemeStyle {
  id: string
  label: string
  builtin: boolean
  note: string
  accent: string
  swatches: Swatch[]
  modes: ThemeMode[]
}

/** The CSS custom properties derived from a palette for one mode. */
export interface ThemeVariables {
  '--q1d295b': string
  '--q5b417c': string
  '--q79944a': string
  '--q292341': string
  '--q0704b8': string
  '--q343253': string
  '--qd3d2fd': string
  '--q883115': string
  '--q9ab642': string
  '--q3c93d1': string
  '--q1c50a8': string
  '--q149cae': string
  '--qbf0417': string
  '--qedba01': string
  '--q04b770': string
  '--q3d0904': string
  '--q8f0315': string
  '--qca1baf': string
  '--qdf74ad': string
  '--qf4cfe3': string
  '--q676eb9': string
  '--qbf30b8': string
  '--q5b15fd': string
  '--q9bc9e9': string
  '--q35d916': string
  '--qd5c0f3': string
  '--q2be419': string
  '--q015283': string
  '--q0584de': string
  '--qde2d3b': string
  '--q842b14': string
  '--qc43a07': string
  '--q127448': string
  '--qb28b89': string
  '--qa1f2f3': string
  '--q35d916x': string
}

export const PALETTES: Record<PaletteId, Palette> = {
  moonlight: {
    label: 'Moonlight',
    note: 'Pure greyscale — no colour at all.',
    swatches: [
      { name: 'Midnight Mist', hex: '#000000' },
      { name: 'Silver Slate', hex: '#8C8889' },
      { name: 'Clouded Pearl', hex: '#CFCFD3' },
      { name: 'Pure Snow', hex: '#FFFFFF' }
    ]
  },
  meadow: {
    label: 'Meadow',
    note: 'Floral off-white with deep olive and near-black.',
    swatches: [
      { name: 'Floral White', hex: '#FAF7EF' },
      { name: 'Black Olive', hex: '#32372C' },
      { name: 'Carbon Black', hex: '#121314' }
    ]
  },
  slate: {
    label: 'Slate',
    note: 'Soft browns and olives on a warm charcoal.',
    swatches: [
      { name: 'White', hex: '#F4F4F4' },
      { name: 'Brown', hex: '#46413C' },
      { name: 'Olive', hex: '#8F9289' },
      { name: 'Coal', hex: '#242224' }
    ]
  },
  monolith: {
    label: 'Monolith',
    note: 'Concrete, stability and a warm human note.',
    swatches: [
      { name: 'Base', hex: '#E9E9E6' },
      { name: 'Structures', hex: '#2E2E2E' },
      { name: 'Concrete', hex: '#CCCCCB' },
      { name: 'Stability', hex: '#21262B' },
      { name: 'Human warmth', hex: '#A08E65' }
    ]
  },
  ferrous: {
    label: 'Ferrous',
    note: 'Concrete and metal — a cold blue-grey shell.',
    swatches: [
      { name: 'Dark', hex: '#21262B' },
      { name: 'Metal', hex: '#A9A9A9' },
      { name: 'Bright', hex: '#F1F1F1' },
      { name: 'Steel', hex: '#778899' }
    ]
  },
  sky: {
    label: 'Sky',
    note: 'A soft blue with warm neutrals.',
    swatches: [
      { name: 'Soft blue', hex: '#97C2EC' },
      { name: 'Light brown', hex: '#D6D0C2' },
      { name: 'Main black', hex: '#1F1F1F' },
      { name: 'Main white', hex: '#FFFFFF' }
    ]
  }
}

const hexToRgb = (hex: string): number[] => {
  const v = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16))
}

/** Mix two hex colours. t=0 → a, t=1 → b. */
export function mix(a: string, b: string, t: number): string {
  const ra = hexToRgb(a)
  const rb = hexToRgb(b)
  const out = ra.map((v, i) => Math.round(v + (rb[i] - v) * t))
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** Relative luminance, so the text ramp can be picked automatically. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export const isLight = (hex: string): boolean => luminance(hex) > 0.45

/**
 * Build the full variable set for one style.
 * `mode` is "light" or "dark"; the ramp is derived from the palette.
 */
export function buildTheme(palette: Palette, mode: ThemeMode): ThemeVariables {
  const sw = palette.swatches.map((s) => s.hex)
  const lightest = sw.reduce((a, b) => (luminance(a) > luminance(b) ? a : b))
  const darkest = sw.reduce((a, b) => (luminance(a) < luminance(b) ? a : b))
  const mid = sw.find((h) => h !== lightest && h !== darkest) || lightest

  // the accent is the most saturated swatch, and the canvas the darkest (or the
  // lightest in light mode) — so the palette drives the whole surface.
  const accent =
    sw
      .map((h) => ({ h, sat: Math.max(...hexToRgb(h)) - Math.min(...hexToRgb(h)) }))
      .sort((a, b) => b.sat - a.sat)[0]?.h || mid

  const dark = mode === 'dark'
  const canvas = dark ? darkest : lightest
  const chrome = dark ? mix(darkest, mid, 0.18) : mix(lightest, mid, 0.1)
  const surface = dark ? mix(darkest, mid, 0.12) : mix(lightest, mid, 0.05)
  const raised = dark ? mix(darkest, mid, 0.3) : mix(lightest, mid, 0.16)
  const text = dark ? lightest : darkest
  const textSecondary = dark ? mix(text, canvas, 0.35) : mix(text, canvas, 0.35)
  const textTertiary = dark ? mix(text, canvas, 0.55) : mix(text, canvas, 0.55)
  const textQuaternary = dark ? mix(text, canvas, 0.7) : mix(text, canvas, 0.7)
  const border = dark ? mix(darkest, mid, 0.26) : mix(lightest, darkest, 0.14)
  const borderStrong = dark ? mix(darkest, mid, 0.42) : mix(lightest, darkest, 0.24)
  const fillSecondary = dark ? mix(darkest, mid, 0.16) : mix(lightest, darkest, 0.08)
  const fillTertiary = dark ? mix(darkest, mid, 0.1) : mix(lightest, darkest, 0.04)
  const fillQuaternary = dark ? mix(darkest, mid, 0.07) : mix(lightest, darkest, 0.03)
  const accentSoft = dark ? mix(darkest, accent, 0.22) : mix(lightest, accent, 0.18)
  const accentText = dark ? mix(accent, lightest, 0.25) : mix(accent, darkest, 0.25)
  const accentDim = dark ? mix(darkest, accent, 0.42) : mix(lightest, accent, 0.4)
  const accentSoft2 = dark ? mix(darkest, accent, 0.14) : mix(lightest, accent, 0.12)

  return {
    '--q1d295b': canvas,
    '--q5b417c': chrome,
    '--q79944a': canvas,
    '--q292341': dark ? mix(darkest, '#000000', 0.35) : mix(lightest, '#ffffff', 0.2),
    '--q0704b8': text,
    '--q343253': text,
    '--qd3d2fd': text,
    '--q883115': textSecondary,
    '--q9ab642': textTertiary,
    '--q3c93d1': textQuaternary,
    '--q1c50a8': accent,
    '--q149cae': accentText,
    '--qbf0417': accentText,
    '--qedba01': accentText,
    '--q04b770': accentText,
    '--q3d0904': accentText,
    '--q8f0315': accentDim,
    '--qca1baf': accentDim,
    '--qdf74ad': accentSoft,
    '--qf4cfe3': accentSoft,
    '--q676eb9': fillSecondary,
    '--qbf30b8': fillSecondary,
    '--q5b15fd': fillTertiary,
    '--q9bc9e9': fillQuaternary,
    '--q35d916': fillQuaternary,
    '--qd5c0f3': fillQuaternary,
    '--q2be419': fillTertiary,
    '--q015283': border,
    '--q0584de': border,
    '--qde2d3b': border,
    '--q842b14': borderStrong,
    '--qc43a07': borderStrong,
    '--q127448': dark ? `${mid}14` : `${darkest}14`,
    '--qb28b89': dark ? mix(darkest, '#000000', 0.45) : mix(lightest, '#000000', 0.06),
    '--qa1f2f3': dark ? '#ffffff' : '#ffffff',
    '--q35d916x': accentSoft2
  }
}

/** The styles the earlier shell offers: the four recovered ones plus our own palettes. */
export const BUILTIN: BuiltinStyle[] = [
  { id: 'forest', label: 'Forest', accent: '#5cb870', swatches: ['#111110', '#5cb870', '#eeeeeb'] },
  { id: 'mint', label: 'Mint', accent: '#6fd8b0', swatches: ['#101614', '#6fd8b0', '#e8f6ef'] },
  { id: 'bee', label: 'Bee', accent: '#e0c65c', swatches: ['#1a1a12', '#e0c65c', '#f5f0d6'] },
  { id: 'parchment', label: 'Parchment', accent: '#c8a878', swatches: ['#1c1a15', '#c8a878', '#f3ede0'] }
]

export function styles(): ThemeStyle[] {
  const out: ThemeStyle[] = BUILTIN.map((b) => ({
    id: b.id,
    label: b.label,
    builtin: true,
    note: 'Recovered from the original design system.',
    accent: b.accent,
    swatches: b.swatches.map((hex, i) => ({ name: `Swatch ${i + 1}`, hex })),
    modes: ['light', 'dark']
  }))
  for (const [id, palette] of Object.entries(PALETTES) as Array<[PaletteId, Palette]>) {
    out.push({
      id,
      label: palette.label,
      builtin: false,
      note: palette.note,
      accent: palette.swatches[palette.swatches.length - 1].hex,
      swatches: palette.swatches,
      modes: ['light', 'dark']
    })
  }
  return out
}

/** Emit the CSS for every style. */
export function css(): string {
  const lines = ['/* Generated from electron/backend/themes.js — do not edit by hand. */', '']
  for (const [id, palette] of Object.entries(PALETTES) as Array<[PaletteId, Palette]>) {
    for (const mode of ['light', 'dark'] as ThemeMode[]) {
      const vars = buildTheme(palette, mode)
      lines.push(`html[data-theme="${id}-${mode}"] {`)
      for (const [k, v] of Object.entries(vars)) {
        if (k.endsWith('x')) continue
        lines.push(`  ${k}: ${v};`)
      }
      lines.push('}', '')
    }
  }
  return lines.join('\n')
}
