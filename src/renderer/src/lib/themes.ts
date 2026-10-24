import { create } from 'zustand'

export type ThemeId =
  | 'moonlight'
  | 'bee'
  | 'pulsidian'
  | 'patina'
  | 'celadon'
  | 'heliodor'
  | 'moon'
  | 'afterimage'
  | 'resin'
  | 'xanadu'
  | 'wenge'
  | 'glaucous'
  | 'cinnabar-light'
  | 'cinnabar-dark'
  | 'viridian-light'
  | 'viridian-dark'
  | 'sulfur-light'
  | 'sulfur-dark'
  | 'glacial-light'
  | 'glacial-dark'
  | 'quartz-light'
  | 'quartz-dark'
  | 'nocturne-light'
  | 'nocturne-dark'
  | 'atelier-studio'
  | 'atelier-harbor'
  | 'atelier-meadow'
  | 'atelier-sand'
  | 'atelier-dune'
  | 'atelier-eclipse'
  | 'atelier-midnight'
  | 'atelier-forest'
  | 'atelier-plum'
  | 'atelier-void'

export type ThemeKind = 'dark' | 'light'
export type ThemeCollection = 'solo' | 'teams'

export interface Theme {
  id: ThemeId
  label: string
  description: string
  kind: ThemeKind
  collection?: ThemeCollection
  origin?: 'house' | 'atelier'
  exclusive?: boolean
  tokens: Record<string, string>
}

const base = {
  '--c-canvas': '',
  '--c-canvas-deep': '',
  '--c-sidebar': '',
  '--c-panel': '',
  '--c-panel-2': '',
  '--c-surface': '',
  '--c-surface-2': '',
  '--c-surface-3': '',
  '--c-ink': '',
  '--c-muted': '',
  '--c-faint': '',
  '--c-line': '',
  '--c-line-strong': '',
  '--c-accent': '',
  '--c-accent-soft': '',
  '--c-accent-ink': '',
  '--c-gold': '',
  '--c-gold-soft': '',
  '--c-positive': '',
  '--c-warn': '',
  '--c-danger': '',
  '--c-ink-button': '',
  '--c-on-ink': '',
  '--c-identity-a': '',
  '--c-identity-b': ''
}

/**
 * The Rare Five are optional, opt-in light palettes. Each is three colours —
 * paper, ink and one signal — and every other token is derived from them, so a
 * palette stays coherent instead of being tuned by hand 22 values at a time.
 *
 * `src/renderer/src/styles.css` is authoritative for rendering; this mirror
 * exists only so the Appearance preview can show a swatch without mounting the
 * theme. `themes.test.ts` asserts the two stay identical.
 */
function channel(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16)
  ]
}

