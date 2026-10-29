import { z } from 'zod'
import { isIP } from 'node:net'
import { defineTool, toolResultError } from './types'
import { truncate } from '../../util'
import { safeEgressFetch } from '../../selfimpulse/security/egressNet'
import { stealthSearchRouter } from '../../services/stealthBrowser'

const MAX_REDIRECTS = 3

const BLOCKED_NAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal'
])

function ipv4ToInt(host: string): number | null {
  const parts = host.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = value * 256 + octet
  }
  return value
}

function isBlockedIpv4(value: number): boolean {
  const inRange = (base: number, bits: number): boolean => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    return ((value & mask) >>> 0) === ((base & mask) >>> 0)
  }
  return (
    inRange(0x00000000, 8) || // 0.0.0.0/8 "this network"
    inRange(0x0a000000, 8) || // 10.0.0.0/8
    inRange(0x64400000, 10) || // 100.64.0.0/10 CGNAT
    inRange(0x7f000000, 8) || // 127.0.0.0/8 loopback
    inRange(0xa9fe0000, 16) || // 169.254.0.0/16 link-local
    inRange(0xac100000, 12) || // 172.16.0.0/12
    inRange(0xc0a80000, 16) || // 192.168.0.0/16
    inRange(0xe0000000, 4) || // 224.0.0.0/4 multicast
    inRange(0xf0000000, 4) // 240.0.0.0/4 reserved, includes broadcast
  )
}

/** Expands an IPv6 literal to eight 16-bit groups; returns null when unparseable. */
function expandIpv6(host: string): number[] | null {
  const halves = host.split('::')
  if (halves.length > 2) return null
  const parse = (part: string): number[] | null => {
    if (!part) return []
    const groups: number[] = []
    for (const piece of part.split(':')) {
      if (piece.includes('.')) {
        const v4 = ipv4ToInt(piece)
        if (v4 === null) return null
        groups.push(Math.floor(v4 / 65536), v4 % 65536)
        continue
      }
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null
      groups.push(parseInt(piece, 16))
    }
    return groups
  }
  const head = parse(halves[0])
  const tail = halves.length === 2 ? parse(halves[1]) : []
  if (!head || !tail) return null
  if (halves.length === 1) return head.length === 8 ? head : null
  const fill = 8 - head.length - tail.length
  if (fill < 0) return null
  return [...head, ...new Array<number>(fill).fill(0), ...tail]
}

function isBlockedIpv6(host: string): boolean {
  const groups = expandIpv6(host.split('%')[0])
  // Fail closed: `isIP` said this is IPv6, so an unparseable literal is suspicious.
  if (!groups) return true
  const mapped =
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff
  if (mapped) return isBlockedIpv4(groups[6] * 256 + groups[7])
  const first = groups[0]
  return (
    groups.every((group) => group === 0) || // ::
    (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) || // ::1
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (first & 0xff00) === 0xff00 // ff00::/8 multicast
  )
}

/**
 * True for loopback, private, link-local, unique-local, unspecified and
 * multicast hosts. Only canonical dotted-quad IPv4 is recognised: exotic
 * encodings such as `http://2130706433/` or octal/hex octets are not decoded
 * here, so this is a guard against ordinary misconfiguration and simple SSRF,
 * not a complete defence against a determined attacker.
 */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .replace(/\.$/, '')
  if (!host) return true
  if (BLOCKED_NAMES.has(host) || host.endsWith('.localhost')) return true
  const family = isIP(host)
  if (family === 4) {
    const value = ipv4ToInt(host)
    return value === null ? true : isBlockedIpv4(value)
  }
  if (family === 6) return isBlockedIpv6(host)
  return false
}

function normalizeUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed.')
  }
  return url
}

/** Fetches through the native DNS-classified, pinned, per-redirect egress boundary. */
async function fetchPublic(start: URL, signal: AbortSignal): Promise<{ response: Response; url: URL }> {
  const response = await safeEgressFetch(start.toString(), {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8'
    },
    signal,
    redirect: 'manual',
    maxRedirects: MAX_REDIRECTS
  })
  const hops = (response as Response & { egressHops?: Array<{ url: string }> }).egressHops
  return { response, url: new URL(hops?.at(-1)?.url || response.url || start.toString()) }
}

