import type { TableProposal, TableSeat, TableState } from './types'

export const TABLE_MAX_PEERS = 2
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

export function otherSeat(seat: TableSeat): TableSeat {
  return seat === 'a' ? 'b' : 'a'
}

export function ownSeat(state: TableState): TableSeat {
  return state.role === 'guest' ? 'b' : 'a'
}

export function hasOpenProposal(proposals: TableProposal[]): boolean {
  return proposals.some((proposal) => proposal.status === 'pending' || proposal.status === 'approved')
}

export function turnKey(proposal: TableProposal, seat: TableSeat): TableProposal {
  if (proposal.status !== 'pending' || proposal.keys[seat]) return proposal
  const keys = { ...proposal.keys, [seat]: true }
  return {
    ...proposal,
    keys,
    status: keys.a && keys.b ? 'approved' : 'pending',
    approvedAt: keys.a && keys.b ? new Date().toISOString() : undefined
  }
}

export function withdrawProposal(proposal: TableProposal): TableProposal {
  if (proposal.status !== 'pending') return proposal
  return { ...proposal, status: 'withdrawn' }
}

export function publishProposal(proposal: TableProposal): TableProposal {
  if (proposal.status !== 'approved') return proposal
  return { ...proposal, status: 'published', publishedAt: new Date().toISOString() }
}
