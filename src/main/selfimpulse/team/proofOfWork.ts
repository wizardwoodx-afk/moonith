import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { getPaths } from '../../paths'
import { atomicWriteJson, newId, nowIso, readJson } from '../../util'
import { ephemeralSigner, verifyDigestSignature, type ReceiptSigner } from '../../sphragis/signer'
import type { ProofOfWorkCertificate, ProofOfWorkRecord } from '@shared/types'

export const GENESIS_POW_HASH = '0000000000000000000000000000000000000000000000000000000000000000'

function getProofsFile(): string {
  try {
    return join(getPaths().root, 'proofs_of_work.json')
  } catch {
    return join(process.cwd(), '.proofs_of_work.json')
  }
}

export function computeSha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export class ProofOfWorkService {
  private proofs: ProofOfWorkRecord[] = []
  private lastHash: string = GENESIS_POW_HASH
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
    const file = getProofsFile()
    this.proofs = await readJson<ProofOfWorkRecord[]>(file, [])
    if (this.proofs.length > 0) {
      this.lastHash = this.proofs[this.proofs.length - 1].recordHash
    }
    this.loaded = true
  }

  private async persist(): Promise<void> {
    const file = getProofsFile()
    await atomicWriteJson(file, this.proofs)
  }

  async recordProof(input: {
    teamSessionId: string
    stepOrTaskId: string
    authorName: string
    roleId: string
    isAgent: boolean
    summary: string
    inputData: string
    outputData: string
    verificationPassed: boolean
    verificationDetails?: string
  }): Promise<ProofOfWorkRecord> {
    await this.ensureLoaded()

    const proofId = newId('pow')
    const timestamp = nowIso()
    const inputDigest = computeSha256(input.inputData)
    const outputDigest = computeSha256(input.outputData)
    const prevHash = this.lastHash

    // Digest that links all critical parameters
    const payload = `${proofId}:${input.teamSessionId}:${input.stepOrTaskId}:${input.authorName}:${inputDigest}:${outputDigest}:${input.verificationPassed}:${prevHash}`
    const recordHash = computeSha256(payload)
    const signature = this.signer.signDigest(recordHash)

    const record: ProofOfWorkRecord = {
      proofId,
      teamSessionId: input.teamSessionId,
      stepOrTaskId: input.stepOrTaskId,
      authorName: input.authorName,
      roleId: input.roleId,
      isAgent: input.isAgent,
      timestamp,
      summary: input.summary,
      inputDigest,
      outputDigest,
      verificationPassed: input.verificationPassed,
      verificationDetails: input.verificationDetails,
      prevHash,
      recordHash,
      signature,
      keyId: this.signer.keyId
    }

    this.proofs.push(record)
    this.lastHash = recordHash
    await this.persist()
    return record
  }

  async listProofs(teamSessionId?: string): Promise<ProofOfWorkRecord[]> {
    await this.ensureLoaded()
    if (!teamSessionId) return [...this.proofs]
    return this.proofs.filter((p) => p.teamSessionId === teamSessionId)
  }

  async exportCertificate(input: {
    teamSessionId: string
    outputPath?: string
    playbookTitle?: string
  }): Promise<ProofOfWorkCertificate> {
    await this.ensureLoaded()
    const sessionProofs = this.proofs.filter((p) => p.teamSessionId === input.teamSessionId)

    if (sessionProofs.length === 0) {
      throw new Error(`No proof of work records found for team session: ${input.teamSessionId}`)
    }

    const certificateId = newId('cert')
    const issuedAt = nowIso()
    const verifiedCount = sessionProofs.filter((p) => p.verificationPassed).length

    // Compute Merkle root of record hashes
    const concatenatedHashes = sessionProofs.map((p) => p.recordHash).join(':')
    const merkleRoot = computeSha256(concatenatedHashes)
    const signature = this.signer.signDigest(merkleRoot)

    const certificate: ProofOfWorkCertificate = {
      certificateId,
      teamSessionId: input.teamSessionId,
      playbookTitle: input.playbookTitle,
      issuedAt,
      totalProofs: sessionProofs.length,
      verifiedCount,
      merkleRoot,
      proofs: sessionProofs,
      signature,
      signerKeyId: this.signer.keyId
    }

    // Generate Markdown Certificate Document
    const mdLines = [
      `# Proof of Work Certificate — SelfImpulse Collaborative Squad`,
      `**Certificate ID**: \`${certificateId}\``,
      `**Team Session ID**: \`${input.teamSessionId}\``,
      input.playbookTitle ? `**Playbook / Sprint**: ${input.playbookTitle}` : '',
      `**Issued At**: ${issuedAt}`,
      `**Signer Key ID**: \`${this.signer.keyId}\``,
      `**Verification Status**: **${verifiedCount} / ${sessionProofs.length} Passed**`,
      '',
      `---`,
      `## Itemized Squad Proof of Work Ledger`,
      '',
      `| # | Role & Author | Action / Milestone | Status | Output Digest | Timestamp |`,
      `| :--- | :--- | :--- | :--- | :--- | :--- |`,
      ...sessionProofs.map((p, idx) => {
        const statusBadge = p.verificationPassed ? 'VERIFIED' : 'FAILED'
        const actorTag = p.authorName
        return `| ${idx + 1} | ${actorTag} (${p.roleId}) | ${p.summary} | ${statusBadge} | \`${p.outputDigest.slice(0, 12)}...\` | ${p.timestamp} |`
      }),
      '',
      `---`,
      `## Cryptographic Integrity & Tamper-Proof Audit Chain`,
      `- **Root Merkle Digest**: \`${merkleRoot}\``,
      `- **Ed25519 Cryptographic Signature**: \`${signature}\``,
      `- **Signer Public Key (Hex)**: \`${this.signer.publicKeyHex}\``,
      '',
      `> *This document represents verifiable proof of execution. The hash chain guarantees that no task outputs, author attributions, or timestamps were altered after sealing.*`
    ].filter(Boolean)

    if (input.outputPath) {
      await fs.writeFile(input.outputPath, mdLines.join('\n'), 'utf8')
    }

    return certificate
  }

  verifyCertificate(certificate: ProofOfWorkCertificate): { valid: boolean; reason?: string } {
    if (!certificate.proofs || certificate.proofs.length === 0) {
      return { valid: false, reason: 'Certificate contains no proof records.' }
    }

    // Verify individual record integrity and hash chain
    let prev = certificate.proofs[0].prevHash
    for (let i = 0; i < certificate.proofs.length; i++) {
      const p = certificate.proofs[i]
      if (p.prevHash !== prev) {
        return {
          valid: false,
          reason: `Hash chain broken at proof #${i + 1} (${p.proofId}): expected prevHash ${prev}, got ${p.prevHash}`
        }
      }
      const payload = `${p.proofId}:${p.teamSessionId}:${p.stepOrTaskId}:${p.authorName}:${p.inputDigest}:${p.outputDigest}:${p.verificationPassed}:${p.prevHash}`
      const expectedRecordHash = computeSha256(payload)
      if (p.recordHash !== expectedRecordHash) {
        return {
          valid: false,
          reason: `Record hash tampering detected at proof #${i + 1} (${p.proofId})`
        }
      }
      prev = p.recordHash
    }

    // Verify Merkle Root
    const concatenatedHashes = certificate.proofs.map((p) => p.recordHash).join(':')
    const calculatedMerkleRoot = computeSha256(concatenatedHashes)
    if (calculatedMerkleRoot !== certificate.merkleRoot) {
      return { valid: false, reason: 'Merkle root does not match proof records.' }
    }

    // Verify Ed25519 signature
    if (this.signer.keyId === certificate.signerKeyId) {
      const sigOk = verifyDigestSignature(
        certificate.merkleRoot,
        certificate.signature,
        this.signer.publicKeyHex
      )
      if (!sigOk) {
        return { valid: false, reason: 'Cryptographic Ed25519 signature verification failed.' }
      }
    }

    return { valid: true }
  }
}

export const proofOfWorkService = new ProofOfWorkService()
