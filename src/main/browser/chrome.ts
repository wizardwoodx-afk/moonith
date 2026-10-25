import { constants } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { BrowserError } from './errors'

export interface DevToolsEndpoint {
  httpUrl: string
  webSocketUrl: string
}

export function chromeCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): string[] {
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ]
  }
  if (platform === 'win32') {
    const roots = [
      env.LOCALAPPDATA,
      env.PROGRAMFILES,
      env['PROGRAMFILES(X86)'],
      env.PROGRAMW6432
    ].filter((value): value is string => Boolean(value))
    return roots.flatMap((root) => [
      join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(root, 'Google', 'Chrome SxS', 'Application', 'chrome.exe')
    ])
  }
  if (platform === 'linux') {
    const directories = (env.PATH ?? '').split(delimiter).filter(Boolean)
    return ['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium'].flatMap(
      (name) => directories.map((directory) => join(directory, name))
    )
  }
  return []
}

async function executable(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    if (!info.isFile()) return false
    if (process.platform !== 'win32') await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Resolve a local browser without returning environment variables or credentials. */
export async function findChromeExecutable(): Promise<string> {
  const configured = process.env.CHROME_PATH?.trim()
  if (configured) {
    if (await executable(configured)) return configured
    throw new BrowserError(
      'BROWSER_UNAVAILABLE',
      'CHROME_PATH does not point to an executable Chrome browser. Fix it or choose Built-in Chromium in Settings → Browser.'
    )
  }
  for (const candidate of chromeCandidates(process.platform, process.env)) {
    if (await executable(candidate)) return candidate
  }
  throw new BrowserError(
    'BROWSER_UNAVAILABLE',
    'Stagehand needs Google Chrome or Chromium on this device. Install Chrome, or choose Built-in Chromium in Settings → Browser.'
  )
}

export function assertStagehandSandboxSupported(): void {
  if (process.platform === 'linux' && process.getuid?.() === 0) {
    throw new BrowserError(
      'BROWSER_UNAVAILABLE',
      'Stagehand will not launch Chrome without its OS sandbox when running as root. Use Built-in Chromium or run SelfImpulse as a standard user.'
    )
  }
  // Stagehand 4.3 disables Chromium's sandbox whenever CI is set. Fail closed
  // instead of silently weakening a product security boundary.
  if (process.env.CI) {
    throw new BrowserError(
      'BROWSER_UNAVAILABLE',
      'Stagehand is unavailable in CI because its launcher disables the Chromium sandbox there. Use Built-in Chromium for this environment.'
    )
  }
}

export function parseDevToolsActivePort(raw: string): DevToolsEndpoint {
  const [portText, socketPath] = raw.trim().split(/\r?\n/)
  const port = Number(portText)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new BrowserError('BROWSER_UNAVAILABLE', 'Chrome reported an invalid private debugging endpoint.')
  }
  if (!socketPath?.startsWith('/devtools/browser/')) {
    throw new BrowserError('BROWSER_UNAVAILABLE', 'Chrome reported an invalid private debugging target.')
  }
  return {
    httpUrl: `http://127.0.0.1:${port}`,
    webSocketUrl: `ws://127.0.0.1:${port}${socketPath}`
  }
}

export async function readDevToolsEndpoint(profileDir: string): Promise<DevToolsEndpoint> {
  try {
    return parseDevToolsActivePort(await readFile(join(profileDir, 'DevToolsActivePort'), 'utf8'))
  } catch (error) {
    if (error instanceof BrowserError) throw error
    throw new BrowserError(
      'BROWSER_UNAVAILABLE',
      'Chrome started without a readable private control channel. Reopen the browser or use Built-in Chromium.',
      { cause: error }
    )
  }
}
