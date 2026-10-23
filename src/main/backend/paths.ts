import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

let cachedRoot: string | null = null

/** Where the transplanted the earlier shell backend keeps its collections. */
export function backendRoot(): string {
  if (cachedRoot) return cachedRoot
  const root = join(app.getPath('userData'), 'backend')
  mkdirSync(root, { recursive: true })
  cachedRoot = root
  return root
}

/** The default working directory for the agent when a task has not chosen one. */
export function backendWorkspace(): string {
  const dir = join(app.getPath('userData'), 'workspace')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Where installed skill bundles live. */
export function backendSkillsDir(): string {
  const dir = join(backendWorkspace(), '.agents', 'skills')
  mkdirSync(dir, { recursive: true })
  return dir
}
