import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'

/**
 * Shared egress guard for every path that lets the agent (or a page it read)
 * point a real socket at a host: the task browser
 * (`src/main/services/browser.ts`) and the web tools
 * (`src/main/agent/tools/web.ts`).
 *
 * Why this module exists: a hostname-only check admits exactly the hosts that
 * make SSRF useful. `127.0.0.1.nip.io`, `1.1.1.1.nip.io`, a wildcard DNS name
 * behind a rebalancer, or any short-TTL record can answer with a loopback,
 * private or metadata address at the moment the socket connects. So the guard
 * resolves the name and inspects **every** answer, not just the first, and
 * refuses the whole record set if one answer is not public.
 *
 * Known limitations, stated rather than implied (see also the report):
 *  - TOCTOU / DNS rebind: resolution here and resolution by the connecting
 *    stack (Chromium, `fetch`) are two lookups. A record with TTL 0 can answer
 *    public to the guard and private to the socket. The resolved `address` is
 *    returned so a caller can pin it; neither the task browser nor `fetch` does
 *    today, because pinning an IP for an https URL breaks SNI and certificate
 *    validation.
 *  - Chromium follows redirects inside its own navigation stack, so a
 *    server-side redirect from a public host to a private one happens in hops we
 *    cannot intercept before the request. `browserService` re-checks the final
 *    URL after the load and blanks the page, which stops the *content* from
 *    reaching the model but does not undo the request.
 *
 * The error class is deliberately coarse: `private`, `loopback` and
 * `blocked host` are the three outcomes a caller has to distinguish, and the
 * tools surface them as a tool error, never as a crash.
 */

export type EgressResolver = (host: string) => Promise<{ address: string }[]>

export type EgressReason = 'private' | 'loopback' | 'blocked host'

/** Thrown for every refusal. Callers catch it and turn it into a tool error. */
export class EgressBlockedError extends Error {
  readonly reason: EgressReason

  constructor(reason: EgressReason, detail: string) {
    super(`${detail} [egress ${reason}]`)
    this.name = 'EgressBlockedError'
    this.reason = reason
  }
}

export interface AddressRefusal {
  reason: EgressReason
  detail: string
}

function blocked(reason: EgressReason, detail: string): EgressBlockedError {
  return new EgressBlockedError(reason, detail)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Default resolver: every A **and** AAAA answer, untouched. `all: true` is what
 * makes the guard see a record set that mixes public and private answers, and
 * `verbatim: true` stops Node from quietly folding IPv6 answers into IPv4 form.
 */
const defaultResolver: EgressResolver = async (host) =>
  dns.lookup(host, { all: true, verbatim: true })

// ---------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------

interface V4Range {
  base: number
  bits: number
  reason: 'private' | 'loopback'
  label: string
}

function v4Range(cidr: string, bits: number, reason: 'private' | 'loopback', label: string): V4Range {
  const base = parseIpv4(cidr)
  if (base === null) throw new Error(`egressGuard: bad range literal ${cidr}`)
  return { base, bits, reason, label }
}

/**
 * Refused IPv4 space. The first group is what the audits named (loopback, the
 * RFC1918 pairs, link-local — which is every cloud metadata endpoint — and
 * `0.0.0.0/8`, whose zero address means "this host"). CGNAT, the IETF
 * assignment block, the benchmarking block, multicast and the reserved/broadcast
 * space are included because nothing on the public web legitimately lives there.
 */
const BLOCKED_V4: V4Range[] = [
  v4Range('0.0.0.0', 8, 'private', '0.0.0.0/8 this-network, includes 0.0.0.0 itself'),
  v4Range('10.0.0.0', 8, 'private', '10.0.0.0/8 RFC1918'),
  v4Range('100.64.0.0', 10, 'private', '100.64.0.0/10 CGNAT (used by some cloud metadata services)'),
  v4Range('127.0.0.0', 8, 'loopback', '127.0.0.0/8 loopback'),
  v4Range('169.254.0.0', 16, 'private', '169.254.0.0/16 link-local, includes cloud metadata'),
  v4Range('172.16.0.0', 12, 'private', '172.16.0.0/12 RFC1918'),
  v4Range('192.0.0.0', 24, 'private', '192.0.0.0/24 IETF protocol assignments'),
  v4Range('192.168.0.0', 16, 'private', '192.168.0.0/16 RFC1918'),
  v4Range('198.18.0.0', 15, 'private', '198.18.0.0/15 benchmarking'),
  v4Range('224.0.0.0', 4, 'private', '224.0.0.0/4 multicast'),
  v4Range('240.0.0.0', 4, 'private', '240.0.0.0/4 reserved, includes 255.255.255.255')
]

function inV4Range(value: number, range: V4Range): boolean {
  const mask = range.bits === 0 ? 0 : (0xffffffff << (32 - range.bits)) >>> 0
  return ((value & mask) >>> 0) === ((range.base & mask) >>> 0)
}

/** Strict dotted quad: four decimal octets, no leading zeros, no short forms. */
function parseIpv4(value: string): number | null {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  let result = 0
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    result = result * 256 + octet
  }
  return result
}

