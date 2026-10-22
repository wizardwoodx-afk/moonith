import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const LEGACY_ENTRIES = [
  'settings.json',
  'schedules.json',
  'subagents.json',
  'memories.json',
  'usage.json',
  'tasks',
  'workspaces',
  'skills',
  'logs',
  'selfimpulse',
  'Local Storage'
]

/**
 * Copy the pre-rebrand profile into the new `userData` folder.
 *
 * Runs only when the destination has no `settings.json`, so an existing
 * SelfImpulse profile is never merged into or overwritten. Individual entries
 * that cannot be read are skipped and reported; the caller keeps booting.
 */
export function copyLegacyUserData(legacy: string, next: string): string[] {
  if (!existsSync(legacy) || existsSync(join(next, 'settings.json'))) return []

  mkdirSync(next, { recursive: true })
  const copied: string[] = []

  for (const entry of LEGACY_ENTRIES) {
    const from = join(legacy, entry)
    if (!existsSync(from)) continue
    try {
      cpSync(from, join(next, entry), { recursive: true, force: false, errorOnExist: false })
      copied.push(entry)
    } catch (error) {
      console.warn(
        `[startup] could not migrate ${entry}:`,
        error instanceof Error ? error.message : error
      )
    }
  }

  return copied
}
