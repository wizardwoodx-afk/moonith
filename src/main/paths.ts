import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export interface AppPaths {
  root: string
  tasks: string
  workspaces: string
  settingsFile: string
  schedulesFile: string
  logs: string
  skills: string
  subAgentsFile: string
  memoriesFile: string
  usageFile: string
}

let cached: AppPaths | null = null

export function getPaths(): AppPaths {
  if (cached) return cached
  const root = app.getPath('userData')
  const paths: AppPaths = {
    root,
    tasks: join(root, 'tasks'),
    workspaces: join(root, 'workspaces'),
    settingsFile: join(root, 'settings.json'),
    schedulesFile: join(root, 'schedules.json'),
    logs: join(root, 'logs'),
    skills: join(root, 'skills'),
    subAgentsFile: join(root, 'subagents.json'),
    memoriesFile: join(root, 'memories.json'),
    usageFile: join(root, 'usage.json')
  }
  for (const dir of [paths.root, paths.tasks, paths.workspaces, paths.logs, paths.skills]) {
    mkdirSync(dir, { recursive: true })
  }
  cached = paths
  return paths
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
