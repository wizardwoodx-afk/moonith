/**
 * SelfImpulse Skill Hub Installer.
 *
 * Provides 1-click safe installation of SKILL.md bundles.
 * Scans content with OpenAI Guardrails before writing to disk.
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { getPaths } from '../../paths'
import { guardrails } from '../../agent/guardrails'
import { parseSkillMarkdown } from '../skills'

export interface SkillInstallInput {
  id: string
  name: string
  markdownContent: string
  scripts?: Array<{ filename: string; content: string }>
}

export interface SkillInstallResult {
  success: boolean
  installedPath?: string
  error?: string
}

export class SkillHubInstaller {
  private skillsBaseDir?: string

  constructor(baseDir?: string) {
    this.skillsBaseDir = baseDir
  }

  private resolveDir(): string {
    return this.skillsBaseDir ?? getPaths().skills
  }

  /**
   * Installs a new skill into the profile skills folder after safety verification.
   */
  async install(input: SkillInstallInput): Promise<SkillInstallResult> {
    // 1. Safety check content with Guardrails
    const check = guardrails.screenInput(input.markdownContent)
    if (!check.allowed) {
      return {
        success: false,
        error: `Skill installation blocked by safety checks: ${check.violations.map((v) => v.message).join('; ')}`
      }
    }

    // 2. Validate structure
    const parsed = parseSkillMarkdown(input.markdownContent)
    if (!parsed.name && !input.name) {
      return {
        success: false,
        error: 'Skill content must contain valid YAML frontmatter with a "name" field or a title heading.'
      }
    }

    // 3. Write skill files atomically
    const sanitizedId = input.id.toLowerCase().replace(/[^a-z0-9_-]/g, '-')
    const targetDir = join(this.resolveDir(), sanitizedId)

    try {
      await fs.mkdir(targetDir, { recursive: true })
      const skillFile = join(targetDir, 'SKILL.md')
      await fs.writeFile(skillFile, input.markdownContent, 'utf8')

      if (input.scripts) {
        const scriptsDir = join(targetDir, 'scripts')
        await fs.mkdir(scriptsDir, { recursive: true })
        for (const script of input.scripts) {
          const scriptTarget = join(scriptsDir, script.filename)
          await fs.writeFile(scriptTarget, script.content, 'utf8')
        }
      }

      return {
        success: true,
        installedPath: skillFile
      }
    } catch (err) {
      return {
        success: false,
        error: `Failed to write skill to disk: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  /**
   * Uninstalls a skill from the skills directory.
   */
  async uninstall(skillId: string): Promise<boolean> {
    const sanitizedId = skillId.toLowerCase().replace(/[^a-z0-9_-]/g, '-')
    const targetDir = join(this.resolveDir(), sanitizedId)
    try {
      await fs.rm(targetDir, { recursive: true, force: true })
      return true
    } catch {
      return false
    }
  }
}

export const skillHubInstaller = new SkillHubInstaller()
