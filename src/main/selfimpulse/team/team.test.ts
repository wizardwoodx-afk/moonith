import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { teamPlaybookService } from './playbooks'
import { proofOfWorkService } from './proofOfWork'
import { ephemeralSigner } from '../../sphragis/signer'

describe('TeamPlaybookService and ProofOfWorkService', () => {
  let tempDir: string
  const testSigner = ephemeralSigner()

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'team-colab-test-'))
    proofOfWorkService.setSigner(testSigner)
  })

  afterAll(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  describe('Team Playbooks Engine', () => {
    it('lists default starter playbooks', async () => {
      const list = await teamPlaybookService.list()
      expect(list.length).toBeGreaterThanOrEqual(2)
      const ids = list.map((p) => p.id)
      expect(ids).toContain('pb_default_feature_sprint')
      expect(ids).toContain('pb_default_creative_studio')
    })

    it('saves, retrieves, and deletes a custom team playbook', async () => {
      const saved = await teamPlaybookService.save({
        title: 'Security Review & Bug Hunter Squad',
        description: 'Multi-agent review mesh searching for injection and authorization flaws.',
        tags: ['security', 'audit'],
        roles: [
          {
            id: 'role_sec_lead',
            name: 'Security Lead',
            title: 'Lead Auditor',
            isAgent: false
          },
          {
            id: 'role_nomos',
            name: 'Nomos Guard',
            title: 'Automated Static Analyzer',
            isAgent: true,
            agentType: 'auditor'
          }
        ],
        steps: [
          {
            id: 's1',
            title: 'Static Analysis Scan',
            roleId: 'role_nomos',
            prompt: 'Run full scan on security endpoints.',
            verificationCriteria: 'Zero critical vulnerabilities'
          }
        ]
      })

      expect(saved.id).toBeDefined()
      expect(saved.title).toBe('Security Review & Bug Hunter Squad')

      const retrieved = await teamPlaybookService.get(saved.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.roles).toHaveLength(2)

      const deleted = await teamPlaybookService.delete(saved.id)
      expect(deleted).toBe(true)

      const afterDelete = await teamPlaybookService.get(saved.id)
      expect(afterDelete).toBeNull()
    })

    it('snapshots an active collaborative session into a reusable playbook', async () => {
      const snap = await teamPlaybookService.snapshotSession({
        sessionId: 'test_session_123',
        title: 'Sprint 42 Victory Run',
        description: 'Snapshot of the collaborative sprint with full squad.'
      })

      expect(snap.id).toBeDefined()
      expect(snap.title).toBe('Sprint 42 Victory Run')
      expect(snap.roles.length).toBeGreaterThanOrEqual(2)
      expect(snap.steps.length).toBeGreaterThanOrEqual(1)
    })

    it('instantiates a playbook into executable tasks', async () => {
      const instantiated = await teamPlaybookService.instantiate({
        playbookId: 'pb_default_feature_sprint',
        workspacePath: tempDir
      })

      expect(instantiated.taskIds).toHaveLength(1)
      expect(instantiated.taskIds[0]).toBeDefined()
    })
  })

  describe('Proof of Work & Certificate Subsystem', () => {
    let sessionId: string

    beforeAll(() => {
      sessionId = `session_sprint_${Date.now()}`
    })

    it('records verifiable proof of work records in sequence with hash chain', async () => {
      const p1 = await proofOfWorkService.recordProof({
        teamSessionId: sessionId,
        stepOrTaskId: 'step_1',
        authorName: 'Architect Agent',
        roleId: 'role_architect',
        isAgent: true,
        summary: 'Generated system spec and module interfaces',
        inputData: 'Spec requirements prompt v1',
        outputData: 'export interface SystemArchitecture { ... }',
        verificationPassed: true,
        verificationDetails: 'Syntax checked, 0 errors'
      })

      expect(p1.proofId).toBeDefined()
      expect(p1.signature).toBeDefined()
      expect(p1.verificationPassed).toBe(true)

      const p2 = await proofOfWorkService.recordProof({
        teamSessionId: sessionId,
        stepOrTaskId: 'step_2',
        authorName: 'Coder Agent',
        roleId: 'role_coder',
        isAgent: true,
        summary: 'Implemented test-driven feature module',
        inputData: 'Implementation prompt v1',
        outputData: 'export class FeatureEngine { ... }',
        verificationPassed: true,
        verificationDetails: '6 unit tests passing'
      })

      expect(p2.prevHash).toBe(p1.recordHash)
      expect(p2.recordHash).not.toBe(p1.recordHash)
    })

    it('exports a signed Proof of Work Certificate and verifies it', async () => {
      const certPath = join(tempDir, 'team_sprint_alpha.pow.md')
      const cert = await proofOfWorkService.exportCertificate({
        teamSessionId: sessionId,
        playbookTitle: 'Sprint Alpha Run',
        outputPath: certPath
      })

      expect(cert.certificateId).toBeDefined()
      expect(cert.totalProofs).toBe(2)
      expect(cert.verifiedCount).toBe(2)
      expect(cert.signature).toBeDefined()
      expect(existsSync(certPath)).toBe(true)

      const mdContent = readFileSync(certPath, 'utf8')
      expect(mdContent).toContain('Proof of Work Certificate')
      expect(mdContent).toContain('Sprint Alpha Run')
      expect(mdContent).toContain('Architect Agent')

      // Cryptographic verification
      const verifyResult = proofOfWorkService.verifyCertificate(cert)
      expect(verifyResult.valid).toBe(true)
      expect(verifyResult.reason).toBeUndefined()
    })

    it('rejects tampered Proof of Work certificates', async () => {
      const cert = await proofOfWorkService.exportCertificate({
        teamSessionId: sessionId
      })

      // Tamper with output data in one of the proofs
      const tampered = JSON.parse(JSON.stringify(cert))
      tampered.proofs[0].outputDigest = 'f000000000000000000000000000000000000000000000000000000000000000'

      const verifyResult = proofOfWorkService.verifyCertificate(tampered)
      expect(verifyResult.valid).toBe(false)
      expect(verifyResult.reason).toContain('Record hash tampering detected')
    })
  })
})