export const webFetchTool = defineTool({
  name: 'web_fetch',
  title: 'Fetch web page',
  description:
    'Fetch a public web page and return readable text, its title, and links. Use for research. Does not run JavaScript.',
  schema: z.object({ url: z.string().url() }),
  sideEffect: 'network',
  risk: 'low',
  execute: async (args) => {
    try {
      const start = normalizeUrl(args.url)
      if (isBlockedHost(start.hostname)) {
        return { content: 'Refusing to fetch a private or loopback address.', isError: true }
      }
      const { response, url } = await fetchPublic(start, AbortSignal.timeout(25000))
      if (!response.ok) return { content: `Request failed with HTTP ${response.status}.`, isError: true }
      const contentType = response.headers.get('content-type') ?? ''
      if (!/text|json|xml|html/.test(contentType)) {
        return { content: `Unsupported content type: ${contentType}`, isError: true }
      }
      const raw = (await response.text()).slice(0, 800_000)
      if (!/html/.test(contentType)) {
        return { content: truncate(raw, 24000) }
      }
      const cheerio = await import('cheerio')
      const $ = cheerio.load(raw)
      $('script,style,noscript,svg,iframe,canvas').remove()
      const title = $('title').first().text().trim() || url.hostname
      const description = $('meta[name="description"]').attr('content')?.trim()
      const text = $('body')
        .text()
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n\s*\n+/g, '\n\n')
        .trim()
      const links: string[] = []
      const seen = new Set<string>()
      $('a[href]').each((_, element) => {
        if (links.length >= 25) return
        const href = $(element).attr('href')
        if (!href) return
        try {
          const absolute = new URL(href, url).toString()
          if (seen.has(absolute) || !/^https?:/.test(absolute)) return
          seen.add(absolute)
          links.push(`${$(element).text().trim().slice(0, 80) || absolute} → ${absolute}`)
        } catch {
          /* ignore */
        }
      })
      return {
        content: [
          `Title: ${title}`,
          `URL: ${url.toString()}`,
          description ? `Description: ${description}` : '',
          '',
          truncate(text, 20000),
          links.length ? `\n\nLinks:\n${links.join('\n')}` : ''
        ]
          .filter(Boolean)
          .join('\n')
      }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => args.url
})

export const webSearchTool = defineTool({
  name: 'web_search',
  title: 'Search the web',
  description:
    'Search the web using the always-on stealth browser engine (with Camoufox anti-detect headers and bot-evasion). Returns organic titles, clean URLs, and rich snippets. Use web_fetch or browser tools to read a result.',
  schema: z.object({ query: z.string().min(1) }),
  sideEffect: 'network',
  risk: 'low',
  execute: async (args) => {
    try {
      // 1. Direct route to always-on stealth browser search
      const outcome = await stealthSearchRouter.search(args.query, 10)
      if (outcome.results.length > 0) {
        const formatted = outcome.results.map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n')
        return {
          content: `Results for “${args.query}” (${outcome.sourceEngine}, ${outcome.durationMs}ms):\n\n${formatted}`
        }
      }
    } catch {
      // Fallback to direct fetch path if stealth router encounters network exception
    }

    try {
      const form = new URLSearchParams({ q: args.query })
      const response = await fetch(`https://html.duckduckgo.com/html/?${form.toString()}`, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36',
          Accept: 'text/html'
        },
        signal: AbortSignal.timeout(25000)
      })
      if (!response.ok) {
        return { content: `Search failed with HTTP ${response.status}.`, isError: true }
      }
      const html = await response.text()
      const cheerio = await import('cheerio')
      const $ = cheerio.load(html)
      const results: string[] = []
      $('.result').each((_, element) => {
        if (results.length >= 10) return
        const link = $(element).find('.result__a').first()
        const title = link.text().trim()
        let href = link.attr('href') ?? ''
        if (href.includes('uddg=')) {
          try {
            href = decodeURIComponent(new URL(href, 'https://duckduckgo.com').searchParams.get('uddg') ?? href)
          } catch {
            /* keep */
          }
        }
        const snippet = $(element).find('.result__snippet').text().trim()
        if (title && href) results.push(`${results.length + 1}. ${title}\n${href}\n${snippet}`)
      })
      if (!results.length) {
        return {
          content: 'No results parsed. DuckDuckGo may be blocking automated requests; try browser_open on a search URL.',
          isError: true
        }
      }
      return { content: `Results for “${args.query}”:\n\n${results.join('\n\n')}` }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => args.query
})

export const webTools = [webFetchTool, webSearchTool]
