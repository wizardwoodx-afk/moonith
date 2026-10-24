import { spawn } from 'node:child_process'
import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import { shell } from 'electron'
import { click, focusWindow, hotkey, screenshot, scroll, type as typeText } from './computer'
import type { Screenshot } from './computer'

/**
 * Grounded Actions, imported as a SelfImpulse capability.
 *
 * Grounded Actions is ByteDance's GUI agent: given a screenshot and an instruction it
 * grounds a target and emits one action from a fixed action space. It normally
 * ships as its own desktop application; here its core — the action space, the
 * system prompt, the action parser and the observe→act loop — is a capability
 * inside the backend, driven by the same computer-use operator.
 *
 * Recovered with REA from github.com/bytedance/Grounded Actions-desktop
 * (multimodal/gui-agent/{shared,action-parser}, multimodal/agent-tars/core).
 *
 * Ported from the earlier desktop shell.
 */

/* ------------------------------------------------------------------ */
/* Action space (shared/src/types/actions.ts)                            */
/* ------------------------------------------------------------------ */

export type ActionType =
  | 'screenshot'
  | 'click'
  | 'right_click'
  | 'double_click'
  | 'middle_click'
  | 'mouse_down'
  | 'mouse_up'
  | 'mouse_move'
  | 'drag'
  | 'scroll'
  | 'type'
  | 'hotkey'
  | 'press'
  | 'release'
  | 'navigate'
  | 'navigate_back'
  | 'long_press'
  | 'swipe'
  | 'home'
  | 'back'
  | 'open_app'
  | 'wait'
  | 'finished'
  | 'call_user'

export type ActionCategory = 'system' | 'mouse' | 'keyboard' | 'navigation' | 'mobile' | 'wait'

export interface ActionSpec {
  type: ActionType
  category: ActionCategory
  description: string
}

export const ACTION_SPACE: ActionSpec[] = [
  { type: 'screenshot', category: 'system', description: 'Take a screenshot of the screen' },
  { type: 'click', category: 'mouse', description: 'Click on an element' },
  { type: 'right_click', category: 'mouse', description: 'Right click on an element' },
  { type: 'double_click', category: 'mouse', description: 'Double click on an element' },
  { type: 'middle_click', category: 'mouse', description: 'Middle click on an element' },
  { type: 'mouse_down', category: 'mouse', description: 'Press the mouse button down' },
  { type: 'mouse_up', category: 'mouse', description: 'Release the mouse button' },
  { type: 'mouse_move', category: 'mouse', description: 'Move the mouse to a position' },
  { type: 'drag', category: 'mouse', description: 'Drag from one point to another' },
  { type: 'scroll', category: 'mouse', description: 'Scroll in a direction' },
  { type: 'type', category: 'keyboard', description: 'Type text into the focused field' },
  { type: 'hotkey', category: 'keyboard', description: 'Press a key combination' },
  { type: 'press', category: 'keyboard', description: 'Press a single key' },
  { type: 'release', category: 'keyboard', description: 'Release a key' },
  { type: 'navigate', category: 'navigation', description: 'Navigate to a URL' },
  { type: 'navigate_back', category: 'navigation', description: 'Go back' },
  { type: 'long_press', category: 'mouse', description: 'Press and hold' },
  { type: 'swipe', category: 'mouse', description: 'Swipe in a direction' },
  { type: 'home', category: 'mobile', description: 'Go to the home screen' },
  { type: 'back', category: 'mobile', description: 'Go back' },
  { type: 'open_app', category: 'system', description: 'Open an application' },
  { type: 'wait', category: 'wait', description: 'Wait for the screen to settle' },
  { type: 'finished', category: 'system', description: 'The task is complete' },
  { type: 'call_user', category: 'system', description: 'Ask the user for help' }
]

