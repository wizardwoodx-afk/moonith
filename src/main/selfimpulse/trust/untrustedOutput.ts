/**
 * Untrusted Tool-Output Sanitizer & Anti-Hijacking Shield for SelfImpulse.
 *
 * Implements strict defense against Indirect Prompt Injection:
 * - Tool outputs (web pages, file contents, API returns) are untrusted data, NEVER instructions.
 * - Detects prompt hijacking patterns: "IGNORE PREVIOUS INSTRUCTIONS", delimiter breakouts,
 *   role spoofing, and credential exfiltration triggers.
 * - Quarantines suspicious payloads away from the model's context window.
 */

export interface SanitizationResult {
  safe: boolean
  sanitizedContent: string
  quarantined: boolean
  detectedThreats: string[]
}

const HIJACK_PATTERNS = [
  { name: 'System Override', regex: /ignore\s+(all\s+)?(previous|prior)\s+instructions/i },
  { name: 'Role Spoofing', regex: /(system\s*prompt:|you\s+are\s+now\s+a\s+|developer\s+mode\s+enabled)/i },
  { name: 'Exfiltration Probe', regex: /(send|post|fetch|curl)\s+.*(api_key|password|secret|token|credential)/i },
  { name: 'Context Delimiter Breakout', regex: /(<\/?(system_message|antigravity|instruction)>)/i },
  { name: 'Privilege Escalation', regex: /(bypass\s+safety|disable\s+guardrails|grant\s+root)/i }
]

export class UntrustedOutputSanitizer {
  /**
   * Screen and sanitize raw tool output before delivering it into the model's context.
   */
  sanitizeToolOutput(toolName: string, rawOutput: string): SanitizationResult {
    const threats: string[] = []

    for (const pat of HIJACK_PATTERNS) {
      if (pat.regex.test(rawOutput)) {
        threats.push(pat.name)
      }
    }

    if (threats.length > 0) {
      // Dangerous content detected: quarantine from context window
      const sanitizedNotice = [
        `[SECURITY WARNING: Tool '${toolName}' returned content that was quarantined due to potential indirect prompt injection.]`,
        `Threats flagged: ${threats.join(', ')}.`,
        `The raw content has been isolated and excluded from model instruction processing.`
      ].join('\n')

      return {
        safe: false,
        sanitizedContent: sanitizedNotice,
        quarantined: true,
        detectedThreats: threats
      }
    }

    return {
      safe: true,
      sanitizedContent: rawOutput,
      quarantined: false,
      detectedThreats: []
    }
  }
}

export const untrustedOutputSanitizer = new UntrustedOutputSanitizer()
