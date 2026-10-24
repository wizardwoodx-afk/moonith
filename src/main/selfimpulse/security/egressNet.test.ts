import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { resolveEgress, safeEgressFetch } from './egressNet'

describe('native egress enforcement', () => {
  it('rejects mapped metadata and obfuscated IPv4 literals', async () => {
    expect((await resolveEgress('http://[::ffff:a9fe:a9fe]/')).ok).toBe(false)
    expect((await resolveEgress('http://2852039166/')).ok).toBe(false)
    expect((await resolveEgress('http://0xa9fea9fe/')).ok).toBe(false)
  })

  it('fails closed when DNS returns both public and private answers', async () => {
    const decision = await resolveEgress('https://example.com/', {
      resolve: async () => ['8.8.8.8', '127.0.0.1']
    })
    expect(decision.ok).toBe(false)
    expect(decision.reason).toContain('127.0.0.1')
  })

  it('re-vets redirects before a second request can be sent', async () => {
    const requested: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      requested.push(url)
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } })
    }
    await expect(safeEgressFetch('https://example.com/start', {
      fetchImpl,
      resolve: async () => ['8.8.8.8'],
      maxRedirects: 3
    })).rejects.toThrow('egress refused at hop 1')
    expect(requested).toEqual(['https://example.com/start'])
  })

  it('pins a resolved hostname to the classified socket address', async () => {
    const server = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end(`pinned:${request.headers.host ?? ''}`)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    try {
      const response = await safeEgressFetch(`http://public.test:${port}/`, {
        allowLoopback: true,
        resolve: async () => ['127.0.0.1']
      })
      expect(await response.text()).toBe(`pinned:public.test:${port}`)
      const hops = (response as Response & { egressHops?: Array<{ pinned?: boolean }> }).egressHops
      expect(hops?.[0]?.pinned).toBe(true)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })
})
