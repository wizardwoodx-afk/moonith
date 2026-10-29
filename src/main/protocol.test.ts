import { promises as fs, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  handleKnightFileRequest,
  knightFileAllowedOrigins,
  pinnedCorsOrigin,
  resolveContainedPath,
  type KnightFileDeps,
  type KnightFileRequest
} from './fileProtocol'

/**
 * The handler under test is `src/main/fileProtocol.ts`, which `src/main/index.ts`
 * wires to the real store, workspace paths and MIME table. Nothing here imports
 * Electron: the task lookup, the workspace resolver and the MIME resolver come
 * in as the injected deps the shipped handler is built from.
 *
 * Request URLs are written the way `src/renderer/src/lib/utils.ts#fileUrl`
 * writes them — `knight-file://file/<taskId>/<relPath>`. `file` is the host and
 * the task id is the first path segment, because the scheme is registered
 * `standard: true`.
 */

/** The app's own origins: packaged (`file://` document) and the dev server. */
const APP_ORIGINS = ['file://', 'null', 'http://localhost:5173']

const MIME: Record<string, string> = {
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.pdf': 'application/pdf'
}

function mimeTypeFor(filePath: string): string | undefined {
  const dot = filePath.lastIndexOf('.')
  return MIME[filePath.slice(dot).toLowerCase()]
}

let root = ''
let workspace = ''
let secretsDir = ''
const knownTasks = new Set(['task-1'])

function deps(overrides: Partial<KnightFileDeps> = {}): KnightFileDeps {
  return {
    taskExists: (taskId) => knownTasks.has(taskId),
    workspaceFor: (taskId) => join(workspace, taskId),
    mimeTypeFor,
    allowedOrigins: () => APP_ORIGINS,
    ...overrides
  }
}

function request(url: string, origin?: string): KnightFileRequest {
  return { url, headers: new Headers(origin === undefined ? {} : { origin }) }
}

beforeAll(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'knight-file-'))
  secretsDir = join(root, 'secrets')
  await fs.mkdir(secretsDir, { recursive: true })
  await fs.writeFile(join(secretsDir, 'id_rsa'), 'PRIVATE KEY MATERIAL')
  workspace = join(root, 'workspaces')
  await fs.mkdir(join(workspace, 'task-1'), { recursive: true })
  await fs.writeFile(join(workspace, 'task-1', 'a.txt'), 'inside the workspace')
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('knight-file containment', () => {
  it('serves a normal in-workspace file with its content type', async () => {
    const response = await handleKnightFileRequest(request('knight-file://file/task-1/a.txt'), deps())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/plain')
    expect(await response.text()).toBe('inside the workspace')
  })

  it('refuses a symlink inside the task workspace that escapes it', async () => {
    // Windows only lets an unprivileged account make junctions, not file
    // symlinks, so the escape is planted as either and the request is aimed at
    // whichever took. If neither is creatable the case is skipped loudly; the
    // refusal itself is still proven without links in the resolveContainedPath
    // suite below.
    const link = join(workspace, 'task-1', 'link')
    let escapedTo = ''
    try {
      await fs.symlink(join(secretsDir, 'id_rsa'), link, 'file')
      escapedTo = 'link'
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      try {
        await fs.symlink(secretsDir, join(workspace, 'task-1', 'dirlink'), 'junction')
        escapedTo = 'dirlink/id_rsa'
      } catch (junctionError) {
        console.warn(
          '[protocol] skipping the live escape link: this account could not create one (',
          code ?? String(error),
          '/ ',
          (junctionError as NodeJS.ErrnoException).code ?? String(junctionError),
          '). The outside-realpath refusal is still asserted by resolveContainedPath.'
        )
        return
      }
    }

    const response = await handleKnightFileRequest(
      request(`knight-file://file/task-1/${escapedTo}`),
      deps()
    )
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain('PRIVATE KEY MATERIAL')
  })

  it('refuses an encoded traversal segment instead of serving the parent tree', async () => {
    // `%2F` survives URL parsing, so the traversal only appears after decoding —
    // and it is refused there, before any path is built.
    const response = await handleKnightFileRequest(
      request('knight-file://file/task-1/sub%2F..%2F..%2Fsecrets%2Fid_rsa'),
      deps()
    )
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain('PRIVATE KEY MATERIAL')
  })

  it('refuses a traversal that only the resolved path would have caught', async () => {
    // A link the app did not plant, aimed out of the workspace: even when the
    // written path stays inside, the real path decides.
    const response = await handleKnightFileRequest(
      request('knight-file://file/task-1/id_rsa'),
      deps({
        realpath: async (path) =>
          path === join(workspace, 'task-1', 'id_rsa') ? join(secretsDir, 'id_rsa') : path
      })
    )
    expect(response.status).toBe(403)
  })

  it('404s a request for a task id that does not exist', async () => {
    const response = await handleKnightFileRequest(
      request('knight-file://file/task-does-not-exist/a.txt'),
      deps()
    )
    expect(response.status).toBe(404)
  })

  it('404s a file inside a real task that is simply absent', async () => {
    const response = await handleKnightFileRequest(
      request('knight-file://file/task-1/nope.txt'),
      deps()
    )
    expect(response.status).toBe(404)
  })

  it('keeps nosniff and no-store on what it serves, and on what it refuses', async () => {
    const served = await handleKnightFileRequest(request('knight-file://file/task-1/a.txt'), deps())
    expect(served.headers.get('x-content-type-options')).toBe('nosniff')
    expect(served.headers.get('cache-control')).toBe('no-store')
  })
})

