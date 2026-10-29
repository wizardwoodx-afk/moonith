import { describe, expect, it, beforeAll } from 'vitest'
import { passportManager } from './passport'
import { ephemeralSigner } from './signer'

describe('Diabaterion Agent Passport System (APS)', () => {
  const testSigner = ephemeralSigner()

  beforeAll(() => {
    passportManager.setSigner(testSigner)
  })

  it('initializes and lists default core squad passports', async () => {
    const list = await passportManager.listPassports()
    expect(list.length).toBeGreaterThanOrEqual(4)
    const agentIds = list.map((p) => p.agentId)
    expect(agentIds).toContain('captain')
    expect(agentIds).toContain('daedalus')
    expect(agentIds).toContain('nomos_auditor')
  })

  it('issues a cryptographically signed passport with scoped capabilities', async () => {
    const passport = await passportManager.issuePassport({
      agentId: 'specialist_tester',
      agentRole: 'E2E Testing Agent',
      principalName: 'Dev Lead',
      capabilities: ['fs.read', 'fs.write'],
      validityHours: 48
    })

    expect(passport.passportId).toBeDefined()
    expect(passport.agentId).toBe('specialist_tester')
    expect(passport.signature).toBeDefined()
    expect(passport.revoked).toBe(false)
    expect(passport.capabilities).toEqual(['fs.read', 'fs.write'])

    // Verification check
    const verify = await passportManager.verifyPassport(passport.passportId)
    expect(verify.valid).toBe(true)
    expect(verify.reason).toBeUndefined()
  })

  it('permits authorized capabilities and rejects missing capabilities', async () => {
    // Has fs.read, fs.write
    const checkRead = await passportManager.checkAuthority('specialist_tester', 'fs.read')
    expect(checkRead.allowed).toBe(true)

    // Lacks shell.exec
    const checkShell = await passportManager.checkAuthority('specialist_tester', 'shell.exec')
    expect(checkShell.allowed).toBe(false)
    expect(checkShell.reason).toContain('lacks required capability')
  })

  it('instantly enforces passport revocation', async () => {
    const passport = await passportManager.getPassport('specialist_tester')
    expect(passport).not.toBeNull()

    const revoked = await passportManager.revokePassport(
      passport!.passportId,
      'Exceeded error threshold'
    )
    expect(revoked).toBe(true)

    // Verify should fail
    const verify = await passportManager.verifyPassport(passport!.passportId)
    expect(verify.valid).toBe(false)
    expect(verify.reason).toContain('Passport has been revoked')

    // Authority check should block
    const checkAgain = await passportManager.checkAuthority('specialist_tester', 'fs.read')
    expect(checkAgain.allowed).toBe(false)
    expect(checkAgain.reason).toContain('revoked')
  })
})