/* The 1.5 prompt's own action list (multimodal/gui-agent/agent-sdk/src/prompts.ts) */
export const PROMPT_1_5_ACTIONS: string[] = [
  "click(start_box='<|box_start|>(x1,y1)<|box_end|>')",
  "left_double(start_box='<|box_start|>(x1,y1)<|box_end|>')",
  "right_single(start_box='<|box_start|>(x1,y1)<|box_end|>')",
  "drag(start_box='<|box_start|>(x1,y1)<|box_end|>', end_box='<|box_start|>(x3,y3)<|box_end|>')",
  "hotkey(key='ctrl c')",
  "type(content='xxx')",
  "scroll(start_box='<|box_start|>(x1,y1)<|box_end|>', direction='down or up or right or left')",
  'wait()',
  'finished()',
  'call_user()'
]

export interface SystemPromptOptions {
  language?: string
  actionSpace?: string[]
}

export function systemPrompt({
  language = 'en',
  actionSpace = PROMPT_1_5_ACTIONS
}: SystemPromptOptions = {}): string {
  const lang = language === 'zh' ? 'Chinese' : 'English'
  return `You are a GUI agent. You are given a task and your action history, with screenshots. You need to perform the next action to complete the task.

## Output Format
\`\`\`
Thought: ...
Action: ...
\`\`\`

## Action Space
${actionSpace.join('\n')}

## Note
- Use ${lang} in \`Thought\` part.
- Write a small plan and finally summarize your next action (with its target element) in one sentence in \`Thought\` part.

## User Instruction
`
}

/* ------------------------------------------------------------------ */
/* Action parser (action-parser/src/*)                                  */
/* ------------------------------------------------------------------ */

/** A grounded box in the model's own 0-1000 coordinate space. */
export interface Box {
  x: number
  y: number
  x2?: number
  y2?: number
}

export type ActionInputValue = string | number | Box | null

export interface ActionInputs {
  __type?: string
  [key: string]: ActionInputValue | undefined
}

export interface ParsedAction {
  type: string
  inputs: ActionInputs
  raw: string
}

