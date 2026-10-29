import { describe, expect, it } from 'bun:test'
import { EnterprisePassportManager } from './enterprise/passportManager'
import { BlastRadiusArbiter } from './enterprise/blastRadiusArbiter'
import { VerifiableKernel } from './enterprise/verifiableKernel'
import { MemoryGovernor } from './enterprise/memoryGovernor'
import { EvolutionEngine } from './enterprise/evolutionEngine'
import { CoworkKernel } from './coworkKernel'

describe('Cowork Enterprise Subsystem in SelfImpulse', () => {
  it('issues and cryptographically verifies Zero-Trust Agent Passports', () => {
    const manager = new EnterprisePassportManager();
    const passport = manager.issuePassport('alice', 'coworker', ['fs:read', 'fs:write']);

    expect(passport.passportId).toContain('pass_');
    expect(passport.signature).toBeDefined();

    const verified = manager.verifyPassport(passport, 'fs:read');
    expect(verified.valid).toBe(true);

    const denied = manager.verifyPassport(passport, 'admin:kill');
    expect(denied.valid).toBe(false);
    expect(denied.reason).toContain('Missing required execution scope');

    // Test revocation
    manager.revokePassport(passport.passportId);
    const revokedCheck = manager.verifyPassport(passport, 'fs:read');
    expect(revokedCheck.valid).toBe(false);
    expect(revokedCheck.reason).toContain('revoked');
  });

  it('enforces Blast-Radius token, spend, and write ceilings', () => {
    const arbiter = new BlastRadiusArbiter({
      maxTokensPerRun: 1000,
      maxSpendDollars: 1.0,
      maxFileWritesPerHour: 5
    });

    const step1 = arbiter.recordConsumption(500, 0.4, 2);
    expect(step1.allowed).toBe(true);
    expect(step1.escalationLevel).toBe('normal');

    // Caution at 80%
    const step2 = arbiter.recordConsumption(350, 0.45, 1);
    expect(step2.allowed).toBe(true);
    expect(step2.escalationLevel).toBe('caution');

    // Exceed limit -> quarantined
    const step3 = arbiter.recordConsumption(200, 0.2, 3);
    expect(step3.allowed).toBe(false);
    expect(step3.escalationLevel).toBe('quarantined');
    expect(step3.reason).toContain('Blast-radius budget exceeded');
  });

  it('generates and verifies Tool-Attested Kernel Proofs', () => {
    const verifier = new VerifiableKernel();
    const proof = verifier.attestToolExecution(
      'write_file',
      { path: 'src/main.ts', content: 'console.log("hello")' },
      { status: 'saved', bytes: 24 }
    );

    expect(proof.proofId).toContain('proof_');
    expect(proof.inputDigest).toBeDefined();
    expect(proof.outputDigest).toBeDefined();
    expect(proof.verified).toBe(true);
    expect(verifier.verifyProof(proof)).toBe(true);

    // Altered proof check
    const forged = { ...proof, inputDigest: 'forged_digest_0000' };
    expect(verifier.verifyProof(forged)).toBe(false);
  });

  it('maintains scoped, tamper-sealed memory partitions (MemClaw style)', () => {
    const mem = new MemoryGovernor();
    mem.createPartition('finance', 'confidential', ['accountant']);

    const writeOk = mem.writeScopedMemory('finance', 'q3_revenue', '$4.2M', 'accountant');
    expect(writeOk.success).toBe(true);

    const unauthorizedWrite = mem.writeScopedMemory('finance', 'hacked', '0', 'guest');
    expect(unauthorizedWrite.success).toBe(false);
    expect(unauthorizedWrite.error).toContain('Unauthorized');

    const read = mem.readScopedMemory('finance', 'q3_revenue', 'accountant');
    expect(read.value).toBe('$4.2M');
  });

  it('distills self-evolving scaffolding rules from trajectories', () => {
    const evo = new EvolutionEngine();
    const rule = evo.distillEvolutionRule(
      'coding',
      'EBUSY file lock during write',
      'Use atomic write with exponential backoff retry'
    );

    expect(rule.ruleId).toContain('evolve_coding_');
    expect(rule.confidenceScore).toBe(0.85);

    evo.recordRuleApplication(rule.ruleId, true);
    expect(evo.listAllRules()[0].confidenceScore).toBeCloseTo(0.88, 2);
  });

  it('CoworkKernel integrates enterprise subsystem seamlessly', async () => {
    const kernel = new CoworkKernel({ sessionId: 'ent_session' });
    expect(kernel.enterprise).toBeDefined();

    const summary = kernel.enterprise.getSummary();
    expect(summary.blastRadiusBudget).toBeDefined();

    // Execute step and verify tool-attestation
    const res = await kernel.executeStep('tool', 'unit_test_tool', { param: 42 });
    expect(res.stepIndex).toBe(1);
    expect(kernel.enterprise.verifier.listProofs().length).toBe(1);
  });
});
