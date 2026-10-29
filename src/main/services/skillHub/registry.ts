/**
 * SelfImpulse Skill Hub Registry.
 *
 * Fully de-branded native catalog and registry for modular SKILL.md bundles.
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { getPaths } from '../../paths'
import { parseSkillMarkdown, type ParsedSkill } from '../skills'

export interface HubSkillItem {
  id: string
  name: string
  description: string
  author: string
  installed: boolean
  path?: string
}

export class SkillHubRegistry {
  private localSkillsDir?: string

  constructor(skillsDir?: string) {
    this.localSkillsDir = skillsDir
  }

  private resolveDir(): string {
    return this.localSkillsDir ?? getPaths().skills
  }

  /**
   * Scans and lists all locally installed skills in the profile skills directory.
   */
  async listInstalled(): Promise<HubSkillItem[]> {
    const items: HubSkillItem[] = []
    const dir = this.resolveDir()
    try {
      await fs.mkdir(dir, { recursive: true })
      const entries = await fs.readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const skillPath = join(dir, entry.name, 'SKILL.md')
        try {
          const content = await fs.readFile(skillPath, 'utf8')
          const parsed = parseSkillMarkdown(content)
          items.push({
            id: entry.name,
            name: parsed.name || entry.name,
            description: parsed.description || 'No description provided.',
            author: 'local',
            installed: true,
            path: skillPath
          })
        } catch {
          // Folder without SKILL.md is skipped
        }
      }
    } catch {
      // Empty if directory unreadable
    }

    return items
  }

  /**
   * Search through skills by query keyword in name or description.
   */
  async search(query: string): Promise<HubSkillItem[]> {
    const all = await this.listInstalled()
    const q = query.toLowerCase().trim()
    if (!q) return all

    return all.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)
    )
  }
}

export const skillHubRegistry = new SkillHubRegistry()
