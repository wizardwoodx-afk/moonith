import type { TableProposal, TableSeat, TableState } from './types'

export const TABLE_MAX_PEERS = 4
export const TABLE_SEATS: TableSeat[] = ['a', 'b', 'c', 'd']
export const TABLE_DISCOVERY_PORTS = [47787, 47788, 47789, 47790]
export const TABLE_CODE_LENGTH = 6

export const EMPTY_TABLE_STATE: TableState = {
  role: 'idle',
  code: null,
  address: null,
  port: null,
  peers: [],
  goal: null,
  proposals: [],
  ledger: [],
  connected: false,
  startedAt: null
}

export function ownSeat(state: TableState): TableSeat {
  return state.seat ?? (state.role === 'guest' ? 'b' : 'a')
}

export function hasOpenProposal(proposals: TableProposal[]): boolean {
  return proposals.some((proposal) => proposal.status === 'pending' || proposal.status === 'approved')
}

/** The seats that must act on a proposal. Older proposals only knew two seats. */
export function proposalSeats(proposal: TableProposal): TableSeat[] {
  return proposal.seats && proposal.seats.length
    ? proposal.seats
    : ([...new Set(['a', 'b', proposal.proposedBy])] as TableSeat[])
}

export function allSeatsTurned(
  keys: Partial<Record<TableSeat, boolean>>,
  seats: TableSeat[]
): boolean {
  return seats.every((seat) => keys[seat] === true)
}

export function turnKey(proposal: TableProposal, seat: TableSeat): TableProposal {
  const seats = proposalSeats(proposal)
  if (proposal.status !== 'pending' || proposal.keys[seat] || !seats.includes(seat)) return proposal
  const keys = { ...proposal.keys, [seat]: true }
  const approved = allSeatsTurned(keys, seats)
  return {
    ...proposal,
    keys,
    status: approved ? 'approved' : 'pending',
    approvedAt: approved ? new Date().toISOString() : undefined
  }
}

export function withdrawProposal(proposal: TableProposal): TableProposal {
  if (proposal.status !== 'pending') return proposal
  return { ...proposal, status: 'withdrawn' }
}

export function publishProposal(proposal: TableProposal): TableProposal {
  if (proposal.status !== 'approved') return proposal
  const done: Partial<Record<TableSeat, boolean>> = {}
  for (const seat of proposalSeats(proposal)) done[seat] = false
  return {
    ...proposal,
    status: 'published',
    publishedAt: new Date().toISOString(),
    done
  }
}

export function markDone(proposal: TableProposal, seat: TableSeat): TableProposal {
  if (proposal.status !== 'published' || proposal.done?.[seat]) return proposal
  return { ...proposal, done: { ...proposal.done, [seat]: true } }
}

export function allDone(proposal: TableProposal): boolean {
  return (
    proposal.status === 'published' &&
    proposalSeats(proposal).every((seat) => proposal.done?.[seat] === true)
  )
}
