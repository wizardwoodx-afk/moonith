import { describe, expect, it } from 'vitest'
import {
  hasOpenProposal,
  ownSeat,
  publishProposal,
  turnKey,
  withdrawProposal
} from '@shared/table'
import type { TableProposal, TableState } from '@shared/types'

function proposal(patch: Partial<TableProposal> = {}): TableProposal {
  return {
    id: 'proposal-1',
    title: 'Release the brief',
    summary: 'Move the finished brief to the shared table.',
    proposedBy: 'a',
    keys: { a: false, b: false },
    status: 'pending',
    createdAt: '2026-10-21T09:00:00.000Z',
    ...patch
  }
}

describe('joint keys', () => {
  it('stays pending after one key and approves after both', () => {
    const one = turnKey(proposal(), 'a')
    expect(one.status).toBe('pending')
    const two = turnKey(one, 'b')
    expect(two.status).toBe('approved')
    expect(two.approvedAt).toBeTruthy()
  })

  it('is idempotent for the same key', () => {
    const one = turnKey(proposal(), 'a')
    expect(turnKey(one, 'a')).toBe(one)
  })

  it('cannot be approved after withdrawal', () => {
    const withdrawn = withdrawProposal(proposal())
    expect(turnKey(withdrawn, 'a')).toBe(withdrawn)
    expect(turnKey(withdrawn, 'b')).toBe(withdrawn)
  })

  it('publishes only a co-signed action', () => {
    expect(publishProposal(proposal()).status).toBe('pending')
    const approved = turnKey(turnKey(proposal(), 'a'), 'b')
    const published = publishProposal(approved)
    expect(published.status).toBe('published')
    expect(published.publishedAt).toBeTruthy()
  })
})

describe('table seats', () => {
  it('gives the host seat a and the guest seat b', () => {
    const state = { role: 'host' } as TableState
    expect(ownSeat(state)).toBe('a')
    expect(ownSeat({ ...state, role: 'guest' })).toBe('b')
    expect(ownSeat({ ...state, role: 'idle' })).toBe('a')
  })

  it('treats pending and approved actions as open', () => {
    expect(hasOpenProposal([proposal()])).toBe(true)
    expect(hasOpenProposal([proposal({ status: 'approved' })])).toBe(true)
    expect(hasOpenProposal([proposal({ status: 'published' })])).toBe(false)
    expect(hasOpenProposal([proposal({ status: 'withdrawn' })])).toBe(false)
  })
})
