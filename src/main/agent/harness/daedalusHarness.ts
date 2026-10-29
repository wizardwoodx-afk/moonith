import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { newId, nowIso } from '../../util'
import type { AtroposVirtualActor } from '../durable/virtualActor'
import { TechnePatchEngine } from '../coding/patchEngine'

export type HarnessStage = 'survey' | 'spec' | 'patch' | 'verify' | 'settle'

export interface HarnessCheckpoint {
  id: string
  stage: HarnessStage
  timestamp: string
  fileSnapshots: Record<string, string>
  note?: string
}

export interface StageVerificationResult {
  passed: boolean
  issues: string[]
}

export class DaedalusCodingHarness {
  private checkpoints = new Map<string, HarnessCheckpoint>()

  constructor(
    public readonly actor: AtroposVirtualActor,
    public readonly workspace: string
  ) {}

  /**
   * Captures a durable checkpoint of tracked files before or after a stage.
   */
  async createCheckpoint(stage: HarnessStage, filePaths: string[], note?: string): Promise<string> {
    const id = newId('chk')
    const fileSnapshots: Record<string, string> = {}

    for (const relPath of filePaths) {
      const fullPath = join(this.workspace, relPath)
      try {
        const content = await fs.readFile(fullPath, 'utf8')
        fileSnapshots[relPath] = content
      } catch {
        // File may not exist yet (to be created in patch)
      }
    }

    const checkpoint: HarnessCheckpoint = {
      id,
      stage,
      timestamp: nowIso(),
      fileSnapshots,
      note
    }

    this.checkpoints.set(id, checkpoint)
    // Persist into actor's durable state
    await this.actor.set(`checkpoint_${id}`, checkpoint)
    await this.actor.set('latest_checkpoint_id', id)

    return id
  }

  /**
   * Restores files to a previously saved checkpoint.
   */
  async rollbackToCheckpoint(checkpointId: string): Promise<boolean> {
    let checkpoint = this.checkpoints.get(checkpointId)
    if (!checkpoint) {
      checkpoint = await this.actor.get<HarnessCheckpoint>(`checkpoint_${checkpointId}`)
    }
    if (!checkpoint) return false

    for (const [relPath, content] of Object.entries(checkpoint.fileSnapshots)) {
      const fullPath = join(this.workspace, relPath)
      await fs.writeFile(fullPath, content, 'utf8')
    }

    await this.actor.set('active_rollback', {
      toCheckpoint: checkpointId,
      at: nowIso()
    })

    return true
  }

  /**
   * Executes a durable stage step, skipping re-execution if already recorded in the actor's journal.
   */
  async runStage<T>(stage: HarnessStage, name: string, taskFn: () => Promise<T>): Promise<T> {
    await this.actor.set('current_stage', stage)
    const stepKey = `harness_${stage}_${name}`
    return this.actor.run(stepKey, taskFn)
  }

  /**
   * Pre-verification gate: checks code syntax and structural integrity across modified files.
   */
  async verifyStage(filePaths: string[]): Promise<StageVerificationResult> {
    const issues: string[] = []

    for (const relPath of filePaths) {
      const fullPath = join(this.workspace, relPath)
      try {
        const content = await fs.readFile(fullPath, 'utf8')
        const syntaxResult = TechnePatchEngine.validateCodeSyntax(relPath, content)
        if (!syntaxResult.valid) {
          issues.push(`${relPath}: ${syntaxResult.error}`)
        }
      } catch (err: unknown) {
        issues.push(`${relPath}: File read error (${err instanceof Error ? err.message : String(err)})`)
      }
    }

    return {
      passed: issues.length === 0,
      issues
    }
  }

  getCheckpoint(id: string): HarnessCheckpoint | undefined {
    return this.checkpoints.get(id)
  }
}
