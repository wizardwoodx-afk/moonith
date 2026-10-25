import { describe, expect, it } from 'vitest'
import { DEFAULT_BROWSER_SETTINGS, normalizeBrowserSettings } from './browser'

describe('browser settings normalization', () => {
  it('defaults missing or corrupt persisted values to headless Stagehand', () => {
    expect(normalizeBrowserSettings(undefined)).toEqual(DEFAULT_BROWSER_SETTINGS)
    expect(normalizeBrowserSettings(null)).toEqual(DEFAULT_BROWSER_SETTINGS)
    expect(normalizeBrowserSettings('chromium')).toEqual(DEFAULT_BROWSER_SETTINGS)
    expect(normalizeBrowserSettings({ engine: 'other', headless: 'no' })).toEqual(DEFAULT_BROWSER_SETTINGS)
  })

  it('keeps only the supported engine and explicit headless preference', () => {
    expect(normalizeBrowserSettings({ engine: 'chromium', headless: false, executablePath: 'ignored' })).toEqual({
      engine: 'chromium',
      headless: false
    })
  })
})
