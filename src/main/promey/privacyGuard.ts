/**
 * PROPRIETARY - SelfImpulse Promey Duet Engine
 * Privacy Boundaries: Credential Masking & Outbound DLP Scanner
 */

import type { PromeyPrivacySanitizeResult } from './types';

export class PromeyPrivacyGuard {
  private maskedCredentialsVault: Map<string, string> = new Map();
  private leaksPreventedCount = 0;

  /**
   * Mask credentials so secrets are isolated and never leak into LLM transcripts
   */
  public maskCredential(secretValue: string, label = 'secret'): string {
    const token = `__PROMEY_MASKED_${label.toUpperCase()}_${this.maskedCredentialsVault.size + 1}__`;
    this.maskedCredentialsVault.set(token, secretValue);
    return token;
  }

  /**
   * Unmask credential when executing in secure raw host shell/network transport
   */
  public unmaskCredential(maskedText: string): string {
    let unmasked = maskedText;
    for (const [token, secret] of this.maskedCredentialsVault.entries()) {
      if (unmasked.includes(token)) {
        unmasked = unmasked.replaceAll(token, secret);
      }
    }
    return unmasked;
  }

  /**
   * Outbound DLP scanner: Scans outgoing strings for accidental secret/PII egress
   */
  public sanitizeOutbound(text: string): PromeyPrivacySanitizeResult {
    let sanitized = text;
    let redactedDlpCount = 0;
    const leaksPrevented: string[] = [];

    // 1. Common API keys (OpenAI, Anthropic, GitHub, AWS, Slack, generic Bearer)
    const apiKeyPatterns: Array<{ name: string; regex: RegExp }> = [
      { name: 'OpenAI Secret Key', regex: /sk-[a-zA-Z0-9]{32,}/g },
      { name: 'Anthropic Secret Key', regex: /sk-ant-[a-zA-Z0-9_-]{32,}/g },
      { name: 'GitHub Personal Token', regex: /gh[pousr][_-][a-zA-Z0-9]{36,}/g },
      { name: 'AWS Access Key ID', regex: /AKIA[0-9A-Z]{16}/g },
      { name: 'Generic JWT Token', regex: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g }
    ];

    for (const pattern of apiKeyPatterns) {
      if (pattern.regex.test(sanitized)) {
        sanitized = sanitized.replace(pattern.regex, `[REDACTED_${pattern.name.toUpperCase().replace(/\s+/g, '_')}]`);
        leaksPrevented.push(pattern.name);
        redactedDlpCount++;
      }
    }

    // 2. Private Keys (RSA, EC, PGP)
    const privateKeyRegex = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
    if (privateKeyRegex.test(sanitized)) {
      sanitized = sanitized.replace(privateKeyRegex, '[REDACTED_CRYPTOGRAPHIC_PRIVATE_KEY]');
      leaksPrevented.push('Cryptographic Private Key');
      redactedDlpCount++;
    }

    // 3. Credit Card Numbers (13-19 digit candidate sequences)
    const ccRegex = /\b(?:\d{4}[ -]?){3}(?:\d{4}|\d{1,3})\b/g;
    if (ccRegex.test(sanitized)) {
      sanitized = sanitized.replace(ccRegex, '[REDACTED_PAYMENT_CARD]');
      leaksPrevented.push('Payment Card Number');
      redactedDlpCount++;
    }

    this.leaksPreventedCount += redactedDlpCount;

    return {
      sanitizedText: sanitized,
      maskedCredentialsCount: this.maskedCredentialsVault.size,
      redactedDlpCount,
      leaksPrevented
    };
  }

  public getTelemetry(): {
    vaultStoredTokens: number;
    totalLeaksPrevented: number;
  } {
    return {
      vaultStoredTokens: this.maskedCredentialsVault.size,
      totalLeaksPrevented: this.leaksPreventedCount
    };
  }
}
