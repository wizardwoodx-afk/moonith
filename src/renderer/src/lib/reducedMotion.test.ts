import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function collectFiles(root: string, extension: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) found.push(...collectFiles(path, extension))
    else if (entry.name.endsWith(extension)) found.push(path)
  }
  return found
}

describe('motion contract', () => {
  const css = readFileSync('src/renderer/src/styles.css', 'utf8')
  const main = readFileSync('src/renderer/src/main.tsx', 'utf8')

  it('kills decorative CSS motion in reduced mode', () => {
    const rule = css.indexOf("html[data-motion-mode='reduced'] *,")
    expect(rule).toBeGreaterThan(-1)
    const block = css.slice(rule, css.indexOf('}', rule))
    expect(block).toContain('animation-duration: 0.001ms !important')
    expect(block).toContain('animation-iteration-count: 1 !important')
    expect(block).toContain('transition-duration: 0.001ms !important')
    expect(block).toContain('scroll-behavior: auto !important')
  })

  it('lets essential motion opt back in through a declared duration', () => {
    expect(css).toContain("[data-motion='essential']")
    expect(css).toContain('var(--motion-duration')
  })

  it('keeps the working-state loaders moving for reduced-motion readers', () => {
    /* A frozen loader says nothing: the ring, the letters, the light and the
     * shimmer are how the app says work is in flight, so they opt back in. */
    for (const loader of ['.work-ring', '.bounce-letter', '.status-light', '.shimmer-text']) {
      const rule = css.slice(css.indexOf(`${loader} {`), css.indexOf('}', css.indexOf(`${loader} {`)))
      expect(rule).toContain('--motion-duration')
      expect(rule).toContain('--motion-iteration: infinite')
    }
    expect(css).toContain("html[data-motion-mode='reduced'] [data-motion='essential']")
    const ring = readFileSync('src/renderer/src/motion/WorkRing.tsx', 'utf8')
    const light = readFileSync('src/renderer/src/motion/StatusLight.tsx', 'utf8')
    const shimmer = readFileSync('src/renderer/src/motion/ShimmerText.tsx', 'utf8')
    expect(ring).toContain('data-motion="essential"')
    expect(light).toContain('data-motion="essential"')
    expect(shimmer).toContain('data-motion="essential"')
  })

  it('drives Framer Motion from the same resolved mode', () => {
    expect(main).toContain("resolved === 'reduced' ? 'always' : 'never'")
  })

  it('keeps the machine out of the app own motion consumers', () => {
    /* useReducedMotion reads the operating system directly and would freeze
     * the interface on a machine that says "reduce", against the setting the
     * person actually chose. Every consumer reads the app's mode instead. */
    const files = collectFiles('src/renderer/src', '.tsx')
    const offenders = files.filter((file) =>
      /\buseReducedMotion\(\)/.test(readFileSync(file, 'utf8'))
    )
    expect(offenders).toEqual([])
  })
})
