import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The renderer draws the approval dialog, so a window nobody can see leaves a
 * task blocked with nothing to answer it. Every path that stops a request from
 * being pending has to announce itself, or the taskbar flash and the tray
 * tooltip stay up forever: answering, cancelling a task, cancelling on quit and
 * the ten-minute timeout are each one of those paths.
 */
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] }
}))

import { approvals } from './approvals'

const REQUEST = {
  tool: 'file_write',
  title: 'Write a file',
  summary: 'Replace notes.txt',
  risk: 'medium' as const
}

afterEach(() => {
  approvals.cancelAll()
  vi.useRealTimers()
})

describe('approvals.onPendingChanged', () => {
  it('fires when a request is created and again when it is answered', async () => {
    const changed = vi.fn()
    approvals.onPendingChanged(changed)

    const pendingRequest = approvals.request('task-1', REQUEST)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(approvals.listPending()).toHaveLength(1)

    const id = approvals.listPending()[0].id
    approvals.respond(id, true)
    expect(changed).toHaveBeenCalledTimes(2)
    expect(approvals.listPending()).toHaveLength(0)
    await expect(pendingRequest).resolves.toBe(true)
  })

  it('fires when the request times out', async () => {
    vi.useFakeTimers()
    const changed = vi.fn()

    const settled = approvals.request('task-2', REQUEST)
    approvals.onPendingChanged(changed)
    changed.mockClear()

    vi.advanceTimersByTime(10 * 60 * 1000)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(approvals.listPending()).toHaveLength(0)
    await expect(settled).resolves.toBe(false)
  })

  it('fires once for a task cancel and once for a quit cancel', async () => {
    approvals.request('task-3', REQUEST)
    approvals.request('task-4', REQUEST)
    const changed = vi.fn()
    approvals.onPendingChanged(changed)

    approvals.cancelTask('task-3')
    expect(changed).toHaveBeenCalledTimes(1)
    expect(approvals.listPending()).toHaveLength(1)

    approvals.cancelAll()
    expect(changed).toHaveBeenCalledTimes(2)
    expect(approvals.listPending()).toHaveLength(0)
  })

  it('says nothing when there was nothing to cancel', () => {
    const changed = vi.fn()
    approvals.onPendingChanged(changed)

    approvals.cancelTask('absent')
    approvals.cancelAll()
    approvals.respond('absent', true)
    expect(changed).not.toHaveBeenCalled()
  })

  it('keeps deciding the approval even when the signal handler throws', async () => {
    approvals.onPendingChanged(() => {
      throw new Error('the tray exploded')
    })

    const settled = approvals.request('task-5', REQUEST)
    expect(approvals.listPending()).toHaveLength(1)
    approvals.respond(approvals.listPending()[0].id, false)
    await expect(settled).resolves.toBe(false)
  })

  it('stops reporting after the listener is dropped', () => {
    const changed = vi.fn()
    const unsubscribe = approvals.onPendingChanged(changed)
    unsubscribe()

    approvals.request('task-6', REQUEST)
    expect(changed).not.toHaveBeenCalled()
  })
})
