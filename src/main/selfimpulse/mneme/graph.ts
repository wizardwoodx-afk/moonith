/**
 * Mneme: Local-First Markdown Knowledge Graph Engine for SelfImpulse.
 *
 * Named from Greek "Μνήμη" (memory / remembrance).
 * Operates purely on local plain Markdown files with bidirectional WikiLinks ([[link]]).
 * Fully compatible with Obsidian, VS Code, and standard local Markdown ecosystems.
 * Zero external servers, zero cloud lock-in.
 */
import { promises as fs } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import type { MnemeGraphSummary, MnemeNode } from '@shared/types'

export class MnemeKnowledgeGraph {
  private nodes: Map<string, MnemeNode> = new Map()
  private lastIndexedAt: string = new Date().toISOString()

  /**
   * Scans a workspace directory for Markdown files and builds the local knowledge graph.
   */
  async indexDirectory(rootPath: string): Promise<MnemeGraphSummary> {
    this.nodes.clear()
    await this.scanDir(rootPath, rootPath)
    this.lastIndexedAt = new Date().toISOString()
    return this.getSummary()
  }

  private async scanDir(dir: string, root: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const ent of entries) {
        if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'dist' || ent.name === 'out') {
          continue
        }
        const full = join(dir, ent.name)
        if (ent.isDirectory()) {
          await this.scanDir(full, root)
        } else if (ent.isFile() && (ent.name.endsWith('.md') || ent.name.endsWith('.markdown'))) {
          await this.indexFile(full, root)
        }
      }
    } catch {
      // Graceful fallback for non-existent directories
    }
  }

  private async indexFile(filePath: string, root: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf8')
      const relPath = relative(root, filePath).replace(/\\/g, '/')
      const id = relPath.replace(/\.(md|markdown)$/i, '')
      const fileName = basename(filePath, '.md')

      // Extract title: first # header or filename
      const titleMatch = content.match(/^#\s+(.+)$/m)
      const title = titleMatch ? titleMatch[1].trim() : fileName

      // Extract WikiLinks: [[target]] or [[target|label]]
      const linkMatches = content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)
      const links = Array.from(linkMatches, (m) => m[1].trim())

      // Extract tags: #tag or frontmatter tags
      const tagMatches = content.matchAll(/(?:^|\s)#([a-zA-Z0-9_\-/]+)/g)
      const tags = Array.from(new Set(Array.from(tagMatches, (m) => m[1])))

      // Summary: first non-header paragraph
      const lines = content.split('\n').filter((l) => l.trim() && !l.startsWith('#'))
      const summary = lines[0]?.trim().slice(0, 160) ?? 'Knowledge node.'

      const node: MnemeNode = {
        id,
        title,
        path: relPath,
        tags,
        links,
        summary,
        updatedAt: new Date().toISOString()
      }

      this.nodes.set(id, node)
    } catch {
      // skip unreadable
    }
  }

  query(searchTerm: string): MnemeNode[] {
    const term = searchTerm.toLowerCase()
    return Array.from(this.nodes.values()).filter(
      (n) =>
        n.title.toLowerCase().includes(term) ||
        n.summary.toLowerCase().includes(term) ||
        n.tags.some((t) => t.toLowerCase().includes(term)) ||
        n.links.some((l) => l.toLowerCase().includes(term))
    )
  }

  getSummary(): MnemeGraphSummary {
    let linkCount = 0
    for (const n of this.nodes.values()) {
      linkCount += n.links.length
    }
    return {
      nodeCount: this.nodes.size,
      linkCount,
      nodes: Array.from(this.nodes.values()),
      lastIndexedAt: this.lastIndexedAt
    }
  }

  /**
   * Generates or updates a knowledge Markdown node directly in the local workspace.
   */
  async upsertNode(rootPath: string, node: { id: string; title: string; content: string; tags?: string[]; links?: string[] }): Promise<MnemeNode> {
    const rel = `${node.id}.md`
    const full = join(rootPath, rel)
    await fs.mkdir(dirname(full), { recursive: true })

    const frontmatter = [
      '---',
      `title: "${node.title}"`,
      node.tags && node.tags.length > 0 ? `tags: [${node.tags.map((t) => `"${t}"`).join(', ')}]` : null,
      `updatedAt: "${new Date().toISOString()}"`,
      '---\n'
    ]
      .filter(Boolean)
      .join('\n')

    const linksSection = node.links && node.links.length > 0
      ? `\n\n## Related Knowledge\n${node.links.map((l) => `- [[${l}]]`).join('\n')}\n`
      : ''

    const body = `${frontmatter}# ${node.title}\n\n${node.content}${linksSection}`
    await fs.writeFile(full, body, 'utf8')

    await this.indexFile(full, rootPath)
    return this.nodes.get(node.id)!
  }
}

export const mnemeGraph = new MnemeKnowledgeGraph()
