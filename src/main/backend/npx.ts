import { execFile, type ExecException, type ExecFileOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

/** A command and its argv, ready to be spawned with `shell: false`. */
export interface ExecutableInvocation {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
}

export interface NpxRunResult {
  code: number | string
  stdout: string
  stderr: string
  error: ExecException | null
}

export interface NpxRunOptions {
  timeout?: number
  cwd?: string
  env?: NodeJS.ProcessEnv
  maxBuffer?: number
}

/**
 * Third-party package executables are not trusted with the desktop's provider
 * credentials. Keep ordinary process configuration, but remove credential-
 * shaped variables and loader hooks before spawning a package.
 */
export function npxEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(source)) {
    if (/(?:api[_-]?key|token|secret|password|passwd|private[_-]?key|credential|authorization)/i.test(key)) continue
    if (/^(?:NODE_OPTIONS|ELECTRON_RUN_AS_NODE)$/i.test(key)) continue
    env[key] = value
  }
  // npm lifecycle scripts are not needed for the registry CLIs used here and
  // are an unnecessary second code-execution step during installation.
  env.npm_config_ignore_scripts = 'true'
  return env
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
export function npxCommand(
  args: string[],
  env: NodeJS.ProcessEnv = npxEnvironment()
): ExecutableInvocation {
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

/**
 * Run a package executable with an argument vector and `shell: false` on every
 * platform. Ambient provider credentials are stripped; callers may pass the
 * specific variables a CLI needs (for example marketplace client credentials)
 * explicitly in `options.env`.
 */
export function runNpx(
  pkg: string,
  args: string[],
  options: NpxRunOptions = {}
): Promise<NpxRunResult> {
  if (!pkg || args.some((arg) => String(arg).includes('\0'))) {
    const failure = new Error('Invalid npx invocation.') as ExecException
    return Promise.resolve({ code: 'EINVAL', stdout: '', stderr: failure.message, error: failure })
  }

  let invocation: ExecutableInvocation
  try {
    invocation = npxCommand(['-y', pkg, ...args], {
      ...npxEnvironment(),
      ...options.env
    })
  } catch (error) {
    const failure = error as ExecException
    return Promise.resolve({
      code: 'ENOENT',
      stdout: '',
      stderr: failure.message,
      error: failure
    })
  }

  return new Promise((resolve) => {
    const execOptions: ExecFileOptions = {
      encoding: 'utf8',
      timeout: options.timeout ?? 300000,
      cwd: options.cwd,
      maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
      windowsHide: true,
      shell: false,
      env: {
        ...invocation.env,
        npm_config_ignore_scripts: 'true'
      }
    }
    execFile(invocation.command, invocation.args, execOptions, (error, stdout, stderr) => {
      resolve({
        code: error ? error.code ?? 1 : 0,
        stdout: typeof stdout === 'string' ? stdout : stdout.toString('utf8'),
        stderr: typeof stderr === 'string' ? stderr : stderr.toString('utf8'),
        error
      })
    })
  })
}