/**
 * Splits an IPv6 literal into its eight 16-bit groups, expanding `::` and a
 * trailing embedded IPv4. Validation is delegated to `net.isIP` by the caller,
 * so this only has to be structurally faithful.
 */
function ipv6Groups(value: string): number[] | null {
  const halves = value.split('::')
  if (halves.length > 2) return null
  const head = splitGroupRun(halves[0])
  const tail = halves.length === 2 ? splitGroupRun(halves[1]) : []
  if (!head || !tail) return null
  if (halves.length === 1) return head.length === 8 ? head : null
  const fill = 8 - head.length - tail.length
  if (fill < 1) return null
  return [...head, ...new Array<number>(fill).fill(0), ...tail]
}

function splitGroupRun(part: string): number[] | null {
  if (part === '') return []
  const pieces = part.split(':')
  const groups: number[] = []
  for (let index = 0; index < pieces.length; index++) {
    const piece = pieces[index]
    if (piece.includes('.')) {
      // An embedded IPv4 always lands in the final position and takes two groups.
      if (index !== pieces.length - 1) return null
      const embedded = parseIpv4(piece)
      if (embedded === null) return null
      groups.push(Math.floor(embedded / 0x10000), embedded % 0x10000)
      continue
    }
    if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return null
    groups.push(parseInt(piece, 16))
  }
  return groups
}

function high32(top: number, bottom: number): number {
  return top * 0x10000 + bottom
}

interface Embedded {
  value: number
  label: string
}

/**
 * The IPv4 hidden inside an IPv6 answer. Without this, `::ffff:127.0.0.1`,
 * `64:ff9b::7f00:1`, `2002:7f00:1::` and a Teredo client are four clean ways to
 * walk straight past a loopback check.
 */
function embeddedIpv4(groups: number[]): Embedded | null {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups
  if (g5 === 0xffff && [g0, g1, g2, g3, g4].every((group) => group === 0)) {
    return { value: high32(g6, g7), label: 'IPv4-mapped ::ffff:0:96' }
  }
  if (g0 === 0x0064 && g1 === 0xff9b && [g2, g3, g4, g5].every((group) => group === 0)) {
    return { value: high32(g6, g7), label: 'NAT64 well-known prefix 64:ff9b::/96' }
  }
  if (g0 === 0x2002) {
    return { value: high32(g2, g3), label: '6to4 2002::/16' }
  }
  if (g0 === 0x2001 && g1 === 0x0000) {
    // Teredo: the client's IPv4 is stored inverted in the low 32 bits.
    return { value: (~high32(g6, g7)) >>> 0, label: 'Teredo 2001::/32' }
  }
  // The deprecated IPv4-compatible form `::a.b.c.d`. `::` and `::1` are already
  // handled by the time this runs, so the remaining low-32 values really are
  // disguised IPv4.
  if ([g0, g1, g2, g3, g4, g5].every((group) => group === 0)) {
    return { value: high32(g6, g7), label: 'IPv4-compatible ::/96' }
  }
  return null
}

function classifyIpv4Value(value: number, display: string): AddressRefusal | null {
  for (const range of BLOCKED_V4) {
    if (inV4Range(value, range)) {
      return { reason: range.reason, detail: `${display} is in ${range.label}` }
    }
  }
  return null
}

