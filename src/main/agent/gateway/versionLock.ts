/**
 * Resource-Version Verification for the Tool Execution Gateway.
 *
 * Implements optimistic concurrency control. Before mutating a shared resource,
 * the gateway verifies that the resource's current version / hash matches the
 * caller's expected version, preventing stale overwrites or concurrent race conditions.
 */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'

export interface ResourceVersionCheck {
  resourcePath: string
  expectedVersion?: string
}

export interface VersionCheckResult {
  valid: boolean
  currentVersion?: string
  error?: string
}

export class ResourceVersionGuard {
  /**
   * Computes a deterministic SHA-256 version hash for a file.
   */
  async getFileVersion(filePath: string): Promise<string | undefined> {
    try {
      const buffer = await fs.readFile(filePath)
      return createHash('sha256').update(buffer).digest('hex')
    } catch (err: unknown) {
      const anyErr = err as { code?: string }
      if (anyErr?.code === 'ENOENT') return 'non-existent'
      return undefined
    }
  }

  /**
   * Validates whether the current state of a resource matches the expected version.
   */
  async verifyVersion(check: ResourceVersionCheck): Promise<VersionCheckResult> {
    if (!check.expectedVersion) {
      // No version check requested
      return { valid: true }
    }

    const currentVersion = await this.getFileVersion(check.resourcePath)
    if (!currentVersion) {
      return {
        valid: false,
        error: `Could not determine version for resource "${check.resourcePath}".`
      }
    }

    if (currentVersion !== check.expectedVersion) {
      return {
        valid: false,
        currentVersion,
        error: `Resource version conflict: expected version "${check.expectedVersion}" but found "${currentVersion}".`
      }
    }

    return {
      valid: true,
      currentVersion
    }
  }
}

export const resourceVersionGuard = new ResourceVersionGuard()
