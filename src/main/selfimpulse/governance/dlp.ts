import {
  ALL_SENSITIVE_DATA_CATEGORIES,
  type DlpFindingSummary,
  type DlpInspection,
  type DlpMode,
  type DlpSettings,
  type SensitiveDataCategory
} from '@shared/governance'

export interface SensitiveMatch {
  category: SensitiveDataCategory
  start: number
  end: number
}

export interface ProtectionResult<T> {
  value: T
  findings: DlpFindingSummary[]
  total: number
}

interface CategoryCount {
  category: SensitiveDataCategory
}

const CATEGORY_PRIORITY: SensitiveDataCategory[] = [
  'private-key',
  'api-key',
  'jwt',
  'credit-card',
  'secret',
  'email',
  'phone'
]

const PATTERNS: Array<{
  category: SensitiveDataCategory
  expression: RegExp
  validate?: (match: string) => boolean
}> = [
  {
    category: 'private-key',
    expression:
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]{0,100000}?-----END [A-Z0-9 ]*PRIVATE KEY-----/g
  },
  {
    category: 'api-key',
    expression:
      /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g
  },
  {
    category: 'api-key',
    expression: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}\b/gi
  },
  {
    category: 'jwt',
    expression: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
  },
  {
    category: 'secret',
    expression:
      /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret)\b["']?\s*[:=]\s*(?:"[^"\r\n]{4,}"|'[^'\r\n]{4,}'|[^\s,;]{6,})/gi
  },
  {
    category: 'email',
    expression: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/gi
  },
  {
    category: 'credit-card',
    expression: /(?<!\d)(?:\d[ -]*?){13,19}(?!\d)/g,
    validate: validPaymentCard
  },
  {
    category: 'phone',
    expression: /(?<![\w])\+\d{1,3}(?:[ .-]?\d{2,5}){2,4}(?![\w])/g
  },
  {
    category: 'phone',
    expression:
      /(?<![\w])(?:\(\d{2,4}\)|\d{2,5})[ .-]\d{3,5}(?:[ .-]\d{3,5})?(?![\w])/g
  }
]

const SENSITIVE_FIELD =
  /^(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret|authorization|private[_-]?key)$/i

function validPaymentCard(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false
  let sum = 0
  let double = false
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = digits.charCodeAt(index) - 48
    if (double) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    double = !double
  }
  return sum % 10 === 0
}

function enabledSet(categories?: readonly SensitiveDataCategory[]): Set<SensitiveDataCategory> {
  return new Set(categories ?? ALL_SENSITIVE_DATA_CATEGORIES)
}

/** Detection returns offsets and categories only, never the matched secret. */
export function detectSensitiveData(
  text: string,
  categories?: readonly SensitiveDataCategory[]
): SensitiveMatch[] {
  if (!text) return []
  const enabled = enabledSet(categories)
  const candidates: SensitiveMatch[] = []
  for (const { category, expression, validate } of PATTERNS) {
    if (!enabled.has(category)) continue
    expression.lastIndex = 0
    for (const match of text.matchAll(expression)) {
      const value = match[0]
      if (validate && !validate(value)) continue
      const start = match.index
      if (start === undefined) continue
      candidates.push({ category, start, end: start + value.length })
    }
  }

  /* A private key or token can contain text matched by a broader rule. Keep
   * the earliest, longest, highest-priority span and discard nested overlaps
   * so redaction is deterministic and counts are not inflated. */
  candidates.sort((left, right) => {
    if (left.start !== right.start) return left.start - right.start
    const leftLength = left.end - left.start
    const rightLength = right.end - right.start
    if (leftLength !== rightLength) return rightLength - leftLength
    return CATEGORY_PRIORITY.indexOf(left.category) - CATEGORY_PRIORITY.indexOf(right.category)
  })
  const accepted: SensitiveMatch[] = []
  let occupiedUntil = -1
  for (const candidate of candidates) {
    if (candidate.start < occupiedUntil) continue
    accepted.push(candidate)
    occupiedUntil = candidate.end
  }
  return accepted
}

