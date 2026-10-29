/**
 * Techne Patch Engine — Structured multi-hunk patch application and syntax guard.
 *
 * Provides resilient unified diff parsing, fuzzy line matching, and pre-flight
 * syntax checking before writes are applied to disk.
 */

export interface DiffHunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: string[]
}

export interface ParsedDiff {
  oldPath?: string
  newPath?: string
  hunks: DiffHunk[]
}

export interface PatchOutcome {
  success: boolean
  content?: string
  additions: number
  deletions: number
  error?: string
}

export interface SyntaxCheckResult {
  valid: boolean
  error?: string
}

export class TechnePatchEngine {
  /**
   * Parse a unified diff string into hunks.
   */
  static parseUnifiedDiff(diffText: string): ParsedDiff {
    const lines = diffText.split(/\r?\n/)
    let oldPath: string | undefined
    let newPath: string | undefined
    const hunks: DiffHunk[] = []

    let currentHunk: DiffHunk | null = null

    for (const line of lines) {
      if (line.startsWith('--- ')) {
        const pathPart = line.slice(4).trim()
        oldPath = pathPart.startsWith('a/') ? pathPart.slice(2) : pathPart
        continue
      }
      if (line.startsWith('+++ ')) {
        const pathPart = line.slice(4).trim()
        newPath = pathPart.startsWith('b/') ? pathPart.slice(2) : pathPart
        continue
      }
      if (line.startsWith('@@ ')) {
        const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
        if (match) {
          if (currentHunk) {
            hunks.push(currentHunk)
          }
          currentHunk = {
            oldStart: parseInt(match[1], 10),
            oldCount: match[2] !== undefined ? parseInt(match[2], 10) : 1,
            newStart: parseInt(match[3], 10),
            newCount: match[4] !== undefined ? parseInt(match[4], 10) : 1,
            lines: []
          }
          continue
        }
      }

      if (currentHunk) {
        if (
          line.startsWith(' ') ||
          line.startsWith('+') ||
          line.startsWith('-') ||
          line === ''
        ) {
          currentHunk.lines.push(line.length === 0 ? ' ' : line)
        }
      }
    }

    if (currentHunk) {
      hunks.push(currentHunk)
    }

    return { oldPath, newPath, hunks }
  }

