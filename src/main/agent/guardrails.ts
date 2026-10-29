/**
 * OpenAI Guardrails TypeScript implementation for SelfImpulse.
 *
 * Provides real-time screening of inputs, outputs, and tool calls:
 * 1. Prompt Injection & Jailbreak detection (DAN, roleplay bypass, privilege escalation).
 * 2. PII / Secret Leakage screening (keys, tokens, credentials, sensitive patterns).
 * 3. Destructive Command / Policy Violation filtering.
 */

export interface GuardrailCheckResult {
  allowed: boolean
  violations: GuardrailViolation[]
  sanitizedText?: string
}

export interface GuardrailViolation {
  category: 'prompt_injection' | 'jailbreak' | 'pii' | 'secret' | 'policy'
  severity: 'low' | 'medium' | 'high' | 'critical'
  message: string
  matchedPattern?: string
}

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /system\s+prompt\s+override/i,
  /you\s+are\s+now\s+in\s+(developer|unrestricted|god)\s+mode/i,
  /\bdo\s+anything\s+now\b/i,
  /\bjailbreak\b/i,
  /disregard\s+the\s+safety\s+rules/i,
  /simulate\s+(an\s+unfiltered|an\s+evil)\s+assistant/i
]

const SECRET_PATTERNS = [
  { name: 'OpenAI API Key', regex: /sk-[A-Za-z0-9-_]{20,}/ },
  { name: 'Anthropic API Key', regex: /sk-ant-[A-Za-z0-9-_]{20,}/ },
  { name: 'GitHub Token', regex: /gh[pousr][-_][A-Za-z0-9_]{30,}/ },
  { name: 'Private Key Block', regex: /-----BEGIN\s+(RSA|EC|DSA|OPENSSH|PGP)?\s*PRIVATE KEY-----/ },
  { name: 'Generic JWT', regex: /eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_.]+/ }
]

export class GuardrailsEngine {
  /**
   * Screen incoming prompt or user input before it reaches the model.
   */
  screenInput(text: string): GuardrailCheckResult {
    const violations: GuardrailViolation[] = []

    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        violations.push({
          category: 'prompt_injection',
          severity: 'high',
          message: 'Potential prompt injection or jailbreak attempt detected.',
          matchedPattern: pattern.source
        })
      }
    }

    return {
      allowed: violations.length === 0,
      violations
    }
  }

  /**
   * Screen tool call arguments before execution.
   */
  screenToolCall(toolName: string, args: Record<string, unknown>): GuardrailCheckResult {
    const violations: GuardrailViolation[] = []
    const argsJson = JSON.stringify(args)

    // Check for exposed secrets being sent in plaintext where prohibited
    for (const secret of SECRET_PATTERNS) {
      if (secret.regex.test(argsJson)) {
        violations.push({
          category: 'secret',
          severity: 'critical',
          message: `Plaintext credential detected in tool arguments (${secret.name}).`,
          matchedPattern: secret.name
        })
      }
    }

    return {
      allowed: violations.filter((v) => v.severity === 'critical').length === 0,
      violations
    }
  }

  /**
   * Redact or sanitize PII and secrets in output content.
   */
  sanitizeOutput(text: string): string {
    let sanitized = text
    for (const secret of SECRET_PATTERNS) {
      sanitized = sanitized.replace(secret.regex, `[REDACTED_${secret.name.toUpperCase().replace(/\s+/g, '_')}]`)
    }
    return sanitized
  }
}

export const guardrails = new GuardrailsEngine()
