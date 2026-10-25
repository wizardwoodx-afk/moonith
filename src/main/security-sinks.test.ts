import { readFileSync, readdirSync, statSync } from 'node:fs'
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

const FORBIDDEN: Array<[string, RegExp]> = [
  ['cmd /c start', /'cmd',\s*\[\s*'\/c',\s*'start'/],
  ['windows shell spawn', /shell:\s*process\.platform\s*===\s*'win32'/],
  ['plaintext secret fallback', /\{\s*plain:\s*value\s*\}/],
  ['broad websocket CSP', /connect-src\s+'self'\s+ws:/]
]

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
    const offenders: string[] = []
    for (const file of tsFiles(ROOT)) {
      const text = readFileSync(file, 'utf8')
      for (const [label, pattern] of FORBIDDEN) {
        if (pattern.test(text) && !ALLOW_SHELL.has(file) && !EXEMPT[label]?.has(file)) {
          offenders.push(`${label}: ${file}`)
        }
      }
      if (
        /shell:\s*true/.test(text) &&
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
