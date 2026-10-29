import { afterEach, describe, expect, it } from 'vitest'
import { hostname } from 'node:os'
import { TableService, deriveTableKey, isEncryptedTableEnvelope, encryptTablePayload } from './table'

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

async function pair(
  options?: { withWork?: boolean }
): Promise<{ host: TableService; guest: TableService; code: string; port: number }> {
  const host = create()
  const guest = create()
  if (options?.withWork) {
    host.workStarter = async (proposal) => `task-host-${proposal.title}`
    guest.workStarter = async (proposal) => `task-guest-${proposal.title}`
  }
  const hosted = await host.hostTable({ name: 'Avery' })
  if (!hosted.code || !hosted.port) throw new Error('host did not open a table')
  await guest.joinTable({
    code: hosted.code,
    address: `127.0.0.1:${hosted.port}`,
    name: 'Blake'
  })
  return { host, guest, code: hosted.code, port: hosted.port }
}

async function coSign(
  host: TableService,
  guest: TableService,
  input: { title: string; summary: string }
): Promise<string> {
  await guest.propose(input)
  const proposed = (await host.getState()).proposals[0]
  await host.turnKey(proposed.id)
  const approved = await guest.turnKey(proposed.id)
  expect(approved.proposals[0].status).toBe('approved')
  return proposed.id
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

  it('rejects a wrong code', async () => {
    const { port } = await pair()
    const third = create()

    await expect(
      third.joinTable({ code: 'ZZZZZZ', address: `127.0.0.1:${port}`, name: 'Casey' })
    ).rejects.toThrow(/code/i)
  })

  it('seats a third and fourth Captain, then refuses a fifth', async () => {
    const { host, code, port } = await pair()
    const third = create()
    const fourth = create()
    const fifth = create()

    const thirdJoined = await third.joinTable({
      code,
      address: `127.0.0.1:${port}`,
      name: 'Casey'
    })
    expect(thirdJoined.seat).toBe('c')
    expect(thirdJoined.peers.map((peer) => peer.seat)).toEqual(['a', 'b', 'c'])

    const fourthJoined = await fourth.joinTable({
      code,
      address: `127.0.0.1:${port}`,
      name: 'Dana'
    })
    expect(fourthJoined.seat).toBe('d')
    expect(fourthJoined.peers.map((peer) => peer.seat)).toEqual(['a', 'b', 'c', 'd'])

    await expect(
      fifth.joinTable({ code, address: `127.0.0.1:${port}`, name: 'Eli' })
    ).rejects.toThrow(/full/i)
  })

  it('needs a key from every seated Captain, not just two', async () => {
    const { host, guest, code, port } = await pair()
    const third = create()
    await third.joinTable({ code, address: `127.0.0.1:${port}`, name: 'Casey' })

    await guest.propose({ title: 'Ship the beta', summary: 'All three desks confirm.' })
    const open = (await host.getState()).proposals[0]
    expect(open.seats).toEqual(['a', 'b', 'c'])

    await host.turnKey(open.id)
    let state = await guest.turnKey(open.id)
    expect(state.proposals[0].status).toBe('pending')
    state = await third.turnKey(open.id)
    expect(state.proposals[0].status).toBe('approved')
  })

  it('refuses a second open joint action', async () => {
    const { guest } = await pair()
    await guest.propose({ title: 'First action', summary: 'One at a time.' })
    await expect(
      guest.propose({ title: 'Second action', summary: 'Should be refused.' })
    ).rejects.toThrow(/open joint action/i)
  })

  it('starts the work on every desk when a joint action is published', async () => {
    const { host, guest } = await pair({ withWork: true })
    const id = await coSign(host, guest, {
      title: 'Draft the brief',
      summary: 'Both desks draft their sections.'
    })

    await expect(host.markDone(id)).rejects.toThrow(/published/i)

    const published = await guest.publish(id)
    const proposal = published.proposals[0]
    expect(proposal.status).toBe('published')
    expect(proposal.done).toEqual({ a: false, b: false })
    expect(proposal.taskIds?.a).toMatch(/^task-host-/)
    expect(proposal.taskIds?.b).toMatch(/^task-guest-/)

    const hostState = await host.getState()
    expect(hostState.proposals[0].taskIds?.a).toMatch(/^task-host-/)
    expect(hostState.proposals[0].taskIds?.b).toMatch(/^task-guest-/)
    expect(
      hostState.ledger.some((entry) => entry.text.includes('The work starts on every desk'))
    ).toBe(true)
  })

  it('tracks each side finishing a published joint action', async () => {
    const { host, guest } = await pair()
    const id = await coSign(host, guest, {
      title: 'Archive the receipts',
      summary: 'Both desks archive their own copies.'
    })
    await guest.publish(id)

    const guestState = await guest.markDone(id)
    expect(guestState.proposals[0].done).toEqual({ a: false, b: true })
    await expect(guest.markDone(id)).rejects.toThrow(/already marked done/i)

    const hostState = await host.markDone(id)
    expect(hostState.proposals[0].done).toEqual({ a: true, b: true })
    expect(
      hostState.ledger.some((entry) => entry.text.includes('complete on all desks'))
    ).toBe(true)
  })

  it('encrypts join request/response and state traffic on the wire', async () => {
    const host = create()
    const hosted = await host.hostTable({ name: 'Avery' })
    const code = hosted.code!
    const port = hosted.port!

    // Verify host peer does not expose raw OS hostname
    const hostState = await host.getState()
    const hostPeer = hostState.peers.find((p) => p.seat === 'a')
    expect(hostPeer?.device).not.toBe(hostname())
    expect(hostPeer?.device).toBe('Host Desktop')

    // Perform a raw HTTP /join as a network observer would see it
    const codeKey = deriveTableKey(code)
    const joinBody = encryptTablePayload({ code, name: 'SecretCaptain', device: 'Guest Desktop' }, codeKey)

    const rawResponse = await fetch(`http://127.0.0.1:${port}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(joinBody)
    })
    expect(rawResponse.ok).toBe(true)

    const rawJson = (await rawResponse.json()) as Record<string, unknown>
    // The response body over the wire must be encrypted, not plaintext state
    expect(isEncryptedTableEnvelope(rawJson)).toBe(true)
    expect(rawJson.state).toBeUndefined()
    expect(rawJson.token).toBeUndefined()

    // Query state over raw HTTP with the decrypted token
    const decrypted = (await import('./table')).decryptTablePayload<{ token: string }>(rawJson, codeKey)
    const rawStateResponse = await fetch(`http://127.0.0.1:${port}/state`, {
      headers: { authorization: `Bearer ${decrypted.token}` }
    })
    expect(rawStateResponse.ok).toBe(true)
    const rawStateJson = (await rawStateResponse.json()) as Record<string, unknown>
    // State traffic over the wire must be an encrypted envelope
    expect(isEncryptedTableEnvelope(rawStateJson)).toBe(true)
    expect(rawStateJson.goal).toBeUndefined()
    expect(rawStateJson.proposals).toBeUndefined()
  })
})
