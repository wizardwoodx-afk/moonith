import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

const shared = resolve('src/shared')

/**
 * Provenance, injected at bundle time so a running build can say which commit
 * it came from. Absent in dev and in tests, where the identity module falls
 * back instead of throwing.
 */
function provenance(): Record<string, string> {
  let commit = ''
  try {
    commit = execSync('git rev-parse HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    /* Not a git checkout — provenance is best effort. */
  }
  return {
    __SI_COMMIT__: JSON.stringify(commit),
    __SI_BUILT__: JSON.stringify(new Date().toISOString())
  }
}

/**
 * The shipped CSP forbids inline scripts. `@vitejs/plugin-react` injects an
 * inline react-refresh preamble into the dev server's HTML, which that policy
 * would block, so relax `script-src` for `serve` only. `apply: 'serve'` keeps
 * this out of the production build entirely — the packaged app keeps the
 * strict policy that `src/renderer/index.html` declares.
 */
function devInlineScriptCsp(): Plugin {
  return {
    name: 'selfimpulse-dev-csp',
    apply: 'serve',
    transformIndexHtml(html: string): string {
      return html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
    }
  }
}

/**
 * `KNIGHT_BUILD_ONLY` splits the production build into two processes.
 *
 * The vendored graph runtime and the renderer bundle are both large, and this
 * machine's commit limit is reached when rollup/rolldown holds all three
 * targets at once. Splitting is a build detail, not a product difference: the
 * dev server still runs every target in one process.
 */
const only = process.env.KNIGHT_BUILD_ONLY

export default defineConfig({
  ...(only === 'renderer'
    ? {}
    : {
        main: {
          define: provenance(),
          resolve: {
            alias: { '@shared': shared }
          },
          // The vendored graph runtime (langgraph) is one large circular module
          // graph. Rolldown's minifier recurses hard enough to overflow the
          // default thread stack on Windows; the unminified main bundle is a
          // few hundred KB larger and needs no minification inside Electron.
          build: { minify: false }
        },
        preload: {
          define: provenance(),
          resolve: {
            alias: { '@shared': shared }
          }
        }
      }),
  ...(only === 'main'
    ? {}
    : {
        renderer: {
          define: provenance(),
          root: 'src/renderer',
          resolve: {
            alias: {
              '@shared': shared,
              '@renderer': resolve('src/renderer/src')
            }
          },
          plugins: [react(), tailwindcss(), devInlineScriptCsp()]
        }
      })
})
