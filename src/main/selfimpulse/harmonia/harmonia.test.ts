import { describe, expect, it } from 'vitest'
import { HarmoniaService } from './service'

describe('Harmonia: Executive Decision Card Feed', () => {
  it('creates and retrieves decision cards', async () => {
    const service = new HarmoniaService()
    const card = await service.createCard({
      agentId: 'daedalus',
      agentName: 'Daedalus Coder',
      title: 'Implement Resilient Offline Storage',
      summary: 'Fallback to local SQLite when network connectivity drops.',
      kind: 'patch',
      diff: '+ const db = openLocalDb();',
      suggestedAction: 'Apply local fallback adapter'
    })

    expect(card.cardId).toBeDefined()
    expect(card.title).toBe('Implement Resilient Offline Storage')
    expect(card.status).toBe('pending')

    const list = await service.listCards()
    expect(list.some((c) => c.cardId === card.cardId)).toBe(true)
  })

  it('allows 1-click accept decisions on cards', async () => {
    const service = new HarmoniaService()
    const card = await service.createCard({
      agentId: 'kubernis',
      agentName: 'Kubernis Watcher',
      title: 'Optimize Database Indices',
      summary: 'Add index on team_sessions.created_at',
      kind: 'action',
      suggestedAction: 'Execute CREATE INDEX migration'
    })

    const updated = await service.decideCard({
      cardId: card.cardId,
      decision: 'accept',
      comment: 'Approved for v1 release'
    })

    expect(updated.status).toBe('accepted')
    expect(updated.metadata?.decisionComment).toBe('Approved for v1 release')

    const acceptedList = await service.listCards('accepted')
    expect(acceptedList.some((c) => c.cardId === card.cardId)).toBe(true)
  })

  it('allows 1-click reject decisions and dismissals', async () => {
    const service = new HarmoniaService()
    const card = await service.createCard({
      agentId: 'theatron',
      agentName: 'Theatron Creative',
      title: 'Add Experimental Neon Theme',
      summary: 'Adds glowing accent borders to all controls.',
      kind: 'review',
      suggestedAction: 'Merge CSS styles'
    })

    const rejected = await service.decideCard({
      cardId: card.cardId,
      decision: 'reject',
      comment: 'Fails accessibility contrast standards'
    })

    expect(rejected.status).toBe('rejected')

    const dismissed = await service.dismissCard(card.cardId)
    expect(dismissed).toBe(true)

    const list = await service.listCards()
    expect(list.some((c) => c.cardId === card.cardId)).toBe(false)
  })
})
