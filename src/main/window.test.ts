import { describe, expect, it, vi } from 'vitest'

/**
 * Which native signal a waiting approval gets, per window state. The window is
 * the thing that hides the dialog, so the mapping from "can the user see it" to
 * "what wakes the user up" is the whole fix and it is decided here, away from
 * the tray and the real BrowserWindow that apply it.
 */
vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: class {},
  Menu: { buildFromTemplate: () => ({ popup: () => undefined }) },
  shell: { openExternal: async () => undefined }
}))

import {
  getWindowPresentation,
  isMainWindowFocused,
  planApprovalAttention
} from './window'

const OFF = { tooltipWaiting: false, flash: false, showWindow: false, balloon: false }

function plan(presentation: 'visible' | 'minimized' | 'hidden' | 'none', focused = false) {
  return planApprovalAttention({ hasPendingApproval: true, presentation, focused })
}

describe('planApprovalAttention', () => {
  it('signals nothing once the decision is answered, in every window state', () => {
    for (const presentation of ['visible', 'minimized', 'hidden', 'none'] as const) {
      for (const focused of [false, true]) {
        expect(
          planApprovalAttention({ hasPendingApproval: false, presentation, focused })
        ).toEqual(OFF)
      }
    }
  })

  it('drops the signal when the window is back in the foreground', () => {
    expect(plan('visible', true)).toEqual(OFF)
  })

  it('flashes a window that is on screen but behind another app', () => {
    expect(plan('visible', false)).toEqual({
      tooltipWaiting: true,
      flash: true,
      showWindow: false,
      balloon: false
    })
  })

  it('brings the window back when the app was closed to the tray', () => {
    expect(plan('hidden')).toEqual({
      tooltipWaiting: true,
      flash: true,
      showWindow: true,
      balloon: false
    })
  })

  it('leaves a minimized window alone and speaks through the tray', () => {
    expect(plan('minimized')).toEqual({
      tooltipWaiting: true,
      flash: true,
      showWindow: false,
      balloon: true
    })
  })

  it('relies on the tray when there is no window at all', () => {
    expect(plan('none')).toEqual({
      tooltipWaiting: true,
      flash: false,
      showWindow: false,
      balloon: true
    })
  })
})

describe('window presentation without a window', () => {
  it('reports the main window as absent rather than throwing', () => {
    expect(getWindowPresentation()).toBe('none')
    expect(isMainWindowFocused()).toBe(false)
  })
})
