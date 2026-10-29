import { promises as nodeFs } from 'node:fs'
import { join } from 'node:path'
import { isWithin } from './security'

/**
 * The `knight-file:` scheme hands a task's own workspace folder to the renderer.
 * Everything that decides *whether a byte is returned* lives here, away from
 * Electron, so containment and CORS are testable in plain Node
 * (`src/main/protocol.test.ts`) while `src/main/index.ts` only wires the handler
 * to the real store, paths and MIME table.
 */

/** The structural slice of Electron's `Request` this handler actually reads. */
export interface KnightFileRequest {
  url: string
  headers?: { get: (name: string) => string | null }
}

export interface KnightFileDeps {
  /** Existence check for the task id — the only authorisation the scheme has. */
  taskExists: (taskId: string) => boolean
  /** The workspace root granted to that task. */
  workspaceFor: (taskId: string) => string
  /** Extension → MIME, injected so this module never pulls `electron` in. */
  mimeTypeFor: (filePath: string) => string | undefined
  /**
   * The exact `Origin` values allowed to read responses cross-origin. A function
   * because the dev-server origin is only known once the app has one.
   */
  allowedOrigins: () => readonly string[]
  realpath?: (filePath: string) => Promise<string>
  readFile?: (filePath: string) => Promise<Uint8Array>
}

export type Containment =
  | { readonly ok: true; readonly realPath: string }
  | { readonly ok: false; readonly reason: 'escaped' | 'missing' }

/**
 * Scheme privileges for `protocol.registerSchemesAsPrivileged`.
 *
 * `corsEnabled` has to stay: the renderer's text/code preview
 * (`src/renderer/src/components/Artifacts.tsx#PreviewBody`) reads the artifact
 * with `fetch()`, and Blink refuses a cross-origin fetch to a scheme that does
 * not support CORS before it ever looks at the response headers — so dropping it
 * would break preview, not close the hole.
 *
 * What closed the hole was the wildcard `access-control-allow-origin: '*'`, and
 * that is gone: `pinnedCorsOrigin` now names at most one of the app's own
 * origins, so no web origin can read another task's files by guessing a task id.
 */
export const KNIGHT_FILE_PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  corsEnabled: true,
  stream: true
} as const

/**
 * Containment, decided on **resolved** paths only.
 *
 * Comparing the unresolved pair is what let a symlink planted inside a task
 * workspace read anything the app can reach: `link -> ~/.ssh/id_rsa` sits inside
 * the root lexically while its real path does not. There is deliberately no
 * fallback to the unresolved comparison — if a real path cannot be taken, the
 * request is refused rather than judged on the path the attacker wrote.
 */
export async function resolveContainedPath(
  workspace: string,
  target: string,
  realpath: (filePath: string) => Promise<string> = (path) => nodeFs.realpath(path)
): Promise<Containment> {
  let realRoot: string
  try {
    realRoot = await realpath(workspace)
  } catch {
    // No resolvable root means nothing is granted under it.
    return { ok: false, reason: 'missing' }
  }

  let realTarget: string
  try {
    realTarget = await realpath(target)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code
    // A missing file is a 404; a path we cannot resolve (permissions, a link
    // into a protected tree) is refused. Neither is ever judged unresolved.
    return { ok: false, reason: code === 'ENOENT' ? 'missing' : 'escaped' }
  }

  if (!isWithin(realRoot, realTarget)) return { ok: false, reason: 'escaped' }
  return { ok: true, realPath: realTarget }
}

/**
 * The CORS answer for one request: the request's own origin, but only when it
 * exactly names one of the app's origins. Never `*`, and a `*` that somehow
 * entered the allow-list is ignored rather than echoed, so the wildcard cannot
 * come back by configuration.
 */
export function pinnedCorsOrigin(
  request: KnightFileRequest,
  allowed: readonly string[]
): string | null {
  const origin = request.headers?.get('origin') ?? null
  if (!origin || origin === '*') return null
  return allowed.some((entry) => entry !== '*' && entry === origin) ? origin : null
}

/**
 * Encoded traversal is refused on the decoded segment, before any path is built.
 * The URL parser already drops `..` segments it can see (`../` and `%2e%2e`), so
 * what is left to catch here is traversal hidden behind an encoded separator —
 * `sub%2F..%2F..%2Fsecrets%2Fid_rsa` decodes to one segment that walks out of the
 * workspace. Everything else about decoding stays exactly as it was: a malformed
 * `%` still throws into the 404 below, and a legitimate name is untouched.
 */
function isUnsafeSegment(segment: string): boolean {
  if (segment.includes('\0')) return true
  return segment.split(/[/\\]/).some((part) => part === '..')
}

/**
 * The only origins `knight-file:` answers to cross-origin. The scheme needs CORS
 * because the artifact preview reads text and code with `fetch()`
 * (`src/renderer/src/components/Artifacts.tsx#PreviewBody`), so the answer is
 * pinned to the app's own document rather than the wildcard that used to greet
 * every origin:
 *
 *   - With a dev server, its origin is the only one the window is served from.
 *   - Packaged, the window is `loadFile()`-served and a `file:` document reports
 *     itself as the opaque origin `null` (`file://` is the other serialisation
 *     Chromium gives it). Both name this app's own document.
 *
 * A real web origin — a site in the browser panel's own session, or any page a
 * future feature navigates to — gets no header, which is what kills "guess a task
 * id from any page and read its files". `null` is admitted only when no dev
 * server is running, so it can only ever name the app's own `file:` document.
 */
export function knightFileAllowedOrigins(devRendererUrl?: string): string[] {
  if (devRendererUrl) {
    try {
      return [new URL(devRendererUrl).origin]
    } catch {
      // A malformed dev URL must not widen the origin list.
    }
  }
  return ['null', 'file://']
}

export async function handleKnightFileRequest(
  request: KnightFileRequest,
  deps: KnightFileDeps
): Promise<Response> {
  try {
    const url = new URL(request.url)
    const segments = url.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment))
    const taskId = segments.shift()
    if (!taskId || !deps.taskExists(taskId)) {
      return new Response('Not found', { status: 404 })
    }
    if (segments.some(isUnsafeSegment)) {
      return new Response('Forbidden', { status: 403 })
    }

    const workspace = deps.workspaceFor(taskId)
    const target = join(workspace, ...segments)
    const realpath = deps.realpath ?? ((path: string) => nodeFs.realpath(path))
    const contained = await resolveContainedPath(workspace, target, realpath)
    if (!contained.ok) {
      return contained.reason === 'escaped'
        ? new Response('Forbidden', { status: 403 })
        : new Response('Not found', { status: 404 })
    }

    const readFile = deps.readFile ?? ((path: string) => nodeFs.readFile(path))
    const data = await readFile(contained.realPath)
    const mime = deps.mimeTypeFor(contained.realPath) ?? 'application/octet-stream'
    const headers: Record<string, string> = {
      'content-type': mime,
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store'
    }
    const origin = pinnedCorsOrigin(request, deps.allowedOrigins())
    if (origin) {
      headers['access-control-allow-origin'] = origin
      headers.vary = 'Origin'
    }
    if (mime === 'text/html') {
      headers['content-security-policy'] =
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"
    }
    return new Response(new Uint8Array(data), { headers })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
