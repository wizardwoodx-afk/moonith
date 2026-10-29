import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { getPaths } from '../paths'
import type { EngineStatusPublic } from '@shared/types'
import { EngineClient } from './client'

export type EngineStatus = EngineStatusPublic

interface StartInput {
  config: Record<string, unknown>
  env: Record<string, string>
  providerCount: number
}

function engineBinary(): string {
  if (process.env.SELFIMPULSE_ENGINE_BIN) return process.env.SELFIMPULSE_ENGINE_BIN
  if (app.isPackaged) return join(process.resourcesPath, 'engine', 'opencode.exe')
  return join(app.getAppPath(), 'resources', 'engine', 'opencode.exe')
}

function engineBridgeScript(): string {
  if (process.env.SELFIMPULSE_ENGINE_BRIDGE) return process.env.SELFIMPULSE_ENGINE_BRIDGE
  if (app.isPackaged) return join(process.resourcesPath, 'engine-bridge.cjs')
  return join(app.getAppPath(), 'resources', 'engine-bridge.cjs')
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => (port ? resolve(port) : reject(new Error('No free port'))))
    })
  })
}

class EngineSupervisor {
  private child?: ChildProcess
  private clientValue?: EngineClient
  private state: EngineStatus = { state: 'stopped' }
  private signature = ''
  private starting?: Promise<EngineClient>

  status(): EngineStatus {
    return { ...this.state }
  }

  client(): EngineClient | undefined {
    return this.state.state === 'running' ? this.clientValue : undefined
  }

  bridgeScript(): string {
    return engineBridgeScript()
  }

  private home(): { config: string; data: string; cache: string; state: string } {
    const root = join(getPaths().root, 'engine')
    const dirs = {
      config: join(root, 'config'),
      data: join(root, 'data'),
      cache: join(root, 'cache'),
      state: join(root, 'state')
    }
    for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true })
    mkdirSync(join(dirs.config, 'opencode'), { recursive: true })
    return dirs
  }

  async start(input: StartInput): Promise<EngineClient> {
    /* Keys travel in the child's environment, so a rotated key must restart
     * the engine; the values are hashed, never kept in the signature string. */
    const envDigest = Object.entries(input.env)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => [name, createHash('sha256').update(value).digest('hex')])
    const signature = createHash('sha256')
      .update(JSON.stringify({ config: input.config, env: envDigest }))
      .digest('hex')

    if (this.state.state === 'running' && this.clientValue && signature === this.signature) {
      return this.clientValue
    }
    if (this.starting) {
      await this.starting.catch(() => undefined)
      if (this.state.state === 'running' && this.clientValue && signature === this.signature) {
        return this.clientValue
      }
    }
    this.starting = this.launch(input, signature)
    try {
      return await this.starting
    } finally {
      this.starting = undefined
    }
  }

  private async launch(input: StartInput, signature: string): Promise<EngineClient> {
    await this.stop()
    this.state = { state: 'starting', providers: input.providerCount }
    const dirs = this.home()
    writeFileSync(
      join(dirs.config, 'opencode', 'opencode.json'),
      JSON.stringify(input.config, null, 2)
    )
    const port = await freePort()
    const password = randomBytes(24).toString('base64url')
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...input.env,
      OPENCODE_PASSWORD: password,
      XDG_CONFIG_HOME: dirs.config,
      XDG_DATA_HOME: dirs.data,
      XDG_CACHE_HOME: dirs.cache,
      XDG_STATE_HOME: dirs.state,
      OPENCODE_DISABLE_AUTOUPDATE: '1'
    }
    const child = spawn(engineBinary(), ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.child = child
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      this.state.lastLine = chunk.trim().split('\n').pop()
    })
    child.stderr?.on('data', (chunk: string) => {
      const line = chunk.trim().split('\n').pop() ?? ''
      if (line) this.state.lastLine = line
    })
    child.on('exit', (code) => {
      if (this.child !== child) return
      this.child = undefined
      this.clientValue?.close()
      this.clientValue = undefined
      this.signature = ''
      this.state = {
        state: code === 0 ? 'stopped' : 'error',
        error: code === 0 ? undefined : `Engine exited with code ${code}`,
        providers: this.state.providers
      }
    })

    const client = new EngineClient(`http://127.0.0.1:${port}`, password)
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (child.exitCode !== null) break
      if (await client.health()) {
        client.startStream((error) => {
          this.state.lastLine = `event stream: ${error.message}`
        })
        this.clientValue = client
        this.signature = signature
        this.state = {
          state: 'running',
          port,
          providers: input.providerCount,
          ...(this.state.lastLine ? { lastLine: this.state.lastLine } : {})
        }
        return client
      }
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    child.kill()
    this.child = undefined
    this.state = {
      state: 'error',
      error:
        this.state.lastLine ??
        'The execution engine did not become ready. Check the engine log in the app data folder.'
    }
    throw new Error(this.state.error)
  }

  async stop(): Promise<void> {
    this.clientValue?.close()
    this.clientValue = undefined
    this.signature = ''
    const child = this.child
    this.child = undefined
    if (child && child.exitCode === null) {
      child.kill()
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 3000)
        child.once('exit', () => {
          clearTimeout(timer)
          resolve(undefined)
        })
      })
    }
    if (this.state.state !== 'error') this.state = { state: 'stopped' }
  }
}

export const engineSupervisor = new EngineSupervisor()
