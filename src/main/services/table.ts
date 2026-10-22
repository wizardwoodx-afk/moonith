import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createSocket, type Socket as DgramSocket } from 'node:dgram'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces, hostname } from 'node:os'
import type { AddressInfo } from 'node:net'
import {
  EMPTY_TABLE_STATE,
  TABLE_CODE_LENGTH,
  TABLE_DISCOVERY_PORTS,
  publishProposal,
  turnKey as applyTurnKey,
  withdrawProposal
} from '@shared/table'
import type {
  TableGoal,
  TableGoalInput,
  TableHostInput,
  TableJoinInput,
  TableLedgerEntry,
  TablePeer,
  TableProposal,
  TableProposalInput,
  TableSeat,
  TableState
} from '@shared/types'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const DISCOVERY_PREFIX = 'KNIGHT_TABLE_V1'
const MAX_BODY_BYTES = 64 * 1024
const MAX_LEDGER = 200
const MAX_PROPOSALS = 100
const GUEST_TIMEOUT_MS = 12_000
const GUEST_POLL_MS = 1_600
const HEARTBEAT_FAILURES = 3

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

interface SharedCore {
  goal: TableGoal | null
  proposals: TableProposal[]
  ledger: TableLedgerEntry[]
}

interface GuestSeat {
  name: string
  device: string
  joinedAt: string
  lastSeen: number
  token: string
}

interface HostSession {
  server: Server
  discovery: DgramSocket | null
  port: number
  code: string
  hostName: string
  startedAt: string
  guest: GuestSeat | null
  core: SharedCore
}

interface GuestSession {
  baseUrl: string
  token: string
  code: string
  name: string
  address: string
  startedAt: string
  timer: NodeJS.Timeout
  state: TableState
  polling: boolean
  failures: number
}

function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function makeCode(): string {
  const bytes = randomBytes(TABLE_CODE_LENGTH)
  let code = ''
  for (let index = 0; index < TABLE_CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length]
  }
  return code
}

function normalizeCode(value: unknown): string {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, TABLE_CODE_LENGTH)
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '0.0.0.0', () => {
      server.removeListener('error', reject)
      const address = server.address() as AddressInfo
      resolve(address.port)
    })
  })
}

function ipToInt(ip: string): number {
  const parts = ip.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return 0
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

function intToIp(value: number): string {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.')
}

function broadcastTargets(): string[] {
  const targets = new Set<string>(['255.255.255.255'])
  for (const entries of Object.values(networkInterfaces())) {
    for (const net of entries ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue
      const ip = ipToInt(net.address)
      const mask = ipToInt(net.netmask)
      if (!ip || !mask) continue
      targets.add(intToIp(((ip & mask) | (~mask >>> 0)) >>> 0))
    }
  }
  return [...targets]
}

function localAddress(): string | null {
  for (const entries of Object.values(networkInterfaces())) {
    for (const net of entries ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  return null
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'That message is too large for the table.')
    chunks.push(chunk as Buffer)
  }
  if (size === 0) return {}
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new HttpError(400, 'Expected a JSON object.')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, 'Could not read that message.')
  }
}

function reply(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(body)
  })
  res.end(body)
}