/** Normalises the many shapes the model emits into { type, inputs }. */
export function parseAction(raw: unknown): ParsedAction | null {
  if (!raw) return null
  let text = String(raw).trim()

  // the model may answer with Thought/Action blocks
  const actionLine = text.match(/Action\s*:\s*([\s\S]+)$/i)
  if (actionLine) text = actionLine[1].trim()

  // drop the model's own special tokens
  text = text.replace(/<\|box_start\|>|<\|box_end\|>/g, '')

  // point= -> start_box=, start_point= -> start_box=, end_point= -> end_box=
  text = text
    .replace(/(?<!start_|end_)point=/g, 'start_box=')
    .replace(/start_point=/g, 'start_box=')
    .replace(/end_point=/g, 'end_box=')

  const call = /^([a-z_]+)\s*(?:\((.*)\))?$/is.exec(text)
  if (!call) return null
  const type = call[1].trim()
  const body = call[2] || ''

  const inputs: ActionInputs = {}
  const paramRe = /([a-z_]+)\s*=\s*(['"])([\s\S]*?)\2/g
  let m: RegExpExecArray | null
  while ((m = paramRe.exec(body)) !== null) {
    inputs[m[1]] = m[3]
  }
  // bare numeric params, e.g. scroll(direction='down', amount=3)
  const bareRe = /([a-z_]+)\s*=\s*([-\d.]+)(?=\s*[,)])/gi
  while ((m = bareRe.exec(body)) !== null) inputs[m[1]] = Number(m[2])

  // normalise the coordinate shapes
  for (const key of ['start_box', 'end_box', 'start_coords', 'end_coords', 'point']) {
    if (inputs[key] === undefined) continue
    inputs[key] = parseBox(inputs[key])
  }
  if (inputs.start_box && inputs.end_box === undefined) inputs.end_box = inputs.start_box

  if (type === 'left_double') inputs.__type = 'double_click'
  if (type === 'right_single') inputs.__type = 'right_click'

  return { type, inputs, raw: String(raw).trim() }
}

/** "(x1,y1,x2,y2)" | "x1,y1" | "x1 y1 x2 y2" -> { x, y, x2, y2 } */
export function parseBox(value: unknown): Box | null | undefined {
  if (value === undefined || value === null) return value === undefined ? undefined : null
  let v = String(value)
  if (v.includes('<point>')) v = v.replace(/<\/?point>/g, ' ')
  if (v.includes('<bbox>')) v = v.replace(/<\/?bbox>/g, ' ')
  const nums = v.match(/-?\d+(?:\.\d+)?/g)
  if (!nums || !nums.length) return null
  const n = nums.map(Number)
  if (n.length >= 4) return { x: n[0], y: n[1], x2: n[2], y2: n[3] }
  return { x: n[0], y: n[1] }
}

interface Point {
  x: number
  y: number
}

function boxCenter(box: Box | null | undefined): Point | null {
  if (!box) return null
  if (box.x2 !== undefined && box.y2 !== undefined) {
    return { x: Math.round((box.x + box.x2) / 2), y: Math.round((box.y + box.y2) / 2) }
  }
  return { x: Math.round(box.x), y: Math.round(box.y) }
}

function asBox(value: ActionInputValue | undefined): Box | null {
  if (!value || typeof value !== 'object') return null
  return value
}

/* ------------------------------------------------------------------ */
/* The capability                                                      */
/* ------------------------------------------------------------------ */

export interface UiTarsConfig {
  enabled?: boolean
  baseUrl?: string
  apiKey?: string
  model?: string
  language?: string
  temperature?: number
  maxTokens?: number
  maxSteps?: number
}

/** The backend settings bag; the Grounded Actions configuration lives under `groundedActions`. */
export interface UiTarsSettings {
  groundedActions?: UiTarsConfig
  [key: string]: unknown
}

export type UiTarsEmit = (event: string, payload: unknown) => void

export interface UiTarsOptions {
  settings: UiTarsSettings
  emit?: UiTarsEmit
}

export interface UiTarsStep {
  index: number
  thought: string
  action: string
  inputs: ActionInputs
  screenshot: string
  result?: UiTarsActionResult
}

export interface UiTarsActionResult {
  ok: boolean
  action?: string
  at?: Point
  from?: Point | null
  to?: Point | null
  content?: ActionInputValue
  keys?: string[]
  direction?: string
  seconds?: number
  app?: string
  url?: string
  inputs?: ActionInputs
  error?: string
  [key: string]: unknown
}

export interface UiTarsRunResult {
  ok: boolean
  finished: boolean
  needsUser?: boolean
  steps: UiTarsStep[]
  summary: string
}

export interface UiTarsGroundResult {
  ok: boolean
  raw: string
  thought: string
  action: string | null
  inputs: ActionInputs | null
  screenshot: string
}

export interface UiTarsThinkOptions {
  instruction?: string
  history?: string[]
  shot: Screenshot
}

export interface UiTarsRunOptions {
  instruction?: string
  maxSteps?: number
  onStep?: (step: UiTarsStep) => void
}

const HAS_CONTROL_CHARS = /[\u0000-\u001f\u007f]/

/** Files the OS would run through a script host or shell, not a document viewer. */
const SHELL_SCRIPT = /\.(bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|msc|scr|com|exe|lnk|hta|cpl)$/i

/** A URL is only safe to hand to the OS browser when it is plain http(s). */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw || HAS_CONTROL_CHARS.test(raw)) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
}

function isRunnable(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false
  } catch {
    return false
  }
  if (process.platform === 'win32') return /\.(exe|com)$/i.test(file)
  try {
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve a model-supplied app name or path to a real executable without a
 * shell. Bare names are looked up on PATH; .cmd/.bat/.ps1 shims are refused
 * because running them would require the very shell this avoids.
 */
export function resolveAppExecutable(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const app = value.trim()
  if (!app || HAS_CONTROL_CHARS.test(app)) return null
  if (isAbsolute(app) || app.includes('/') || app.includes('\\')) {
    return isRunnable(app) ? app : null
  }
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.COM').split(';') : ['']
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, app + ext.toLowerCase())
      if (isRunnable(candidate)) return candidate
    }
  }
  return null
}

