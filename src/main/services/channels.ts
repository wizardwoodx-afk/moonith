import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { ChannelInput, ChannelRecord, ChannelState, Task } from '@shared/types'
import { agentRuntime } from '../agent/runtime'
import { subscribeTaskEvents } from '../emitter'
import { store } from '../store'
import { nowIso, truncate } from '../util'
import { protectChannelReply, telegramChatAuthorized } from './channelPolicy'
import { resolveAgentName } from '@shared/identity'

/** Fallbacks are sent out to the other side of a channel, so they use the chosen name. */
function agentLabel(): string {
  try {
    return resolveAgentName(store.getPublicSettings().agentName)
  } catch {
    return resolveAgentName()
  }
}

const MAX_BODY = 64 * 1024
const WEBHOOK_TIMEOUT = 180_000
const TELEGRAM_TIMEOUT = 300_000
const MAX_TEXT = 8000

interface DeliveryResult {
  taskId: string
  reply: string | null
  pending?: boolean
}

function replyForChannel(reply: string | null): string | null {
  if (reply === null) return null
  const protectedReply = protectChannelReply(reply, store.getGovernanceSettings().dlp)
  return protectedReply.text ?? 'SelfImpulse blocked this response under the enterprise DLP policy.'
}

function lastAssistant(task: Task): string {
  for (let index = task.messages.length - 1; index >= 0; index--) {
    const message = task.messages[index]
    if (message.role === 'assistant' && !message.hidden && message.content.trim()) {
      return message.content.trim()
    }
  }
  return ''
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}

class ChannelService {
  private server: Server | null = null
  private port: number | null = null
  private pollers = new Map<string, AbortController>()
  private conversationTasks = new Map<string, string>()

  getState(): ChannelState {
    return {
      channels: store.listChannels(),
      running: Boolean(this.server) || this.pollers.size > 0,
      port: this.port
    }
  }

  async start(): Promise<void> {
    this.stop()
    const channels = store.listChannels()
    const webhooks = channels.filter(
      (channel) => channel.kind === 'webhook' && channel.enabled && channel.hasToken
    )
    if (webhooks.length) await this.startServer(webhooks)
    for (const channel of channels) {
      if (channel.kind === 'telegram' && channel.enabled) {
        const token = store.getChannelToken(channel.id)
        if (token && channel.allowedChatIds.length === 0) {
          await store.updateChannel(channel.id, {
            error: 'Telegram is locked until at least one numeric chat ID is allowed.'
          })
        } else if (token) {
          this.startTelegram(channel, token)
        } else {
          await store.updateChannel(channel.id, { error: 'Add a bot token to connect.' })
        }
      }
    }
  }

  async restart(): Promise<ChannelState> {
    await this.start()
    return this.getState()
  }

  async upsert(input: ChannelInput): Promise<ChannelState> {
    await store.upsertChannel(input)
    await this.start()
    return this.getState()
  }

  async remove(id: string): Promise<ChannelState> {
    await store.removeChannel(id)
    await this.start()
    return this.getState()
  }

  dispose(): void {
    this.stop()
  }

  private stop(): void {
    if (this.server) {
      this.server.close()
      this.server = null
    }
    this.port = null
    for (const controller of this.pollers.values()) controller.abort()
    this.pollers.clear()
  }

