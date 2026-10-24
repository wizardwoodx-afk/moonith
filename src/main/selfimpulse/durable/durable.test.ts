import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DurableJournal,
  DurableJournalCorruptError,
  DurableStore,
  RetryableError,
  TerminalError,
  durableFileName
} from './index'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'selfimpulse-durable-'))
})

afterEach(async () => {
  vi.useRealTimers()
  await rm(root, { recursive: true, force: true })
})

describe('durable execution journal', () => {
  it('replays a completed step without invoking its callback after a restart', async () => {
    const first = await new DurableStore(root).context('task:user')
    const callback = vi.fn(async () => ({ content: 'written once', isError: false }))

    await expect(first.run('tool:call-1', callback)).resolves.toEqual({
      content: 'written once',
      isError: false
    })
    expect(callback).toHaveBeenCalledTimes(1)

    const reopened = await new DurableStore(root).context('task:user')
    await expect(reopened.run('tool:call-1', callback)).resolves.toEqual({
      content: 'written once',
      isError: false
    })
    expect(callback).toHaveBeenCalledTimes(1)
    expect(reopened.wasReplayed('tool:call-1')).toBe(true)
  })

  it('deduplicates concurrent calls for the same step', async () => {
    const context = await new DurableStore(root).context('parallel')
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const callback = vi.fn(async () => {
      await gate
      return 42
    })
    const one = context.run('shared', callback)
    const two = context.run('shared', callback)
    release()
    await expect(Promise.all([one, two])).resolves.toEqual([42, 42])
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('retries retryable failures with bounded attempts and retains diagnostics', async () => {
    const context = await new DurableStore(root).context('retry')
    let attempts = 0
    const events: string[] = []
    const observed = await new DurableStore(root).context('retry', {
      onEvent: (event) => events.push(event.type)
    })
    // Use the same journal through a new context so event observation does not
    // change the step identity or persistence behavior.
    void context
    const value = await observed.run(
      'flaky',
      async () => {
        attempts += 1
        if (attempts < 3) throw new RetryableError(`failure ${attempts}`)
        return 'ok'
      },
      { maxAttempts: 3, initialDelayMs: 0 }
    )

    expect(value).toBe('ok')
    expect(attempts).toBe(3)
    expect(events.filter((event) => event === 'step_retry')).toHaveLength(2)
    expect(observed.snapshot().entries['step:flaky']).toMatchObject({
      status: 'completed',
      attempt: 3,
      value: 'ok'
    })
  })

  it('does not retry terminal or exhausted failures on the same invocation', async () => {
    const context = await new DurableStore(root).context('errors')
    const terminal = vi.fn(() => {
      throw new TerminalError('do not retry')
    })
    await expect(context.run('terminal', terminal, { maxAttempts: 5 })).rejects.toThrow(
      'do not retry'
    )
    expect(terminal).toHaveBeenCalledTimes(1)

    let attempts = 0
    await expect(
      context.run(
        'exhausted',
        () => {
          attempts += 1
          throw new Error('still down')
        },
        { maxAttempts: 2, initialDelayMs: 0 }
      )
    ).rejects.toThrow('still down')
    expect(attempts).toBe(2)
    expect(context.snapshot().entries['step:exhausted']).toMatchObject({
      status: 'pending',
      attempt: 2,
      error: { message: 'still down' }
    })

    // A later manual recovery is allowed to try the unfinished step again.
    await expect(context.run('exhausted', async () => 'recovered')).resolves.toBe('recovered')
  })

  it('preserves keyed JSON state and deterministic random values across reopen', async () => {
    const context = await new DurableStore(root).context('state')
    await context.set('count', 3)
    await context.set('nested', { ok: true })
    const sequence = [context.rand.random(), context.rand.uuidv4()]
    const firstNow = await context.now('test')

    const sameSequence = await new DurableStore(root).context('state')
    expect(sameSequence.get('count')).toBe(3)
    expect(sameSequence.get('nested')).toEqual({ ok: true })
    expect([sameSequence.rand.random(), sameSequence.rand.uuidv4()]).toEqual(sequence)
    await expect(sameSequence.now('test')).resolves.toBe(firstNow)
    await sameSequence.delete('count')
    expect(sameSequence.get('count')).toBeUndefined()
  })

  it('restores the random sequence recorded by a replayed step', async () => {
    const context = await new DurableStore(root).context('random-steps')
    await context.run('randomized', () => {
      context.rand.random()
      context.rand.random()
      return 'done'
    })
    const expected = context.rand.uuidv4()

    const reopened = await new DurableStore(root).context('random-steps')
    await reopened.run('randomized', () => {
      throw new Error('A completed step must not execute again.')
    })
    expect(reopened.rand.uuidv4()).toBe(expected)
  })

  it('recovers an interrupted running entry as retryable', async () => {
    // Seed the exact state a crashed single-writer process can leave behind.
    // No old writer remains alive to race the recovering store.
    const journal = await DurableJournal.open(root, 'crash')
    const at = new Date().toISOString()
    await journal.putEntry({
      key: 'step:model:1',
      kind: 'step',
      status: 'running',
      attempt: 1,
      createdAt: at,
      updatedAt: at
    })

    const recovered = await new DurableStore(root).context('crash')
    expect(recovered.snapshot().entries['step:model:1']?.status).toBe('pending')
    const callback = vi.fn(async () => 'recovered')
    await expect(recovered.run('model:1', callback)).resolves.toBe('recovered')
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('refuses to replace a corrupt journal with an empty one', async () => {
    const context = await new DurableStore(root).context('corrupt')
    await context.set('important', true)
    await writeFile(join(root, durableFileName('corrupt')), '{not json', 'utf8')
    await expect(new DurableStore(root).context('corrupt')).rejects.toBeInstanceOf(
      DurableJournalCorruptError
    )
    await expect(readFile(join(root, durableFileName('corrupt')), 'utf8')).resolves.toBe(
      '{not json'
    )
  })
})

describe('durable timers and external events', () => {
  it('persists a timer wake time and completes it after reopen', async () => {
    let now = Date.parse('2026-10-24T00:00:00.000Z')
    const context = await new DurableStore(root).context('timer', { now: () => now })
    const sleeping = context.sleep('later', 50)
    const wakeAt = context.snapshot().entries['timer:later']?.wakeAt
    expect(wakeAt).toBe(new Date(now + 50).toISOString())
    now += 60
    await sleeping

    const reopened = await new DurableStore(root).context('timer', { now: () => now })
    await expect(reopened.sleep('later', 5000)).resolves.toBeUndefined()
    expect(reopened.snapshot().entries['timer:later']?.wakeAt).toBe(wakeAt)
  })

  it('resolves an awakeable durably and only once', async () => {
    const store = new DurableStore(root)
    const context = await store.context('events')
    const awakeable = await context.awakeable<{ approved: boolean }>('approval')
    const waiting = vi.fn()
    awakeable.promise.then(waiting)

    await store.resolveAwakeable(awakeable.id, { approved: true })
    await expect(awakeable.promise).resolves.toEqual({ approved: true })
    expect(waiting).toHaveBeenCalledWith({ approved: true })
    await expect(store.resolveAwakeable(awakeable.id, { approved: false })).rejects.toThrow(
      'already settled'
    )

    const reopenedStore = new DurableStore(root)
    const reopened = await reopenedStore.context('events')
    const recovered = await reopened.awakeable<{ approved: boolean }>('approval')
    await expect(recovered.promise).resolves.toEqual({ approved: true })
  })

  it('supports named promises, rejection, and waiters registered before resolution', async () => {
    const store = new DurableStore(root)
    const context = await store.context('promises')
    const promise = context.promise<string>('human-input')
    const waiting = promise.get()
    await vi.waitFor(async () => {
      expect((await promise.peek()).settled).toBe(false)
    })
    await store.resolvePromise('promises', 'human-input', 'continue')
    await expect(waiting).resolves.toBe('continue')
    await expect(promise.peek()).resolves.toMatchObject({ settled: true, value: 'continue' })

    const rejected = context.promise('rejected')
    const rejectedWait = rejected.get()
    const rejection = expect(rejectedWait).rejects.toThrow('external failure')
    await store.rejectPromise('promises', 'rejected', new Error('external failure'))
    await rejection
  })
})
