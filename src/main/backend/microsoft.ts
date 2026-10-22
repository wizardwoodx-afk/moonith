import { execFileSync } from 'node:child_process'
import type { WireMessage } from './provider'
import type { SecretStore } from './security'
import type { BackendStore } from './store'

/**
 * Microsoft integration for Knight Cowork.
 *
 * Two things live here:
 *
 *   1. GitHub Copilot as a *model provider* and as an *MCP server*.
 *      The Copilot API (api.githubcopilot.com) is OpenAI-compatible and speaks
 *      the same protocol as the models endpoint, and the same host serves the
 *      official GitHub MCP Server (repositories, issues, pull requests, code
 *      search). Authentication is the user's own GitHub token.
 *
 *   2. Microsoft 365 Copilot data through the Microsoft Graph API — the surface
 *      Copilot 365 itself reasons over: OneDrive and SharePoint files, Word and
 *      Excel documents, Outlook mail, the calendar and Teams chats. Graph is
 *      reached with an OAuth 2.0 device-code flow, so the user signs in with
 *      their own Microsoft account and no secret ever touches the app.
 *
 * Ported from Seamoon's `electron/backend/microsoft.js`.
 */

export const COPILOT_API = 'https://api.githubcopilot.com'
export const COPILOT_MCP = 'https://api.githubcopilot.com/mcp/'
const GRAPH = 'https://graph.microsoft.com/v1.0'
const LOGIN = 'https://login.microsoftonline.com/common/oauth2/v2.0'
export const MS_LEARN_MCP = 'https://learn.microsoft.com/api/mcp'

/* ------------------------------------------------------------------ */
/* GitHub Copilot                                                      */
/* ------------------------------------------------------------------ */

export interface CopilotModel {
  id?: string
  label?: string
  family: string
  context: number
  output: number
}

export interface CopilotChatResponse {
  choices?: Array<{
    message?: { role?: string; content?: string | null }
    finish_reason?: string
    [key: string]: unknown
  }>
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  [key: string]: unknown
}

export interface CopilotChatOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

/** A connector definition the MCP manager can dial. */
export interface McpConnector {
  id: string
  name: string
  url: string
  headers: Record<string, string>
  enabled: boolean
  source: string
}

interface CopilotModelEntry {
  id?: string
  name?: string
  label?: string
  capabilities?: {
    family?: string
    limits?: {
      max_context_window_tokens?: number
      max_output_tokens?: number
    }
  }
}

export class Copilot {
  readonly store: BackendStore
  /** The keychain, when one is available. The token is preferred there. */
  readonly secrets?: SecretStore

  constructor(store: BackendStore, secrets?: SecretStore) {
    this.store = store
    this.secrets = secrets
  }