function bearer(req: IncomingMessage): string {
  const header = req.headers.authorization ?? ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

function tokensMatch(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}

function parseAddress(raw: string): { baseUrl: string; host: string } {
  const value = raw.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  if (!value) throw new HttpError(400, 'Enter the host address as ip:port.')
  const match = /^([a-zA-Z0-9.-]+):(\d{1,5})$/.exec(value)
  if (!match) throw new HttpError(400, 'The host address needs an ip:port, for example 192.168.1.20:53421.')
  const port = Number(match[2])
  if (port < 1 || port > 65535) throw new HttpError(400, 'That host port is not valid.')
  return { baseUrl: `http://${match[1]}:${port}`, host: match[1] }
}

async function discover(code: string): Promise<{ port: number; address: string } | null> {
  return new Promise<{ port: number; address: string } | null>((resolve) => {
    const socket = createSocket({ type: 'udp4', reuseAddr: true })
    let settled = false
    let timer: NodeJS.Timeout | null = null

    const finish = (found: { port: number; address: string } | null): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      try {
        socket.close()
      } catch {
        /* already closed */
      }
      resolve(found)
    }

    socket.on('error', () => finish(null))
    socket.on('message', (message, remote) => {
      try {
        const payload = JSON.parse(message.toString('utf8')) as {
          code?: string
          port?: number
        }
        if (payload.code === code && Number.isInteger(payload.port)) {
          finish({ port: Number(payload.port), address: remote.address })
        }
      } catch {
        /* ignore foreign datagrams */
      }
    })
    socket.bind(() => {
      socket.setBroadcast(true)
      const request = `${DISCOVERY_PREFIX} ${code}`
      for (const port of TABLE_DISCOVERY_PORTS) {
        for (const target of broadcastTargets()) {
          socket.send(request, port, target, () => undefined)
        }
      }
      timer = setTimeout(() => finish(null), 1_800)
    })
  })
}

async function bindDiscovery(
  code: string,
  port: number,
  hostName: string
): Promise<DgramSocket | null> {
  for (const candidate of TABLE_DISCOVERY_PORTS) {
    const socket = createSocket({ type: 'udp4', reuseAddr: true })
    const bound = await new Promise<boolean>((resolve) => {
      socket.once('error', () => resolve(false))
      socket.bind(candidate, '0.0.0.0', () => {
        socket.removeAllListeners('error')
        resolve(true)
      })
    })
    if (!bound) {
      try {
        socket.close()
      } catch {
        /* already closed */
      }
      continue
    }
    socket.on('message', (message, remote) => {
      if (message.toString('utf8') !== `${DISCOVERY_PREFIX} ${code}`) return
      const payload = JSON.stringify({ code, port, name: hostName, device: hostname() })
      socket.send(payload, remote.port, remote.address, () => undefined)
    })
    socket.on('error', () => undefined)
    return socket
  }
  return null
}

function entry(
  actor: TableSeat | 'joint',
  text: string,
  status: TableLedgerEntry['status']
): TableLedgerEntry {
  return { id: `ledger_${randomUUID()}`, actor, text, status, at: new Date().toISOString() }
}

function pushLedger(core: SharedCore, next: TableLedgerEntry): void {
  core.ledger = [...core.ledger, next].slice(-MAX_LEDGER)
}

function openProposal(proposals: TableProposal[]): TableProposal | undefined {
  return proposals.find(
    (proposal) => proposal.status === 'pending' || proposal.status === 'approved'
  )
}

export class TableService {
  private host: HostSession | null = null
  private guest: GuestSession | null = null
  private failures = new Map<string, { count: number; resetAt: number }>()

  async getState(): Promise<TableState> {
    return this.state()
  }

