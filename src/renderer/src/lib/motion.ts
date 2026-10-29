import { create } from 'zustand'

export type MotionPreference = 'full' | 'reduced' | 'system'
export type ResolvedMotion = 'full' | 'reduced'

const STORAGE_KEY = 'selfimpulse.motion'
const LEGACY_STORAGE_KEY = 'knight.motion'

export const DEFAULT_MOTION_PREFERENCE: MotionPreference = 'full'

export const MOTION_PREFERENCES: {
  value: MotionPreference
  label: string
  detail: string
}[] = [
  {
    value: 'full',
    label: 'Full',
    detail: 'Everything moves. Loaders spin, panels spring, text shimmers.'
  },
  {
    value: 'reduced',
    label: 'Reduced',
    detail: 'Decoration stops. The working loaders keep moving so you can still see that work is in flight.'
  },
  {
    value: 'system',
    label: 'System',
    detail: 'Follow the reduce-motion setting your operating system reports.'
  }
]

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * The operating system's own answer, kept aside before anything overrides it.
 * Only the "follow the system" preference consults it.
 */
const nativeMatchMedia: typeof window.matchMedia | null =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia.bind(window)
    : null

function systemPrefersReduced(): boolean {
  try {
    return nativeMatchMedia?.(REDUCED_MOTION_QUERY).matches ?? false
  } catch {
    return false
  }
}

export function readStoredMotion(): MotionPreference {
  try {
    const stored = (window.localStorage.getItem(STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_STORAGE_KEY)) as MotionPreference | null
    if (stored === 'full' || stored === 'reduced' || stored === 'system') return stored
  } catch {
    /* storage is optional */
  }
  return DEFAULT_MOTION_PREFERENCE
}

export function resolveMotion(preference: MotionPreference): ResolvedMotion {
  if (preference === 'system') return systemPrefersReduced() ? 'reduced' : 'full'
  return preference
}

/**
 * The resolved mode is published on the document so the stylesheet can act on
 * it. CSS cannot ask "is this motion essential" on its own, so the escape
 * hatch stays an attribute on the element and the mode stays an attribute on
 * the root.
 */
export function paintMotion(resolved: ResolvedMotion): void {
  document.documentElement.dataset.motionMode = resolved
}

type ReducedListener = (event: MediaQueryListEvent) => void

const reducedListeners = new Set<ReducedListener>()

/**
 * Third-party renderers ask the operating system directly whether they should
 * freeze themselves, which would override a mode the person picked on purpose.
 * The answer they get is the app's resolved mode instead: the machine only
 * gets a say when the person asked to follow it.
 */
function reducedMotionList(): MediaQueryList {
  const list = {
    media: REDUCED_MOTION_QUERY,
    onchange: null,
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'change') reducedListeners.add(listener as ReducedListener)
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'change') reducedListeners.delete(listener as ReducedListener)
    },
    addListener: (listener: (event: MediaQueryListEvent) => void) => {
      reducedListeners.add(listener)
    },
    removeListener: (listener: (event: MediaQueryListEvent) => void) => {
      reducedListeners.delete(listener)
    },
    dispatchEvent: () => true
  } as unknown as MediaQueryList
  Object.defineProperty(list, 'matches', {
    get: () => useMotion.getState().resolved === 'reduced',
    enumerable: true
  })
  return list
}

/**
 * Routes the reduced-motion media query through the app's own setting. Every
 * other query keeps the browser's answer.
 */
export function installMotionMediaQuery(): void {
  if (typeof window === 'undefined' || !nativeMatchMedia) return
  const passthrough = nativeMatchMedia
  window.matchMedia = ((query: string) =>
    query.includes('prefers-reduced-motion') ? reducedMotionList() : passthrough(query)) as typeof window.matchMedia
}

function notifyReducedMotion(): void {
  const event = {
    matches: useMotion.getState().resolved === 'reduced',
    media: REDUCED_MOTION_QUERY
  } as MediaQueryListEvent
  for (const listener of reducedListeners) {
    try {
      listener(event)
    } catch {
      /* a listener must not break the switch */
    }
  }
}

interface MotionStore {
  preference: MotionPreference
  resolved: ResolvedMotion
  setPreference: (preference: MotionPreference) => void
}

const initialPreference =
  typeof document === 'undefined' ? DEFAULT_MOTION_PREFERENCE : readStoredMotion()

export const useMotion = create<MotionStore>((set) => ({
  preference: initialPreference,
  resolved: resolveMotion(initialPreference),
  setPreference: (preference) => {
    const resolved = resolveMotion(preference)
    paintMotion(resolved)
    try {
      window.localStorage.setItem(STORAGE_KEY, preference)
    } catch {
      /* storage is optional */
    }
    set({ preference, resolved })
    notifyReducedMotion()
  }
}))

export function initMotion(): void {
  installMotionMediaQuery()
  paintMotion(useMotion.getState().resolved)
  try {
    nativeMatchMedia
      ?.(REDUCED_MOTION_QUERY)
      .addEventListener('change', () => {
        if (useMotion.getState().preference !== 'system') return
        const resolved = resolveMotion('system')
        paintMotion(resolved)
        useMotion.setState({ resolved })
        notifyReducedMotion()
      })
  } catch {
    /* the media query is optional */
  }
}