function blend(a: string, b: string, amount: number): string {
  const from = channel(a)
  const to = channel(b)
  return (
    '#' +
    from
      .map((part, index) => part + (to[index] - part) * amount)
      .map((part) => Math.round(Math.max(0, Math.min(255, part))))
      .map((part) => part.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  )
}

function veil(hex: string, alpha: number): string {
  const [r, g, b] = channel(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function lightPalette(
  canvas: string,
  ink: string,
  signal: string
): Record<string, string> {
  return {
    ...base,
    '--c-canvas': canvas,
    '--c-canvas-deep': blend(canvas, ink, 0.07),
    '--c-sidebar': blend(canvas, ink, 0.03),
    '--c-panel': blend('#FFFFFF', canvas, 0.86),
    '--c-panel-2': blend(canvas, ink, 0.05),
    '--c-surface': blend('#FFFFFF', canvas, 0.86),
    '--c-surface-2': blend(canvas, ink, 0.055),
    '--c-surface-3': blend(canvas, ink, 0.1),
    '--c-ink': ink,
    '--c-muted': blend(canvas, ink, 0.58),
    '--c-faint': blend(canvas, ink, 0.42),
    '--c-line': veil(ink, 0.11),
    '--c-line-strong': veil(ink, 0.2),
    '--c-accent': signal,
    '--c-accent-soft': blend(canvas, signal, 0.16),
    '--c-accent-ink': blend(ink, signal, 0.42),
    '--c-gold': blend(ink, signal, 0.35),
    '--c-gold-soft': blend(canvas, signal, 0.22),
    // Status hues stay fixed: a green that reads as "safe" must not shift with
    // the accent, or the colours stop meaning what they say.
    '--c-positive': '#377440',
    '--c-warn': '#986b00',
    '--c-danger': '#a63a2a',
    '--c-ink-button': ink,
    '--c-on-ink': canvas,
    '--c-identity-a': signal,
    '--c-identity-b': blend(signal, ink, 0.4)
  }
}

/** The supplied three-color studies keep ink on their signal CTAs. */
function distinctLightPalette(
  canvas: string,
  ink: string,
  signal: string
): Record<string, string> {
  return {
    ...lightPalette(canvas, ink, signal),
    '--c-ink-button': signal,
    '--c-on-ink': ink
  }
}

/** Dark mode swaps surface/text roles but preserves all three source colors. */
function distinctDarkPalette(
  canvas: string,
  ink: string,
  signal: string
): Record<string, string> {
  return {
    ...base,
    '--c-canvas': ink,
    '--c-canvas-deep': blend(ink, '#000000', 0.25),
    '--c-sidebar': blend(ink, canvas, 0.035),
    '--c-panel': blend(ink, canvas, 0.05),
    '--c-panel-2': blend(ink, canvas, 0.035),
    '--c-surface': blend(ink, canvas, 0.075),
    '--c-surface-2': blend(ink, canvas, 0.11),
    '--c-surface-3': blend(ink, canvas, 0.16),
    '--c-ink': canvas,
    '--c-muted': blend(ink, canvas, 0.7),
    '--c-faint': blend(ink, canvas, 0.5),
    '--c-line': veil(canvas, 0.13),
    '--c-line-strong': veil(canvas, 0.23),
    '--c-accent': signal,
    '--c-accent-soft': blend(ink, signal, 0.22),
    '--c-accent-ink': blend(signal, canvas, 0.45),
    '--c-gold': blend(signal, canvas, 0.38),
    '--c-gold-soft': blend(ink, signal, 0.24),
    '--c-positive': '#84C9A4',
    '--c-warn': '#DFBA7D',
    '--c-danger': '#E08D80',
    '--c-ink-button': signal,
    '--c-on-ink': ink,
    '--c-identity-a': signal,
    '--c-identity-b': blend(signal, canvas, 0.4)
  }
}

function luminance(hex: string): number {
  const channels = channel(hex).map((value) => value / 255)
  const linear = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  )
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

export function colorContrast(a: string, b: string): number {
  const values = [luminance(a), luminance(b)].sort((left, right) => right - left)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

/** Pick a readable CTA label instead of assuming every accent wants black ink. */
function onSignal(signal: string, canvas: string, ink: string): string {
  const candidates = [canvas, ink, '#FFFFFF', '#07070A']
  return candidates.reduce((best, candidate) =>
    colorContrast(candidate, signal) > colorContrast(best, signal) ? candidate : best
  )
}

interface AtelierSource {
  canvas: string
  surface: string
  ink: string
  signal: string
}

/**
 * The supplied Atelier studies enter the same token system as the house
 * palettes. Canvas, surface, ink and signal remain recognizable, while muted
 * text and CTA labels are derived for real product surfaces and AA contrast.
 */
export function atelierPalette(
  kind: ThemeKind,
  source: AtelierSource
): Record<string, string> {
  const { canvas, surface, ink, signal } = source
  const dark = kind === 'dark'
  return {
    ...base,
    '--c-canvas': canvas,
    '--c-canvas-deep': dark ? blend(canvas, '#000000', 0.32) : blend(canvas, ink, 0.055),
    '--c-sidebar': dark ? blend(canvas, surface, 0.28) : blend(canvas, surface, 0.24),
    '--c-panel': dark ? blend(canvas, surface, 0.52) : blend('#FFFFFF', canvas, 0.72),
    '--c-panel-2': dark ? blend(canvas, surface, 0.38) : blend(canvas, surface, 0.22),
    '--c-surface': dark ? blend(canvas, surface, 0.72) : blend('#FFFFFF', surface, 0.52),
    '--c-surface-2': surface,
    '--c-surface-3': dark ? blend(surface, ink, 0.16) : blend(surface, ink, 0.075),
    '--c-ink': ink,
    '--c-muted': dark ? blend(canvas, ink, 0.72) : blend(canvas, ink, 0.72),
    '--c-faint': dark ? blend(canvas, ink, 0.56) : blend(canvas, ink, 0.62),
    '--c-line': veil(ink, dark ? 0.14 : 0.12),
    '--c-line-strong': veil(ink, dark ? 0.25 : 0.21),
    '--c-accent': signal,
    '--c-accent-soft': dark ? blend(canvas, signal, 0.2) : blend(canvas, signal, 0.14),
    '--c-accent-ink':
      !dark && colorContrast(signal, canvas) < 4.5 ? blend(ink, signal, 0.32) : signal,
    '--c-gold': dark ? blend(signal, ink, 0.3) : blend(signal, ink, 0.34),
    '--c-gold-soft': dark ? blend(canvas, signal, 0.22) : blend(canvas, signal, 0.2),
    '--c-positive': dark ? '#84C9A4' : '#377440',
    '--c-warn': dark ? '#DFBA7D' : '#986B00',
    '--c-danger': dark ? '#E08D80' : '#A63A2A',
    '--c-ink-button': signal,
    '--c-on-ink': onSignal(signal, canvas, ink),
    '--c-identity-a': signal,
    '--c-identity-b': dark ? blend(signal, ink, 0.42) : blend(signal, ink, 0.38)
  }
}

function atelierTheme(
  id: ThemeId,
  label: string,
  description: string,
  kind: ThemeKind,
  collection: ThemeCollection,
  source: AtelierSource
): Theme {
  return {
    id,
    label,
    description,
    kind,
    collection,
    origin: 'atelier',
    tokens: atelierPalette(kind, source)
  }
}

export const THEMES: Theme[] = [
  {
    id: 'moonlight',
    label: 'Moonlight',
    description: 'SelfImpulse’s monochrome night: black glass, silver type, one cool light.',
    kind: 'dark',
    tokens: {
      ...base,
      '--c-canvas': '#09090b',
      '--c-canvas-deep': '#060608',
      '--c-sidebar': '#101013',
      '--c-panel': '#111114',
      '--c-panel-2': '#0e0e11',
      '--c-surface': '#151518',
      '--c-surface-2': '#1a1a1e',
      '--c-surface-3': '#202025',
      '--c-ink': '#d8d8dc',
      '--c-muted': '#929299',
      '--c-faint': '#6c6c74',
      '--c-line': '#242429',
      '--c-line-strong': '#35353c',
      '--c-accent': '#c2c2cb',
      '--c-accent-soft': '#202027',
      '--c-accent-ink': '#e6e6ec',
      '--c-gold': '#d9ccb0',
      '--c-gold-soft': '#2a261d',
      '--c-positive': '#84c9a4',
      '--c-warn': '#dfba7d',
      '--c-danger': '#e08d80',
      '--c-ink-button': '#d8d8dc',
      '--c-on-ink': '#09090b',
      '--c-identity-a': '#d59a82',
      '--c-identity-b': '#93b6d8'
    }
  },
  {
    id: 'bee',
    label: 'Bee',
    description: 'SelfImpulse’s working warmth: smoked olive, honey gold, quiet amber.',
    kind: 'dark',
    tokens: {
      ...base,
      '--c-canvas': '#12100b',
      '--c-canvas-deep': '#0d0b07',
      '--c-sidebar': '#19160f',
      '--c-panel': '#1a1710',
      '--c-panel-2': '#16130c',
      '--c-surface': '#1e1a12',
      '--c-surface-2': '#241f15',
      '--c-surface-3': '#2b2518',
      '--c-ink': '#ece4d2',
      '--c-muted': '#b3a78b',
      '--c-faint': '#85795f',
      '--c-line': '#30291c',
      '--c-line-strong': '#423925',
      '--c-accent': '#e0c65c',
      '--c-accent-soft': '#332b13',
      '--c-accent-ink': '#f0da78',
      '--c-gold': '#f0da78',
      '--c-gold-soft': '#3a331a',
      '--c-positive': '#a9c97e',
      '--c-warn': '#e2a95f',
      '--c-danger': '#de7f6a',
      '--c-ink-button': '#ece4d2',
      '--c-on-ink': '#221b07',
      '--c-identity-a': '#e0c65c',
      '--c-identity-b': '#a3b9a2'
    }
  },
  {
    id: 'pulsidian',
    label: 'Pulsidian',
    description: 'Bone paper and pine ink, cut by a single pulse of lime.',
    kind: 'light',
    tokens: {
      ...base,
      '--c-canvas': '#f4f3ec',
      '--c-canvas-deep': '#ebeae1',
      '--c-sidebar': '#edede3',
      '--c-panel': '#f9f8f2',
      '--c-panel-2': '#f1f0e8',
      '--c-surface': '#fbfaf5',
      '--c-surface-2': '#efeee5',
      '--c-surface-3': '#e6e5da',
      '--c-ink': '#0e1812',
      '--c-muted': '#59645b',
      '--c-faint': '#7e887f',
      '--c-line': 'rgba(14, 24, 18, 0.11)',
      '--c-line-strong': 'rgba(14, 24, 18, 0.2)',
      '--c-accent': '#bed73c',
      '--c-accent-soft': '#e8efc9',
      '--c-accent-ink': '#3e4a0d',
      '--c-gold': '#7c6100',
      '--c-gold-soft': '#efe8c9',
      '--c-positive': '#377440',
      '--c-warn': '#986b00',
      '--c-danger': '#a63a2a',
      '--c-ink-button': '#0e1812',
      '--c-on-ink': '#f4f3ec',
      '--c-identity-a': '#b34a2b',
      '--c-identity-b': '#3d7067'
    }
  },
  {
    id: 'patina',
    label: 'Patina',
    description: 'Mineral paper, verdigris ink, and the calm of weathered metal.',
    kind: 'light',
    tokens: {
      ...base,
      '--c-canvas': '#eff2ec',
      '--c-canvas-deep': '#e5eae2',
      '--c-sidebar': '#e8ece5',
      '--c-panel': '#f5f7f1',
      '--c-panel-2': '#edf1e9',
      '--c-surface': '#f8faf4',
      '--c-surface-2': '#eaf0e7',
      '--c-surface-3': '#e0e7dd',
      '--c-ink': '#10201d',
      '--c-muted': '#52635e',
      '--c-faint': '#768781',
      '--c-line': 'rgba(16, 32, 29, 0.11)',
      '--c-line-strong': 'rgba(16, 32, 29, 0.2)',
      '--c-accent': '#3d7067',
      '--c-accent-soft': '#d8e5e0',
      '--c-accent-ink': '#2a564f',
      '--c-gold': '#8b6b2e',
      '--c-gold-soft': '#ede7d4',
      '--c-positive': '#3d7067',
      '--c-warn': '#8f6a1e',
      '--c-danger': '#a53f2e',
      '--c-ink-button': '#10201d',
      '--c-on-ink': '#eff2ec',
      '--c-identity-a': '#3d7067',
      '--c-identity-b': '#7d9690'
    }
  },
  {
    id: 'celadon',
    label: 'Celadon',
    description: 'Cloud ivory and midnight jade, glazed with agent green.',
    kind: 'light',
    tokens: {
      ...base,
      '--c-canvas': '#f2f1ea',
      '--c-canvas-deep': '#e8e7de',
      '--c-sidebar': '#eaeae0',
      '--c-panel': '#f7f6ef',
      '--c-panel-2': '#efeee6',
      '--c-surface': '#faf9f3',
      '--c-surface-2': '#edece4',
      '--c-surface-3': '#e3e2d9',
      '--c-ink': '#0d2b21',
      '--c-muted': '#4f645b',
      '--c-faint': '#74877e',
      '--c-line': 'rgba(13, 43, 33, 0.11)',
      '--c-line-strong': 'rgba(13, 43, 33, 0.2)',
      '--c-accent': '#377440',
      '--c-accent-soft': '#dce9db',
      '--c-accent-ink': '#21542b',
      '--c-gold': '#86672d',
      '--c-gold-soft': '#eee7cf',
      '--c-positive': '#377440',
      '--c-warn': '#93680f',
      '--c-danger': '#a43b2c',
      '--c-ink-button': '#0d2b21',
      '--c-on-ink': '#f2f1ea',
      '--c-identity-a': '#377440',
      '--c-identity-b': '#7d9690'
    }
  },
  {
    id: 'heliodor',
    label: 'Heliodor',
    description: 'Wax paper and espresso ink, warmed by solar ochre and clay.',
    kind: 'light',
    tokens: {
      ...base,
      '--c-canvas': '#f6eedd',
      '--c-canvas-deep': '#eee3ce',
      '--c-sidebar': '#f0e7d5',
      '--c-panel': '#faf4e5',
      '--c-panel-2': '#f4ebd9',
      '--c-surface': '#fcf7eb',
      '--c-surface-2': '#f1e8d6',
      '--c-surface-3': '#e9dcc4',
      '--c-ink': '#211711',
      '--c-muted': '#67564a',
      '--c-faint': '#8c7b6c',
      '--c-line': 'rgba(33, 23, 17, 0.11)',
      '--c-line-strong': 'rgba(33, 23, 17, 0.2)',
      '--c-accent': '#d7932b',
      '--c-accent-soft': '#f3e3c4',
      '--c-accent-ink': '#8a5310',
      '--c-gold': '#b34a2b',
      '--c-gold-soft': '#f2dccf',
      '--c-positive': '#5e7a3a',
      '--c-warn': '#a76a10',
      '--c-danger': '#b34a2b',
      '--c-ink-button': '#211711',
      '--c-on-ink': '#f6eedd',
      '--c-identity-a': '#b34a2b',
      '--c-identity-b': '#d7932b'
    }
  },
  {
    id: 'moon',
    label: 'Moon',
    description: 'The exclusive night: deepest black, a breath of moon glow, soft moon-white type.',
    kind: 'dark',
    exclusive: true,
    tokens: {
      ...base,
      '--c-canvas': '#050506',
      '--c-canvas-deep': '#020203',
      '--c-sidebar': '#070709',
      '--c-panel': '#060608',
      '--c-panel-2': '#050507',
      '--c-surface': '#0a0a0d',
      '--c-surface-2': '#0f0f14',
      '--c-surface-3': '#14141a',
      '--c-ink': '#e6e4de',
      '--c-muted': '#9b99a2',
      '--c-faint': '#6d6b75',
      '--c-line': '#19191f',
      '--c-line-strong': '#282831',
      '--c-accent': '#c7c4e8',
      '--c-accent-soft': '#16161f',
      '--c-accent-ink': '#dedcf2',
      '--c-gold': '#d8cfae',
      '--c-gold-soft': '#242017',
      '--c-positive': '#93c7b0',
      '--c-warn': '#d9b98a',
      '--c-danger': '#d9908a',
      '--c-ink-button': '#e6e4de',
      '--c-on-ink': '#08080a',
      '--c-identity-a': '#b7a6d9',
      '--c-identity-b': '#8fb7cf'
    }
  },
  {
    id: 'afterimage',
    label: 'Afterimage',
    description: 'What the eye keeps after the light goes: warm paper, plum shadow, a rose that refuses to fade.',
    kind: 'light',
    tokens: lightPalette('#F5EFEA', '#1F151A', '#C27483')
  },
  {
    id: 'resin',
    label: 'Resin',
    description: 'Amber hardened in old paper. Slow, viscous, patient gold.',
    kind: 'light',
    tokens: lightPalette('#F4F0E3', '#1D180F', '#AF7F24')
  },
  {
    id: 'xanadu',
    label: 'Xanadu',
    description: 'A pleasure-dome of pale green and deep pine, with one thread of jade.',
    kind: 'light',
    tokens: lightPalette('#EFF1E9', '#141C18', '#718D79')
  },
  {
    id: 'wenge',
    label: 'Wenge',
    description: 'Tropical timber, cut and oiled: tawny grain against near-black heartwood.',
    kind: 'light',
    tokens: lightPalette('#F0E6DC', '#211817', '#A87B61')
  },
  {
    id: 'glaucous',
    label: 'Glaucous',
    description: 'Sea-fog blue over slate. The colour of a horizon seen through salt.',
    kind: 'light',
    tokens: lightPalette('#E9EEEA', '#121B1F', '#6B8D97')
  },
  {
    id: 'cinnabar-light',
    label: 'Cinnabar',
    description: 'Warm porcelain and umber carbon, cut by decisive mineral red.',
    kind: 'light',
    tokens: distinctLightPalette('#F5F1EA', '#140C0A', '#D1553B')
  },
  {
    id: 'cinnabar-dark',
    label: 'Cinnabar',
    description: 'Umber carbon and warm porcelain, with confident vermilion signals.',
    kind: 'dark',
    tokens: distinctDarkPalette('#F5F1EA', '#140C0A', '#D1553B')
  },
  {
    id: 'viridian-light',
    label: 'Viridian',
    description: 'Cool mineral mist and forest carbon, energized by true living green.',
    kind: 'light',
    tokens: distinctLightPalette('#EDF2EE', '#050D09', '#218F6A')
  },
  {
    id: 'viridian-dark',
    label: 'Viridian',
    description: 'Forest carbon and cool mist, with precise operational green signals.',
    kind: 'dark',
    tokens: distinctDarkPalette('#EDF2EE', '#050D09', '#218F6A')
  },
  {
    id: 'sulfur-light',
    label: 'Sulfur',
    description: 'Pale lichen and carbon olive, marked by unconventional dry yellow.',
    kind: 'light',
    tokens: distinctLightPalette('#F0F0E4', '#12130D', '#8F8B2D')
  },
  {
    id: 'sulfur-dark',
    label: 'Sulfur',
    description: 'Carbon olive and pale lichen, with kinetic sulfur signals.',
    kind: 'dark',
    tokens: distinctDarkPalette('#F0F0E4', '#12130D', '#8F8B2D')
  },
  {
    id: 'glacial-light',
    label: 'Glacial',
    description: 'Ice veil and graphite tide, clarified by analytical cyan.',
    kind: 'light',
    tokens: distinctLightPalette('#E8F0F2', '#0E161B', '#4E8FA9')
  },
  {
    id: 'glacial-dark',
    label: 'Glacial',
    description: 'Blue graphite and ice veil, with crisp glacial-cyan signals.',
    kind: 'dark',
    tokens: distinctDarkPalette('#E8F0F2', '#0E161B', '#4E8FA9')
  },
  {
    id: 'quartz-light',
    label: 'Quartz',
    description: 'Mineral lavender and deep aubergine, softened by orchid signals.',
    kind: 'light',
    tokens: distinctLightPalette('#F0EAF2', '#120B13', '#A875B2')
  },
  {
    id: 'quartz-dark',
    label: 'Quartz',
    description: 'Deep aubergine and mineral lavender, with luminous quartz signals.',
    kind: 'dark',
    tokens: distinctDarkPalette('#F0EAF2', '#120B13', '#A875B2')
  },
  atelierTheme(
    'nocturne-light',
    'Nocturne Iron',
    'Warm Paper and oxidized iron slate: a quiet mineral signature for individual work.',
    'light',
    'solo',
    { canvas: '#FFFBF5', surface: '#E8EDF1', ink: '#0A0A0A', signal: '#5C6B7A' }
  ),
  {
    ...atelierTheme(
      'nocturne-dark',
      'Nocturne Iron',
      'True Void, mineral iron, and a cool light tuned for focused night work.',
      'dark',
      'solo',
      { canvas: '#07070A', surface: '#2F3640', ink: '#F5F5F7', signal: '#5C6B7A' }
    ),
    tokens: {
      ...atelierPalette('dark', {
        canvas: '#07070A',
        surface: '#2F3640',
        ink: '#F5F5F7',
        signal: '#5C6B7A'
      }),
      '--c-accent-ink': '#A8B4C0',
      '--c-identity-b': '#A8B4C0'
    }
  },
  atelierTheme(
    'atelier-studio',
    'Studio',
    'Paper White, Gallery Fog, and Apple Ink for the most minimal solo workspace.',
    'light',
    'solo',
    { canvas: '#F5F5F7', surface: '#E8E8ED', ink: '#1D1D1F', signal: '#1D1D1F' }
  ),
  atelierTheme(
    'atelier-harbor',
    'Harbor',
    'Harbor Mist and muted coastal blue for clear operational teamwork.',
    'light',
    'teams',
    { canvas: '#F2F7FB', surface: '#DCE6F0', ink: '#0F1E2E', signal: '#2F5A94' }
  ),
  atelierTheme(
    'atelier-meadow',
    'Meadow',
    'Sage Paper and Forest Ink for calm, long-running collaborative focus.',
    'light',
    'teams',
    { canvas: '#F4F7F2', surface: '#D8E2D6', ink: '#132019', signal: '#3A6B4A' }
  ),
  atelierTheme(
    'atelier-sand',
    'Sand',
    'Parchment, Sand Haze, and stone accents for editorial solo work.',
    'light',
    'solo',
    { canvas: '#FDF8F0', surface: '#E9DDC2', ink: '#211E1A', signal: '#8B6F47' }
  ),
  atelierTheme(
    'atelier-dune',
    'Dune',
    'Lavender Paper and muted violet for thoughtful individual creative work.',
    'light',
    'solo',
    { canvas: '#F6F3FA', surface: '#E6E0F1', ink: '#1E1A2A', signal: '#6B5B8A' }
  ),
  atelierTheme(
    'atelier-eclipse',
    'Eclipse',
    'Zinc Black and off-white type: a neutral, precise solo dark room.',
    'dark',
    'solo',
    { canvas: '#09090B', surface: '#1C1C1E', ink: '#FAFAFA', signal: '#A1A1AA' }
  ),
  atelierTheme(
    'atelier-midnight',
    'Midnight',
    'Navy Black and Harbor Glint for coordinated operations after dark.',
    'dark',
    'teams',
    { canvas: '#0A0F1A', surface: '#1B2436', ink: '#E8EDF5', signal: '#7A8BB3' }
  ),
  atelierTheme(
    'atelier-forest',
    'Forest',
    'Forest Void and sage signals for calm multi-agent execution.',
    'dark',
    'teams',
    { canvas: '#0A1410', surface: '#1B2A20', ink: '#EAF0E8', signal: '#7A9B8A' }
  ),
  atelierTheme(
    'atelier-plum',
    'Plum',
    'Aubergine Black and muted plum for creative teams and review rooms.',
    'dark',
    'teams',
    { canvas: '#120F14', surface: '#241E26', ink: '#F5F0F7', signal: '#9A8BA8' }
  ),
  atelierTheme(
    'atelier-void',
    'Void',
    'The deepest OLED canvas with a single specular edge for spatial solo focus.',
    'dark',
    'solo',
    { canvas: '#07070A', surface: '#13151A', ink: '#F5F7FB', signal: '#9CA3AF' }
  )
]

const TEAM_THEME_IDS = new Set<ThemeId>([
  'bee',
  'xanadu',
  'glaucous',
  'viridian-light',
  'viridian-dark',
  'glacial-light',
  'glacial-dark'
])

export function themeCollection(id: ThemeId): ThemeCollection {
  const explicit = themeById(id).collection
  if (explicit) return explicit
  return TEAM_THEME_IDS.has(id) ? 'teams' : 'solo'
}

export const ATELIER_THEME_IDS = THEMES.filter((theme) => theme.origin === 'atelier').map(
  (theme) => theme.id
)

export const DEFAULT_THEME: ThemeId = 'moonlight'
const STORAGE_KEY = 'knight.theme'

export function themeById(id: ThemeId): Theme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0]
}

export function readStoredTheme(): ThemeId {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY) as ThemeId | null
    if (stored && THEMES.some((theme) => theme.id === stored)) return stored
  } catch {
    /* storage is optional */
  }
  return DEFAULT_THEME
}

let paintTimer: number | undefined

function paint(id: ThemeId, animate: boolean): void {
  const root = document.documentElement
  const theme = themeById(id)
  root.dataset.theme = id
  root.dataset.collection = themeCollection(id)
  for (const [token, value] of Object.entries(theme.tokens)) {
    if (value) root.style.setProperty(token, value)
  }
  root.style.colorScheme = theme.kind
  if (paintTimer !== undefined) window.clearTimeout(paintTimer)
  if (!animate) {
    root.classList.remove('theme-switching')
    return
  }
  root.classList.add('theme-switching')
  paintTimer = window.setTimeout(() => root.classList.remove('theme-switching'), 380)
}

export function applyTheme(id: ThemeId, animate = true): void {
  paint(id, animate)
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch {
    /* storage is optional */
  }
}

export function initTheme(): void {
  paint(readStoredTheme(), false)
}

interface ThemeStore {
  themeId: ThemeId
  setTheme: (id: ThemeId) => void
}

export const useTheme = create<ThemeStore>((set) => ({
  themeId: typeof document === 'undefined' ? DEFAULT_THEME : readStoredTheme(),
  setTheme: (id) => {
    applyTheme(id)
    set({ themeId: id })
  }
}))
