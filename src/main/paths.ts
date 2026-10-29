import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { copyLegacyUserData } from './userDataMigration'

export interface AppPaths {
  root: string
  tasks: string
  workspaces: string
  coworkers: string
  settingsFile: string
  schedulesFile: string
  libraryFile: string
  logs: string
  skills: string
  studio: string
  subAgentsFile: string
  memoriesFile: string
  usageFile: string
  durable: string
  snapshots: string
}

let cached: AppPaths | null = null

export function getPaths(): AppPaths {
  if (cached) return cached
  const root = app.getPath('userData')
  const paths: AppPaths = {
    root,
    tasks: join(root, 'tasks'),
    workspaces: join(root, 'workspaces'),
    coworkers: join(root, 'coworkers'),
    settingsFile: join(root, 'settings.json'),
    schedulesFile: join(root, 'schedules.json'),
    libraryFile: join(root, 'library.json'),
    logs: join(root, 'logs'),
    skills: join(root, 'skills'),
    studio: join(root, 'studio'),
    subAgentsFile: join(root, 'subagents.json'),
    memoriesFile: join(root, 'memories.json'),
    usageFile: join(root, 'usage.json'),
    durable: join(root, 'durable'),
    snapshots: join(root, 'snapshots')
  }
  for (const dir of [
    paths.root,
    paths.tasks,
    paths.workspaces,
    paths.coworkers,
    paths.logs,
    paths.skills,
    paths.studio,
    paths.durable,
    paths.snapshots
  ]) {
    mkdirSync(dir, { recursive: true })
  }
  cached = paths
  return paths
}

/**
 * The rebrand moved `userData` from `knight-cowork` to `SelfImpulse`. Copy the
 * previous profile once, before the store opens it.
 */
export function migrateLegacyUserData(): void {
  const next = app.getPath('userData')
  const legacy = join(app.getPath('appData'), 'knight-cowork')
  if (resolve(legacy).toLowerCase() === resolve(next).toLowerCase()) return
  copyLegacyUserData(legacy, next)
}

export function taskWorkspace(id: string): string {
  return join(getPaths().workspaces, id)
}

export function ensureTaskWorkspace(id: string): string {
  const dir = taskWorkspace(id)
  mkdirSync(dir, { recursive: true })
  mkdirSync(join(dir, 'attachments'), { recursive: true })
  return dir
}
