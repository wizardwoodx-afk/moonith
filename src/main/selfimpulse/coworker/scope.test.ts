import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { handoffCoworkerArtifact, promoteCoworkerArtifact } from './artifacts'
import { browserScope, coworkerSegment, taskIdForBrowserScope } from './scope'

/** Windows refuses to create symlinks without Developer Mode or elevation.
 *  Probing beats a red test that reads like a security regression: the guard
 *  below is untested on this machine, and says so. */
async function symlinksAllowed(): Promise<boolean> {
  const { mkdtemp, symlink, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'symlink-probe-'))
  try {
    const target = join(dir, 'target.txt')
    await writeFile(target, 'x')
    await symlink(target, join(dir, 'link.txt'))
    return true
  } catch {
    return false
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

const CAN_SYMLINK = await symlinksAllowed()


const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('coworker scope and artifact boundary', () => {
  it('gives Captain and every Crew run distinct scopes, including durable ids', () => {
    const captain = browserScope('task-1')
    const first = browserScope('task-1', 'captain:task-1:crew:call-1')
    const second = browserScope('task-1', 'captain:task-1:crew:call-2')
    expect(new Set([captain, first, second]).size).toBe(3)
    expect(taskIdForBrowserScope(first)).toBe('task-1')
    expect(taskIdForBrowserScope(captain)).toBe('task-1')
    expect(taskIdForBrowserScope('task-2:crew:captain:task-1:crew:call-1')).toBe('task-2')
    expect(taskIdForBrowserScope('../escape')).toBeNull()
    expect(coworkerSegment(first)).not.toBe(coworkerSegment(second))
  })

  it('promotes only a real file inside the private workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'selfimpulse-coworker-'))
    temporary.push(root)
    const workspace = join(root, 'private')
    const shared = join(root, 'shared')
    await writeFile(join(root, 'outside.txt'), 'do not copy')
    await import('node:fs/promises').then(({ mkdir }) => mkdir(join(workspace, 'nested'), { recursive: true }))
    await writeFile(join(workspace, 'nested', 'report.md'), '# Report')
    const promoted = await promoteCoworkerArtifact(
      join(workspace, 'nested', 'report.md'),
      workspace,
      shared,
      'run:one'
    )
    expect(await readFile(promoted, 'utf8')).toBe('# Report')
    expect(promoted).toContain(join('shared', 'crew'))
    await expect(
      promoteCoworkerArtifact(join(root, 'outside.txt'), workspace, shared, 'run:one')
    ).rejects.toThrow('Only files inside')
    await expect(
      handoffCoworkerArtifact(join(root, 'outside.txt'), workspace, shared, 'run:one')
    ).resolves.toBeNull()
  })

  it.skipIf(!CAN_SYMLINK)('does not follow a workspace symlink to an outside artifact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'selfimpulse-coworker-link-'))
    temporary.push(root)
    const workspace = join(root, 'private')
    const shared = join(root, 'shared')
    await import('node:fs/promises').then(({ mkdir }) => mkdir(workspace, { recursive: true }))
    await writeFile(join(root, 'secret.txt'), 'secret')
    await symlink(join(root, 'secret.txt'), join(workspace, 'link.txt'))
    await expect(
      promoteCoworkerArtifact(join(workspace, 'link.txt'), workspace, shared, 'run:one')
    ).rejects.toThrow('Only files inside')
  })
})