  /** The user's own GitHub token: the keychain, else the stored one, else the gh CLI's. */
  token(): string {
    const sealed = this.secrets?.get('copilotToken')
    if (sealed) return sealed
    const stored = this.store.settings.all().copilotToken
    if (typeof stored === 'string' && stored) return stored
    try {
      const t = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 8000 }).trim()
      return t || ''
    } catch {
      return ''
    }
  }

  connected(): boolean {
    return Boolean(this.token())
  }

  headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${this.token()}`,
      'Copilot-Integration-Id': 'knight',
      'Editor-Version': 'vscode/1.95.0'
    }
  }

  /** The live model catalogue the user's Copilot subscription can reach. */
  async models(): Promise<CopilotModel[]> {
    const res = await fetch(`${COPILOT_API}/models`, { headers: this.headers() })
    if (!res.ok) {
      throw new Error(`Copilot models failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
    }
    const json = (await res.json()) as { data?: CopilotModelEntry[] }
    return (json.data || []).map((m) => ({
      id: m.id || m.name,
      label: m.label || m.id || m.name,
      family: m.capabilities?.family || '',
      context: m.capabilities?.limits?.max_context_window_tokens || 0,
      output: m.capabilities?.limits?.max_output_tokens || 0
    }))
  }

  /** A working chat completion against the Copilot API. */
  async chat(
    messages: WireMessage[],
    { model, temperature, maxTokens, signal }: CopilotChatOptions = {}
  ): Promise<CopilotChatResponse> {
    const res = await fetch(`${COPILOT_API}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: model || 'gpt-4o',
        messages,
        stream: false,
        ...(temperature !== undefined ? { temperature } : {}),
        ...(maxTokens ? { max_tokens: maxTokens } : {})
      }),
      signal
    })
    if (!res.ok) {
      throw new Error(`Copilot chat failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
    }
    return (await res.json()) as CopilotChatResponse
  }

  /** The official GitHub MCP Server, as a connector definition. */
  mcpConnector(): McpConnector {
    return {
      id: 'github-copilot-mcp',
      name: 'GitHub MCP Server (Copilot)',
      url: COPILOT_MCP,
      headers: { Authorization: `Bearer ${this.token()}` },
      enabled: true,
      source: 'copilot'
    }
  }

  /** Microsoft's own documentation MCP server — no key needed. */
  learnConnector(): McpConnector {
    return {
      id: 'microsoft-learn-mcp',
      name: 'Microsoft Learn',
      url: MS_LEARN_MCP,
      headers: {},
      enabled: true,
      source: 'microsoft'
    }
  }
}

/* ------------------------------------------------------------------ */
/* Microsoft 365 (Graph)                                                */
/* ------------------------------------------------------------------ */

export const M365_SCOPES = 'User.Read Files.ReadWrite Mail.ReadWrite Calendars.ReadWrite Chat.Read'

/** The Microsoft account record, as kept in the settings collection. */
export type M365Account = {
  clientId?: string
  deviceCode?: string
  interval?: number
  expiresIn?: number
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  [key: string]: unknown
}

export interface M365SignInPrompt {
  userCode?: string
  verificationUri?: string
  message?: string
  expiresIn?: number
}

export type M365SignInResult = { pending: true } | { pending: false; connected: true }

export interface GraphOptions {
  method?: string
  body?: unknown
  query?: Record<string, unknown>
}

export interface M365SendMailInput {
  to?: string
  subject?: string
  body?: string
}

export interface M365SearchHit {
  name?: string
  webUrl?: string
  size?: number
  lastModifiedDateTime?: string
  file?: { mimeType?: string }
  [key: string]: unknown
}

export interface M365SearchContainer {
  hits?: M365SearchHit[]
  [key: string]: unknown
}

export interface M365File {
  id?: string
  name?: string
  type: 'folder' | 'file'
  size?: number
  webUrl?: string
  modified?: string
}

export interface M365FileContent {
  name?: string
  webUrl?: string
  size?: number
  mime?: string
  content: string
}

export interface M365MailMessage {
  id?: string
  subject?: string
  from?: string
  received?: string
  read?: boolean
  preview?: string
}

export interface M365CalendarEvent {
  subject?: string
  start?: string
  end?: string
  organizer?: string
  location?: string
}

export interface M365Chat {
  id?: string
  topic: string
}