  private async startServer(webhooks: ChannelRecord[]): Promise<void> {
    const server = createServer((request, response) => {
      void this.handleHttp(request, response).catch((error) => {
        this.respond(response, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      })
    })
    await new Promise<void>((resolve) => {
      server.once('error', () => resolve())
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      for (const channel of webhooks) {
        await store.updateChannel(channel.id, {
          error: 'The local webhook could not bind to a port.'
        })
      }
      return
    }
    this.server = server
    this.port = address.port
    for (const channel of webhooks) {
      await store.updateChannel(channel.id, { port: address.port, error: undefined })
    }
    // eslint-disable-next-line no-console
    console.log(`[channels] local webhook listening on 127.0.0.1:${address.port}`)
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'POST') {
      this.respond(response, 405, { ok: false, error: 'Use POST for inbound messages.' })
      return
    }
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${this.port ?? 0}`)
    const match = /^\/inbound\/([A-Za-z0-9_-]+)$/.exec(url.pathname)
    if (!match) {
      this.respond(response, 404, { ok: false, error: 'Unknown channel endpoint.' })
      return
    }
    const channel = store.getChannel(match[1])
    if (!channel || channel.kind !== 'webhook' || !channel.enabled) {
      this.respond(response, 404, { ok: false, error: 'That channel is not running.' })
      return
    }
    const secret = store.getChannelToken(channel.id)
    if (!this.authorized(request, secret)) {
      this.respond(response, 401, { ok: false, error: 'Invalid channel token.' })
      return
    }

    let body = ''
    for await (const chunk of request) {
      body += chunk.toString()
      if (body.length > MAX_BODY) {
        this.respond(response, 413, { ok: false, error: 'Message too large.' })
        return
      }
    }
    let parsed: { text?: unknown; conversationId?: unknown; from?: unknown }
    try {
      parsed = JSON.parse(body || '{}') as typeof parsed
    } catch {
      this.respond(response, 400, { ok: false, error: 'Send a JSON body.' })
      return
    }
    const text = typeof parsed.text === 'string' ? parsed.text.trim().slice(0, MAX_TEXT) : ''
    if (!text) {
      this.respond(response, 400, { ok: false, error: 'Include a text field.' })
      return
    }
    const conversation =
      (typeof parsed.conversationId === 'string' && parsed.conversationId.slice(0, 120)) ||
      (typeof parsed.from === 'string' && parsed.from.slice(0, 120)) ||
      'default'

    const publicChannel = store.listChannels().find((item) => item.id === channel.id)
    if (!publicChannel) {
      this.respond(response, 404, { ok: false, error: 'That channel is not running.' })
      return
    }
    const result = await this.deliver(publicChannel, text, conversation, WEBHOOK_TIMEOUT)
    this.respond(response, result.pending ? 202 : 200, {
      ok: true,
      taskId: result.taskId,
      pending: Boolean(result.pending),
      reply: replyForChannel(result.reply)
    })
  }

  private authorized(request: IncomingMessage, secret: string | undefined): boolean {
    if (!secret) return false
    const header = request.headers['x-selfimpulse-token'] ?? request.headers['x-knight-token']
    const authorization = request.headers.authorization
    const provided = Array.isArray(header)
      ? header[0]
      : header ||
        (typeof authorization === 'string' && authorization.startsWith('Bearer ')
          ? authorization.slice(7)
          : '')
    if (!provided) return false
    const left = Buffer.from(String(provided))
    const right = Buffer.from(secret)
    return left.length === right.length && timingSafeEqual(left, right)
  }

  private respond(response: ServerResponse, status: number, body: unknown): void {
    if (response.writableEnded) return
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    })
    response.end(JSON.stringify(body))
  }

  private async deliver(
    channel: ChannelRecord,
    text: string,
    conversationId: string,
    timeoutMs: number
  ): Promise<DeliveryResult> {
    const key = `${channel.id}:${conversationId}`
    let taskId = this.conversationTasks.get(key)
    let task = taskId ? store.getTask(taskId) : undefined
    if (!task) {
      const settings = store.getPublicSettings()
      task = await store.createTask({
        title: truncate(text.split(/\r?\n/)[0] ?? 'Channel message', 70),
        objective: text,
        mode: 'chat',
        permissionMode: settings.defaultPermissionMode,
        providerId: settings.defaultProviderId,
        model: settings.defaultModel
      })
      this.conversationTasks.set(key, task.id)
    }
    await store.updateChannel(channel.id, {
      messagesIn: channel.messagesIn + 1,
      lastMessageAt: nowIso(),
      error: undefined
    })
    const replyPromise = this.waitForReply(task.id, timeoutMs)
    await agentRuntime.sendMessage({ taskId: task.id, text })
    const reply = await replyPromise
    if (reply === null) return { taskId: task.id, reply: null, pending: true }
    await store.updateChannel(channel.id, { messagesOut: channel.messagesOut + 1 })
    return { taskId: task.id, reply }
  }

  private waitForReply(taskId: string, timeoutMs: number): Promise<string | null> {
    return new Promise((resolve) => {
      let settled = false
      let waitingSince = 0
      const finish = (value: string | null): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      }
      const check = (): void => {
        const task = store.getTask(taskId)
        if (!task) return finish(`This conversation ended before ${agentLabel()} replied.`)
        if (task.status === 'done') {
          return finish(lastAssistant(task) || `${agentLabel()} finished without a written reply.`)
        }
        if (task.status === 'error') {
          return finish(`The task failed: ${task.error ?? 'unknown error'}`)
        }
        if (task.status === 'paused') {
          return finish(lastAssistant(task) || 'The task was paused before a reply was written.')
        }
        if (task.status === 'waiting') {
          if (!waitingSince) waitingSince = Date.now()
          if (Date.now() - waitingSince > 45_000) {
            return finish(
              'This task is waiting for your approval in SelfImpulse. Open the task to approve or deny the action, then send your message again.'
            )
          }
        } else {
          waitingSince = 0
        }
      }
      const unsubscribe = subscribeTaskEvents((event) => {
        if (event.type === 'task' && event.task.id === taskId) check()
      })
      const interval = setInterval(check, 800)
      const deadline = setTimeout(() => finish(null), timeoutMs)
      const cleanup = (): void => {
        unsubscribe()
        clearInterval(interval)
        clearTimeout(deadline)
      }
    })
  }

  private startTelegram(channel: ChannelRecord, token: string): void {
    const controller = new AbortController()
    this.pollers.set(channel.id, controller)
    void this.pollTelegram(channel, token, controller.signal)
  }

  private async pollTelegram(
    channel: ChannelRecord,
    token: string,
    signal: AbortSignal
  ): Promise<void> {
    let offset = 0
    while (!signal.aborted) {
      try {
        const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`)
        url.searchParams.set('timeout', '25')
        url.searchParams.set('offset', String(offset))
        url.searchParams.set('allowed_updates', '["message"]')
        const response = await fetch(url, { signal })
        const json = (await response.json()) as {
          ok?: boolean
          description?: string
          result?: Array<{
            update_id: number
            message?: {
              text?: string
              chat?: { id?: number }
              from?: { is_bot?: boolean; username?: string }
            }
          }>
        }
        if (!json.ok) throw new Error(json.description || `Telegram returned ${response.status}.`)
        for (const update of json.result ?? []) {
          offset = Math.max(offset, update.update_id + 1)
          const message = update.message
          const text = message?.text?.trim()
          const chatId = message?.chat?.id
          if (!text || chatId === undefined || message?.from?.is_bot) continue
          if (!telegramChatAuthorized(channel.allowedChatIds, chatId)) continue
          void this.handleTelegram(channel.id, token, chatId, text)
        }
        const stored = store.getChannel(channel.id)
        if (stored?.error) await store.updateChannel(channel.id, { error: undefined })
      } catch (error) {
        if (signal.aborted) return
        const message = error instanceof Error ? error.message : String(error)
        await store.updateChannel(channel.id, { error: truncate(message, 300) })
        await sleep(5000, signal)
      }
    }
  }

  private async handleTelegram(
    channelId: string,
    token: string,
    chatId: number,
    text: string
  ): Promise<void> {
    const channel = store.listChannels().find((item) => item.id === channelId)
    if (!channel || !telegramChatAuthorized(channel.allowedChatIds, chatId)) return
    try {
      const result = await this.deliver(channel, text, `tg:${chatId}`, TELEGRAM_TIMEOUT)
      const reply = replyForChannel(
        result.reply ??
          'The task is still running. Open SelfImpulse to follow it; I will not send a partial answer here.'
      )
      if (reply !== null) await this.sendTelegram(channelId, token, chatId, reply)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await store.updateChannel(channelId, { error: truncate(message, 300) })
      await this.sendTelegram(
        channelId,
        token,
        chatId,
        `SelfImpulse could not complete that: ${message}`
      ).catch(() => undefined)
    }
  }

  private async sendTelegram(
    channelId: string,
    token: string,
    chatId: number,
    text: string
  ): Promise<void> {
    const channel = store.listChannels().find((item) => item.id === channelId)
    if (!channel || !channel.enabled || !telegramChatAuthorized(channel.allowedChatIds, chatId)) {
      return
    }
    const protectedReply = protectChannelReply(text, store.getGovernanceSettings().dlp)
    const approvedText =
      protectedReply.text ?? 'SelfImpulse blocked this response under the enterprise DLP policy.'
    const chunks = approvedText.match(/[\s\S]{1,3900}/g) ?? [approvedText]
    for (const chunk of chunks) {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: chunk }),
        signal: AbortSignal.timeout(20000)
      })
      if (!response.ok) throw new Error(`Telegram send failed (${response.status}).`)
    }
  }
}

export const channelService = new ChannelService()
