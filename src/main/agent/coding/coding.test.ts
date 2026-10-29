import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileNavigator } from './fileNavigator'
import { TechnePatchEngine } from './patchEngine'

describe('Coding Engine: FileNavigator & TechnePatchEngine', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `coding_engine_test_${Date.now()}_${Math.random().toString(36).slice(2)}`)
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => undefined)
  })

  it('reads paged lines and computes next offsets', async () => {
    const filePath = join(testDir, 'sample.txt')
    const lines = Array.from({ length: 50 }, (_, i) => `Line number ${i + 1}`)
    await fs.writeFile(filePath, lines.join('\n'), 'utf8')

    const page1 = await FileNavigator.readFile(filePath, { offset: 1, limit: 20 })
    expect(page1.linesCount).toBe(20)
    expect(page1.offset).toBe(1)
    expect(page1.hasMore).toBe(true)
    expect(page1.nextOffset).toBe(21)
    expect(page1.content.startsWith('Line number 1')).toBe(true)

    const page2 = await FileNavigator.readFile(filePath, { offset: page1.nextOffset, limit: 35 })
    expect(page2.linesCount).toBe(30)
    expect(page2.offset).toBe(21)
    expect(page2.content.endsWith('Line number 50')).toBe(true)
  })

  it('lists directory with paging and types', async () => {
    await fs.writeFile(join(testDir, 'fileA.txt'), 'hello', 'utf8')
    await fs.writeFile(join(testDir, 'fileB.txt'), 'world', 'utf8')
    await fs.mkdir(join(testDir, 'subfolder'), { recursive: true })

    const res = await FileNavigator.listDirectory(testDir, { limit: 10 })
    expect(res.entries.length).toBe(3)
    expect(res.entries[0].type).toBe('directory')
    expect(res.entries[0].path).toBe('subfolder')
  })

  it('extracts symbol outlines from TypeScript code', () => {
    const code = `
export interface UserProfile {
  id: string
  name: string
}

export class AccountService {
  constructor() {}
  public async getUser(id: string): Promise<UserProfile> {
    return { id, name: 'Alice' }
  }
}

export function computeScore(a: number, b: number): number {
  return a + b
}
`
    const symbols = FileNavigator.outlineSymbols(code)
    expect(symbols.some((s) => s.kind === 'interface' && s.name === 'UserProfile')).toBe(true)
    expect(symbols.some((s) => s.kind === 'class' && s.name === 'AccountService')).toBe(true)
    expect(symbols.some((s) => s.kind === 'function' && s.name === 'computeScore')).toBe(true)
  })

  it('parses and applies unified diffs with fuzzy context matching', () => {
    const original = `function add(a, b) {
  // calculate sum
  const result = a + b
  return result
}`

    const diff = `--- a/math.js
+++ b/math.js
@@ -1,5 +1,5 @@
 function add(a, b) {
-  // calculate sum
+  // calculate sum with logging
+  console.log("Adding numbers", a, b)
   const result = a + b
   return result
 }`

    const outcome = TechnePatchEngine.applyUnifiedPatch(original, diff)
    expect(outcome.success).toBe(true)
    expect(outcome.content).toContain('// calculate sum with logging')
    expect(outcome.content).toContain('console.log("Adding numbers", a, b)')
    expect(outcome.additions).toBe(2)
    expect(outcome.deletions).toBe(1)
  })

  it('validates syntax before committing code changes', () => {
    const goodCode = `function test() { const x = [1, 2, { a: "hello" }]; return x; }`
    const unclosedCode = `function test() { const x = [1, 2, { a: "hello" ]; return x; }`
    const invalidJson = `{ "name": "SelfImpulse", "version": }`

    expect(TechnePatchEngine.validateCodeSyntax('test.ts', goodCode).valid).toBe(true)
    expect(TechnePatchEngine.validateCodeSyntax('test.ts', unclosedCode).valid).toBe(false)
    expect(TechnePatchEngine.validateCodeSyntax('package.json', invalidJson).valid).toBe(false)
  })
})
