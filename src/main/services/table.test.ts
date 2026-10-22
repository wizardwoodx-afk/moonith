import { afterEach, describe, expect, it } from 'vitest'
import { TableService } from './table'

const services: TableService[] = []

function create(): TableService {
  const service = new TableService()
  services.push(service)
  return service
}

afterEach(async () => {
  await Promise.all(services.map((service) => service.leave()))
  services.length = 0
})

async function pair(): Promise<{ host: TableService; guest: TableService; code: string; port: number }> {
  const host = create()
  const guest = create()
  const hosted = await host.hostTable({ name: 'Avery' })
  if (!hosted.code || !hosted.port) throw new Error('host did not open a table')
  await guest.joinTable({
    code: hosted.code,
    address: `127.0.0.1:${hosted.port}`,
    name: 'Blake'
  })
  return { host, guest, code: hosted.code, port: hosted.port }
}

describe('table service', () => {
  it('hosts, joins and shares a goal with a second machine', async () => {
    const { host, guest, code, port } = await pair()
    expect(code).toHaveLength(6)
    expect(port).toBeGreaterThan(0)

    const joined = await guest.getState()
    expect(joined.role).toBe('guest')
    expect(joined.peers.map((peer) => peer.seat)).toEqual(['a', 'b'])
    expect(joined.peers.every((peer) => peer.online)).toBe(true)

    await guest.setGoal({ title: 'Ship the alpha', detail: 'One shared outcome.', due: 'Friday' })
    const state = await host.getState()
    expect(state.goal?.title).toBe('Ship the alpha')
    expect(state.goal?.setBy).toBe('b')
    expect(state.ledger.some((entry) => entry.text.includes('Ship the alpha'))).toBe(true)
  })

  it('requires both keys before publishing a joint action', async () => {
    const { host, guest } = await pair()
    await guest.propose({ title: 'Release the brief', summary: 'Publish the finished brief.' })

    let state = await host.getState()
    const open = state.proposals[0]
    expect(open.status).toBe('pending')

    state = await host.turnKey(open.id)
    expect(state.proposals[0].status).toBe('pending')
    expect(state.proposals[0].keys.a).toBe(true)

    const guestState = await guest.turnKey(open.id)
    expect(guestState.proposals[0].status).toBe('approved')

    const published = await guest.publish(open.id)
    expect(published.proposals[0].status).toBe('published')

    state = await host.getState()
    expect(state.proposals[0].status).toBe('published')
    expect(state.ledger.some((entry) => entry.status === 'approved')).toBe(true)
  })

  it('lets only the proposer withdraw', async () => {
    const { host, guest } = await pair()
    await guest.propose({ title: 'Buy credits', summary: 'Commit shared research credits.' })
    const open = (await host.getState()).proposals[0]

    await expect(host.withdraw(open.id)).rejects.toThrow(/proposed it/i)
    const withdrawn = await guest.withdraw(open.id)
    expect(withdrawn.proposals[0].status).toBe('withdrawn')
    await expect(host.turnKey(open.id)).rejects.toThrow(/no longer pending/i)
  })

  it('rejects a wrong code and a third Captain', async () => {
    const { host, code, port } = await pair()
    const third = create()

    await expect(
      third.joinTable({ code: 'ZZZZZZ', address: `127.0.0.1:${port}`, name: 'Casey' })
    ).rejects.toThrow(/code/i)

    const hosted = await host.getState()
    await expect(
      third.joinTable({ code: code, address: `127.0.0.1:${hosted.port}`, name: 'Casey' })
    ).rejects.toThrow(/two Captains/i)
  })

  it('refuses a second open joint action', async () => {
    const { guest } = await pair()
    await guest.propose({ title: 'First action', summary: 'One at a time.' })
    await expect(
      guest.propose({ title: 'Second action', summary: 'Should be refused.' })
    ).rejects.toThrow(/open joint action/i)
  })
})
