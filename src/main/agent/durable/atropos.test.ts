import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AtroposVirtualActor } from './virtualActor'
import { awakeableManager } from './awakeables'

describe('Atropos Durable Agent Execution Engine', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `atropos_test_${Date.now()}_${Math.random().toString(36).slice(2)}`)
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => undefined)
  })

  it('memoizes step.run results and skips re-execution on reload', async () => {
    const actorId = 'actor_test_memoize'
    const fn = vi.fn().mockResolvedValue({ status: 'ok', data: 42 })

    const actor1 = new AtroposVirtualActor(actorId, testDir)
    await actor1.init()

    const res1 = await actor1.run('compute_step', fn)
    expect(res1).toEqual({ status: 'ok', data: 42 })
    expect(fn).toHaveBeenCalledTimes(1)

    // Second call on same instance should return cached without calling fn
    const res2 = await actor1.run('compute_step', fn)
    expect(res2).toEqual({ status: 'ok', data: 42 })
    expect(fn).toHaveBeenCalledTimes(1)

    // Now simulate application restart: instantiate a new actor reading from disk
    const actor2 = new AtroposVirtualActor(actorId, testDir)
    await actor2.init()

    const res3 = await actor2.run('compute_step', fn)
    expect(res3).toEqual({ status: 'ok', data: 42 })
    expect(fn).toHaveBeenCalledTimes(1) // fn was STILL never called again!
  })

  it('persists step failures across restarts without re-executing', async () => {
    const actorId = 'actor_test_fail'
    const failFn = vi.fn().mockRejectedValue(new Error('Syntax validation failed'))

    const actor1 = new AtroposVirtualActor(actorId, testDir)
    await actor1.init()

    await expect(actor1.run('broken_step', failFn)).rejects.toThrow('Syntax validation failed')
    expect(failFn).toHaveBeenCalledTimes(1)

    // Simulate restart
    const actor2 = new AtroposVirtualActor(actorId, testDir)
    await actor2.init()

    await expect(actor2.run('broken_step', failFn)).rejects.toThrow('Syntax validation failed')
    expect(failFn).toHaveBeenCalledTimes(1)
  })

  it('suspends on awakeables and resumes upon external resolution', async () => {
    const actorId = 'actor_test_awk'
    const actor = new AtroposVirtualActor(actorId, testDir)
    await actor.init()

    const { id, promise } = actor.awakeable<{ approved: boolean; note: string }>('human_approval')

    let resolved = false
    void promise.then((val) => {
      resolved = true
      expect(val).toEqual({ approved: true, note: 'Approved by human reviewer' })
    })

    expect(resolved).toBe(false)
    expect(awakeableManager.hasPending(id)).toBe(true)

    // Resolve the awakeable
    const success = await awakeableManager.resolve(id, { approved: true, note: 'Approved by human reviewer' })
    expect(success).toBe(true)

    const finalVal = await promise
    expect(finalVal.approved).toBe(true)
    expect(resolved).toBe(true)
  })

  it('durable timers complete and persist state', async () => {
    const actorId = 'actor_test_timer'
    const actor1 = new AtroposVirtualActor(actorId, testDir)
    await actor1.init()

    const start = Date.now()
    await actor1.sleep('short_wait', 50)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(40)

    // On second call (or restart), timer is already completed, returns immediately
    const actor2 = new AtroposVirtualActor(actorId, testDir)
    await actor2.init()

    const start2 = Date.now()
    await actor2.sleep('short_wait', 50)
    expect(Date.now() - start2).toBeLessThan(30)
  })

  it('provides persistent KV actor state across reloads', async () => {
    const actorId = 'actor_test_kv'
    const actor1 = new AtroposVirtualActor(actorId, testDir)
    await actor1.init()

    await actor1.set('currentGoal', 'Refactor database schema')
    await actor1.set('iteration', 3)

    expect(await actor1.get('currentGoal')).toBe('Refactor database schema')
    expect(await actor1.get('iteration')).toBe(3)

    // Reload from journal
    const actor2 = new AtroposVirtualActor(actorId, testDir)
    await actor2.init()

    expect(await actor2.get('currentGoal')).toBe('Refactor database schema')
    expect(await actor2.get('iteration')).toBe(3)

    await actor2.delete('iteration')
    expect(await actor2.get('iteration')).toBeUndefined()

    await actor2.clear()
    expect(await actor2.get('currentGoal')).toBeUndefined()
  })
})
