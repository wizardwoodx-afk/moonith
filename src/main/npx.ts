import { execFile, type ExecException, type ExecFileOptions } from 'node:child_process'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

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

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * Locate npm's JavaScript entrypoint rather than executing npx.cmd through a
 * Windows command interpreter. Electron is run as Node for this child only.
 */
export function resolveNpxCli(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  const candidates: string[] = []
  if (env.SELFIMPULSE_NPX_CLI) candidates.push(env.SELFIMPULSE_NPX_CLI)
  if (env.npm_execpath) {
    candidates.push(join(dirname(env.npm_execpath), 'npx-cli.js'))
  }

  for (const directory of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const name of platform === 'win32' ? ['npx.cmd', 'npx'] : ['npx']) {
      const executable = join(directory, name)
      if (!isFile(executable)) continue
      try {
        const real = realpathSync(executable)
        if (real.endsWith('.js')) candidates.push(real)
      } catch {
        // The derived Windows locations below still cover regular npm shims.
      }
      if (platform === 'win32') {
        candidates.push(
          join(directory, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
          join(directory, '..', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
          join(directory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
          join(directory, '..', 'npm', 'bin', 'npx-cli.js')
        )
      }
    }
  }

  const resolved = candidates.find((candidate) => candidate.endsWith('.js') && isFile(candidate))
  if (!resolved) {
    throw new Error(
      'Unable to locate npm’s npx-cli.js. Install Node.js/npm or set SELFIMPULSE_NPX_CLI; SelfImpulse will not fall back to a command shell.'
    )
  }
  return resolved
}

export function npxInvocation(cliPath: string, pkg: string, args: string[]): {
  executable: string
  args: string[]
} {
  if (!cliPath || !pkg || args.some((arg) => arg.includes('\0'))) {
    throw new Error('Invalid npx invocation.')
  }
  return { executable: process.execPath, args: [cliPath, '-y', pkg, ...args] }
}

/** Execute a package with an argument vector and shell:false on every platform. */
export function runNpx(
  pkg: string,
  args: string[],
  options: NpxRunOptions = {}
): Promise<NpxRunResult> {
  let invocation: ReturnType<typeof npxInvocation>
  try {
    invocation = npxInvocation(resolveNpxCli(), pkg, args)
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
        ...npxEnvironment(),
        ...options.env,
        ELECTRON_RUN_AS_NODE: '1',
        npm_config_ignore_scripts: 'true'
      }
    }
    execFile(invocation.executable, invocation.args, execOptions, (error, stdout, stderr) => {
      resolve({
        code: error ? error.code ?? 1 : 0,
        stdout: typeof stdout === 'string' ? stdout : stdout.toString('utf8'),
        stderr: typeof stderr === 'string' ? stderr : stderr.toString('utf8'),
        error
      })
    })
  })
}
