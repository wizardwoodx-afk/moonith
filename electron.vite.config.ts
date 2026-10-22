import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = resolve('src/shared')

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
          resolve: {
            alias: { '@shared': shared }
          }
        }
      }),
  ...(only === 'main'
    ? {}
    : {
        renderer: {
          root: 'src/renderer',
          resolve: {
            alias: {
              '@shared': shared,
              '@renderer': resolve('src/renderer/src')
            }
          },
          plugins: [react(), tailwindcss()]
        }
      })
})
