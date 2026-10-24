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

export function slugify(value: string, fallback = 'task'): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || fallback
}
