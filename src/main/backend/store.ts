import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Tiny atomic JSON collection. One file per collection under the backend root.
 * Ported from this app's `electron/backend/store.js`.
 */
export class Collection<T extends { id: string }> {
  readonly file: string
  private data: T[]
  private readonly fallback: T[]
  private writeTimer: NodeJS.Timeout | null = null

  constructor(file: string, fallback: T[]) {
    this.file = file
    this.fallback = fallback
    this.data = this.read()
  }

  private read(): T[] {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as T[]
    } catch {
      return structuredClone(this.fallback)
    }
  }

  private flush(): void {
    const tmp = `${this.file}.tmp`
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    renameSync(tmp, this.file)
  }

  save(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => this.flush(), 120)
  }

  flushNow(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = null
    this.flush()
  }

  all(): T[] {
    return this.data
  }

  find(predicate: (item: T) => boolean): T | undefined {
    return this.data.find(predicate)
  }

  findById(id: string): T | undefined {
    return this.data.find((item) => item.id === id)
  }

  insert(item: T): T {
    this.data.push(item)
    this.save()
    return item
  }

  update(id: string, patch: Partial<T>): T | null {
    const item = this.data.find((entry) => entry.id === id)
    if (!item) return null
    Object.assign(item, patch)
    this.save()
    return item
  }

  remove(id: string): boolean {
    const index = this.data.findIndex((entry) => entry.id === id)
    if (index === -1) return false
    this.data.splice(index, 1)
    this.save()
    return true
  }

  replace(items: T[]): void {
    this.data = items
    this.save()
  }
}

/** A collection whose records carry arbitrary keys rather than an `id`. */
export class KeyedCollection<T extends Record<string, unknown>> {
  readonly file: string
  private data: Record<string, T>
  private readonly fallback: Record<string, T>
  private writeTimer: NodeJS.Timeout | null = null

  constructor(file: string, fallback: Record<string, T>) {
    this.file = file
    this.fallback = fallback
    this.data = this.read()
  }

  private read(): Record<string, T> {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, T>
    } catch {
      return structuredClone(this.fallback)
    }
  }

  private flush(): void {
    const tmp = `${this.file}.tmp`
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    renameSync(tmp, this.file)
  }

  save(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => this.flush(), 120)
  }

  flushNow(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = null
    this.flush()
  }

  all(): Record<string, T> {
    return this.data
  }

  get(key: string): T | undefined {
    return this.data[key]
  }

  set(key: string, value: T): T {
    this.data[key] = value
    this.save()
    return value
  }

  update(key: string, patch: Partial<T>): T | null {
    const current = this.data[key]
    if (!current) return null
    Object.assign(current, patch)
    this.save()
    return current
  }

  remove(key: string): boolean {
    if (!(key in this.data)) return false
    delete this.data[key]
    this.save()
    return true
  }
}

export interface BackendSession {
  id: string
  title: string
  agentId: string
  createdAt: number
  updatedAt: number
  usage: number
  [key: string]: unknown
}

export interface BackendMessage {
  id: string
  sessionId: string
  role: string
  content: string
  createdAt: number
  agentId?: string
  usage?: { prompt?: number; completion?: number; total?: number }
  [key: string]: unknown
}

export interface BackendAgent {
  id: string
  name: string
  role: string
  description: string
  prompt: string
  tools: string[]
  color: string
  [key: string]: unknown
}

export interface BackendTeam {
  id: string
  name: string
  leader: string
  members: string[]
  description: string
  [key: string]: unknown
}

export interface BackendMemory {
  id: string
  text: string
  scope: string
  tags: string[]
  source: string
  createdAt: number
  [key: string]: unknown
}

export interface BackendUsageBucket {
  id: string
  day: string
  agentId: string
  prompt: number
  completion: number
  total: number
  calls: number
  [key: string]: unknown
}

export interface BackendMcpServer {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  enabled: boolean
  [key: string]: unknown
}

/** The backend's own collection store. Ported from this app's `store.js`. */
export class BackendStore {
  readonly dir: string
  readonly sessions: Collection<BackendSession>
  readonly messages: Collection<BackendMessage>
  readonly agents: Collection<BackendAgent>
  readonly teams: Collection<BackendTeam>
  readonly memories: Collection<BackendMemory>
  readonly usage: Collection<BackendUsageBucket>
  readonly settings: KeyedCollection<Record<string, unknown>>
  readonly mcpServers: Collection<BackendMcpServer>

  constructor(dir: string) {
    this.dir = dir
    mkdirSync(dir, { recursive: true })
    const file = (name: string): string => join(dir, `${name}.json`)

    this.sessions = new Collection<BackendSession>(file('sessions'), [])
    this.messages = new Collection<BackendMessage>(file('messages'), [])
    this.agents = new Collection<BackendAgent>(file('agents'), [])
    this.teams = new Collection<BackendTeam>(file('teams'), [])
    this.memories = new Collection<BackendMemory>(file('memories'), [])
    this.usage = new Collection<BackendUsageBucket>(file('usage'), [])
    this.settings = new KeyedCollection<Record<string, unknown>>(file('settings'), {})
    this.mcpServers = new Collection<BackendMcpServer>(file('mcp-servers'), [])
  }

  flush(): void {
    const collections = [
      this.sessions,
      this.messages,
      this.agents,
      this.teams,
      this.memories,
      this.usage,
      this.settings,
      this.mcpServers
    ]
    for (const collection of collections) collection.flushNow()
  }

  hasFile(name: string): boolean {
    return existsSync(join(this.dir, `${name}.json`))
  }
}
