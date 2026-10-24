import { existsSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

/** A command and its argv, ready to be spawned with `shell: false`. */
export interface ExecutableInvocation {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
}

function findOnPath(name: string): string | undefined {
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
      : ['']
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, name + ext)
      if (existsSync(candidate)) return candidate
      const lower = join(dir, name + ext.toLowerCase())
      if (lower !== candidate && existsSync(lower)) return lower
    }
  }
  return undefined
}

/** The `npx-cli.js` entrypoint, which can run without a shell on every platform. */
function findNpxCli(): string | undefined {
  const exeDir = dirname(process.execPath)
  const candidates = [
    join(exeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    join(exeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js')
  ]
  for (const name of ['npx', 'npm']) {
    const found = findOnPath(name)
    if (found) candidates.push(join(dirname(found), 'node_modules', 'npm', 'bin', 'npx-cli.js'))
  }
  if (process.env.APPDATA) {
    candidates.push(join(process.env.APPDATA, 'npm', 'node_modules', 'npm', 'bin', 'npx-cli.js'))
  }
  return candidates.find((candidate) => existsSync(candidate))
}

/**
 * Resolve `npx` without ever going through a shell. On Windows npx is a .cmd
 * shim that Node cannot execute directly, so its JS entrypoint is run with the
 * current Node (or Electron in Node mode) binary instead. Arguments stay in an
 * argv array, so metacharacters in them are inert.
 */
export function npxCommand(args: string[], env: NodeJS.ProcessEnv = process.env): ExecutableInvocation {
  const cli = findNpxCli()
  if (cli) {
    return {
      command: process.execPath,
      args: [cli, ...args],
      env: process.versions.electron ? { ...env, ELECTRON_RUN_AS_NODE: '1' } : env
    }
  }
  if (process.platform !== 'win32') {
    const npx = findOnPath('npx')
    if (npx) return { command: npx, args, env }
  }
  throw new Error('npx was not found on this machine. Install Node.js to run the marketplace CLIs.')
}
