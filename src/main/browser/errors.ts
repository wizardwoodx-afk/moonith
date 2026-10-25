import { NavigationBlockError } from '../selfimpulse/coworker/navigation'
import { redactSensitiveText } from '../selfimpulse/governance/dlp'

export function sanitizeBrowserText(message: string): string {
  return redactSensitiveText(message, ['secret', 'api-key']).text
    .replace(/[\r\n]+/g, ' ')
    .replace(/\u0000/g, '')
    .slice(0, 6000)
}

export type BrowserErrorCode =
  | 'BROWSER_UNAVAILABLE'
  | 'BROWSER_AI_UNAVAILABLE'
  | 'BROWSER_MODEL_UNAVAILABLE'
  | 'BROWSER_MODEL_INVALID'
  | 'BROWSER_NAVIGATION_FAILED'
  | 'BROWSER_ACTION_FAILED'
  | 'BROWSER_TIMEOUT'
  | 'BROWSER_CLOSED'
  | 'BROWSER_SECURITY'

/** Operational error with a stable, renderer-safe code and no stack exposure. */
export class BrowserError extends Error {
  constructor(
    readonly code: BrowserErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(sanitizeBrowserText(message), options)
    this.name = 'BrowserError'
  }
}

export function isNavigationBlocked(error: unknown): boolean {
  return error instanceof NavigationBlockError ||
    (error instanceof BrowserError && error.code === 'BROWSER_SECURITY')
}

export function browserErrorMessage(error: unknown): string {
  if (error instanceof BrowserError || error instanceof NavigationBlockError) return error.message
  const raw = error instanceof Error ? error.message : String(error)
  if (/Chrome installation not found|does not exist|ENOENT.*chrome/i.test(raw)) {
    return 'Stagehand needs Google Chrome or Chromium on this device. Install Chrome, or choose Built-in Chromium in Settings → Browser.'
  }
  if (/certificate|ERR_CERT/i.test(raw)) {
    return 'The browser stopped because the site certificate could not be verified. SelfImpulse does not bypass TLS checks.'
  }
  if (/timeout|timed out/i.test(raw)) {
    return 'The browser operation timed out. The page may still be loading; retry once or inspect it with a screenshot.'
  }
  if (/Target closed|Session closed|CDP client is closed|browser.*closed/i.test(raw)) {
    return 'The browser session closed unexpectedly. Reopen the page to start a clean session.'
  }
  return sanitizeBrowserText(raw).slice(0, 800) || 'The browser operation failed.'
}

export function asBrowserError(
  error: unknown,
  code: BrowserErrorCode = 'BROWSER_ACTION_FAILED'
): BrowserError {
  if (error instanceof BrowserError) return error
  if (error instanceof NavigationBlockError) {
    return new BrowserError('BROWSER_SECURITY', error.message, { cause: error })
  }
  return new BrowserError(code, browserErrorMessage(error), { cause: error })
}

export function unavailable(error: unknown): BrowserError {
  return asBrowserError(error, 'BROWSER_UNAVAILABLE')
}