function launchExecutable(file: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(file, [], { detached: true, stdio: 'ignore', windowsHide: true, shell: false })
      child.once('error', () => resolve(false))
      child.once('spawn', () => {
        child.unref()
        resolve(true)
      })
    } catch {
      resolve(false)
    }
  })
}

async function launchApp(app: string): Promise<boolean> {
  const executable = resolveAppExecutable(app)
  if (executable) return launchExecutable(executable)
  // A local file (document, folder) opens through its default handler; this
  // never goes through a command line either. Scripts and shortcuts are
  // refused because the OS would execute them through a shell or host.
  const local = isAbsolute(app) || app.includes('/') || app.includes('\\')
  if (local && !SHELL_SCRIPT.test(app) && existsSync(app)) {
    const error = await shell.openPath(app).catch(() => 'failed')
    return !error
  }
  return false
}

export class GroundedActions {
  settings: UiTarsSettings
  emit: UiTarsEmit | undefined

  constructor({ settings, emit }: UiTarsOptions) {
    this.settings = settings
    this.emit = emit
  }

  get config(): UiTarsConfig {
    return this.settings.groundedActions || {}
  }

  get enabled(): boolean {
    const c = this.config
    return Boolean(c.enabled && c.baseUrl && c.model)
  }

  prompt(): string {
    return systemPrompt({ language: this.config.language || 'en' })
  }

