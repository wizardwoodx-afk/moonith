import { describe, expect, it } from 'vitest'
import { diffLines, diffStat, MAX_RENDERED_LINES } from './diff'

const render = (before: string, after: string): string[] =>
  diffLines(before, after).lines.map((line) => `${line.sign} ${line.text}`)

describe('diffLines', () => {
  it('reports no change when the text is identical', () => {
    const diff = diffLines('a\nb\nc\n', 'a\nb\nc\n')
    expect(diff.added).toBe(0)
    expect(diff.removed).toBe(0)
    expect(diff.lines.every((line) => line.sign === ' ')).toBe(true)
  })

  it('keeps the untouched neighbours around the one changed line', () => {
    expect(render('one\ntwo\nthree\nfour\n', 'one\nTWO\nthree\nfour\n')).toEqual([
      '  one',
      '- two',
      '+ TWO',
      '  three',
      '  four'
    ])
  })

  it('treats a trailing newline as the end of the file, not an empty line', () => {
    expect(diffLines('a\n', 'a\n').added).toBe(0)
    expect(render('a', 'a\n')).toEqual(['  a'])
  })

  it('counts a pure addition without inventing a removal', () => {
    const diff = diffLines('title\n', 'title\nbody one\nbody two\n')
    expect(diff.added).toBe(2)
    expect(diff.removed).toBe(0)
  })

  it('handles a brand new file', () => {
    const diff = diffLines('', 'created\n')
    expect(diff.added).toBe(1)
    expect(diff.removed).toBe(0)
    expect(diff.lines[0]).toEqual({ sign: '+', text: 'created' })
  })

  it('handles a file emptied out', () => {
    const diff = diffLines('gone\n', '')
    expect(diff.removed).toBe(1)
    expect(diff.added).toBe(0)
  })

  it('refuses to spend the quadratic pass on two huge middles', () => {
    const before = Array.from({ length: 3000 }, (_, i) => `old ${i}`).join('\n')
    const after = Array.from({ length: 3000 }, (_, i) => `new ${i}`).join('\n')
    const diff = diffLines(before, after)
    expect(diff.removed).toBe(3000)
    expect(diff.added).toBe(3000)
    // Coarse mode puts every removal before every addition.
    expect(diff.lines[MAX_RENDERED_LINES - 1].sign).toBe('-')
  })

  it('bounds what the modal has to render but keeps the counts true', () => {
    const before = Array.from({ length: 900 }, (_, i) => `line ${i}`).join('\n')
    const after = `${before}\nappended\n`
    const diff = diffLines(before, after)
    expect(diff.added).toBe(1)
    expect(diff.truncated).toBe(true)
    expect(diff.lines).toHaveLength(MAX_RENDERED_LINES + 1)
    expect(diff.lines[MAX_RENDERED_LINES].text).toContain('more lines')
  })

  it('matches the ordering a diff reader expects when lines move', () => {
    expect(render('a\nb\nc\n', 'a\nc\nb\n')).toEqual(['  a', '- b', '  c', '+ b'])
  })

  it('prints a one-line stat', () => {
    expect(diffStat(diffLines('x\ny\n', 'x\nz\nw\n'))).toBe('+2 −1')
  })
})
