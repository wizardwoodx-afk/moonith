import type { DiffLine } from '@shared/types'

/**
 * A line-level diff, kept deliberately small and local.
 *
 * This exists so an approval prompt can show the real change instead of a JSON
 * blob: the user is asked to allow a write, so the write has to be readable
 * before it happens. No dependency is added for it, and the output is bounded
 * so a huge file cannot turn the modal into an endless scroll.
 */

/** Lines the renderer may see. Counts always cover the whole change. */
export const MAX_RENDERED_LINES = 400

/** Cells of the subsequence table; past this the middle shows as one block. */
const LCS_CELLS = 2_000_000

function toLines(text: string): string[] {
  if (!text) return []
  const lines = text.split('\n')
  // A trailing newline is not an extra empty line.
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * The unchanged head and tail. Trimming them first is what makes most real
 * edits — a handful of lines inside a long file — cheap.
 */
function commonEdges(from: string[], to: string[]): { head: number; tailFrom: number; tailTo: number } {
  let head = 0
  while (head < from.length && head < to.length && from[head] === to[head]) head++
  let tailFrom = from.length
  let tailTo = to.length
  while (tailFrom > head && tailTo > head && from[tailFrom - 1] === to[tailTo - 1]) {
    tailFrom--
    tailTo--
  }
  return { head, tailFrom, tailTo }
}

function walkMiddle(from: string[], to: string[]): DiffLine[] {
  const rows = from.length
  const cols = to.length
  const table: Uint32Array[] = []
  for (let row = 0; row <= rows; row++) table.push(new Uint32Array(cols + 1))
  for (let row = rows - 1; row >= 0; row--) {
    for (let col = cols - 1; col >= 0; col--) {
      table[row][col] =
        from[row] === to[col]
          ? table[row + 1][col + 1] + 1
          : Math.max(table[row + 1][col], table[row][col + 1])
    }
  }

  const out: DiffLine[] = []
  let row = 0
  let col = 0
  while (row < rows && col < cols) {
    if (from[row] === to[col]) {
      out.push({ sign: ' ', text: to[col] })
      row++
      col++
    } else if (table[row + 1][col] >= table[row][col + 1]) {
      out.push({ sign: '-', text: from[row] })
      row++
    } else {
      out.push({ sign: '+', text: to[col] })
      col++
    }
  }
  while (row < rows) out.push({ sign: '-', text: from[row++] })
  while (col < cols) out.push({ sign: '+', text: to[col++] })
  return out
}

/** Removals before additions: the same order every diff tool reads. */
function asBlock(from: string[], to: string[]): DiffLine[] {
  return [
    ...from.map((text) => ({ sign: '-' as const, text })),
    ...to.map((text) => ({ sign: '+' as const, text }))
  ]
}

export interface LineDiff {
  lines: DiffLine[]
  added: number
  removed: number
  /** True when the change was larger than the renderer can be shown. */
  truncated: boolean
}

export function diffLines(before: string, after: string): LineDiff {
  const from = toLines(before)
  const to = toLines(after)
  const { head, tailFrom, tailTo } = commonEdges(from, to)

  const middleFrom = from.slice(head, tailFrom)
  const middleTo = to.slice(head, tailTo)
  const tooBig = middleFrom.length * middleTo.length > LCS_CELLS
  const middle = tooBig || !middleFrom.length || !middleTo.length
    ? asBlock(middleFrom, middleTo)
    : walkMiddle(middleFrom, middleTo)

  const all: DiffLine[] = [
    ...from.slice(0, head).map((text) => ({ sign: ' ' as const, text })),
    ...middle,
    ...from.slice(tailFrom).map((text) => ({ sign: ' ' as const, text }))
  ]

  let added = 0
  let removed = 0
  for (const line of all) {
    if (line.sign === '+') added++
    else if (line.sign === '-') removed++
  }

  if (all.length <= MAX_RENDERED_LINES) {
    return { lines: all, added, removed, truncated: false }
  }
  return {
    lines: [
      ...all.slice(0, MAX_RENDERED_LINES),
      { sign: ' ', text: `… ${all.length - MAX_RENDERED_LINES} more lines; the whole change is applied on approval` }
    ],
    added,
    removed,
    truncated: true
  }
}

/** A short human line: "+12 −3 in src/app.ts" */
export function diffStat(diff: LineDiff): string {
  return `+${diff.added} −${diff.removed}`
}
