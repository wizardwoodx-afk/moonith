import { afterEach, describe, expect, it, vi } from 'vitest'

type Listener = (event: { matches: boolean; media: string }) => void

interface FakeWindow {
  matchMedia: (query: string) => {
    media: string
    matches: boolean
    addEventListener: (type: string, listener: Listener) => void
    removeEventListener: (type: string, listener: Listener) => void
    addListener: (listener: Listener) => void
    removeListener: (listener: Listener) => void
    dispatchEvent: () => boolean
  }
  localStorage?: Storage
}

/**
 * A browser that reports "reduce motion", which is what a machine with the
 * animation setting off says. The person in front of it never asked for that.
 */
function machineThatPrefersReduced(): { win: FakeWindow; listeners: Listener[] } {
  const listeners: Listener[] = []
  const win: FakeWindow = {
    matchMedia: (query: string) => ({
      media: query,
      matches: true,
      addEventListener: (_type: string, listener: Listener) => listeners.push(listener),
      removeEventListener: () => undefined,
      addListener: (listener: Listener) => listeners.push(listener),
      removeListener: () => undefined,
      dispatchEvent: () => true
    })
  }
  return { win, listeners }
}

const globals = globalThis as unknown as { window?: unknown; document?: unknown }

afterEach(() => {
  delete globals.window
  delete globals.document
})

async function loadMotion(win: FakeWindow) {
  globals.window = win
  globals.document = { documentElement: { dataset: {} as Record<string, string> } }
  vi.resetModules()
  const mod = await import('./motion')
  mod.initMotion()
  return mod
}

describe('motion authority', () => {
  it('keeps the machine out of it when the person did not ask to follow the system', async () => {
    const { win } = machineThatPrefersReduced()
    const mod = await loadMotion(win)

    expect(mod.useMotion.getState().preference).toBe('full')
    expect(mod.useMotion.getState().resolved).toBe('full')
    /* The query a third-party renderer asks now answers with the app's mode. */
    expect(win.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(false)
    expect(win.matchMedia('(prefers-reduced-motion)').matches).toBe(false)
  })

  it('follows the machine when the person asked to follow the system', async () => {
    const { win } = machineThatPrefersReduced()
    const mod = await loadMotion(win)

    mod.useMotion.getState().setPreference('system')
    expect(mod.useMotion.getState().resolved).toBe('reduced')
    expect(win.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true)
  })

  it('reports the change to renderers that already asked', async () => {
    const { win, listeners } = machineThatPrefersReduced()
    const mod = await loadMotion(win)

    const seen: boolean[] = []
    win.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (event) => {
      seen.push(event.matches)
    })

    mod.useMotion.getState().setPreference('reduced')
    expect(seen.at(-1)).toBe(true)

    mod.useMotion.getState().setPreference('full')
    expect(seen.at(-1)).toBe(false)
    expect(listeners.length).toBeGreaterThan(0)
  })

  it('leaves every other media query to the browser', async () => {
    const { win } = machineThatPrefersReduced()
    await loadMotion(win)
    expect(win.matchMedia('(pointer: fine)').matches).toBe(true)
  })
})