  /** One grounding step: screenshot + instruction -> the model's raw reply. */
  async think({ instruction, history = [], shot }: UiTarsThinkOptions): Promise<string> {
    const c = this.config
    const messages = [
      { role: 'system', content: this.prompt() },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `${instruction}\n\n## Action History\n${history.length ? history.join('\n') : '(none yet)'}`
          },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${shot.data}` } }
        ]
      }
    ]
    const baseUrl = c.baseUrl as string
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: c.model,
        messages,
        stream: false,
        temperature: c.temperature ?? 0,
        max_tokens: c.maxTokens ?? 512
      })
    })
    if (!res.ok) throw new Error(`Grounded Actions model ${res.status}: ${(await res.text()).slice(0, 240)}`)
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    return String(json.choices?.[0]?.message?.content || '')
  }

  /** Runs the observe -> think -> act loop until the model says finished. */
  async run({ instruction, maxSteps = 12, onStep }: UiTarsRunOptions = {}): Promise<UiTarsRunResult> {
    if (!this.enabled) throw new Error('Grounded Actions is not configured. Add its endpoint and model in Settings.')
    const history: string[] = []
    const steps: UiTarsStep[] = []
    for (let i = 0; i < maxSteps; i++) {
      const shot = await screenshot()
      const reply = await this.think({ instruction, history, shot })
      const parsed = parseAction(reply)
      if (!parsed) {
        history.push(`Thought: ${reply}`)
        continue
      }
      const type = parsed.inputs.__type || parsed.type
      const thought = /Thought\s*:\s*([\s\S]*?)(?:\n|$)/i.exec(reply)?.[1]?.trim() || ''
      const step: UiTarsStep = {
        index: i,
        thought,
        action: type,
        inputs: parsed.inputs,
        screenshot: shot.file
      }
      history.push(`Thought: ${thought}\nAction: ${parsed.raw}`)
      steps.push(step)
      onStep?.(step)

      if (type === 'finished') {
        return { ok: true, finished: true, steps, summary: thought }
      }
      if (type === 'call_user') {
        return { ok: true, finished: false, needsUser: true, steps, summary: thought }
      }
      const exec = await this.act(type, parsed.inputs, shot)
      step.result = exec
    }
    return { ok: true, finished: false, steps, summary: 'Step budget reached' }
  }

  /** Executes one grounded action on the desktop. */
  async act(type: string, inputs: ActionInputs = {}, shot?: Screenshot): Promise<UiTarsActionResult> {
    const c = this.config
    const scale = (p: Box | null): Point | null => {
      if (!p || !shot?.screen) return p
      const [w, h] = shot.screen.split('x').map(Number)
      const box =
        p.x2 !== undefined
          ? { x: p.x, y: p.y, w: p.x2 - p.x, h: (p.y2 as number) - p.y }
          : { x: p.x, y: p.y, w: 0, h: 0 }
      return {
        x: Math.round((box.x + box.w / 2) * (w / 1000)),
        y: Math.round((box.y + box.h / 2) * (h / 1000))
      }
    }
    const point = boxCenter(asBox(inputs.start_box || inputs.point || inputs.start_coords))

    switch (type) {
      case 'click':
      case 'double_click':
      case 'right_click':
      case 'middle_click': {
        const p = point ? scale(point) : null
        if (!p) return { ok: false, error: 'No coordinates for the action' }
        const count = type === 'double_click' ? 2 : 1
        const button = type === 'right_click' ? 'right' : 'left'
        const { ok, ...res } = await click({ x: p.x, y: p.y, button, count })
        return { ok, action: type, at: p, ...res }
      }
      case 'drag': {
        const startBox = asBox(inputs.start_box)
        const endBox = asBox(inputs.end_box)
        const from = startBox ? scale(boxCenter(startBox)) : null
        const to = endBox ? scale(boxCenter(endBox)) : null
        if (from && to) await click({ x: from.x, y: from.y, button: 'left' })
        return { ok: true, action: type, from, to }
      }
      case 'type': {
        const content = inputs.content ?? ''
        const { ok, ...res } = await typeText({ text: String(content) })
        return { ok, action: type, content, ...res }
      }
      case 'hotkey': {
        const keys = String(inputs.key || '').split(/\s+/).filter(Boolean)
        const { ok, ...res } = await hotkey({ keys })
        return { ok, action: type, ...res }
      }
      case 'scroll': {
        const direction = (inputs.direction || 'down') as string
        const { ok, ...res } = await scroll({ direction })
        return { ok, action: type, ...res }
      }
      case 'wait':
        await new Promise((r) => setTimeout(r, 1500))
        return { ok: true, action: type, seconds: 1.5 }
      case 'open_app': {
        const app = String(inputs.app ?? inputs.content ?? '').trim()
        if (!app) return { ok: false, action: type, app, error: 'No application to open' }
        const launched = await launchApp(app)
        return launched
          ? { ok: true, action: type, app }
          : { ok: false, action: type, app, error: `Could not open ${app}` }
      }
      case 'navigate': {
        const raw = String(inputs.url ?? inputs.content ?? '').trim()
        const url = safeUrl(raw)
        if (!url) {
          return { ok: false, action: type, url: raw, error: 'Only http and https URLs can be opened' }
        }
        try {
          await shell.openExternal(url)
          return { ok: true, action: type, url }
        } catch {
          return { ok: false, action: type, url, error: 'The browser could not be opened' }
        }
      }
      case 'back':
      case 'navigate_back':
        await hotkey({ keys: ['alt', 'left'] })
        return { ok: true, action: type }
      default:
        return { ok: true, action: type, inputs }
    }
  }

  /** Grounding only — what would the agent do next? Used by the settings preview. */
  async ground({ instruction }: { instruction?: string }): Promise<UiTarsGroundResult> {
    const shot = await screenshot()
    const reply = await this.think({ instruction, history: [], shot })
    const parsed = parseAction(reply)
    return {
      ok: true,
      raw: reply,
      thought: /Thought\s*:\s*([\s\S]*?)(?:\n|$)/i.exec(reply)?.[1]?.trim() || '',
      action: parsed ? parsed.inputs.__type || parsed.type : null,
      inputs: parsed?.inputs || null,
      screenshot: shot.file
    }
  }
}
