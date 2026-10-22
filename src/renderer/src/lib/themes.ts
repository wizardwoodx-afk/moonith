import { create } from 'zustand'

export type ThemeId =
  | 'moonlight'
  | 'bee'
  | 'pulsidian'
  | 'patina'
  | 'celadon'
  | 'heliodor'
  | 'moon'

export type ThemeKind = 'dark' | 'light'

export interface Theme {
  id: ThemeId
  label: string
  description: string
  kind: ThemeKind
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

export const THEMES: Theme[] = [
  {
    id: 'moonlight',
    label: 'Moonlight',
    description: 'Knight’s monochrome night: black glass, silver type, one cool light.',
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
    description: 'Knight’s working warmth: smoked olive, honey gold, quiet amber.',
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
  }
]

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

function paint(id: ThemeId, animate: boolean): void {
  const root = document.documentElement
  root.dataset.theme = id
  if (!animate) return
  root.classList.add('theme-switching')
  window.setTimeout(() => root.classList.remove('theme-switching'), 380)
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
