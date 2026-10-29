import crypto from 'node:crypto'
import type { EnterpriseAgentPassport } from './types'

export class EnterprisePassportManager {
  private secretKey: string;
  private activePassports: Map<string, EnterpriseAgentPassport> = new Map();

  constructor(secretKey?: string) {
    this.secretKey = secretKey || crypto.randomBytes(32).toString('hex');
  }

  public issuePassport(
    principal: string,
    agentRole: string = 'coworker',
    scopes: string[] = ['fs:read', 'fs:write', 'tool:execute', 'network:verified'],
    durationMs: number = 24 * 60 * 60 * 1000
  ): EnterpriseAgentPassport {
    const passportId = `pass_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const issuedAt = Date.now();
    const expiresAt = issuedAt + durationMs;
    const publicKey = `key_pub_${crypto.randomBytes(16).toString('hex')}`;

    const payload = `${passportId}:${principal}:${agentRole}:${issuedAt}:${expiresAt}:${scopes.sort().join(',')}`;
    const signature = crypto.createHmac('sha256', this.secretKey).update(payload).digest('hex');

    const passport: EnterpriseAgentPassport = {
      passportId,
      principal,
      agentRole,
      issuedAt,
      expiresAt,
      allowedScopes: scopes,
      publicKey,
      signature,
      revoked: false
    };

    this.activePassports.set(passportId, passport);
    return passport;
  }

  public verifyPassport(passport: EnterpriseAgentPassport, requiredScope?: string): { valid: boolean; reason?: string } {
    if (passport.revoked) {
      return { valid: false, reason: 'Passport has been revoked' };
    }

    if (Date.now() > passport.expiresAt) {
      return { valid: false, reason: 'Passport has expired' };
    }

    const payload = `${passport.passportId}:${passport.principal}:${passport.agentRole}:${passport.issuedAt}:${passport.expiresAt}:${passport.allowedScopes.sort().join(',')}`;
    const expectedSig = crypto.createHmac('sha256', this.secretKey).update(payload).digest('hex');

    if (passport.signature !== expectedSig) {
      return { valid: false, reason: 'Cryptographic signature mismatch (tampered passport)' };
    }

    if (requiredScope && !passport.allowedScopes.includes(requiredScope) && !passport.allowedScopes.includes('*')) {
      return { valid: false, reason: `Missing required execution scope: ${requiredScope}` };
    }

    return { valid: true };
  }

  public revokePassport(passportId: string): boolean {
    const p = this.activePassports.get(passportId);
    if (!p) return false;
    p.revoked = true;
    return true;
  }

  public getPassport(passportId: string): EnterpriseAgentPassport | undefined {
    return this.activePassports.get(passportId);
  }

  public listActivePassports(): EnterpriseAgentPassport[] {
    return Array.from(this.activePassports.values()).filter((p) => !p.revoked && Date.now() <= p.expiresAt);
  }
}
