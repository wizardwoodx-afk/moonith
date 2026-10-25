import { promises as fs, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getPaths } from '../../paths'
import { coworkerSegment, requireActorId, requireTaskId } from './scope'

export { browserScope, taskIdForBrowserScope } from './scope'
export { coworkerDisplayPath, handoffCoworkerArtifact, promoteCoworkerArtifact } from './artifacts'

/** Kept outside task workspaces so shared reads cannot traverse into another
 * specialist's private working directory. */
export function coworkerTaskRoot(taskId: string): string {
  requireTaskId(taskId)
  return join(getPaths().coworkers, coworkerSegment(taskId))
}

export function coworkerWorkspace(taskId: string, actorId: string): string {
  requireActorId(actorId)
  return join(coworkerTaskRoot(taskId), coworkerSegment(actorId))
}

export function ensureCoworkerWorkspace(taskId: string, actorId: string): string {
  const workspace = coworkerWorkspace(taskId, actorId)
  mkdirSync(workspace, { recursive: true, mode: 0o700 })
  return workspace
}

export async function removeCoworkerTask(taskId: string): Promise<void> {
  await fs.rm(coworkerTaskRoot(taskId), { recursive: true, force: true })
}
