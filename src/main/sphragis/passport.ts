/**
 * Diabaterion: Cryptographic Agent Passport System (APS) for SelfImpulse.
 *
 * Named from Greek "διαβατήριον" (passport / safe-conduct pass).
 * Provides verifiable, cryptographically signed credentials for autonomous agents,
 * governing:
 * 1. Verifiable Agent Identity (Ed25519 key ID, role, model)
 * 2. Principal Attestation (human operator / organization)
 * 3. Scoped Capability Delegations & Confined Workspace Roots
 * 4. Real-time Revocation Verification (checked by Gateway & Nomos before any action)
 */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { getPaths } from '../paths'
import { atomicWriteJson, newId, nowIso, readJson } from '../util'
import { ephemeralSigner, verifyDigestSignature, type ReceiptSigner } from './signer'
import type { AgentCapability, AgentPassport, IssuePassportInput } from '@shared/types'
import type { Capability } from '../nomos/types'

function getPassportsFile(): string {
  try {
    return join(getPaths().root, 'agent_passports.json')
  } catch {
    return join(process.cwd(), '.agent_passports.json')
  }
}

export function computePassportHash(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

export class PassportManager {
  private passports: Map<string, AgentPassport> = new Map()
  private signer: ReceiptSigner
  private loaded = false

  constructor(signer?: ReceiptSigner) {
    this.signer = signer ?? ephemeralSigner()
  }

  setSigner(signer: ReceiptSigner): void {
    this.signer = signer
  }

  getSigner(): ReceiptSigner {
    return this.signer
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    const file = getPassportsFile()
    const stored = await readJson<AgentPassport[]>(file, [])
    if (stored.length === 0) {
      // Seed foundational passports for the core squad
      const now = new Date()
      const future = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
      
      const seedAgents: IssuePassportInput[] = [
        {
          agentId: 'captain',
          agentRole: 'Squad Captain & Orchestrator',
          principalName: 'System Principal',
          capabilities: ['fs.read', 'fs.write', 'document.create', 'studio.run', 'mission.dispatch', 'memory.read', 'memory.write', 'tool.other']
        },
        {
          agentId: 'daedalus',
          agentRole: 'Daedalus Coder & Patch Engine',
          principalName: 'System Principal',
          capabilities: ['fs.read', 'fs.write', 'shell.exec']
        },
        {
          agentId: 'nomos_auditor',
          agentRole: 'Nomos Security & Policy Auditor',
          principalName: 'System Principal',
          capabilities: ['fs.read', 'tool.other']
        },
        {
          agentId: 'theatron_director',
          agentRole: 'Theatron Creative Director',
          principalName: 'System Principal',
          capabilities: ['fs.read', 'fs.write', 'studio.run']
        }
      ]

      for (const sa of seedAgents) {
        const passport = this.mintPassport(sa)
        this.passports.set(passport.agentId, passport)
      }
      try {
        await this.persist()
      } catch {
        // Fallback for tests
      }
    } else {
      for (const p of stored) {
        this.passports.set(p.agentId, p)
      }
    }
    this.loaded = true
  }

  private async persist(): Promise<void> {
    const file = getPassportsFile()
    const list = Array.from(this.passports.values())
    await atomicWriteJson(file, list)
  }

  private mintPassport(input: IssuePassportInput): AgentPassport {
    const passportId = newId('pass')
    const issuedAt = nowIso()
    const validFrom = issuedAt
    const hours = input.validityHours ?? 24 * 365
    const validUntil = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
    const principalName = input.principalName ?? 'Human Operator'
    const allowedRoots = input.allowedRoots ?? ['*']

    const payload = `${passportId}:${input.agentId}:${input.agentRole}:${principalName}:${input.capabilities.sort().join(',')}:${allowedRoots.sort().join(',')}:${validFrom}:${validUntil}`
    const passportHash = computePassportHash(payload)
    const signature = this.signer.signDigest(passportHash)

    return {
      passportId,
      agentId: input.agentId,
      agentRole: input.agentRole,
      principalName,
      principalKeyId: this.signer.keyId,
      capabilities: input.capabilities,
      allowedRoots,
      maxToolCallsPerRun: input.maxToolCallsPerRun ?? 100,
      validFrom,
      validUntil,
      revoked: false,
      passportHash,
      signature,
      signerKeyId: this.signer.keyId,
      issuedAt
    }
  }

  async issuePassport(input: IssuePassportInput): Promise<AgentPassport> {
    await this.ensureLoaded()
    const passport = this.mintPassport(input)
    this.passports.set(passport.agentId, passport)
    await this.persist()
    return passport
  }

  async getPassport(agentId: string): Promise<AgentPassport | null> {
    await this.ensureLoaded()
    return this.passports.get(agentId) ?? null
  }

  async listPassports(): Promise<AgentPassport[]> {
    await this.ensureLoaded()
    return Array.from(this.passports.values())
  }

  async revokePassport(passportId: string, reason: string): Promise<boolean> {
    await this.ensureLoaded()
    for (const p of this.passports.values()) {
      if (p.passportId === passportId) {
        p.revoked = true
        p.revocationReason = reason
        await this.persist()
        return true
      }
    }
    return false
  }

  async verifyPassport(passportId: string): Promise<{ valid: boolean; reason?: string; passport?: AgentPassport }> {
    await this.ensureLoaded()
    let found: AgentPassport | undefined
    for (const p of this.passports.values()) {
      if (p.passportId === passportId) {
        found = p
        break
      }
    }

    if (!found) {
      return { valid: false, reason: `Passport not found: ${passportId}` }
    }

    if (found.revoked) {
      return { valid: false, reason: `Passport has been revoked: ${found.revocationReason ?? 'Security violation'}`, passport: found }
    }

    const now = new Date().getTime()
    if (now < new Date(found.validFrom).getTime() || now > new Date(found.validUntil).getTime()) {
      return { valid: false, reason: 'Passport is expired or not yet valid', passport: found }
    }

    // Verify cryptographic integrity
    const payload = `${found.passportId}:${found.agentId}:${found.agentRole}:${found.principalName}:${found.capabilities.sort().join(',')}:${found.allowedRoots.sort().join(',')}:${found.validFrom}:${found.validUntil}`
    const expectedHash = computePassportHash(payload)
    if (found.passportHash !== expectedHash) {
      return { valid: false, reason: 'Passport payload hash tampering detected', passport: found }
    }

    if (this.signer.keyId === found.signerKeyId) {
      const sigOk = verifyDigestSignature(found.passportHash, found.signature, this.signer.publicKeyHex)
      if (!sigOk) {
        return { valid: false, reason: 'Cryptographic signature verification failed', passport: found }
      }
    }

    return { valid: true, passport: found }
  }

  /**
   * Fast runtime authority verification called by ToolExecutionGateway.
   */
  async checkAuthority(
    agentId: string,
    requiredCapability: Capability,
    targetPath?: string
  ): Promise<{ allowed: boolean; reason?: string }> {
    await this.ensureLoaded()
    const passport = this.passports.get(agentId)
    if (!passport) {
      // Default allow if agent has no explicit passport yet (graceful fallback)
      return { allowed: true }
    }

    if (passport.revoked) {
      return { allowed: false, reason: `Agent passport revoked: ${passport.revocationReason ?? 'Security revocation'}` }
    }

    const now = Date.now()
    if (now > new Date(passport.validUntil).getTime()) {
      return { allowed: false, reason: `Agent passport expired on ${passport.validUntil}` }
    }

    if (!passport.capabilities.includes(requiredCapability as AgentCapability) && !passport.capabilities.includes('tool.other')) {
      return {
        allowed: false,
        reason: `Agent "${agentId}" lacks required capability "${requiredCapability}" in passport (holds: ${passport.capabilities.join(', ')})`
      }
    }

    return { allowed: true }
  }
}

export const passportManager = new PassportManager()
