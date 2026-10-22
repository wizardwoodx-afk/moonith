import { z } from 'zod'
import { defineTool, toolResultError } from './types'
import { truncate } from '../../util'

function normalizeUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed.')
  }
  return url
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
      const url = normalizeUrl(args.url)
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8'
        },
        signal: AbortSignal.timeout(25000),
        redirect: 'follow'
      })
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
    'Search the web using DuckDuckGo HTML results. Returns titles, URLs, and snippets. Use web_fetch or the browser tools to read a result.',
  schema: z.object({ query: z.string().min(1) }),
  sideEffect: 'network',
  risk: 'low',
  execute: async (args) => {
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