export function summarizeFindings(
  findings: readonly CategoryCount[]
): DlpFindingSummary[] {
  const counts = new Map<SensitiveDataCategory, number>()
  for (const finding of findings) {
    counts.set(finding.category, (counts.get(finding.category) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => left.category.localeCompare(right.category))
}

export function redactSensitiveText(
  text: string,
  categories?: readonly SensitiveDataCategory[]
): { text: string; matches: SensitiveMatch[] } {
  const matches = detectSensitiveData(text, categories)
  if (!matches.length) return { text, matches }
  let output = ''
  let cursor = 0
  for (const match of matches) {
    output += text.slice(cursor, match.start)
    output += `[redacted:${match.category}]`
    cursor = match.end
  }
  output += text.slice(cursor)
  return { text: output, matches }
}

function protectString(
  value: string,
  mode: DlpMode,
  categories: readonly SensitiveDataCategory[]
): { value: string; findings: CategoryCount[] } {
  if (mode === 'off') return { value, findings: [] }
  const redacted = redactSensitiveText(value, categories)
  return {
    value: mode === 'redact' ? redacted.text : value,
    findings: redacted.matches
  }
}

/**
 * Recursively protects JSON-compatible model/tool payloads. Sensitive field
 * names are caught even when the value is too short for a token signature.
 * The input is never mutated.
 */
export function protectData<T>(
  input: T,
  settings: DlpSettings,
  categories: readonly SensitiveDataCategory[] = settings.categories
): ProtectionResult<T> {
  if (settings.mode === 'off') return { value: input, findings: [], total: 0 }
  const findings: CategoryCount[] = []
  const ancestors = new WeakSet<object>()
  const enabled = enabledSet(categories)

  const visit = (value: unknown, key?: string, depth = 0): unknown => {
    if (
      key &&
      SENSITIVE_FIELD.test(key) &&
      enabled.has('secret') &&
      value != null
    ) {
      findings.push({ category: 'secret' })
      return settings.mode === 'redact' ? '[redacted:secret]' : value
    }
    if (typeof value === 'string') {
      const protectedString = protectString(value, settings.mode, categories)
      findings.push(...protectedString.findings)
      return protectedString.value
    }
    if (Array.isArray(value)) {
      if (depth > 30) {
        findings.push({ category: 'secret' })
        return settings.mode === 'redact' ? '[redacted:deep-nesting]' : value
      }
      if (ancestors.has(value)) return settings.mode === 'redact' ? '[circular]' : value
      ancestors.add(value)
      try {
        return value.map((item) => visit(item, undefined, depth + 1))
      } finally {
        ancestors.delete(value)
      }
    }
    if (value && typeof value === 'object') {
      if (depth > 30) {
        findings.push({ category: 'secret' })
        return settings.mode === 'redact' ? '[redacted:deep-nesting]' : value
      }
      if (ancestors.has(value)) return settings.mode === 'redact' ? '[circular]' : value
      ancestors.add(value)
      try {
        const output: Record<string, unknown> = {}
        for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
          output[childKey] = visit(childValue, childKey, depth + 1)
        }
        return output
      } finally {
        ancestors.delete(value)
      }
    }
    return value
  }

  const value = visit(input) as T
  return { value, findings: summarizeFindings(findings), total: findings.length }
}

export function inspectSensitiveText(
  text: string,
  categories?: readonly SensitiveDataCategory[]
): DlpInspection {
  const redacted = redactSensitiveText(text, categories)
  return {
    total: redacted.matches.length,
    findings: summarizeFindings(redacted.matches),
    redacted: redacted.text
  }
}

/** Audit metadata is always scrubbed, independently of the task DLP mode. */
export function scrubAuditValue<T>(value: T): T {
  return protectData(value, {
    mode: 'redact',
    categories: ALL_SENSITIVE_DATA_CATEGORIES
  }).value
}

export class DataPolicyError extends Error {
  readonly findings: DlpFindingSummary[]

  constructor(boundary: string, findings: DlpFindingSummary[]) {
    const categories = findings.map((finding) => finding.category).join(', ')
    super(
      `Data-loss prevention blocked ${boundary}: sensitive data detected (${categories}). ` +
        'Remove the sensitive data or ask the policy administrator to change the DLP policy.'
    )
    this.name = 'DataPolicyError'
    this.findings = findings
  }
}
