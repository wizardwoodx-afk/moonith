import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { atomicWriteFile } from './atomic'

export function newId(prefix = ''): string {
  const id = randomUUID()
  return prefix ? `${prefix}_${id}` : id
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  await atomicWriteFile(file, JSON.stringify(value, null, 2))
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function truncate(value: string, max = 4000): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n… [truncated ${value.length - max} chars]`
}

export function safeJsonParse<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

/** Read a response with a hard byte budget before handing JSON to a parser. */
export async function readResponseText(response: Response, maxBytes = 1_000_000): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Response byte limit must be positive.')
  if (!response.body) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error(`Response exceeds the ${maxBytes}-byte limit.`)
    return text
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new Error(`Response exceeds the ${maxBytes}-byte limit.`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

export async function readJsonLimited<T = unknown>(response: Response, maxBytes = 1_000_000): Promise<T> {
  const text = await readResponseText(response, maxBytes)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error('Response was not valid JSON.')
  }
}

export function slugify(value: string, fallback = 'task'): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || fallback
}