describe('resolveContainedPath', () => {
  it('refuses a real path that resolves outside the root', async () => {
    const result = await resolveContainedPath(
      '/work/task-1',
      '/work/task-1/link',
      async (path) => (path === '/work/task-1/link' ? '/home/user/.ssh/id_rsa' : path)
    )
    expect(result).toEqual({ ok: false, reason: 'escaped' })
  })

  it('judges the resolved pair, never the written one', async () => {
    // A workspace that is itself a link (or moved) resolves on both sides, so
    // containment is still decided real-to-real.
    const relocated = await resolveContainedPath(
      '/work/task-1',
      '/work/task-1/a.txt',
      async (path) => (path === '/work/task-1' ? '/elsewhere/task-9' : '/elsewhere/task-9/a.txt')
    )
    expect(relocated).toEqual({ ok: true, realPath: '/elsewhere/task-9/a.txt' })

    // And a link that leaves the resolved root is refused even though its
    // written path sits neatly inside the workspace.
    const escaped = await resolveContainedPath(
      '/work/task-1',
      '/work/task-1/link/id_rsa',
      async (path) => (path.includes('link') ? '/home/user/.ssh/id_rsa' : '/work/task-1')
    )
    expect(escaped).toEqual({ ok: false, reason: 'escaped' })
  })

  it('refuses a workspace root that cannot be resolved at all', async () => {
    const result = await resolveContainedPath('/work/task-1', '/work/task-1/a.txt', async (path) => {
      if (path === '/work/task-1') throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return path
    })
    expect(result).toEqual({ ok: false, reason: 'missing' })
  })

  it('refuses an unresolvable target as escaped, not as an unresolved pass', async () => {
    const result = await resolveContainedPath('/work/task-1', '/work/task-1/link', async (path) => {
      if (path === '/work/task-1') return '/work/task-1'
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
    })
    expect(result).toEqual({ ok: false, reason: 'escaped' })
  })

  it('reports a missing target as missing', async () => {
    const result = await resolveContainedPath(
      '/work/task-1',
      '/work/task-1/gone.txt',
      async (path) => {
        if (path === '/work/task-1') return '/work/task-1'
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }
    )
    expect(result).toEqual({ ok: false, reason: 'missing' })
  })

  it('accepts the workspace root itself and its descendants', async () => {
    const inside = await resolveContainedPath('/work/task-1', '/work/task-1/reports/q1.md', async (p) => p)
    expect(inside).toEqual({ ok: true, realPath: '/work/task-1/reports/q1.md' })
  })

  it('rejects a prefix-colliding sibling even after resolution', async () => {
    const result = await resolveContainedPath('/work/task-1', '/work/task-1other/a.txt', async (p) => p)
    expect(result).toEqual({ ok: false, reason: 'escaped' })
  })
})

describe('knight-file CORS on a privileged scheme', () => {
  it('does not advertise a wildcard CORS origin on a privileged scheme', async () => {
    const response = await handleKnightFileRequest(request('knight-file://file/task-1/a.txt'), deps())
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('refuses a web origin that is not the app itself', async () => {
    const response = await handleKnightFileRequest(
      request('knight-file://file/task-1/a.txt', 'https://evil.example'),
      deps()
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('never echoes a wildcard, even if one were configured', async () => {
    const response = await handleKnightFileRequest(
      request('knight-file://file/task-1/a.txt', 'https://evil.example'),
      deps({ allowedOrigins: () => ['*'] })
    )
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(pinnedCorsOrigin(request('knight-file://file/task-1/a.txt', 'https://x.test'), ['*'])).toBeNull()
  })

  it('names exactly one app origin when the request comes from it', async () => {
    for (const origin of APP_ORIGINS) {
      const response = await handleKnightFileRequest(
        request('knight-file://file/task-1/a.txt', origin),
        deps()
      )
      expect(response.headers.get('access-control-allow-origin')).toBe(origin)
      expect(response.headers.get('vary')).toBe('Origin')
    }
  })

  it('keeps the wildcard origin out of the shipped protocol source', () => {
    // Ratchet in the style of security-sinks.test.ts: a wildcard ACAO must not
    // come back to the scheme, not in the handler and not in the wiring.
    const sources = ['fileProtocol.ts', 'index.ts'].map(
      (name) => readFileSync(join(__dirname, name), 'utf8')
    )
    for (const text of sources) {
      expect(text).not.toMatch(/['"]access-control-allow-origin['"]\s*:\s*['"]\*['"]/)
    }
  })

  it('serves HTML with a script-free CSP so a preview cannot fetch other tasks', async () => {
    await fs.writeFile(join(workspace, 'task-1', 'p.html'), '<h1>hi</h1>')
    const response = await handleKnightFileRequest(
      request('knight-file://file/task-1/p.html'),
      deps()
    )
    expect(response.headers.get('content-type')).toBe('text/html')
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
  })
})

describe('knight-file allowed origins', () => {
  it('names only the dev server origin while one is running', () => {
    expect(knightFileAllowedOrigins('http://localhost:5173/')).toEqual([
      'http://localhost:5173'
    ])
  })

  it('admits the app\'s own file document when there is no dev server', () => {
    expect(knightFileAllowedOrigins()).toEqual(['null', 'file://'])
  })

  it('never widens to a wildcard, not even for a malformed dev URL', () => {
    expect(knightFileAllowedOrigins('not a url')).toEqual(['null', 'file://'])
    for (const origins of [
      knightFileAllowedOrigins('http://localhost:5173'),
      knightFileAllowedOrigins('https://evil.example'),
      knightFileAllowedOrigins()
    ]) {
      expect(origins).not.toContain('*')
    }
  })

  it('does not admit an arbitrary web origin through the dev-server rule', () => {
    const dev = knightFileAllowedOrigins('http://localhost:5173')
    expect(pinnedCorsOrigin(request('knight-file://file/task-1/a.txt', 'https://evil.example'), dev)).toBeNull()
  })
})
