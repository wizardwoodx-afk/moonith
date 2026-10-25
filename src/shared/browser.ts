import type { BrowserSettings } from './types'

export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = {
  engine: 'stagehand',
  headless: true
}

/** Normalize untrusted persisted JSON without carrying unknown fields forward. */
export function normalizeBrowserSettings(value: unknown): BrowserSettings {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return {
    engine: input.engine === 'chromium' ? 'chromium' : 'stagehand',
    headless: input.headless !== false
  }
}