function classifyIpv6Groups(groups: number[], display: string): AddressRefusal | null {
  if (groups.every((group) => group === 0)) {
    return { reason: 'private', detail: `${display} is ::, the unspecified address` }
  }
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) {
    return { reason: 'loopback', detail: `${display} is ::1 loopback` }
  }
  const embedded = embeddedIpv4(groups)
  if (embedded) {
    const refusal = classifyIpv4Value(embedded.value, `${display} (${embedded.label})`)
    if (refusal) return refusal
  }
  const [g0, g1] = groups
  if (g0 === 0x0100 && [g1, groups[2], groups[3]].every((group) => group === 0)) {
    return { reason: 'private', detail: `${display} is in 100::/64 discard-only` }
  }
  if ((g0 & 0xfe00) === 0xfc00) {
    return { reason: 'private', detail: `${display} is in fc00::/7 unique-local` }
  }
  if ((g0 & 0xffc0) === 0xfe80) {
    return { reason: 'private', detail: `${display} is in fe80::/10 link-local` }
  }
  if ((g0 & 0xff00) === 0xff00) {
    return { reason: 'private', detail: `${display} is in ff00::/8 multicast` }
  }
  return null
}

/**
 * Classify one address. `null` means "public, nothing to refuse"; an unparseable
 * address is refused as `blocked host`, so a resolver that answers with junk
 * fails closed instead of failing open.
 */
export function classifyEgressAddress(address: string): AddressRefusal | null {
  const family = isIP(address)
  if (family === 4) {
    const value = parseIpv4(address)
    if (value === null) {
      return { reason: 'blocked host', detail: `${address} is not a strict dotted-quad IPv4 address` }
    }
    return classifyIpv4Value(value, address)
  }
  if (family === 6) {
    const groups = ipv6Groups(address)
    if (!groups) {
      return { reason: 'blocked host', detail: `${address} is an IPv6 literal this guard cannot expand` }
    }
    return classifyIpv6Groups(groups, address)
  }
  return { reason: 'blocked host', detail: `${JSON.stringify(address)} is not an IP address` }
}

// ---------------------------------------------------------------------------
// Name-level refusals (never public, whatever DNS says)
// ---------------------------------------------------------------------------

const LOOPBACK_NAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback'
])

/**
 * RFC 6761 special-use names plus the metadata hostname that only ever resolves
 * to a link-local address on GCE. Refusing these before resolution also keeps
 * the guard from feeding a metadata name to the resolver at all.
 */
const RESERVED_SUFFIXES = ['.localhost', '.local', '.internal', '.home', '.corp', '.intra']

const RESERVED_NAMES = new Set(['metadata.google.internal'])

function blockedNameReason(
  host: string,
  allowLoopback: boolean
): string | null {
  const bare = host.replace(/\.$/, '')
  if (RESERVED_NAMES.has(bare)) return `${host} is a reserved metadata name`
  for (const suffix of RESERVED_SUFFIXES) {
    if (suffix === '.localhost' && allowLoopback) continue
    if (bare === suffix.slice(1) || bare.endsWith(suffix)) {
      return `${host} is a reserved special-use name (${suffix} per RFC 6761)`
    }
  }
  if (!allowLoopback && LOOPBACK_NAMES.has(bare)) return `${host} is a loopback name`
  return null
}

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

interface ParsedHost {
  /** The canonical host as the URL parser produced it (`[::1]` keeps brackets). */
  host: string
  /** An IP literal with brackets removed, or null when the host is a name. */
  literal: string | null
}

function parseHttpUrl(raw: string, purpose: string): URL {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw blocked('blocked host', `${purpose} is not a URL the platform parser accepts`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw blocked(
      'blocked host',
      `only http and https may be used for ${purpose}, got ${parsed.protocol}`
    )
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw blocked('blocked host', `${purpose} carries URL credentials, which are refused`)
  }
  return parsed
}

/**
 * Validates the parsed host and separates IP literals from names. Everything the
 * WHATWG parser does not already normalise — brackets, percent-encoding,
 * stray colons, non-DNS characters — is refused rather than passed to a resolver,
 * because parser differences between Chromium, Node and the system resolver are
 * where this class of bypass lives. The parser has already folded the encodings
 * it understands (`http://2130706433/`, `http://0177.0.0.1/`, `http://0x7f.0.0.1/`,
 * `http://127%2e0%2e0.1/`) to `127.0.0.1`, so those reach the address checks as
 * the literal they mean.
 */