  async hostTable(input: TableHostInput): Promise<TableState> {
    const name = clean(input?.name, 40) || 'Captain'
    await this.leave()
    const code = makeCode()
    const core: SharedCore = { goal: null, proposals: [], ledger: [] }
    const server = createServer((req, res) => {
      void this.handleHostRequest(req, res)
    })
    let port: number
    try {
      port = await listen(server)
    } catch (error) {
      server.close()
      throw new Error(
        `Could not open a table on this machine: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    const discovery = await bindDiscovery(code, port, name)
    const startedAt = new Date().toISOString()
    this.host = {
      server,
      discovery,
      port,
      code,
      hostName: name,
      startedAt,
      guest: null,
      core
    }
    server.on('error', () => undefined)
    pushLedger(core, entry('a', 'Opened the table. Waiting for the second Captain.', 'shared'))
    return this.state()
  }

  async joinTable(input: TableJoinInput): Promise<TableState> {
    const code = normalizeCode(input?.code)
    if (code.length !== TABLE_CODE_LENGTH) {
      throw new Error(`A table code is ${TABLE_CODE_LENGTH} characters.`)
    }
    const name = clean(input?.name, 40) || 'Captain'
    const address = clean(input?.address, 120)
    await this.leave()

    let target: { baseUrl: string; address: string } | null = null
    if (address) {
      const parsed = parseAddress(address)
      target = { baseUrl: parsed.baseUrl, address: parsed.host }
    } else {
      const found = await discover(code)
      if (!found) {
        throw new Error(
          'No table answered that code. Check that the host is on this network and the code is exact, or enter the host address.'
        )
      }
      target = { baseUrl: `http://${found.address}:${found.port}`, address: found.address }
    }

    let payload: { token?: string; state?: TableState }
    try {
      const response = await fetch(`${target.baseUrl}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, name, device: hostname() }),
        signal: AbortSignal.timeout(6_000)
      })
      const json = (await response.json()) as { token?: string; state?: TableState; error?: string }
      if (!response.ok) throw new Error(json.error || `The host refused the join (${response.status}).`)
      payload = json
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error('The host did not answer in time.')
      }
      throw error instanceof Error ? error : new Error(String(error))
    }

    if (!payload.token || !payload.state) throw new Error('The host returned an incomplete table.')
    const startedAt = new Date().toISOString()
    this.guest = {
      baseUrl: target.baseUrl,
      token: payload.token,
      code,
      name,
      address: target.address,
      startedAt,
      timer: setInterval(() => void this.poll(), GUEST_POLL_MS),
      state: {
        ...payload.state,
        role: 'guest',
        code,
        address: target.address,
        connected: true,
        startedAt
      },
      polling: false,
      failures: 0
    }
    return this.state()
  }

  async setGoal(input: TableGoalInput): Promise<TableState> {
    const title = clean(input?.title, 120)
    if (!title) throw new Error('Give the shared goal a title.')
    const detail = clean(input?.detail, 600)
    const due = clean(input?.due, 40)
    const goal: TableGoal = {
      title,
      detail,
      due,
      setBy: this.seat(),
      updatedAt: new Date().toISOString()
    }
    if (this.host) {
      this.host.core.goal = goal
      pushLedger(
        this.host.core,
        entry(this.seat(), `Set the shared goal to “${title}”.`, 'shared')
      )
      return this.state()
    }
    return this.guestPost('/goal', { title, detail, due })
  }

  async propose(input: TableProposalInput): Promise<TableState> {
    const title = clean(input?.title, 120)
    const summary = clean(input?.summary, 400)
    if (!title) throw new Error('Give the joint action a title.')
    if (!summary) throw new Error('Describe what both Captains are agreeing to.')
    if (this.host) {
      const core = this.host.core
      if (openProposal(core.proposals)) {
        throw new Error('Finish or withdraw the open joint action before proposing another.')
      }
      const proposal: TableProposal = {
        id: `proposal_${randomUUID()}`,
        title,
        summary,
        proposedBy: this.seat(),
        keys: { a: false, b: false },
        status: 'pending',
        createdAt: new Date().toISOString()
      }
      core.proposals = [...core.proposals, proposal].slice(-MAX_PROPOSALS)
      pushLedger(
        core,
        entry(
          this.seat(),
          `Proposed “${title}”. Both Captains must turn a key.`,
          'pending'
        )
      )
      return this.state()
    }
    return this.guestPost('/propose', { title, summary })
  }

  async turnKey(proposalId: string): Promise<TableState> {
    const id = clean(proposalId, 80)
    if (this.host) {
      const core = this.host.core
      const proposal = core.proposals.find((item) => item.id === id)
      if (!proposal) throw new Error('That joint action is no longer on the table.')
      if (proposal.status !== 'pending') throw new Error('That action is no longer pending.')
      const next = applyTurnKey(proposal, this.seat())
      if (next === proposal) {
        throw new Error('Your key is already on this action.')
      }
      core.proposals = core.proposals.map((item) => (item.id === id ? next : item))
      if (next.status === 'approved') {
        pushLedger(
          core,
          entry('joint', `“${next.title}” is co-signed by both Captains.`, 'approved')
        )
      }
      return this.state()
    }
    return this.guestPost('/key', { id })
  }

  async withdraw(proposalId: string): Promise<TableState> {
    const id = clean(proposalId, 80)
    if (this.host) {
      const core = this.host.core
      const proposal = core.proposals.find((item) => item.id === id)
      if (!proposal) throw new Error('That joint action is no longer on the table.')
      if (proposal.proposedBy !== this.seat()) {
        throw new Error('Only the Captain who proposed it can withdraw this action.')
      }
      if (proposal.status !== 'pending') {
        throw new Error('Only a pending joint action can be withdrawn.')
      }
      core.proposals = core.proposals.map((item) =>
        item.id === id ? withdrawProposal(item) : item
      )
      pushLedger(
        core,
        entry(this.seat(), `Withdrew “${proposal.title}”. Nothing was published.`, 'withdrawn')
      )
      return this.state()
    }
    return this.guestPost('/withdraw', { id })
  }

  async publish(proposalId: string): Promise<TableState> {
    const id = clean(proposalId, 80)
    if (this.host) {
      const core = this.host.core
      const proposal = core.proposals.find((item) => item.id === id)
      if (!proposal) throw new Error('That joint action is no longer on the table.')
      if (proposal.status !== 'approved') {
        throw new Error('Both keys must be on before this can be published.')
      }
      const next = publishProposal(proposal)
      core.proposals = core.proposals.map((item) => (item.id === id ? next : item))
      pushLedger(
        core,
        entry('joint', `Published “${proposal.title}” to the shared table.`, 'shared')
      )
      return this.state()
    }
    return this.guestPost('/publish', { id })
  }

  async leave(): Promise<TableState> {
    if (this.guest) {
      const current = this.guest
      this.guest = null
      clearInterval(current.timer)
      try {
        await fetch(`${current.baseUrl}/leave`, {
          method: 'POST',
          headers: { authorization: `Bearer ${current.token}` },
          signal: AbortSignal.timeout(2_000)
        })
      } catch {
        /* the host may already be gone */
      }
    }
    this.closeHost()
    this.failures.clear()
    return EMPTY_TABLE_STATE
  }

  dispose(): void {
    void this.leave()
  }

  private seat(): TableSeat {
    return this.host ? 'a' : 'b'
  }

  private state(): TableState {
    if (this.host) {
      const host = this.host
      const now = Date.now()
      const online = host.guest ? now - host.guest.lastSeen < GUEST_TIMEOUT_MS : false
      const peers: TablePeer[] = [
        {
          seat: 'a',
          name: host.hostName,
          device: hostname(),
          online: true,
          joinedAt: host.startedAt
        },
        ...(host.guest
          ? [
              {
                seat: 'b' as const,
                name: host.guest.name,
                device: host.guest.device,
                online,
                joinedAt: host.guest.joinedAt
              }
            ]
          : [])
      ]
      return {
        role: 'host',
        code: host.code,
        address: localAddress(),
        port: host.port,
        peers,
        goal: host.core.goal,
        proposals: [...host.core.proposals].reverse(),
        ledger: [...host.core.ledger].reverse(),
        connected: true,
        startedAt: host.startedAt
      }
    }
    if (this.guest) return { ...this.guest.state, role: 'guest' }
    return EMPTY_TABLE_STATE
  }

  private closeHost(): void {
    const host = this.host
    if (!host) return
    this.host = null
    try {
      host.discovery?.close()
    } catch {
      /* already closed */
    }
    try {
      host.server.close()
    } catch {
      /* already closed */
    }
  }

  private async poll(): Promise<void> {
    const guest = this.guest
    if (!guest || guest.polling) return
    guest.polling = true
    try {
      const response = await fetch(`${guest.baseUrl}/state`, {
        headers: { authorization: `Bearer ${guest.token}` },
        signal: AbortSignal.timeout(4_000)
      })
      if (!response.ok) throw new Error(`Table state failed (${response.status})`)
      const payload = (await response.json()) as TableState
      if (this.guest !== guest) return
      guest.failures = 0
      guest.state = {
        ...payload,
        role: 'guest',
        code: guest.code,
        address: guest.address,
        connected: true,
        startedAt: guest.startedAt
      }
    } catch {
      if (this.guest !== guest) return
      guest.failures += 1
      guest.state = {
        ...guest.state,
        connected: false,
        error:
          guest.failures >= HEARTBEAT_FAILURES
            ? 'Lost contact with the host. Waiting for it to return.'
            : guest.state.error
      }
    } finally {
      if (this.guest === guest) guest.polling = false
    }
  }

  private async guestPost(path: string, body: Record<string, unknown>): Promise<TableState> {
    const guest = this.guest
    if (!guest) throw new Error('You are not at a table.')
    let response: Response
    try {
      response = await fetch(`${guest.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${guest.token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(6_000)
      })
    } catch {
      throw new Error('The host did not answer. Check the connection and try again.')
    }
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string
      state?: TableState
    }
    if (!response.ok) throw new Error(payload.error || `The host refused that action (${response.status}).`)
    if (!payload.state) throw new Error('The host returned an incomplete table.')
    if (this.guest === guest) {
      guest.state = {
        ...payload.state,
        role: 'guest',
        code: guest.code,
        address: guest.address,
        connected: true,
        startedAt: guest.startedAt
      }
      guest.failures = 0
    }
    return this.state()
  }

  private authorize(req: IncomingMessage): GuestSeat {
    const host = this.host
    if (!host || !host.guest) throw new HttpError(401, 'Join a table first.')
    const token = bearer(req)
    if (!tokensMatch(token, host.guest.token)) throw new HttpError(401, 'That table session is not valid.')
    return host.guest
  }

  private async handleHostRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://table.local')
    const path = url.pathname
    try {
      if (path === '/join') {
        if (req.method !== 'POST') throw new HttpError(405, 'Use POST for join.')
        await this.handleJoin(req, res)
        return
      }
      if (path === '/state') {
        if (req.method !== 'GET') throw new HttpError(405, 'Use GET for state.')
        this.authorize(req)
        const host = this.host
        if (host?.guest) host.guest.lastSeen = Date.now()
        reply(res, 200, this.state())
        return
      }
      if (!['/goal', '/propose', '/key', '/withdraw', '/publish', '/leave'].includes(path)) {
        throw new HttpError(404, 'Unknown table route.')
      }
      if (req.method !== 'POST') throw new HttpError(405, 'Use POST for table actions.')
      const guest = this.authorize(req)
      guest.lastSeen = Date.now()
      const body = await readJson(req)
      const host = this.host
      if (!host) throw new HttpError(410, 'This table closed.')

      if (path === '/leave') {
        host.guest = null
        pushLedger(
          host.core,
          entry('b', `${guest.name} left the table.`, 'shared')
        )
        reply(res, 200, { state: this.state() })
        return
      }

      if (path === '/goal') {
        const title = clean(body.title, 120)
        if (!title) throw new HttpError(400, 'Give the shared goal a title.')
        host.core.goal = {
          title,
          detail: clean(body.detail, 600),
          due: clean(body.due, 40),
          setBy: 'b',
          updatedAt: new Date().toISOString()
        }
        pushLedger(host.core, entry('b', `Set the shared goal to “${title}”.`, 'shared'))
      }

      if (path === '/propose') {
        if (openProposal(host.core.proposals)) {
          throw new HttpError(409, 'Finish or withdraw the open joint action first.')
        }
        const title = clean(body.title, 120)
        const summary = clean(body.summary, 400)
        if (!title || !summary) throw new HttpError(400, 'A joint action needs a title and a summary.')
        const proposal: TableProposal = {
          id: `proposal_${randomUUID()}`,
          title,
          summary,
          proposedBy: 'b',
          keys: { a: false, b: false },
          status: 'pending',
          createdAt: new Date().toISOString()
        }
        host.core.proposals = [...host.core.proposals, proposal].slice(-MAX_PROPOSALS)
        pushLedger(
          host.core,
          entry('b', `Proposed “${title}”. Both Captains must turn a key.`, 'pending')
        )
      }

      if (path === '/key' || path === '/withdraw' || path === '/publish') {
        const id = clean(body.id, 80)
        const proposal = host.core.proposals.find((item) => item.id === id)
        if (!proposal) throw new HttpError(404, 'That joint action is no longer on the table.')
        if (path === '/key') {
          if (proposal.status !== 'pending') throw new HttpError(409, 'That action is no longer pending.')
          const next = applyTurnKey(proposal, 'b')
          if (next === proposal) throw new HttpError(409, 'Your key is already on this action.')
          host.core.proposals = host.core.proposals.map((item) => (item.id === id ? next : item))
          if (next.status === 'approved') {
            pushLedger(
              host.core,
              entry('joint', `“${next.title}” is co-signed by both Captains.`, 'approved')
            )
          }
        }
        if (path === '/withdraw') {
          if (proposal.proposedBy !== 'b') {
            throw new HttpError(403, 'Only the Captain who proposed it can withdraw this action.')
          }
          if (proposal.status !== 'pending') throw new HttpError(409, 'That action is no longer pending.')
          host.core.proposals = host.core.proposals.map((item) =>
            item.id === id ? withdrawProposal(item) : item
          )
          pushLedger(
            host.core,
            entry('b', `Withdrew “${proposal.title}”. Nothing was published.`, 'withdrawn')
          )
        }
        if (path === '/publish') {
          if (proposal.status !== 'approved') {
            throw new HttpError(409, 'Both keys must be on before this can be published.')
          }
          host.core.proposals = host.core.proposals.map((item) =>
            item.id === id ? publishProposal(item) : item
          )
          pushLedger(
            host.core,
            entry('joint', `Published “${proposal.title}” to the shared table.`, 'shared')
          )
        }
      }

      reply(res, 200, { state: this.state() })
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      reply(res, status, {
        error: error instanceof Error ? error.message : 'The table could not complete that action.'
      })
    }
  }

