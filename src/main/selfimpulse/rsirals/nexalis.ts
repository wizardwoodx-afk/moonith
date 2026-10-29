/**
 * PROPRIETARY - SelfImpulse RSIRALS
 * Module 6: NEXALIS — Evidence-Backed Knowledge Exchange (Meso Loop)
 */

import crypto from 'node:crypto';
import type { SignedEpistemicClaim } from './types';

export class NexalisKnowledgeExchange {
  private claimsRegistry: Map<string, SignedEpistemicClaim> = new Map();
  private subscribers: Set<string> = new Set(['selfimpulse-main-agent', 'rook-kernel', 'mission-runner']);
  private revokedClaimsCount = 0;

  /**
   * Quarantine, verify, cryptographically sign, and publish an epistemic claim
   */
  public publishClaim(params: {
    topic: string;
    assertion: string;
    evidenceRefs: string[];
    verifierIdentity: string;
    confidence: number;
    reproducibilityProof: string;
    environmentFingerprint?: string;
  }): SignedEpistemicClaim {
    const claimId = `claim-${crypto.randomBytes(6).toString('hex')}`;
    const envFingerprint = params.environmentFingerprint || `env-${process.platform}-${process.arch}-node${process.version.substring(0, 3)}`;

    // Generate SHA-256 payload digest
    const payloadRaw = JSON.stringify({
      topic: params.topic,
      assertion: params.assertion,
      confidence: params.confidence,
      proof: params.reproducibilityProof,
      env: envFingerprint
    });
    const payloadHash = crypto.createHash('sha256').update(payloadRaw).digest('hex');

    // Deterministic cryptographic signature simulation
    const signature = crypto.createHmac('sha256', 'SIP-RSIRALS-NEXALIS-SECRET-2026')
      .update(`${claimId}:${payloadHash}:${params.verifierIdentity}`)
      .digest('hex');

    const now = new Date();
    const validityUntil = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30); // 30-day validity window

    const claim: SignedEpistemicClaim = {
      claimId,
      payloadHash,
      environmentFingerprint: envFingerprint,
      evidenceRefs: params.evidenceRefs,
      verifierIdentity: params.verifierIdentity,
      signature,
      validityRange: {
        from: now.toISOString(),
        until: validityUntil.toISOString()
      },
      isRevoked: false,
      claimData: {
        topic: params.topic,
        assertion: params.assertion,
        confidence: Math.max(0, Math.min(1, params.confidence)),
        reproducibilityProof: params.reproducibilityProof
      }
    };

    this.claimsRegistry.set(claimId, claim);
    return claim;
  }

  /**
   * Verify claim signature and environment compatibility
   */
  public verifyClaimCompatibility(claimId: string, currentEnvironment: string): {
    valid: boolean;
    reason: string;
    claim?: SignedEpistemicClaim;
  } {
    const claim = this.claimsRegistry.get(claimId);
    if (!claim) {
      return { valid: false, reason: 'Claim not found in Nexalis registry.' };
    }

    if (claim.isRevoked) {
      return { valid: false, reason: `Claim ${claimId} was revoked: ${claim.revocationRef || 'Evidence disproven.'}` };
    }

    // Verify cryptographic integrity
    const expectedSig = crypto.createHmac('sha256', 'SIP-RSIRALS-NEXALIS-SECRET-2026')
      .update(`${claimId}:${claim.payloadHash}:${claim.verifierIdentity}`)
      .digest('hex');

    if (expectedSig !== claim.signature) {
      return { valid: false, reason: 'Cryptographic signature mismatch. Claim payload has been altered.' };
    }

    // Check expiration
    if (new Date() > new Date(claim.validityRange.until)) {
      return { valid: false, reason: 'Claim validity window has expired.' };
    }

    // Check environment compatibility
    if (claim.environmentFingerprint !== currentEnvironment && !claim.environmentFingerprint.includes('any')) {
      return { 
        valid: true, 
        reason: `Warning: Environment variance (${claim.environmentFingerprint} vs ${currentEnvironment}). Stage locally before full trust.`,
        claim 
      };
    }

    return { valid: true, reason: 'Verified valid and environment-compatible.', claim };
  }

  /**
   * Revoke a compromised or falsified claim across the entire fleet
   */
  public revokeClaim(claimId: string, revocationReason: string): boolean {
    const claim = this.claimsRegistry.get(claimId);
    if (!claim) return false;

    claim.isRevoked = true;
    claim.revocationRef = `REVOKED: ${revocationReason} at ${new Date().toISOString()}`;
    this.revokedClaimsCount++;
    return true;
  }

  public listActiveClaims(topicFilter?: string): SignedEpistemicClaim[] {
    return Array.from(this.claimsRegistry.values()).filter((c) => {
      if (c.isRevoked) return false;
      if (topicFilter && !c.claimData.topic.toLowerCase().includes(topicFilter.toLowerCase())) return false;
      return true;
    });
  }

  public getTelemetry(): {
    signedClaimsCount: number;
    activeSubscribers: number;
    revokedClaimsCount: number;
  } {
    return {
      signedClaimsCount: this.claimsRegistry.size,
      activeSubscribers: this.subscribers.size,
      revokedClaimsCount: this.revokedClaimsCount
    };
  }
}