function parsedHost(parsed: URL): ParsedHost {
  const host = parsed.hostname
  if (!host) throw blocked('blocked host', 'the URL has no host')

  if (host.startsWith('[')) {
    if (!host.endsWith(']')) {
      throw blocked('blocked host', `${host} is an unbalanced IPv6 literal`)
    }
    const inner = host.slice(1, -1)
    if (inner.includes('%')) {
      throw blocked('blocked host', `${host} carries an IPv6 zone identifier`)
    }
    if (isIP(inner) !== 6 || !ipv6Groups(inner)) {
      throw blocked('blocked host', `${host} is not a valid IPv6 literal`)
    }
    return { host, literal: inner }
  }

  if (host.includes('[') || host.includes(']')) {
    throw blocked('blocked host', `${host} has a misplaced bracket`)
  }
  if (host.includes(':')) {
    throw blocked('blocked host', `${host} looks like a bare IPv6 address without brackets`)
  }
  if (host.includes('%')) {
    throw blocked('blocked host', `${host} is percent-encoded`)
  }
  if (!/^[a-z0-9._-]+$/i.test(host)) {
    throw blocked('blocked host', `${host} contains characters outside the DNS allowlist`)
  }

  const family = isIP(host)
  if (family === 4) {
    if (parseIpv4(host) === null) {
      throw blocked('blocked host', `${host} is not a strict dotted-quad address`)
    }
    return { host, literal: host }
  }
  if (family === 6) return { host, literal: host }
  return { host, literal: null }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface EgressTarget {
  /** The canonicalised URL (`URL.href`), safe to hand to `loadURL`/`fetch`. */
  url: string
  /** The first resolved address, returned so a caller can pin it if it can. */
  address: string
}

/**
 * Resolve `url` and refuse it unless **every** answer is a public http(s) target.
 *
 * Throws `EgressBlockedError` whose message ends in `[egress private]`,
 * `[egress loopback]` or `[egress blocked host]`; tools should catch it and
 * report the message as a tool error. `resolver` is a test seam — production
 * callers leave it undefined and get `dns.promises.lookup(..., { all: true })`.
 * `allowLoopback` admits loopback only (for a deliberately local target);
 * private, link-local and metadata space stays refused either way.
 */
export async function assertPublicHttpTarget(
  url: string,
  resolver: EgressResolver = defaultResolver,
  opts: { allowLoopback?: boolean } = {}
): Promise<EgressTarget> {
  const parsed = parseHttpUrl(url, 'this navigation')
  const allowLoopback = opts.allowLoopback === true
  const { host, literal } = parsedHost(parsed)

  const nameReason = blockedNameReason(host, allowLoopback)
  if (nameReason) throw blocked('blocked host', nameReason)

  if (literal !== null) {
    const refusal = classifyEgressAddress(literal)
    if (refusal && !(allowLoopback && refusal.reason === 'loopback')) {
      throw blocked(refusal.reason, `Refusing ${parsed.href}: ${refusal.detail}`)
    }
    return { url: parsed.href, address: literal }
  }

  let answers: { address: string }[]
  try {
    answers = await resolver(host)
  } catch (error) {
    throw blocked(
      'blocked host',
      `${host} could not be resolved (${errorMessage(error)}), and an unresolvable host is refused rather than guessed at`
    )
  }
  if (!Array.isArray(answers) || answers.length === 0) {
    throw blocked('blocked host', `${host} resolved to no address`)
  }

  const publicAddresses: string[] = []
  for (const answer of answers) {
    const address = answer && typeof answer.address === 'string' ? answer.address : ''
    const refusal = classifyEgressAddress(address)
    if (refusal && !(allowLoopback && refusal.reason === 'loopback')) {
      throw blocked(
        refusal.reason,
        `Refusing ${parsed.href}: ${host} resolves to ${address || '(empty answer)'}, and ${refusal.detail}. Every answer in the record set is checked, so one private record in an otherwise public set is enough to refuse the whole name.`
      )
    }
    publicAddresses.push(address)
  }

  return { url: parsed.href, address: publicAddresses[0] }
}

/**
 * Synchronous, DNS-free first pass, for navigation handlers that cannot await a
 * lookup (Chromium's `will-navigate` and the window-open handler). It returns a
 * refusal reason when a host is obviously not public — IP literals, IPv4
 * encodings the URL parser normalises, reserved names, bad schemes — and `null`
 * when the host is a name that needs resolution.
 *
 * `null` is **not** an approval. The async `assertPublicHttpTarget` stays the
 * authority; this exists so a link click pointing at `169.254.169.254` is
 * stopped without waiting on a lookup.
 */
export function syncBlockedHostReason(url: string): string | null {
  try {
    const parsed = parseHttpUrl(url, 'this navigation')
    const { host, literal } = parsedHost(parsed)
    const nameReason = blockedNameReason(host, false)
    if (nameReason) return nameReason
    if (literal !== null) {
      const refusal = classifyEgressAddress(literal)
      if (refusal) return `${parsed.href}: ${refusal.detail}`
    }
    return null
  } catch (error) {
    return errorMessage(error)
  }
}
