import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')

/**
 * The only two files in this repo that are allowed to hand a command to a
 * shell: the agent's `shell` tool and the backend tool surface. Every other
 * path must spawn with an argv array and `shell: false`.
 */
const ALLOW_SHELL = new Set([
  join(ROOT, 'src/main/agent/tools/shell.ts'),
  join(ROOT, 'src/main/backend/tools.ts')
])

/**
 * Rule-scoped exemptions: one exact file for one exact rule. They exist because
 * a literal pattern can fire on code that is not the sink the rule guards, and
 * the honest answer is a named exception — never a weaker regex.
 */
const EXEMPT: Record<string, Set<string>> = {
  // `shell` here is a *capability flag* in mission permission data:
  // `SecurityBoundary.shell` / `GrantedPermissions.shell` (types.ts) and the
  // role matrix (organization.ts). It is never a child-process `shell` option.
  'spawn shell option': new Set([
    join(ROOT, 'src/main/selfimpulse/mission/types.ts'),
    join(ROOT, 'src/main/selfimpulse/mission/organization.ts')
  ]),
  // Host-boundary secret store with a deliberate, disclosed fallback: when the
  // OS keychain is absent it writes plaintext and names the file in the receipt
  // (see the honesty rules in the module header). The backend store
  // (`backend/security.ts#put`) is the fail-closed one this rule guards.
  'plaintext secret fallback': new Set([join(ROOT, 'src/main/selfimpulse/host/knight.ts')])
}

/**
 * The four forbidden sinks. Quote-tolerant on purpose: reintroducing the same
 * sink with double-quoted literals instead of single-quoted ones — an execFile
 * argv of cmd then a slash-c element then a start element, a spawn shell option
 * taken from a win32 platform comparison, a CSP connect-src of self followed by a
 * ws source — is the same vulnerability, so each pattern accepts either quote
 * style (and ordinary whitespace variance) around its quoted literals. The four
 * meanings are unchanged and still narrow: the plaintext-fallback rule keeps
 * requiring the secret-storage plain-value object shape, not any object literal,
 * and the CSP rule keeps requiring connect-src plus self plus a ws: source.
 * This comment deliberately spells no sink literally: the guard reads its own file.
 */
const FORBIDDEN: Array<[string, RegExp]> = [
  ['cmd /c start', /["']cmd["']\s*,\s*\[\s*["']\/c["']\s*,\s*["']start["']/],
  ['windows shell spawn', /shell:\s*process\.platform\s*===\s*["']win32["']/],
  ['plaintext secret fallback', /\{\s*["']?plain["']?\s*:\s*value\s*\}/],
  ['broad websocket CSP', /connect-src\s+["']self["']\s+ws:/]
]

/**
 * The same class as the second rule, in its literal-true form. The option key may
 * itself be quoted, which is why the key tolerates quotes here too. It is checked
 * apart from FORBIDDEN because its report label must not spell a shell key next to
 * a colon, or this guard would match its own source.
 */
const SPAWN_SHELL_OPTION = /["']?shell["']?\s*:\s*true/

/**
 * The renderer document the CSP rule exists to guard. Asserted, not assumed: if
 * CSP ever moves or the file is renamed, the rule would silently stop guarding
 * anything, which is worse than having no rule at all.
 */
const GUARDED_CSP_DOCUMENT = join(ROOT, 'src/renderer/index.html')

/**
 * Floor for the scan's own reach. Measured on this tree at the time of writing:
 * 315 files (every `.ts`/`.tsx` under the repo plus `src/renderer/index.html`,
 * minus the `PRUNED` directories). 300 leaves room for ordinary file moves and
 * renames, but turns an accidental whole-directory prune failure into a loud
 * assertion instead of a silently smaller scan.
 */
const MIN_SCANNED_FILES = 300

/**
 * Directories the guard does not read. `roi` and `vendor` are vendored upstream
 * runtimes: we ship them verbatim, so their source is not ours to keep clean —
 * a sink inside them is fixed by re-vendoring upstream, never by editing a
 * copy we attribute to someone else (attribution and provenance: Tasks 1 and
 * 14). Scanning them could only ever be answered by weakening this ratchet.
 */
const PRUNED = new Set(['roi', 'vendor', 'node_modules', 'out', 'release', '.git'])

/**
 * `.html` is included because the CSP rule's subject is the renderer document
 * (`src/renderer/index.html`): scanning only `.ts`/`.tsx` would leave that
 * shipped fix unguarded.
 */
function tsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (PRUNED.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) tsFiles(full, out)
    else if (/\.(ts|tsx|html)$/.test(name)) out.push(full)
  }
  return out
}

describe('shipped security fixes', () => {
  it('keeps every forbidden sink out of the source tree', () => {
    const scanned = tsFiles(ROOT)

    // Self-checks first: the ratchet has to prove it is reading the files whose
    // shipped fixes it exists to protect.
    expect(
      existsSync(GUARDED_CSP_DOCUMENT),
      `CSP document moved or was renamed (${GUARDED_CSP_DOCUMENT}): re-aim the CSP rule, do not leave it inert`
    ).toBe(true)
    expect(
      scanned,
      'the sink scan is not reading src/renderer/index.html, so the broad-websocket CSP rule guards nothing'
    ).toContain(GUARDED_CSP_DOCUMENT)
    expect(
      scanned.length,
      `the sink scan read only ${scanned.length} files (floor ${MIN_SCANNED_FILES}): a prune or filter is swallowing a directory`
    ).toBeGreaterThan(MIN_SCANNED_FILES)

    const offenders: string[] = []
    for (const file of scanned) {
      const text = readFileSync(file, 'utf8')
      for (const [label, pattern] of FORBIDDEN) {
        if (pattern.test(text) && !ALLOW_SHELL.has(file) && !EXEMPT[label]?.has(file)) {
          offenders.push(`${label}: ${file}`)
        }
      }
      if (
        SPAWN_SHELL_OPTION.test(text) &&
        !ALLOW_SHELL.has(file) &&
        !EXEMPT['spawn shell option']?.has(file)
      ) {
        // Label spelled without the colon so this guard does not match itself.
        offenders.push(`spawn shell option: ${file}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