  private async handleJoin(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = this.host
    if (!host) throw new HttpError(410, 'This table closed.')
    const remote = req.socket.remoteAddress ?? 'local'
    const attempt = this.failures.get(remote)
    const now = Date.now()
    if (attempt && attempt.resetAt > now && attempt.count >= 6) {
      throw new HttpError(429, 'Too many join attempts. Wait a minute and try again.')
    }
    const body = await readJson(req)
    const code = normalizeCode(body.code)
    if (code !== host.code) {
      const next = attempt && attempt.resetAt > now ? attempt : { count: 0, resetAt: now + 60_000 }
      next.count += 1
      this.failures.set(remote, next)
      if (this.failures.size > 64) {
        const oldest = this.failures.keys().next().value
        if (oldest) this.failures.delete(oldest)
      }
      throw new HttpError(403, 'That table code is not correct.')
    }
    const online = host.guest ? now - host.guest.lastSeen < GUEST_TIMEOUT_MS : false
    if (host.guest && online) {
      throw new HttpError(409, 'This table already has two Captains.')
    }
    const name = clean(body.name, 40) || 'Captain'
    const device = clean(body.device, 60) || remote
    const guest: GuestSeat = {
      name,
      device,
      joinedAt: new Date().toISOString(),
      lastSeen: now,
      token: randomBytes(32).toString('hex')
    }
    host.guest = guest
    this.failures.delete(remote)
    pushLedger(host.core, entry('b', `${name} joined the table.`, 'shared'))
    reply(res, 200, { token: guest.token, state: this.state() })
  }
}

export const tableService = new TableService()