interface DeviceCodeResponse {
  device_code?: string
  user_code?: string
  verification_uri?: string
  message?: string
  interval?: number
  expires_in?: number
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function flag(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

export class M365 {
  readonly store: BackendStore

  constructor(store: BackendStore) {
    this.store = store
  }

  get account(): M365Account {
    return (this.store.settings.get('m365') ?? {}) as M365Account
  }

  connected(): boolean {
    return Boolean(this.account.accessToken)
  }

  clientId(): string {
    return this.account.clientId || ''
  }

  /** Write the account back, merged with whatever is already stored. */
  private persist(patch: M365Account): void {
    this.store.settings.set('m365', { ...this.account, ...patch })
  }

  /**
   * Start the device-code flow. The app shows the code, the user signs in on
   * their own machine, and Knight polls for the token.
   */
  async beginSignIn(clientId: string): Promise<M365SignInPrompt> {
    if (!clientId) throw new Error('A Microsoft Entra app client id is required.')
    const res = await fetch(`${LOGIN}/devicecode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, scope: M365_SCOPES }).toString()
    })
    if (!res.ok) {
      throw new Error(`Microsoft sign-in failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
    }
    const json = (await res.json()) as DeviceCodeResponse
    this.persist({
      ...this.account,
      clientId,
      deviceCode: json.device_code,
      interval: json.interval,
      expiresIn: json.expires_in
    })
    return {
      userCode: json.user_code,
      verificationUri: json.verification_uri,
      message: json.message,
      expiresIn: json.expires_in
    }
  }

  /** Poll for the token the device code will produce. */
  async completeSignIn(): Promise<M365SignInResult> {
    const { clientId, deviceCode } = this.account
    if (!clientId || !deviceCode) throw new Error('Start the sign-in first.')
    const res = await fetch(`${LOGIN}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode
      }).toString()
    })
    const json = (await res.json()) as TokenResponse
    if (json.error) {
      if (json.error === 'authorization_pending') return { pending: true }
      throw new Error(json.error_description || json.error)
    }
    this.persist({
      ...this.account,
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: Date.now() + (json.expires_in || 3600) * 1000,
      deviceCode: undefined
    })
    return { pending: false, connected: true }
  }

  async disconnect(): Promise<{ ok: true }> {
    this.persist({
      ...this.account,
      accessToken: undefined,
      refreshToken: undefined,
      expiresAt: 0
    })
    return { ok: true }
  }

  async token(): Promise<string | undefined> {
    const { accessToken, refreshToken, expiresAt, clientId } = this.account
    if (accessToken && expiresAt && expiresAt > Date.now() + 60000) return accessToken
    if (!refreshToken || !clientId) return accessToken || ''
    // refresh
    const res = await fetch(`${LOGIN}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: M365_SCOPES
      }).toString()
    })
    const json = (await res.json()) as TokenResponse
    if (json.error) throw new Error(json.error_description || json.error)
    this.persist({
      ...this.account,
      accessToken: json.access_token,
      refreshToken: json.refresh_token || refreshToken,
      expiresAt: Date.now() + (json.expires_in || 3600) * 1000
    })
    return json.access_token
  }

  async graph(path: string, { method = 'GET', body, query }: GraphOptions = {}): Promise<Record<string, unknown>> {
    const token = await this.token()
    if (!token) throw new Error('Microsoft 365 is not connected.')
    const url = new URL(`${GRAPH}${path.startsWith('/') ? path : `/${path}`}`)
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
    }
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    })
    if (res.status === 204) return {}
    const text = await res.text()
    let json: Record<string, unknown> = {}
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {}
    } catch {
      json = { raw: text }
    }
    if (!res.ok) {
      const error = json.error
      const message = isRecord(error) ? error.message : undefined
      const msg = message || `Graph ${res.status}`
      throw new Error(String(msg).slice(0, 300))
    }
    return json
  }

  /** Who am I. */
  async me(): Promise<Record<string, unknown>> {
    return this.graph('/me?$select=id,displayName,mail,userPrincipalName,jobTitle')
  }

  /** Files across OneDrive and SharePoint. */
  async searchFiles(query: string | undefined, limit = 25): Promise<M365SearchContainer[]> {
    const json = await this.graph('/search/query', {
      method: 'POST',
      body: {
        requests: [
          {
            entityTypes: ['driveItem'],
            query: { queryString: query },
            from: 0,
            size: limit,
            fields: ['id', 'name', 'webUrl', 'size', 'lastModifiedDateTime', 'file']
          }
        ]
      }
    })
    const first = toArray(json.value)[0]
    const containers = isRecord(first) ? first.hitsContainers : undefined
    return toArray(containers) as M365SearchContainer[]
  }

  async listFiles(folder = 'root', limit = 50): Promise<M365File[]> {
    const json = await this.graph(`/me/drive/root/children`, { query: { $top: limit } })
    return toArray(json.value).map((entry) => {
      const file = isRecord(entry) ? entry : {}
      return {
        id: str(file.id),
        name: str(file.name),
        type: file.folder ? 'folder' : 'file',
        size: num(file.size),
        webUrl: str(file.webUrl),
        modified: str(file.lastModifiedDateTime)
      }
    })
  }

  /** The text of a drive item (Word, Excel, text, markdown…). */
  async readFile(itemId: string | undefined): Promise<M365FileContent> {
    const meta = await this.graph(`/me/drive/items/${itemId}?$select=id,name,size,webUrl,file`)
    const content = await this.graph(`/me/drive/items/${itemId}/content`)
    const text = typeof content === 'string' ? content : JSON.stringify(content)
    const file = isRecord(meta.file) ? meta.file : {}
    return {
      name: str(meta.name),
      webUrl: str(meta.webUrl),
      size: num(meta.size),
      mime: str(file.mimeType),
      content: text.slice(0, 20000)
    }
  }

  async listMail(folder = 'inbox', limit = 20): Promise<M365MailMessage[]> {
    const json = await this.graph(`/me/mailFolders/${folder}/messages`, {
      query: { $top: limit, $select: 'subject,from,receivedDateTime,isRead,bodyPreview' }
    })
    return toArray(json.value).map((entry) => {
      const message = isRecord(entry) ? entry : {}
      const from = isRecord(message.from) ? message.from : {}
      const address = isRecord(from.emailAddress) ? from.emailAddress : {}
      return {
        id: str(message.id),
        subject: str(message.subject),
        from: str(address.address),
        received: str(message.receivedDateTime),
        read: flag(message.isRead),
        preview: str(message.bodyPreview)
      }
    })
  }

  async sendMail({ to, subject, body }: M365SendMailInput): Promise<{ ok: true; sent: boolean }> {
    const json = await this.graph('/me/sendMail', {
      method: 'POST',
      body: {
        message: {
          subject,
          body: { contentType: 'Text', content: body },
          toRecipients: [{ emailAddress: { address: to } }]
        }
      }
    })
    return { ok: true, sent: Boolean(json) }
  }

  async listCalendar(
    startIso: string | undefined,
    endIso: string | undefined,
    limit = 25
  ): Promise<M365CalendarEvent[]> {
    const json = await this.graph('/me/calendarView', {
      query: {
        startDateTime: startIso,
        endDateTime: endIso,
        $top: limit,
        $select: 'subject,start,end,organizer,location'
      }
    })
    return toArray(json.value).map((entry) => {
      const event = isRecord(entry) ? entry : {}
      const start = isRecord(event.start) ? event.start : {}
      const end = isRecord(event.end) ? event.end : {}
      const organizer = isRecord(event.organizer) ? event.organizer : {}
      const organizerAddress = isRecord(organizer.emailAddress) ? organizer.emailAddress : {}
      const location = isRecord(event.location) ? event.location : {}
      return {
        subject: str(event.subject),
        start: str(start.dateTime),
        end: str(end.dateTime),
        organizer: str(organizerAddress.address),
        location: str(location.displayName)
      }
    })
  }

  async listChats(limit = 20): Promise<M365Chat[]> {
    const json = await this.graph('/me/chats', { query: { $top: limit } })
    return toArray(json.value).map((entry) => {
      const chat = isRecord(entry) ? entry : {}
      return { id: str(chat.id), topic: str(chat.topic) || '(no topic)' }
    })
  }
}

