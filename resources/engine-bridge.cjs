/**
 * MCP bridge for the SelfImpulse execution engine.
 *
 * The engine starts this file as a local MCP server. It answers tools/list and
 * tools/call by forwarding to the SelfImpulse main process over a private
 * named pipe, so tool execution keeps using the app's own governed tool
 * runtime. This file is plain CommonJS with no dependencies, because it runs
 * under the packaged Electron binary in Node mode.
 */
const net = require('node:net')
const readline = require('node:readline')

const pipePath = process.env.SI_ENGINE_PIPE
const token = process.env.SI_ENGINE_TOKEN ?? ''

if (!pipePath) {
  process.stderr.write('engine bridge: SI_ENGINE_PIPE is not set\n')
  process.exit(1)
}

let socket = null
let nextId = 1
const pending = new Map()
let buffer = ''

function connect() {
  return new Promise((resolve, reject) => {
    const connection = net.connect(pipePath)
    connection.setEncoding('utf8')
    connection.once('connect', () => {
      socket = connection
      connection.write(JSON.stringify({ token }) + '\n')
      resolve(connection)
    })
    connection.once('error', reject)
    connection.on('data', (chunk) => {
      buffer += chunk
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf('\n')
        if (!line.trim()) continue
        let message
        try {
          message = JSON.parse(line)
        } catch {
          continue
        }
        if (message.id !== undefined && pending.has(message.id)) {
          const entry = pending.get(message.id)
          pending.delete(message.id)
          if (message.error) entry.reject(new Error(message.error))
          else entry.resolve(message.result)
        } else if (message.method === 'tools_changed') {
          notify('notifications/tools/list_changed', {})
        }
      }
    })
    connection.on('close', () => {
      for (const entry of pending.values()) entry.reject(new Error('bridge connection closed'))
      pending.clear()
      process.exit(0)
    })
  })
}

function request(method, params) {
  return new Promise((resolve, reject) => {
    if (!socket) return reject(new Error('bridge is not connected'))
    const id = nextId++
    pending.set(id, { resolve, reject })
    socket.write(JSON.stringify({ id, method, params }) + '\n')
  })
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value })
}

function error(id, message) {
  send({ jsonrpc: '2.0', id, error: { code: -32000, message } })
}

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params })
}

const tools = {
  async list() {
    const list = await request('list', {})
    const mapped = (Array.isArray(list) ? list : []).map((tool) => ({
      name: tool.name,
      description: tool.description || tool.name,
      inputSchema: tool.inputSchema || { type: 'object', properties: {} }
    }))
    return { tools: mapped }
  },
  async call(params) {
    const name = params && params.name
    const args = (params && params.arguments) || {}
    const outcome = await request('call', { name, arguments: args })
    return {
      content: [{ type: 'text', text: String(outcome && outcome.content ? outcome.content : '') }],
      isError: Boolean(outcome && outcome.isError)
    }
  }
}

async function main() {
  await connect()
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  rl.on('line', async (line) => {
    if (!line.trim()) return
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    const { id, method, params } = message
    if (method === 'initialize') {
      const requested = params && params.protocolVersion
      result(id, {
        protocolVersion: requested || '2024-11-05',
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'selfimpulse', version: '1.0.0' }
      })
      return
    }
    if (method === 'notifications/initialized' || method === 'notifications/cancelled') return
    if (method === 'ping') {
      result(id, {})
      return
    }
    try {
      if (method === 'tools/list') {
        result(id, await tools.list())
        return
      }
      if (method === 'tools/call') {
        result(id, await tools.call(params))
        return
      }
      if (id !== undefined) error(id, `Unsupported method ${method}`)
    } catch (failure) {
      if (id !== undefined) error(id, failure && failure.message ? failure.message : String(failure))
    }
  })
  rl.on('close', () => process.exit(0))
}

main().catch((failure) => {
  process.stderr.write('engine bridge failed: ' + (failure && failure.message ? failure.message : failure) + '\n')
  process.exit(1)
})
