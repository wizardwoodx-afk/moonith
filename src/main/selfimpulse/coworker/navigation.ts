import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

/**
 * Native navigation boundary for the coworker browser.
 *
 * The destination classification is adapted from CopilotKit OpenBot's
 * server/src/computer/target.ts (MIT), pinned in PROVENANCE.json. This module
 * deliberately has no OpenBot, Intelligence, gateway, Docker, or service-port
 * dependency. DNS resolution is performed here so a public hostname cannot be
 * used as an unchecked alias for a private or metadata address.
 */

export interface ResolvedAddress {
  address: string
  family?: number
}

export type AddressLookup = (hostname: string) => Promise<ResolvedAddress[]>

export class NavigationBlockError extends Error {
  readonly code = 'NAVIGATION_BLOCKED'

  constructor(message: string) {
    super(message)
    this.name = 'NavigationBlockError'
  }
}

const PRIVATE_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'instance-data',
  'instance-data.ec2.internal'
])

const IPV4_RANGES: Array<[number, number]> = [
  [0x00000000, 8], // "this host" and unspecified
  [0x0a000000, 8], // RFC 1918
  [0x64400000, 10], // shared carrier-grade NAT
  [0x7f000000, 8], // loopback
  [0xa9fe0000, 16], // link local
  [0xac100000, 12], // RFC 1918
  [0xc0000000, 24], // IETF protocol assignments
  [0xc0000200, 24], // documentation
  [0xc0a80000, 16], // RFC 1918
  [0xc6120000, 15], // benchmark networks
  [0xc6336400, 24], // documentation
  [0xcb007100, 24], // documentation
  [0xe0000000, 4], // multicast
  [0xf0000000, 4] // reserved
]

function blocked(message: string): never {
  throw new NavigationBlockError(message)
}

function ipv4Value(value: string): number | null {
  if (isIP(value) !== 4) return null
  const parts = value.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null
  }
  return parts.reduce((result, part) => result * 256 + part, 0) >>> 0
}

function inIpv4Range(value: number, base: number, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (value & mask) === (base & mask)
}

function ipv6Value(value: string): bigint | null {
  if (isIP(value) !== 6 || value.includes('%')) return null
  const pieces = value.toLowerCase().split('::')
  if (pieces.length > 2) return null

  const parseGroups = (input: string, allowIpv4: boolean): number[] | null => {
    if (!input) return []
    const raw = input.split(':')
    const groups: number[] = []
    for (const [index, part] of raw.entries()) {
      if (!part) return null
      if (part.includes('.')) {
        if (!allowIpv4 || index !== raw.length - 1) return null
        const ipv4 = ipv4Value(part)
        if (ipv4 == null) return null
        groups.push((ipv4 >>> 16) & 0xffff, ipv4 & 0xffff)
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(part)) return null
        groups.push(Number.parseInt(part, 16))
      }
    }
    return groups
  }

  const head = parseGroups(pieces[0], pieces.length === 1)
  const tail = pieces.length === 2 ? parseGroups(pieces[1], true) : []
  if (!head || !tail) return null
  const groups = pieces.length === 2 ? [...head, ...Array(8 - head.length - tail.length).fill(0), ...tail] : head
  if (groups.length !== 8) return null
  return groups.reduce((result, group) => (result << 16n) | BigInt(group), 0n)
}

function inIpv6Range(value: bigint, base: bigint, bits: number): boolean {
  const mask = bits === 0 ? 0n : ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - bits)) - 1n)
  return (value & mask) === (base & mask)
}

function v6(value: string): bigint {
  const parsed = ipv6Value(value)
  if (parsed == null) throw new Error(`Invalid internal IPv6 range: ${value}`)
  return parsed
}

const V6_RANGES: Array<[bigint, bigint, number]> = [
  [v6('::'), 0n, 96], // unspecified, loopback, and deprecated IPv4-compatible addresses
  [v6('64:ff9b::'), v6('64:ff9b::'), 96], // NAT64 well-known prefix
  [v6('100::'), v6('100::'), 64], // discard-only
  [v6('2001::'), v6('2001::'), 32], // Teredo tunneling
  [v6('2001:db8::'), v6('2001:db8::'), 32], // documentation
  [v6('fc00::'), v6('fc00::'), 7], // unique local
  [v6('fe80::'), v6('fe80::'), 10], // link local
  [v6('ff00::'), v6('ff00::'), 8] // multicast
]

/** True for loopback, private, link-local, metadata-adjacent, or non-routable IPs. */
export function isDisallowedIp(value: string): boolean {
  const ipv4 = ipv4Value(value)
  if (ipv4 != null) return IPV4_RANGES.some(([base, bits]) => inIpv4Range(ipv4, base, bits))

  const ipv6 = ipv6Value(value)
  if (ipv6 == null) return true

  // IPv4-mapped IPv6 addresses must obey the IPv4 rules too.
  if (ipv6 >> 32n === 0xffffn) {
    const mapped = Number(ipv6 & 0xffffffffn) >>> 0
    return IPV4_RANGES.some(([base, bits]) => inIpv4Range(mapped, base, bits))
  }
  return V6_RANGES.some(([, base, bits]) => inIpv6Range(ipv6, base, bits))
}

function canonicalHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
}

/** Synchronous URL policy. Call assertSafeNavigation for the DNS-aware check. */
export function inspectNavigationTarget(raw: string): URL {
  if (typeof raw !== 'string' || raw.length > 8192 || !raw.trim()) {
    blocked('The browser destination is empty or too long.')
  }
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    blocked('The browser destination is not a valid URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    blocked('Only HTTP and HTTPS browser destinations are allowed.')
  }
  if (url.username || url.password) {
    blocked('Browser destinations containing credentials are not allowed.')
  }
  const hostname = canonicalHostname(url)
  if (!hostname || hostname === '0' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    blocked('Local and private hostnames are not allowed in the coworker browser.')
  }
  if (PRIVATE_HOSTS.has(hostname)) {
    blocked('Local and cloud metadata destinations are blocked.')
  }
  if (isIP(hostname) && isDisallowedIp(hostname)) {
    blocked('Private, loopback, link-local, and non-routable IP destinations are blocked.')
  }
  return url
}

const defaultLookup: AddressLookup = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  return addresses.map((entry) => ({ address: entry.address, family: entry.family }))
}

/**
 * Resolve and validate every address before navigation. Failing closed is
 * intentional: an unresolvable host is not assumed to be safe.
 */
export async function assertSafeNavigation(raw: string, resolveAddress: AddressLookup = defaultLookup): Promise<URL> {
  const url = inspectNavigationTarget(raw)
  const hostname = canonicalHostname(url)
  if (isIP(hostname)) return url

  let addresses: ResolvedAddress[]
  try {
    addresses = await resolveAddress(hostname)
  } catch {
    blocked('The browser destination could not be verified; navigation was blocked.')
  }
  if (!addresses.length) blocked('The browser destination did not resolve to a verified address.')
  for (const entry of addresses) {
    if (!entry || isDisallowedIp(entry.address)) {
      blocked('The browser destination resolves to a private or non-routable address.')
    }
  }
  return url
}

export function navigationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