/* ------------------------------------------------------------------ */
/* The tools the agent can call                                        */
/* ------------------------------------------------------------------ */

export interface M365ToolParameter {
  type: 'string' | 'number' | 'boolean'
  description?: string
}

export type M365ToolParameters = {
  type: 'object'
  properties: Record<string, M365ToolParameter>
  required?: string[]
}

export interface M365ToolFunction {
  name: string
  description: string
  parameters: M365ToolParameters
}

/** An OpenAI-style function spec, with the flat fields the provider expects. */
export interface M365ToolSpec extends M365ToolFunction {
  type: 'function'
  function: M365ToolFunction
}

export type M365ToolArgs = {
  query?: string
  limit?: number
  folder?: string
  itemId?: string
  start?: string
  end?: string
  to?: string
  subject?: string
  body?: string
  [key: string]: unknown
}

export type M365ToolResult =
  | { ok: true; hits: M365SearchContainer[] }
  | { ok: true; files: M365File[] }
  | { ok: true; file: M365FileContent }
  | { ok: true; messages: M365MailMessage[] }
  | { ok: true; sent: boolean }
  | { ok: true; events: M365CalendarEvent[] }
  | { ok: true; chats: M365Chat[] }
  | { ok: false; error: string }

export type M365ToolRunner = (name: string, args: M365ToolArgs) => Promise<M365ToolResult>

