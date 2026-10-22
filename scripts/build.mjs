/**
 * Build the app in two processes.
 *
 * `electron-vite build` normally builds main, preload and renderer in one
 * process. That peaks above this machine's commit limit once the vendored
 * graph runtime is part of the main bundle, and the renderer fails with a
 * native out-of-memory instead of a useful error. Two processes release the
 * first target's memory before the second starts.
 *
 * The split is a resource decision only — the output is the same three
 * targets, in the same `out/` layout electron-vite produces.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const cli = join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')

function build(target) {
  const result = spawnSync(process.execPath, [cli, 'build'], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      KNIGHT_BUILD_ONLY: target,
      // Rolldown's thread pool is the allocation that fails first on a full
      // page file. Two workers keep the peak inside the available commit.
      RAYON_NUM_THREADS: process.env.RAYON_NUM_THREADS ?? '2'
    }
  })
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

build('main')
build('renderer')