  /**
   * Count additions and deletions in a unified diff.
   */
  static countPatchLines(diffText: string): { additions: number; deletions: number } {
    let additions = 0
    let deletions = 0
    for (const line of diffText.split(/\r?\n/)) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++
      else if (line.startsWith('-') && !line.startsWith('---')) deletions++
    }
    return { additions, deletions }
  }

  /**
   * Apply a unified diff to original file content with fuzzy context matching.
   */
  static applyUnifiedPatch(originalContent: string, diffText: string): PatchOutcome {
    const { additions, deletions } = this.countPatchLines(diffText)
    const parsed = this.parseUnifiedDiff(diffText)

    if (parsed.hunks.length === 0) {
      return {
        success: false,
        additions: 0,
        deletions: 0,
        error: 'No valid patch hunks found in diff.'
      }
    }

    const originalLines = originalContent.split(/\r?\n/)
    const outputLines = [...originalLines]
    let lineOffset = 0

    for (let hIdx = 0; hIdx < parsed.hunks.length; hIdx++) {
      const hunk = parsed.hunks[hIdx]
      const targetOldStart = hunk.oldStart - 1 + lineOffset

      // Extract context and old lines from hunk
      const expectedLines: string[] = []
      const replacementLines: string[] = []

      for (const hLine of hunk.lines) {
        const marker = hLine[0]
        const text = hLine.slice(1)
        if (marker === ' ') {
          expectedLines.push(text)
          replacementLines.push(text)
        } else if (marker === '-') {
          expectedLines.push(text)
        } else if (marker === '+') {
          replacementLines.push(text)
        }
      }

      // Locate matching position in outputLines (fuzzy window of +/- 12 lines)
      let matchIdx = -1
      const maxDrift = 12
      const candidateStarts = [
        targetOldStart,
        ...Array.from({ length: maxDrift }, (_, i) => targetOldStart + (i + 1)),
        ...Array.from({ length: maxDrift }, (_, i) => targetOldStart - (i + 1))
      ].filter((idx) => idx >= 0 && idx <= outputLines.length)

      for (const start of candidateStarts) {
        let matches = true
        for (let i = 0; i < expectedLines.length; i++) {
          const expected = expectedLines[i].trim()
          const actual = (outputLines[start + i] ?? '').trim()
          if (expected !== actual) {
            matches = false
            break
          }
        }
        if (matches) {
          matchIdx = start
          break
        }
      }

      if (matchIdx === -1) {
        return {
          success: false,
          additions,
          deletions,
          error: `Hunk #${hIdx + 1} failed to apply at line ${hunk.oldStart}: context mismatch.`
        }
      }

      // Splice replacement into outputLines
      outputLines.splice(matchIdx, expectedLines.length, ...replacementLines)
      lineOffset += replacementLines.length - expectedLines.length
    }

    const patchedText = outputLines.join('\n')

    return {
      success: true,
      content: patchedText,
      additions,
      deletions
    }
  }

  /**
   * Pre-flight syntax validation for changed files.
   */
  static validateCodeSyntax(filePath: string, content: string): SyntaxCheckResult {
    const lower = filePath.toLowerCase()
    if (lower.endsWith('.json')) {
      try {
        JSON.parse(content)
        return { valid: true }
      } catch (err: unknown) {
        return { valid: false, error: `Invalid JSON syntax: ${err instanceof Error ? err.message : String(err)}` }
      }
    }

    // Bracket & Brace balance check for JavaScript, TypeScript, CSS, HTML
    if (
      lower.endsWith('.ts') ||
      lower.endsWith('.tsx') ||
      lower.endsWith('.js') ||
      lower.endsWith('.jsx')
    ) {
      const stack: Array<{ char: string; line: number }> = []
      const lines = content.split(/\r?\n/)

      let inBlockComment = false

      for (let l = 0; l < lines.length; l++) {
        const line = lines[l]
        let inString: string | null = null
        let isEscaped = false

        for (let i = 0; i < line.length; i++) {
          const char = line[i]
          const next = line[i + 1]

          if (inBlockComment) {
            if (char === '*' && next === '/') {
              inBlockComment = false
              i++
            }
            continue
          }

          if (!inString && char === '/' && next === '*') {
            inBlockComment = true
            i++
            continue
          }

          if (!inString && char === '/' && next === '/') {
            break // line comment
          }

          if (inString) {
            if (isEscaped) {
              isEscaped = false
            } else if (char === '\\') {
              isEscaped = true
            } else if (char === inString) {
              inString = null
            }
            continue
          }

          if (char === '"' || char === "'" || char === '`') {
            inString = char
            continue
          }

          if (char === '(' || char === '[' || char === '{') {
            stack.push({ char, line: l + 1 })
          } else if (char === ')' || char === ']' || char === '}') {
            const last = stack.pop()
            if (!last) {
              return {
                valid: false,
                error: `Unmatched closing bracket '${char}' at line ${l + 1}.`
              }
            }
            const expected = last.char === '(' ? ')' : last.char === '[' ? ']' : '}'
            if (char !== expected) {
              return {
                valid: false,
                error: `Mismatched bracket: expected '${expected}' to close '${last.char}' from line ${last.line}, but found '${char}' at line ${l + 1}.`
              }
            }
          }
        }
      }

      if (stack.length > 0) {
        const unclosed = stack[stack.length - 1]
        return {
          valid: false,
          error: `Unclosed bracket '${unclosed.char}' opened at line ${unclosed.line}.`
        }
      }
    }

    return { valid: true }
  }
}