function toolSpec(name: string, description: string, parameters: M365ToolParameters): M365ToolSpec {
  return {
    type: 'function',
    function: { name, description, parameters },
    name,
    description,
    parameters
  }
}

export function m365ToolSpecs(): M365ToolSpec[] {
  return [
    toolSpec(
      'm365_search_files',
      "Search the user's OneDrive and SharePoint files (the Microsoft 365 Copilot surface).",
      {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'number' } },
        required: ['query']
      }
    ),
    toolSpec('m365_list_files', "List the files in the user's OneDrive root.", {
      type: 'object',
      properties: { folder: { type: 'string' } }
    }),
    toolSpec(
      'm365_read_file',
      'Read the contents of a Microsoft 365 document by its drive item id.',
      {
        type: 'object',
        properties: { itemId: { type: 'string' } },
        required: ['itemId']
      }
    ),
    toolSpec('m365_list_mail', 'List mail from a folder (inbox by default).', {
      type: 'object',
      properties: { folder: { type: 'string' }, limit: { type: 'number' } }
    }),
    toolSpec('m365_send_mail', "Send an email from the user's account.", {
      type: 'object',
      properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } },
      required: ['to', 'subject', 'body']
    }),
    toolSpec('m365_list_calendar', 'List calendar events between two ISO timestamps.', {
      type: 'object',
      properties: { start: { type: 'string' }, end: { type: 'string' }, limit: { type: 'number' } },
      required: ['start', 'end']
    }),
    toolSpec('m365_list_chats', "List the user's Teams chats.", {
      type: 'object',
      properties: { limit: { type: 'number' } }
    })
  ]
}

/** The dispatcher the agent uses for the m365_* tools. */
export function makeM365Runner(m365: M365): M365ToolRunner {
  return async (name, args) => {
    switch (name) {
      case 'm365_search_files':
        return { ok: true, hits: await m365.searchFiles(args.query, args.limit || 25) }
      case 'm365_list_files':
        return { ok: true, files: await m365.listFiles(args.folder || 'root') }
      case 'm365_read_file':
        return { ok: true, file: await m365.readFile(args.itemId) }
      case 'm365_list_mail':
        return { ok: true, messages: await m365.listMail(args.folder || 'inbox', args.limit || 20) }
      case 'm365_send_mail':
        return await m365.sendMail(args)
      case 'm365_list_calendar':
        return { ok: true, events: await m365.listCalendar(args.start, args.end, args.limit || 25) }
      case 'm365_list_chats':
        return { ok: true, chats: await m365.listChats(args.limit || 20) }
      default:
        return { ok: false, error: `Unknown tool "${name}"` }
    }
  }
}
