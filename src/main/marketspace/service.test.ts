import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MarketspaceService } from './service'

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


let base = ''
let service: MarketspaceService
let workspace = ''

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'selfimpulse-marketspace-'))
  service = new MarketspaceService(join(base, 'marketspace'))
  workspace = join(base, 'task')
  await mkdir(workspace, { recursive: true })
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('native Marketspace design systems', () => {
  it('discovers reviewed entries and produces a network-free static preview', async () => {
    const entries = await service.list()
    expect(entries.length).toBeGreaterThanOrEqual(3)
    expect(entries.every((entry) => entry.trust === 'reviewed' && !entry.installed)).toBe(true)
    const detail = await service.read('moonlight-product')
    expect(detail?.design).toContain('# Moonlight Product')
    expect(detail?.preview).toContain("default-src 'none'")
    expect(detail?.preview).not.toContain('<script')
    expect(detail?.preview).not.toMatch(/https?:\/\//)
  })

  it('installs and applies only inspected files, refusing accidental overwrite', async () => {
    const installed = await service.install('calm-data')
    expect(installed.installed).toBe(true)
    const applied = await service.apply('calm-data', workspace)
    expect(applied.files).toEqual(['design-system/calm-data/DESIGN.md', 'design-system/calm-data/preview.html'])
    const designPath = join(workspace, 'design-system', 'calm-data', 'DESIGN.md')
    expect(await readFile(designPath, 'utf8')).toContain('# Calm Data')
    await writeFile(designPath, 'user edit', 'utf8')
    await expect(service.apply('calm-data', workspace)).rejects.toThrow('no files were overwritten')
    expect(await readFile(designPath, 'utf8')).toBe('user edit')
    await expect(service.apply('calm-data', workspace, true)).resolves.toMatchObject({ overwritten: true })
    expect(await readFile(designPath, 'utf8')).toContain('# Calm Data')
  })

  it('escapes local design text in previews and keeps local provenance', async () => {
    const detail = await service.create({
      name: 'Local Review',
      description: 'A local system',
      design: '# Local\n\n<script>alert(1)</script>\n\nUse semantic HTML.'
    })
    expect(detail.source).toBe('local')
    expect(detail.trust).toBe('local')
    expect(detail.preview).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(detail.preview).not.toContain('<script>alert(1)</script>')
    expect((await service.list('local review')).some((entry) => entry.id === detail.id)).toBe(true)
  })

  it('does not let a hand-edited manifest counterfeit reviewed provenance', async () => {
    const directory = join(service.root, 'design-systems', 'local-counterfeit')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'DESIGN.md'), '# Untrusted local text', 'utf8')
    await writeFile(join(directory, 'preview.html'), '<p>local</p>', 'utf8')
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({
      format: 'selfimpulse-marketspace/1',
      id: 'local-counterfeit',
      name: 'Counterfeit',
      description: 'A hand-edited manifest',
      version: '1.0.0',
      source: 'builtin',
      updatedAt: new Date().toISOString()
    }), 'utf8')
    await expect(service.read('local-counterfeit')).resolves.toBeNull()
    expect((await service.list()).some((entry) => entry.id === 'local-counterfeit')).toBe(false)
  })

  it.skipIf(!CAN_SYMLINK)('rejects unsafe ids and symlinked application destinations', async () => {
    await expect(service.read('../outside')).rejects.toThrow('Invalid Marketspace entry id')
    await service.install('moonlight-product')
    const outside = join(base, 'outside')
    await mkdir(outside, { recursive: true })
    await symlink(outside, join(workspace, 'design-system'), 'dir')
    await expect(service.apply('moonlight-product', workspace)).rejects.toThrow()
    expect(await readFile(join(outside, 'design-system', 'moonlight-product', 'DESIGN.md'), 'utf8').catch(() => 'missing')).toBe('missing')
  })
})
