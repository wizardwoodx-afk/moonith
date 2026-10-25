import { promises as fs } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { isWithin } from '../../security'
import { coworkerSegment, requireActorId } from './scope'

/** Copy a deliberate Crew deliverable into the parent task's artifact area. */
export async function promoteCoworkerArtifact(
  source: string,
  workspace: string,
  taskWorkspace: string,
  actorId: string
): Promise<string> {
  requireActorId(actorId)
  const realWorkspace = await fs.realpath(workspace)
  const realSource = await fs.realpath(source)
  if (!isWithin(realWorkspace, realSource) || realWorkspace === realSource) {
    throw new Error('Only files inside this coworker workspace can be shared as artifacts.')
  }
  const rel = relative(realWorkspace, realSource)
  if (!rel || rel.split(/[\\/]/).includes('..')) throw new Error('Invalid coworker artifact path.')
  const destinationRoot = join(taskWorkspace, 'crew', coworkerSegment(actorId))
  const destination = resolve(destinationRoot, rel)
  if (!isWithin(destinationRoot, destination)) throw new Error('Coworker artifact escaped its destination.')
  await fs.mkdir(dirname(destination), { recursive: true })
  await fs.copyFile(realSource, destination)
  return destination
}

/** Only private outputs enter the shared artifact area. External granted-folder
 * writes are valid on their own and return null instead of failing after the
 * write or being copied without an explicit handoff. */
export async function handoffCoworkerArtifact(
  source: string,
  workspace: string,
  taskWorkspace: string,
  actorId: string
): Promise<string | null> {
  if (!isWithin(workspace, source)) return null
  return promoteCoworkerArtifact(source, workspace, taskWorkspace, actorId)
}

export function coworkerDisplayPath(taskWorkspace: string, path: string): string {
  const rel = relative(taskWorkspace, path)
  return rel && !rel.startsWith('..') ? rel : basename(path)
}
