import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AtroposVirtualActor } from '../durable/virtualActor'
import { DaedalusCodingHarness } from './daedalusHarness'

describe('Daedalus Long-Horizon Coding Harness', () => {
  let testDir: string
  let workspaceDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `daedalus_test_${Date.now()}_${Math.random().toString(36).slice(2)}`)
    workspaceDir = join(testDir, 'workspace')
    await fs.mkdir(workspaceDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => undefined)
  })

  it('manages checkpoints and rolls back modified files', async () => {
    const actor = new AtroposVirtualActor('daedalus_actor', testDir)
    await actor.init()
    const harness = new DaedalusCodingHarness(actor, workspaceDir)

    const fileRel = 'src/service.ts'
    const fullPath = join(workspaceDir, fileRel)
    await fs.mkdir(join(workspaceDir, 'src'), { recursive: true })
    await fs.writeFile(fullPath, 'const original = true\n', 'utf8')

    // Create checkpoint
    const chkId = await harness.createCheckpoint('survey', [fileRel], 'Initial baseline')
    expect(chkId).toBeTruthy()

    // Tamper / edit file
    await fs.writeFile(fullPath, 'const modified = "corrupted"\n', 'utf8')
    expect(await fs.readFile(fullPath, 'utf8')).toContain('corrupted')

    // Rollback to checkpoint
    const rolledBack = await harness.rollbackToCheckpoint(chkId)
    expect(rolledBack).toBe(true)
    expect(await fs.readFile(fullPath, 'utf8')).toBe('const original = true\n')
  })

  it('runs stages durably through Atropos steps', async () => {
    const actor = new AtroposVirtualActor('daedalus_actor_stages', testDir)
    await actor.init()
    const harness = new DaedalusCodingHarness(actor, workspaceDir)

    let calls = 0
    const result1 = await harness.runStage('spec', 'create_plan', async () => {
      calls++
      return { plan: 'Step 1: Parse AST' }
    })
    expect(result1.plan).toBe('Step 1: Parse AST')
    expect(calls).toBe(1)

    // Repeat runStage with same name should replay from journal
    const result2 = await harness.runStage('spec', 'create_plan', async () => {
      calls++
      return { plan: 'Never called' }
    })
    expect(result2.plan).toBe('Step 1: Parse AST')
    expect(calls).toBe(1)
  })

  it('verifies stage files and flags syntax defects', async () => {
    const actor = new AtroposVirtualActor('daedalus_actor_verify', testDir)
    await actor.init()
    const harness = new DaedalusCodingHarness(actor, workspaceDir)

    const goodFile = 'good.ts'
    const badFile = 'bad.ts'
    await fs.writeFile(join(workspaceDir, goodFile), 'function ok() { return 1; }', 'utf8')
    await fs.writeFile(join(workspaceDir, badFile), 'function bad() { return (1 + 2; }', 'utf8')

    const vGood = await harness.verifyStage([goodFile])
    expect(vGood.passed).toBe(true)
    expect(vGood.issues.length).toBe(0)

    const vBad = await harness.verifyStage([badFile])
    expect(vBad.passed).toBe(false)
    expect(vBad.issues.length).toBeGreaterThan(0)
  })
})
