# SelfImpulse × Moonith Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold Moonith's feature layers (typed workflows, durable execution, agent RBAC + DLP, signed runtime audit ledger, native enterprise control plane, RSIRALS learning, premium motion, 34 themes) into the already-fixed SelfImpulse source at `D:\selfimpulse\source`, keeping Nomos / Sphragis / Aion and every security fix, so that one app ships one agent runtime.

**Architecture:** The two trees are siblings: `src/main/backend/core/` is byte-identical, and both vendor the same LangGraph-derived runtime (`@langchain/langgraph 1.5.1`, `@langchain/core 1.2.18`, `@langchain/langgraph-checkpoint 1.2.0`). SelfImpulse keeps ImpulseCore's phase machine plus the Nomos capability gate and Sphragis receipts; Moonith replaces the loop with a SELF-ΡΟΗ state graph and adds governance/durable/enterprise modules. The merge therefore adopts Moonith's graph engine as the single turn engine, re-wires SelfImpulse's Nomos/Sphragis admission *into* that engine's tool boundary, and lands Moonith's new modules as additive subsystems with their audit findings repaired before they are trusted.

**Tech Stack:** Electron 44, React 19, TypeScript 5.9, electron-vite/Vite 8 (rolldown), Tailwind 4, Zustand, Framer Motion, Vitest 5, electron-builder NSIS (Windows x64).

**Spec:** `C:\Users\HARSHEN\Documents\Qoder\2026-10-24\5a3181d1\moonith-audit\moonith-0.3.0-premium-agent-workspace\docs\` (enterprise-controls.md, agent-workflow-durability-themes.md, premium-motion-and-color.md, self-roi-integration.md) plus the two audit reports delivered in this conversation, which override the docs wherever they disagree.

## Source trees (verbatim, never guess)

- **TARGET (trunk, git repo, branch `feat/selfimpulse-engine`):** `D:\selfimpulse\source`
- **SOURCE (feature donor, no git, read-only):** `C:\Users\HARSHEN\Documents\Qoder\2026-10-24\5a3181d1\moonith-audit\moonith-0.3.0-premium-agent-workspace`
  Shortened below as `MOON`. All `cp` commands must use the absolute path.
- Both trees use CRLF. Do not let a copy change line endings; always `diff --strip-trailing-cr` when comparing.

## Global Constraints

- Never regress the shipped security fixes. Forbidden patterns after merge (Task 16 enforces as a test):
  `execFile('cmd', ['/c', 'start'`, `shell: process.platform === 'win32'`, `shell: true` outside `agent/tools/shell.ts` + `backend/tools.ts`, `{ plain: value }` in `backend/security.ts`, `connect-src 'self' ws: wss:` in `src/renderer/index.html`.
- Keep `src/main/backend/core/` unchanged (identical in both trees; any diff is a mistake).
- One turn engine only. One transcript, one tool registry, one approval flow, one provider path. No second agent stack.
- One vendored graph runtime only. Either `src/main/vendor/graphruntime/` or `src/main/selfimpulse/roi/`, never both.
- No new npm dependency except `glimm@^0.3.1`, `metal-fx@^2.0.11`, `thinking-orbs@^0.3.2`, plus `overrides` `body-parser@2.4.0`, `image-size@2.0.4`, `uuid@11.1.1`.
- `npm audit --omit=dev` must stay at **0 vulnerabilities**.
- Every task ends with `npm run typecheck` clean and its own tests passing; Tasks 16 gates `npm test`, `npm run build`, `npm run dist:win`.
- Commits: this plan commits per task on `feat/merged-agent`. **Commits require the user's explicit approval**; without it, keep the working tree and record the checkpoint instead in `docs/superpowers/plans/merge-checkpoints.md`.
- Do not touch `D:\selfimpulse\app` (the installed binary), `D:\selfimpulse\data`, or any live profile/secret. The live profile still contains a plaintext `gho_…` GitHub token; never echo it.
- Activity indicators, counts, receipts, and audit rows must derive from real records. No decorative fake state.

## File map (locked decisions)

**Take from TARGET, do not overwrite from MOON** (they contain the fixes and the enterprise layers):
`src/main/backend/{grounded,external-agent,marketplace,security,npx,ipc,adapter}.ts`, `src/main/{store,ipc,index,paths}.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/main/nomos/**`, `src/main/sphragis/**`, `src/main/aion/**`, `src/main/enterprise/**`, `src/shared/enterprise.ts`, `src/main/agent/governed.ts`, `src/renderer/src/views/settings/{GovernancePane,MissionsPane,ReceiptsPane,paneBits}.tsx`, all TARGET-only `*.test.ts`.

**Copy from MOON as new modules** (then apply the listed repair in the same task):
`src/main/selfimpulse/durable/**`, `src/main/selfimpulse/workflow/**`, `src/main/selfimpulse/governance/**`, `src/main/services/{governance,reactions}.ts`, `src/main/audit/{runtimeLedger,runtimeService,runtime,keyProvider}.ts`, `src/main/enterpriseControl/**`, `src/shared/{governance,enterpriseControl,rsirals}.ts`, `src/renderer/src/motion/**`, `src/renderer/src/components/task-panel/**`, `src/renderer/src/lib/{cron,taskOperations}.ts`, `src/renderer/src/views/settings/{EnterprisePane,EnterpriseControlPlane,LearningPane}.tsx`, `src/main/selfimpulse/mission/{rsiralsIpc,rsiralsPolicy,rsiralsSnapshot,enterpriseAdmission}.ts`.

**Hand-merged (both sides changed):** `src/main/agent/{engine,runtime,tools/{types,studio}}.ts`, `src/main/services/{subagents,skills,channels}.ts`, `src/main/selfimpulse/mission/{lessons,learningReceipt,selfEvolveRuntime,selfImprove,runGraph,graphCheckpointer,teamExecutor,durable}.ts`, `src/shared/{types,ipc,audit}.ts`, `src/main/index.ts`, `src/renderer/src/{App.tsx,styles.css,lib/{themes,settingsNav}.ts,components/{Composer,PlanCard,Steps,TaskPanel,TitleBar,ui,Artifacts}.tsx,views/{Home,SchedulesView,SettingsView,TaskView}.tsx,views/settings/{AuditPane,ThemePanes}.tsx}`, `package.json`, `electron-builder.yml`.

---

## Phase A — Baseline, runtime, dependencies

### Task 0: Snapshot the uncommitted verified work

**Files:**
- Create: `docs/superpowers/plans/merge-checkpoints.md`
- Create (outside repo): `D:\selfimpulse\backup\source-premerge-<UTC-stamp>.zip`

**Interfaces:**
- Produces: a restorable baseline `git rev-parse HEAD` recorded in the checkpoint file.

- [ ] **Step 1: Confirm repo state and list the dirty files**

```bash
cd /d/selfimpulse/source && git status --porcelain && git log --oneline -1 && git branch --show-current
```
Expected: branch `feat/selfimpulse-engine`, HEAD `0d1f91a…`, ~15 ` M ` files plus new test files.

- [ ] **Step 2: Write an outside-git backup so nothing can be lost**

```bash
cd /d/selfimpulse && powershell -NoProfile -Command "Compress-Archive -Path source\src,source\package.json,source\package-lock.json,source\electron.vite.config.ts,source\tsconfig*.json -DestinationPath (\"backup\source-premerge-{0}.zip\" -f (Get-Date -Format yyyyMMddHHmmss))"
```
Expected: a new zip in `D:\selfimpulse\backup\`.

- [ ] **Step 3: Record the checkpoint (do not commit yet)**

Create `docs/superpowers/plans/merge-checkpoints.md` containing the HEAD sha, the backup zip path, the dirty-file list from Step 1, and the line: `Baseline = verified fixes (250/250 tests, typecheck, build, dist) not yet committed.`

- [ ] **Step 4: Ask the user once whether to commit the baseline.** If approved:

```bash
cd /d/selfimpulse/source && git checkout -b feat/merged-agent && git add -A && git commit -m "fix(security,governance): land the 0.3.0 audit remediation before the Moonith merge"
```
If not approved, continue on `feat/selfimpulse-engine` with the working tree and note it in the checkpoint file.

---

### Task 1: One vendored graph runtime

**Files:**
- Decide between: `src/main/vendor/graphruntime/**` (TARGET) and `src/main/selfimpulse/roi/**` (MOON, 594 files)
- Modify if roi wins: `src/main/selfimpulse/mission/runGraph.ts:86`, `src/main/selfimpulse/mission/graphCheckpointer.ts:40,48,49`

**Interfaces:**
- Produces: a single import root used by the graph engine: either `../../vendor/graphruntime/runtime/index.js` or `../selfimpulse/roi/runtime/index.js`, exporting `StateGraph`, `Annotation`, `START`, `END`, plus `checkpoint/index.js` exporting `BaseCheckpointSaver`, and `core/runnables/index.js` exporting `RunnableConfig`.

- [ ] **Step 1: Prove whether the two runtimes are interchangeable**

```bash
MOON="C:/Users/HARSHEN/Documents/Qoder/2026-10-24/5a3181d1/moonith-audit/moonith-0.3.0-premium-agent-workspace"
for f in runtime/index.js checkpoint/index.js; do
  echo "== $f =="
  diff --strip-trailing-cr "D:/selfimpulse/source/src/main/vendor/graphruntime/$f" "$MOON/src/main/selfimpulse/roi/$f" | head -20
done
ls D:/selfimpulse/source/src/main/vendor/graphruntime/runtime/
ls "$MOON/src/main/selfimpulse/roi/runtime/"
```
Expected: same upstream version, but MOON ships `runtime/executor/*` while TARGET does not.

- [ ] **Step 2: Apply the decision rule**

- If `diff` for `runtime/index.js` shows TARGET already exports everything the engine imports (`Annotation`, `END`, `START`, `StateGraph`, `Command`, `interrupt`) → **keep TARGET's `vendor/graphruntime`** and rewrite every MOON import from `selfimpulse/roi/` to `vendor/graphruntime/` when copying engine code. Do not copy the roi tree.
- Otherwise → **adopt roi as the single runtime**: `cp -r "$MOON/src/main/selfimpulse/roi" src/main/selfimpulse/roi`, repoint the two TARGET importers listed above, then `git rm -r src/main/vendor/graphruntime`.

- [ ] **Step 3: Record the choice and its evidence**

Append to `docs/superpowers/plans/merge-checkpoints.md`: chosen root, the export-diff output, file count before/after.

- [ ] **Step 4: Verify the graph runtime still works for missions**

```bash
cd /d/selfimpulse/source && npx vitest run src/main/selfimpulse/mission -t checkpoint
```
Expected: mission/checkpoint tests PASS (no `Cannot find module` for the runtime root).

- [ ] **Step 5: Commit (if approved)** `chore(runtime): consolidate the vendored graph runtime`

---

### Task 2: Dependencies, overrides, and the security-sink guard test

**Files:**
- Modify: `package.json` (3 deps + `overrides` block)
- Create: `src/main/security-sinks.test.ts`

**Interfaces:**
- Produces: the ratchet itself — Task 16's gate is "keep `src/main/security-sinks.test.ts` green"; it does not import a helper from that file (a controller ruling after Task 2's review removed the previously promised `expectNoForbiddenSinks()` export as dead API).

- [ ] **Step 1: Add the dependencies and overrides**

In `package.json` `dependencies` add:
```json
    "glimm": "^0.3.1",
    "metal-fx": "^2.0.11",
    "thinking-orbs": "^0.3.2",
```
and as a top-level key:
```json
  "overrides": {
    "body-parser": "2.4.0",
    "image-size": "2.0.4",
    "uuid": "11.1.1"
  },
```

- [ ] **Step 2: Install and prove the install is safe**

```bash
cd /d/selfimpulse/source && npm install --no-audit --no-fund 2>&1 | tail -5 \
 && npm audit --omit=dev 2>&1 | tail -3 \
 && node -e "for(const p of ['glimm','metal-fx','thinking-orbs']){const j=require('./node_modules/'+p+'/package.json');console.log(p,j.version,j.license,JSON.stringify(j.scripts&&j.scripts.preinstall||j.scripts&&j.scripts.postinstall||null))}"
```
Expected: `found 0 vulnerabilities`; each package `MIT` with `null` install scripts.

- [ ] **Step 3: Write the failing sink guard**

Create `src/main/security-sinks.test.ts`:
```ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const ALLOW_SHELL = new Set([
  join(ROOT, 'src/main/agent/tools/shell.ts'),
  join(ROOT, 'src/main/backend/tools.ts')
])
const FORBIDDEN: Array<[string, RegExp]> = [
  ['cmd /c start', /'cmd',\s*\[\s*'\/c',\s*'start'/],
  ['windows shell spawn', /shell:\s*process\.platform\s*===\s*'win32'/],
  ['plaintext secret fallback', /\{\s*plain:\s*value\s*\}/],
  ['broad websocket CSP', /connect-src\s+'self'\s+ws:/]
]
function tsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (name === 'node_modules' || name === 'out' || name === '.git') continue
    if (statSync(full).isDirectory()) tsFiles(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}
describe('shipped security fixes', () => {
  it('keeps every forbidden sink out of the source tree', () => {
    const offenders: string[] = []
    for (const file of tsFiles(ROOT)) {
      const text = readFileSync(file, 'utf8')
      for (const [label, pattern] of FORBIDDEN) {
        if (pattern.test(text) && !ALLOW_SHELL.has(file)) offenders.push(`${label}: ${file}`)
      }
      if (/shell:\s*true/.test(text) && !ALLOW_SHELL.has(file)) offenders.push(`shell:true: ${file}`)
    }
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 4: Run it now, before any donor code lands**

```bash
cd /d/selfimpulse/source && npx vitest run src/main/security-sinks.test.ts
```
Expected: PASS (1 test). This is the ratchet: it must keep passing after every later task.

- [ ] **Step 5: Prove the pinned overrides do not break office generation**

```bash
cd /d/selfimpulse/source && npx vitest run src/main/agent/tools/studio.test.ts
```
Expected: all studio tests PASS, including the pptx-with-image and xlsx cases.

- [ ] **Step 6: Commit (if approved)** `chore(deps): premium motion packages and pinned transitive advisories`

---

## Phase B — New subsystems, each repaired as it lands

### Task 3: Durable journal + typed workflow, with fsync and the Windows rename bug

**Files:**
- Copy: `MOON/src/main/selfimpulse/durable/**` → `src/main/selfimpulse/durable/`
- Copy: `MOON/src/main/selfimpulse/workflow/**` → `src/main/selfimpulse/workflow/`
- Modify: `src/main/util.ts:19-24` (`atomicWriteJson`)
- Modify: `src/main/paths.ts` (add the `durable/` profile directory)
- Test: `src/main/selfimpulse/durable/durable.test.ts`, `src/main/selfimpulse/workflow/workflow.test.ts`, `src/main/util.test.ts`

**Interfaces:**
- Produces: `new DurableStore(dir).context(id, opts) → Promise<DurableContext>` with `run`, `sleep`, `awakeable`, `random`, `snapshot`, `hasCompleted`, `set`, `get`; `createWorkflow<I>({ id, inputSchema }).then(step).commit()`; `createStep`, `executeStep` (consumed by the engine in Task 6).

- [ ] **Step 1: Copy the modules and fix import roots**

```bash
MOON="C:/Users/HARSHEN/Documents/Qoder/2026-10-24/5a3181d1/moonith-audit/moonith-0.3.0-premium-agent-workspace"
cd /d/selfimpulse/source
cp -r "$MOON/src/main/selfimpulse/durable" src/main/selfimpulse/durable
cp -r "$MOON/src/main/selfimpulse/workflow" src/main/selfimpulse/workflow
grep -rn "from '\.\./\.\." src/main/selfimpulse/durable src/main/selfimpulse/workflow | grep -v test | head
```
Expected: imports resolve inside the target tree (`../../util`, `../../paths`) with no `selfimpulse/roi` reference from these two modules.

- [ ] **Step 2: Add the journal directory to profile paths**

In `src/main/paths.ts`, next to the existing `audit` entry add and export `durable: join(root, 'durable')`, matching the file's current style.

- [ ] **Step 3: Write the failing durability + Windows tests**

Append to `src/main/util.test.ts` inside the existing `atomicWriteJson` describe:
```ts
  it('survives 64 concurrent writers on one file without throwing', async () => {
    const file = join(dir, 'hammer.json')
    const results = await Promise.allSettled(
      Array.from({ length: 64 }, (_, writer) => atomicWriteJson(file, { writer }))
    )
    expect(results.filter((r) => r.status === 'rejected')).toEqual([])
    const saved = await readJson<{ writer: number } | null>(file, null)
    expect(saved?.writer).toBeGreaterThanOrEqual(0)
    const leftovers = (await fs.readdir(dir)).filter((n) => n.endsWith('.tmp'))
    expect(leftovers).toEqual([])
  })
```

- [ ] **Step 4: Run it to watch it fail**

```bash
cd /d/selfimpulse/source && npx vitest run src/main/util.test.ts
```
Expected: FAIL with `EPERM: operation not permitted, rename …` (the exact failure Moonith reproduces on Windows).

- [ ] **Step 5: Implement fsync, retry, and per-file serialization**

Replace `atomicWriteJson` in `src/main/util.ts` with:
```ts
const writeChains = new Map<string, Promise<void>>()

async function writeOnce<T>(file: string, action: () => Promise<T>): Promise<T> {
  const previous = writeChains.get(file) ?? Promise.resolve()
  const current = previous.then(action, action)
  writeChains.set(
    file,
    current.then(
      () => undefined,
      () => undefined
    )
  )
  void current.catch(() => undefined)
  return current
}

export async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  await writeOnce(file, async () => {
    await fs.mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
    let lastError: unknown
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const handle = await fs.open(tmp, 'w')
      try {
        await handle.writeFile(JSON.stringify(value, null, 2), 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      try {
        await fs.rename(tmp, file)
        const directory = await fs.open(dirname(file), 'r')
        try {
          await directory.sync()
        } catch {
          /* directory fsync is unsupported on Windows; the file sync is what counts */
        } finally {
          await directory.close()
        }
        return
      } catch (error) {
        lastError = error
        if ((error as NodeJS.ErrnoException).code !== 'EPERM') break
        await fs.rm(tmp, { force: true }).catch(() => undefined)
        await new Promise((resolve) => setTimeout(resolve, 5 * (attempt + 1)))
      }
    }
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    throw lastError
  })
}
```

- [ ] **Step 6: Run the durability tests**

```bash
cd /d/selfimpulse/source && npx vitest run src/main/util.test.ts src/main/selfimpulse/durable/durable.test.ts
```
Expected: all PASS, including the donor's distinct-temp-file test.

- [ ] **Step 7: Repair the workflow cancel/resume race and the replay fingerprint**

In `src/main/selfimpulse/workflow/workflow.ts`: create the `AbortController` **before** the first `await` in `start`/`resume`/`recover` and have `cancel()` set a `canceled` flag that `execute()` checks immediately after installing a controller, so a cancel that arrives before `execute()` is not discarded; add an in-flight guard (`private executing: Promise<…> | null`) so `resume`/`recover` cannot both start the same run. Add a definition fingerprint to every journal key: compute `const definitionDigest = createHash('sha256').update(operations.map((op) => op.id).join('\u0000')).digest('hex').slice(0, 16)` in `commit()` and prefix durable keys with `def:${definitionDigest}:` so an edited workflow can never replay another step's committed output.

Real API (verified in `MOON/src/main/selfimpulse/workflow/workflow.test.ts`): `createWorkflow<I>({ id, inputSchema?, outputSchema? })` → builder `.then(createStep<I,O>({ id, execute: ({ input, signal, suspend, durable }) => O }))` / `.parallel([...])` → `.commit()` → `workflow.createRun({ runId, durable }).start(input)`; `run.snapshot()`, `run.cancel()`, `run.resume(stepId, data)`.

- [ ] **Step 8: Write the failing race + fingerprint tests**

Create `src/main/selfimpulse/workflow/workflow.races.test.ts`:
```ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DurableStore } from '../durable/index'
import { createStep, createWorkflow } from './index'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'selfimpulse-workflow-race-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('workflow cancellation and recovery', () => {
  it('honours cancel() issued while start() is still awaiting its journal write', async () => {
    const workflow = createWorkflow<null>({ id: 'early-cancel' })
      .then(createStep<null, null>({
        id: 'hang',
        execute: ({ signal }) =>
          new Promise<null>((_, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
      }))
      .commit()
    const durable = await new DurableStore(root).context('early-cancel')
    const run = workflow.createRun({ runId: 'early-cancel', durable })
    const running = run.start(null)
    run.cancel()
    await expect(running).resolves.toMatchObject({ status: 'canceled' })
  })

  it('refuses a second concurrent resume of the same suspended run', async () => {
    const workflow = createWorkflow<null>({ id: 'double' })
      .then(createStep<null, null>({
        id: 'gate',
        execute: ({ suspend }) => suspend({ waiting: true }) as never
      }))
      .commit()
    const durable = await new DurableStore(root).context('double')
    const run = workflow.createRun({ runId: 'double', durable })
    await run.start(null)
    const [first, second] = await Promise.allSettled([
      run.resume('gate', { approved: true }),
      run.resume('gate', { approved: true })
    ])
    expect([first.status, second.status].filter((status) => status === 'rejected')).toHaveLength(1)
  })
})
```

- [ ] **Step 9: Run them, then fix until green**

```bash
cd /d/selfimpulse/source && npx vitest run src/main/selfimpulse/workflow
```
Expected after Step 7 edits: all PASS. Before the fix the early-cancel test must hang or resolve `success`.

- [ ] **Step 10: Commit (if approved)** `feat(durable,workflow): typed workflows and journals with crash-safe writes`

---

### Task 4: Agent RBAC + DLP, with the reviewer escape and detector gaps closed

**Files:**
- Copy: `MOON/src/main/selfimpulse/governance/{policy,dlp}.ts` (+ their `.test.ts`) → `src/main/selfimpulse/governance/`
- Copy: `MOON/src/shared/governance.ts`, `MOON/src/shared/governance.test.ts` → `src/shared/`
- Copy: `MOON/src/main/services/governance.ts`, `MOON/src/main/services/governance.test.ts` → `src/main/services/`
- Modify: `src/shared/types.ts` (add `Task.agentRole`), `src/main/store.ts` (`normalizeGovernanceSettings`, `createTask` role default)

**Interfaces:**
- Produces: `governanceService.authorize(task, actor, tool) → PolicyDecision`, `.protectModelMessages(task, actor, messages) → ModelMessage[]` (throws `DataPolicyError` in block mode), `.protectToolArguments(task, actor, tool, args) → { args, findings, total }`, `.audit(...)`, `.permittedTools(task, tools)`, `.role(task)`; `AgentRole`, `DlpSettings`, `DEFAULT_GOVERNANCE` from `@shared/governance`.
- Consumed by: Task 6 (engine/runtime), Task 7 (channels), Task 12 (IPC), Task 13 (panes).

- [ ] **Step 1: Copy the four modules and their tests, then typecheck in isolation**

```bash
MOON="C:/Users/HARSHEN/Documents/Qoder/2026-10-24/5a3181d1/moonith-audit/moonith-0.3.0-premium-agent-workspace"
cd /d/selfimpulse/source
mkdir -p src/main/selfimpulse/governance
cp "$MOON"/src/main/selfimpulse/governance/*.ts src/main/selfimpulse/governance/
cp "$MOON"/src/shared/governance.ts "$MOON"/src/shared/governance.test.ts src/shared/
cp "$MOON"/src/main/services/governance.ts "$MOON"/src/main/services/governance.test.ts src/main/services/
npm run typecheck 2>&1 | tail -20
```
Expected: typecheck errors only about `Task.agentRole`, `store.getPublicSettings().governance`, and `runtimeAudit` (Task 5/6 land those).

- [ ] **Step 2: Land the shared type + settings plumbing**

Add to `Task` in `src/shared/types.ts`: `agentRole?: AgentRole`. Add `governance: GovernanceSettings` to `PublicSettings` and the settings default, normalized on read and on save through `normalizeGovernanceSettings` exactly as `MOON/src/main/store.ts` does, keeping TARGET's `sealSecret`/`openSecret` and the serialized task writes untouched.

Real API (verified in `MOON/src/main/selfimpulse/governance/dlp.ts`): `detectSensitiveData(text, categories?)`, `inspectSensitiveText(text, categories?)`, `redactSensitiveText(...)`, `protectData<T>(value, dlpSettings)`, `scrubAuditValue<T>(value)`, `summarizeFindings(...)`, `class DataPolicyError`. There is no `inspectSensitiveValue`.

- [ ] **Step 3: Write the failing detector tests**

Append to `src/main/selfimpulse/governance/dlp.test.ts`:
```ts
describe('detector gaps', () => {
  const apiKey = 'sk-abcdefghijklmnopqrstuvwxyz012345'
  it('detects a numeric card value, not only a string one', () => {
    const findings = detectSensitiveData(`card ${4111111111111111}`, ['payment-card'])
    expect(findings.map((f) => f.category)).toContain('payment-card')
    const nested = protectData({ amount: 4111111111111111 }, { mode: 'redact', categories: ['payment-card'] })
    expect(nested.total).toBeGreaterThan(0)
  })
  it('blocks a circular payload instead of passing it through unexamined', () => {
    const circular: Record<string, unknown> = { apiKey }
    circular.self = circular
    expect(() => protectData(circular, { mode: 'block', categories: ['api-key'] })).toThrow(DataPolicyError)
  })
  it('never writes an untrusted key into the redacted object', () => {
    const payload = JSON.parse(`{"__proto__":{"poisoned":true},"key":"${apiKey}"}`)
    const result = protectData(payload, { mode: 'redact', categories: ['api-key'] })
    expect(({} as Record<string, unknown>).poisoned).toBeUndefined()
    expect(JSON.stringify(result.value)).toContain('[redacted:api-key]')
  })
  it('finishes a 200k adversarial digit string quickly', () => {
    const start = Date.now()
    inspectSensitiveText(`${'1'.repeat(200_000)}x`, ['payment-card'])
    expect(Date.now() - start).toBeLessThan(2_000)
  })
})
```
(`protectData`'s second argument is the settings slice `{ mode, categories }` used by the donor's own tests; match its exact exported type name when writing.)

- [ ] **Step 4: Run to watch them fail**

```bash
cd /d/selfimpulse/source && npx vitest run src/main/selfimpulse/governance/dlp.test.ts
```
Expected: 4 FAIL (numeric miss, circular passthrough, prototype write, slow regex).

- [ ] **Step 5: Implement the four repairs**

In `dlp.ts`: (a) run the card detector over `String(value)` for every `number` value in `visit`, (b) in `block` mode push a finding and throw for circular/`depth > 30` instead of returning the value untouched, (c) build redacted objects with `Object.create(null)` plus a `SAFE_KEY = /^[A-Za-z0-9_$-]+$/` filter so `__proto__`/`constructor` keys are dropped, (d) replace the card regex with `(?:\d[ -]?){13,19}` plus a `value.length <= 40` guard before Luhn validation, keeping repeated-digit rejection.

- [ ] **Step 6: Run the governance suites**

```bash
cd /d/selfimpulse/source && npx vitest run src/main/selfimpulse/governance src/shared/governance.test.ts src/main/services/governance.test.ts
```
Expected: all PASS.

- [ ] **Step 7: Fix the documented-but-false role default**

`policy.ts:42-46` currently hard-codes `resolveTaskRole(assigned) → assigned ?? 'executor'`, so a task with no role ignores the configured default. Change the signature to `resolveTaskRole(assigned: AgentRole | undefined, settings: GovernanceSettings): AgentRole` returning `assigned ?? settings.defaultRole` (update all call sites: `authorizeTool`, `permittedTools`, and `governanceService.role(task)` which must read settings). Then add to `policy.test.ts`:
```ts
  it('holds a legacy task with no role to the configured Viewer default', () => {
    const settings = { ...DEFAULT_GOVERNANCE, defaultRole: 'viewer' }
    const decision = authorizeTool(undefined, settings, {
      name: 'run_command',
      sideEffect: 'execute',
      risk: 'high'
    })
    expect(decision.allowed).toBe(false)
  })
```
Run `npx vitest run src/main/selfimpulse/governance/policy.test.ts` → PASS after the change (the donor's own compatibility comment about existing tasks is preserved because `Task.agentRole` is explicitly assigned on write).

- [ ] **Step 8: Commit (if approved)** `feat(governance): agent RBAC and DLP with hardened detectors`

---

### Task 5: Signed runtime audit ledger, made honestly tamper-evident

**Files:**
- Copy: `MOON/src/main/audit/{runtimeLedger,runtimeService,runtime,keyProvider}.ts` (+ `runtimeLedger.test.ts`) → `src/main/audit/`
- Modify: `src/shared/audit.ts` (merge the runtime event/entry/integrity types), `src/main/paths.ts` (`audit/runtime.jsonl`)
- Modify: `src/main/audit/keychain.ts` (TARGET file) — asymmetric Ed25519 sealing, never silent rotation

**Interfaces:**
- Produces: `runtimeAudit.record(event) → Promise<boolean>`, `.status() → RuntimeAuditIntegrity`, `.entries()`, `.events(query)`; `RuntimeAuditLedger`, `verifyRuntimeLedgerLines(lines, publicKey) → ParsedLedger`.
- Consumed by: Task 4 `governanceService.audit`, Task 7 channels, Task 12 IPC/export.

- [ ] **Step 1: Copy and wire the ledger, keeping TARGET's chain.ts exports additive**

`MOON`'s `chain.ts` adds `createChainedAuditLine`, `signAuditPayload`, `canonicalAuditJson`, `deriveSealKey`, `AUDIT_ZERO_HASH`. Merge those into `src/main/audit/chain.ts` (do not overwrite TARGET's Ed25519 receipt helpers that `sphragis` uses).

- [ ] **Step 2: Replace symmetric HMAC with the existing Ed25519 identity**

TARGET already mints an Ed25519 key for Sphragis. Create `src/main/audit/identity.ts` — this is the type every later step and test uses:
```ts
import { createHash, generateKeyPairSync, privateDecrypt, sign, verify } from 'node:crypto'

export interface AuditIdentity {
  readonly algorithm: 'ed25519'
  readonly publicKey: string
  sign(payload: string): string
  verify(payload: string, signature: string): boolean
}

export function auditIdentityFromSeed(seed: Buffer): AuditIdentity { /* derive the key pair deterministically from the sealed secret */ }
export function createTestAuditIdentity(): AuditIdentity { /* generateKeyPairSync('ed25519') with no persistence, for tests only */ }
```
In `chain.ts` add `AUDIT_ZERO_HASH`, `canonicalAuditJson`, `createChainedAuditLine(entry, index, prev)`, `signAuditPayload(value, identity: AuditIdentity)`, `verifyAuditPayload(value, signature, identity)`, and re-key `buildAuditChain` / `verifyAuditChain` to take an `AuditIdentity` instead of a `Buffer` seal key. TARGET's Sphragis helpers (`digestOfValue`, `receiptBody`, `receiptHash`, `canonicalJson`) stay untouched — the ledger consumes them, it does not replace them.
- [ ] **Step 2b: Extend the event query**

Add `action?: string` to `AuditEventQuery` in `src/shared/audit.ts` and filter on `data.action === query.action` in `runtimeService.events`, keeping the existing `query`/`taskId`/`outcome`/`limit` behaviour.

- [ ] **Step 3: Write the failing tests for the two Moonith defects**

Create `src/main/audit/runtimeLedger.faults.test.ts`:
```ts
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AuditEntry } from '@shared/audit'
import { RuntimeAuditLedger } from './runtimeLedger'
import { createTestAuditIdentity } from './identity'
import { loadAuditSigningKeyFrom } from './keychain'

const roots: string[] = []
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'audit-fault-'))
  roots.push(dir)
  return dir
}
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }) })
function entry(action: string): AuditEntry {
  return {
    kind: 'runtime',
    ts: new Date('2026-10-25T00:00:00Z').toISOString(),
    data: { action, actor: 'system', actorId: 'test', outcome: 'ok' }
  } as unknown as AuditEntry
}

describe('ledger fault handling', () => {
  it('refuses to append after the file was truncated underneath the process', async () => {
    const file = join(tempRoot(), 'runtime.jsonl')
    const ledger = new RuntimeAuditLedger(file, createTestAuditIdentity())
    await ledger.append(entry('one'))
    await ledger.append(entry('two'))
    await ledger.append(entry('three'))
    const kept = readFileSync(file, 'utf8').split('\n').filter(Boolean)
    writeFileSync(file, `${kept.slice(0, 1).join('\n')}\n`, 'utf8')
    await expect(ledger.append(entry('four'))).rejects.toThrow(/integrity/i)
  })

  it('refuses to mint a second key when the stored key cannot be decrypted', async () => {
    const root = tempRoot()
    writeFileSync(join(root, 'audit-seal-key.json'), JSON.stringify({ secret: 'enc:not-a-real-seal' }), 'utf8')
    await expect(loadAuditSigningKeyFrom(root)).rejects.toThrow(/existing audit signing key/i)
  })
})
```
`loadAuditSigningKeyFrom(profileRoot)` is the new testable seam over `keychain.ts`: keep `loadAuditSigningKey()` calling `loadAuditSigningKeyFrom(getPaths().root)` so production behaviour is unchanged.

- [ ] **Step 4: Run to watch them fail**

```bash
cd /d/selfimpulse/source && npx vitest run src/main/audit/runtimeLedger.faults.test.ts
```
Expected: 2 FAIL (append succeeds after truncation; a fresh key is minted).

- [ ] **Step 5: Implement both repairs**

In `runtimeLedger.ts`: keep `open()` caching, but before each `append()` re-read the file tail (all lines when `entries.length % 25 === 0`, otherwise the last 3) and compare the recomputed head with cached state — on mismatch throw and clear `state`. In `keychain.ts`: if the key file exists but cannot be decrypted, throw `The existing audit signing key could not be decrypted; refusing to mint a new key so prior signed evidence stays verifiable.` and write the file with `{ mode: 0o600 }` through an fsynced temp rename. In `runtimeService.record`: never swallow silently — on failure keep `lastError` / `lastFailedAt`, return `false`, and add `lastRecordError?: string | null` and `lastRecordFailedAt?: string | null` to `RuntimeAuditIntegrity` in `src/shared/audit.ts` so `status()` surfaces them; change `governanceService.audit` to `void runtimeAudit.record(event).catch((error) => console.error('audit record failed', error))` so a rejected evidence write cannot vanish as an unhandled rejection.

- [ ] **Step 6: Cap growth and cost**

In `runtimeLedger.ts` write the anchor only every 32 appends (plus always on `verifyFromDisk()` and on process shutdown) and add a `MAX_LEDGER_LINES` of 200 000 with rotation to `runtime.jsonl.<n>`; add `runtimeService` retention config read from governance settings.

- [ ] **Step 7: Run every audit test**

```bash
cd /d/selfimpulse/source && npx vitest run src/main/audit
```
Expected: donor `runtimeLedger.test.ts`, TARGET `audit.test.ts`, and the new faults file all PASS.

- [ ] **Step 8: Commit (if approved)** `feat(audit): ed25519 runtime evidence ledger with fault-aware appends`

---

### Task 6: Native enterprise control plane, with a verifiable revision history

**Files:**
- Copy: `MOON/src/main/enterpriseControl/**` → `src/main/enterpriseControl/`, `MOON/src/shared/enterpriseControl.ts` → `src/shared/`
- Create: `src/main/ipcTrust.ts` (the `assertTrustedMainFrame` seam used by every new handler), plus a `getMainWindow()` accessor in `src/main/window.ts` if it does not already exist
- Modify: `src/main/enterpriseControl/service.ts` (keyed revisions, fsync, `loadKey` option), `src/main/enterpriseControl/ipc.ts` (trust seam + principal pinning)

**Interfaces:**
- Produces: `enterpriseControl() → EnterpriseControlService` with `snapshot`, `mutate`, `authorize`, `revision`, `requireLocalOwner`, `ensureAgentPrincipal`; `authorizeMissionTeam(args)`, `authorizeNativeTaskTool(args)`, `requireLocalEnterprise(action, kind, resourceId)`; `ENTERPRISE_CONTROL_IPC`, `EnterpriseControlMutation` from `@shared/enterpriseControl`.

- [ ] **Step 1: Copy module + shared contract, then typecheck**

```bash
MOON="C:/Users/HARSHEN/Documents/Qoder/2026-10-24/5a3181d1/moonith-audit/moonith-0.3.0-premium-agent-workspace"
cd /d/selfimpulse/source
cp -r "$MOON/src/main/enterpriseControl" src/main/enterpriseControl
cp "$MOON/src/shared/enterpriseControl.ts" src/shared/
npm run typecheck 2>&1 | tail -10
```
Expected: clean except any `runtimeAudit` reference already satisfied by Task 5.

- [ ] **Step 2: Key the revision chain**

`EnterpriseServiceOptions` gains `loadKey?: () => Promise<AuditIdentity>` (defaulting to `loadAuditSigningKey()` from Task 5). Replace `revisionDigest` (unkeyed SHA-256) with `identity.sign(stableJson(recordWithoutDigest))` stored as the revision's `digest`, chain each record's `previousDigest`, and verify the full chain plus the current state's own digest on load — a mismatch must fail closed with `refusing to load the enterprise control plane`.

- [ ] **Step 3: fsync the state file and cap principals**

Persist through the Task-3 `atomicWriteJson` (fsynced) instead of raw `writeFileSync`; in `ensureAgentPrincipal`, reuse an existing principal, expire principals whose run ended (`archive` after 7 days), and hard-cap live principals at 5 000 with a logged refusal beyond that.

- [ ] **Step 4: Make control-plane writes non-self-service for arbitrary renderers**

TARGET has no frame check today — `src/main/enterprise/ipc.ts` pins the actor to the constant `LOCAL_PRINCIPAL_ID` (`nomos/index.ts`), and no file in `src/main` reads `event.sender`. Create the missing seam once: `src/main/ipcTrust.ts` exporting
```ts
import type { IpcMainInvokeEvent } from 'electron'
import { getMainWindow } from './window'

/** Only the app's own main frame may drive the control plane. */
export function assertTrustedMainFrame(event: IpcMainInvokeEvent): void {
  const frame = event.senderFrame
  const window = getMainWindow()
  if (!frame || !window?.webContents.mainFrame) throw new Error('Untrusted IPC sender.')
  if (frame !== window.webContents.mainFrame) throw new Error('Untrusted IPC sender.')
  if (frame.url !== window.webContents.getURL()) throw new Error('Untrusted IPC origin.')
}
```
(`getMainWindow()` already exists at `src/main/window.ts:84`, so the helper needs no new plumbing.) `ENTERPRISE_CONTROL_IPC.mutate` then calls `assertTrustedMainFrame(event)` **and** `requireLocalEnterprise('enterprise.manage', 'namespace', DEFAULT_NAMESPACE_ID)` **and** records the decision through `runtimeAudit`, matching how the approval and kill-switch handlers behave.

- [ ] **Step 5: Write the failing history-tamper test**

Real mutation contract (`src/shared/enterpriseControl.ts:132-181`): `{ expectedRevision, reason, operation }` where `operation` is a tagged union such as `{ type: 'namespace.create', namespace: { id, name, description? } }`. Append to `src/main/enterpriseControl/service.test.ts`:
```ts
  it('refuses to load after the revision file is rewritten without the signing key', async () => {
    const file = join(dir, 'control-plane.json')
    const service = new EnterpriseControlService({ file, now: () => 1_700_000_000_000, loadKey: async () => testAuditIdentity })
    await service.mutate({
      expectedRevision: 1,
      reason: 'created the operations namespace',
      operation: { type: 'namespace.create', namespace: { id: 'ops', name: 'Operations' } }
    })
    const disk = JSON.parse(readFileSync(file, 'utf8')) as {
      current: { restrictions: unknown[] }
      revisions: Array<{ digest: string }>
    }
    disk.current.restrictions = []
    disk.revisions = disk.revisions.map((record) => ({ ...record, digest: '0'.repeat(64) }))
    writeFileSync(file, JSON.stringify(disk), 'utf8')

    const reopened = new EnterpriseControlService({ file, now: () => 1_700_000_000_000, loadKey: async () => testAuditIdentity })
    await expect(reopened.snapshot()).rejects.toThrow(/integrity|sign/i)
  })
```
`loadKey` is the new constructor option added in Step 2 (an `AuditIdentity` provider, mirroring the donor's `AuditKeyProvider` seam); `testAuditIdentity` comes from `src/main/audit/identity.ts`.

- [ ] **Step 6: Run the whole module plus mission admission**

```bash
cd /d/selfimpulse/source && npx vitest run src/main/enterpriseControl src/main/selfimpulse/mission/enterpriseAdmission.test.ts
```
Expected: PASS (copy `enterpriseAdmission.ts` + its test from MOON now).

- [ ] **Step 7: Commit (if approved)** `feat(enterprise): keyed native control plane with mission admission`

---

## Phase C — One agent runtime

### Task 7: Adopt the graph engine and re-wire Nomos + Sphragis into it

**Files:**
- Modify: `src/main/agent/engine.ts` (replace the `ImpulseAgent` loop with the SELF-ΡΟΗ graph from MOON, re-pointed at the Task-1 runtime root)
- Keep: `src/main/agent/governed.ts`, `src/main/agent/governed.test.ts`, `src/main/backend/core/**`
- Copy: `MOON/src/main/agent/engine.test.ts` → `src/main/agent/engine.test.ts`

**Interfaces:**
- Produces: `runEngineTurn(input: EngineInput) → Promise<TurnResult>` where `EngineInput` now also carries `durable?: DurableContext`, `protectModelMessages?: (m: ModelMessage[]) => ModelMessage[]`, `actor: { actor: 'captain' | 'crew' | 'system'; actorId: string; runId?: string }`, and `allowedToolNames?: ReadonlySet<string>`.
- Consumes: `IterationBudget`, `evaluateStopGates`, `shouldNudgeSkill/Memory`, `skillNudgeMessage`, `memoryNudgeMessage`, `finalizeHeldAnswer`, `buildSkillReviewPrompt`, `buildMemoryReviewPrompt`, `DEFAULT_MOONWRIGHT_CONFIG` (all already in `backend/core/index`).

- [ ] **Step 1: Port the engine, changing only import roots**

Copy MOON `engine.ts` over `src/main/agent/engine.ts`; rewrite `../selfimpulse/roi/runtime/index.js` to the Task-1 chosen root; add `allowedToolNames` to `EngineInput`.

- [ ] **Step 2: Constrain the background reviewer (the High finding)**

In `runBackgroundReview`, pass `allowedToolNames: new Set(reviewTools.map((tool) => tool.name))` into the review turn so the tool node can execute only reviewer tools.

- [ ] **Step 3: Write the failing reviewer test**

Create `src/main/agent/engine.review.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { runEngineTurn } from './engine'

describe('background review boundary', () => {
  it('refuses to execute a tool the reviewer was never given', async () => {
    const onTool = vi.fn(async () => ({ content: 'ran' }))
    const ports = { /* minimal provider that emits a run_command call on the review turn */ }
    await runEngineTurn({
      ...baseInput,
      tools: [memoryOnlyTool],
      allowedToolNames: new Set(['memory_write']),
      onTool,
      provider: providerThatCalls('run_command', { command: 'whoami' })
    })
    expect(onTool).not.toHaveBeenCalledWith(expect.any(String), 'run_command', expect.anything())
  })
})
```
Use the existing `MOON/src/main/agent/engine.test.ts` provider fake helpers so the fake model call is real code, not pseudo-code.

- [ ] **Step 4: Implement the guard in the tool node**

In `executeCall`: if `input.allowedToolNames && !input.allowedToolNames.has(call.name)` → emit `agent:tool_denied`, return a `CompletedToolCall` with `isError: true` and content `Reviewer policy denied ${call.name}.` and **never** call `input.onTool`.

- [ ] **Step 5: Re-wire Nomos + Sphragis admission through the engine**

Keep `governed.ts` untouched. In the runtime (Task 8) every tool execution goes through `governToolCall`/`executeGovernedTool`, and the engine's `onTool` receives the already-admitted action id, so the graph cannot bypass the gate. Add `actionId?: string` to `EngineInput`'s tool outcome plumbing via `ToolOutcome` so the engine can pass the Nomos action id back for `recordOutcome`.

- [ ] **Step 6: Run the engine tests**

```bash
cd /d/selfimpulse/source && npx vitest run src/main/agent/engine.test.ts src/main/agent/engine.review.test.ts src/main/agent/governed.test.ts
```
Expected: PASS.

- [ ] **Step 7: Commit (if approved)** `feat(agent): one graph engine that keeps the Nomos gate and reviewer boundary`

---

### Task 8: One runtime: durable identities, governance, Nomos, Sphragis, and working steering

**Files:**
- Modify: `src/main/agent/runtime.ts` (hand-merged from MOON's version, ~1425 lines, plus TARGET's Nomos/Sphragis blocks)
- Modify: `src/main/services/subagents.ts` (MOON's stable Crew identity + TARGET's fail-closed seat registration)
- Test: TARGET `src/main/agent/runtime.test.ts` extended

**Interfaces:**
- Produces: `agentRuntime.sendMessage/steer/stop/resume` with durable run ids `captain:${taskId}:${messageId}`, `crew:${run.id}`, journal dir from `paths.durable`, `durableRunId` passed to `createToolContext`.
- Consumes: `governanceService`, `runtimeAudit`, `nomosGate`, `receiptService`, `authorizeNativeTaskTool`.

- [ ] **Step 1: Port MOON's runtime, then re-insert the TARGET enterprise blocks**

Adopt MOON's `runtime.ts` structure (durable context per run, `protectModelMessages` hook, `protectToolArguments` before approval, Crew parallel delegations, startup recovery, serialized task commits). Then re-add, at exactly their semantic points, TARGET's `nomosGate()` calls: `registerCrewSeat` + `recordOutcome(...'denied')` + `recordApproval(actionId,'human')` + kill-switch check before execute, and `receiptService` minting for `requiresReceipt(tool)` after a successful action with `digestOfValue(args)` and `digestOfValue(content)`.

- [ ] **Step 2: Order the gates as one decision chain**

Inside `executeToolCall`, the boundary order must be: role policy (`governanceService.authorize`) → native control plane (`authorizeNativeTaskTool`) → Nomos capability + kill switch (`governToolCall`) → schema validation → DLP (`protectToolArguments`) → approval → `executeGovernedTool` → `recordOutcome` → receipt mint → `runtimeAudit` tool events. Write that order into the file as a comment block once, and enforce it with the test in Step 3.

- [ ] **Step 3: Write the failing gate-order test on TARGET's existing harness**

`src/main/agent/runtime.test.ts` already mocks the seams (`h.gate`, `h.governToolCall`, `h.approvals`, `h.store.saveTask`) and reaches the private path through a `RuntimeInternals` interface plus `makeTask()`, `makeRun()`, `makeContext()`, and a `writeTool` fixture. Reuse exactly those; the only change is that MOON's `executeToolCall` takes a 7th `durable` argument, so widen the `RuntimeInternals.executeToolCall` declaration in that file and pass the test's durable stub. Append:
```ts
describe('role policy before execution', () => {
  it('denies a Viewer task before the tool runs, before approval, and mints no receipt', async () => {
    h.governance.authorize.mockReturnValue({ allowed: false, reason: 'the viewer role cannot execute', capability: 'execute' })
    h.governance.protectToolArguments.mockImplementation((_t, _a, tool, args) => ({ args, findings: [], total: 0 }))
    const task = { ...makeTask(), agentRole: 'viewer', permissionMode: 'skip' } as Task
    const executeTool = { ...writeTool, name: 'run_command', sideEffect: 'execute', risk: 'high', approval: 'never' } as unknown as AgentTool

    const result = await internals.executeToolCall(
      task,
      new Map([['run_command', executeTool]]),
      { id: 'call-9', name: 'run_command', arguments: { command: 'whoami' } },
      makeRun(),
      makeContext(task),
      'msg-9',
      durableStub
    )

    expect(result.isError).toBe(true)
    expect(executeTool.execute).not.toHaveBeenCalled()
    expect(h.approvals.request).not.toHaveBeenCalled()
    expect(h.gate.governToolCall).not.toHaveBeenCalled()
    expect(h.receipts.recordResult).not.toHaveBeenCalled()
    expect(h.runtimeAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'policy.check', outcome: 'denied', target: 'run_command' })
    )
  })
})
```
Add `h.governance`, `h.receipts`, `h.runtimeAudit`, and `durableStub` to the existing `vi.hoisted` mock block in that file; `durableStub` is the same `{ hasCompleted: () => false, run: (_id, fn) => fn(), … }` shape the donor's `engine.test.ts` already uses.

- [ ] **Step 4: Fix steering so it actually interrupts the live turn**

Read `active.pendingSteer` inside the engine's `prepare` node: when set, append `task.messages` since the last consumed index into `state.messages` as user messages, clear the flag, and emit `agent:steered`. Add a test asserting a steer injected mid-run appears in the next model call's messages.

- [ ] **Step 5: Crew seat hygiene**

Keep TARGET's fail-closed seat registration (registration failure ⇒ Crew refuses), refcount, and `revoke + forget` on run end, and MOON's durable Crew ids. Crew must receive `governanceService.permittedTools` ∩ its no-prompt set ∩ `allowedToolNames`.

- [ ] **Step 6: Run the runtime + subagent suites**

```bash
cd /d/selfimpulse/source && npx vitest run src/main/agent src/main/services/subagents
```
Expected: PASS, including the pre-existing `runtime.test.ts` gate tests.

- [ ] **Step 7: Commit (if approved)** `feat(agent): merged Captain/Crew runtime with steering, RBAC, DLP, Nomos and receipts`

---

### Task 9: Mission layer — RSIRALS that really persists

**Files:**
- Copy: `MOON/src/main/selfimpulse/mission/{rsiralsIpc,rsiralsPolicy,rsiralsSnapshot,enterpriseAdmission}.ts` (+ tests), `MOON/src/shared/rsirals.ts`
- Modify: TARGET `src/main/selfimpulse/mission/{lessons,belief,learningReceipt,selfImprove,skillEvolution,selfEvolveRuntime,agentTeam,autonomyStore,capability,knowledgeSkills,missionLoop,egress,licensing}.ts`, `src/main/selfimpulse/mission/durable.ts`

**Interfaces:**
- Produces: from `src/main/selfimpulse/mission/kvStore.ts` — `interface MissionKv { getItem(k): string | null; setItem(k, v): void; removeItem(k): void }`, `class FileKvStore implements MissionKv`, `installMissionKv(kv: MissionKv | undefined): void`, `getMissionKv(): MissionKv | undefined`; `RSIRALS_IPC.snapshot → RsiralsSnapshot` built from the same KV.

- [ ] **Step 1: Write the failing inert-persistence test**

Real `Lesson` shape (`src/main/selfimpulse/mission/lessons.ts`): `{ id, kind: 'failure' | 'success' | 'environment', text, sourceMissionId, evidence: string[], strength, createdAt: number, lastUsedAt: number, useCount, causal? }`.

Create `src/main/selfimpulse/mission/lessons.persistence.test.ts`:
```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileKvStore, installMissionKv } from './kvStore'
import { loadLessons, saveLessons, type Lesson } from './lessons'

let dir = ''
let file = ''
function lesson(id: string): Lesson {
  return {
    id,
    kind: 'failure',
    text: 'the folder was outside the workspace',
    sourceMissionId: 'm1',
    evidence: ['step-1 denied'],
    strength: 0.8,
    createdAt: 1_760_000_000_000,
    lastUsedAt: 0,
    useCount: 0
  }
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mission-kv-'))
  file = join(dir, 'mission-kv.json')
  installMissionKv(new FileKvStore(file))
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('mission learning persistence', () => {
  it('reports the failure instead of silently dropping a lesson when no kv is installed', () => {
    installMissionKv(undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    saveLessons([lesson('l1')])
    expect(loadLessons()).toEqual([])
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/mission storage unavailable/i))
    error.mockRestore()
  })

  it('round-trips lessons through the profile file', () => {
    saveLessons([lesson('l2')])
    installMissionKv(new FileKvStore(file))
    expect(loadLessons().map((item) => item.id)).toContain('l2')
  })
})
```

- [ ] **Step 2: Run it to watch it fail**

```bash
cd /d/selfimpulse/source && npx vitest run src/main/selfimpulse/mission/lessons.persistence.test.ts
```
Expected: FAIL — `installMissionKv`/`FileKvStore` do not exist; today `localStorage` is undefined in main and every write is swallowed by an empty `catch`.

- [ ] **Step 3: Implement a profile-backed KV**

Create `src/main/selfimpulse/mission/kvStore.ts`:
```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface MissionKv {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** One JSON map under the Electron profile, written synchronously and fsynced. */
export class FileKvStore implements MissionKv {
  constructor(private readonly file: string) { mkdirSync(dirname(file), { recursive: true }) }
  private read(): Record<string, string> {
    try { return JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, string> } catch { return {} }
  }
  private write(value: Record<string, string>): void {
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`
    // Synchronous on purpose: the getters must never observe a half-written map.
    writeFileSync(tmp, JSON.stringify(value), 'utf8')
    renameSync(tmp, this.file)
  }
  getItem(key: string): string | null { return this.read()[key] ?? null }
  setItem(key: string, value: string): void { const all = this.read(); all[key] = value; this.write(all) }
  removeItem(key: string): void { const all = this.read(); delete all[key]; this.write(all) }
}

let installed: MissionKv | undefined
export function installMissionKv(kv: MissionKv | undefined): void { installed = kv }
export function getMissionKv(): MissionKv | undefined { return installed }
```
Import `renameSync` and `writeFileSync` from `node:fs` at the top (no `require`, matching the file's ESM style). Synchronous writes keep `MissionKv` non-async for its ten call sites; the file is small (capped lesson/receipt lists) so an unsynced rename is acceptable here, and Task 3's fsynced `atomicWriteJson` remains the writer for journals, tasks and settings.

- [ ] **Step 4: Replace every bare `localStorage` in `src/main`**

```bash
cd /d/selfimpulse/source && grep -rln "localStorage" src/main | grep -v test
```
For each listed file: import `getMissionKv()` and use it; `installMissionKv` throws no more than it logs; when no KV is installed the setter must `console.error('mission storage unavailable: …')` instead of an empty `catch`. Delete the `globalThis.localStorage?.` usages in `selfimpulse/engine/missionAuthority.ts` and `vault.ts` the same way.

- [ ] **Step 5: Wire installation at startup**

In `src/main/index.ts`, before the mission/agent runtime starts: `installMissionKv(new FileKvStore(join(getPaths().root, 'mission', 'kv.json')))`.

- [ ] **Step 6: Merge the RSIRALS modules**

Copy `rsiralsPolicy.ts` + test, `rsiralsSnapshot.ts`, `rsiralsIpc.ts`, `shared/rsirals.ts`; adopt MOON's `lessons.ts`, `learningReceipt.ts`, `selfEvolveRuntime.ts`, `selfImprove.ts`, `runGraph.ts`, `graphCheckpointer.ts`, `teamExecutor.ts` **but keep TARGET's durable/Aion semantics** where they differ — resolve each of those 7 files by reading both versions and porting only the RSIRALS-specific hunks (record-level utility credit, lesson briefing, strategy selection, snapshot). Re-point `runGraph.ts`/`graphCheckpointer.ts` at the Task-1 runtime root. Register `registerRsiralsIpc()` in the IPC index.

- [ ] **Step 7: Prove persistence with the real modules and remove the stub**

Delete the `vi.stubGlobal('localStorage', …)` line from `selfEvolveRuntime.test.ts` and replace it with `installMissionKv(new FileKvStore(join(dir, 'kv.json')))`; run:
```bash
cd /d/selfimpulse/source && npx vitest run src/main/selfimpulse/mission
```
Expected: all mission tests PASS with no `localStorage` stub anywhere (`grep -rn "stubGlobal('localStorage'" src` returns nothing).

- [ ] **Step 8: Commit (if approved)** `fix(mission): profile-backed learning state and rsirals snapshot`

---

### Task 10: Channel access control (fixes a flaw both trees share)

**Files:**
- Create: `src/main/services/channelPolicy.ts`, `src/main/services/channelPolicy.test.ts`
- Modify: `src/main/services/channels.ts` (`pollTelegram` call gate at :339, webhook gate at :188, `deliver` task creation at :222-240, `sendTelegram` egress scan at :376)
- Modify: `src/shared/governance.ts` (add `ChannelPolicy`), `src/main/store.ts` (default + normalization)
- Modify: `src/renderer/src/views/settings/EnterprisePane.tsx` (allowlist editor)

**Interfaces:**
- Produces: `GovernanceSettings.channels: { telegramAllowedChatIds: number[]; webhookAllowedSenders: string[]; channelRole: AgentRole; requireApprovalForChannels: boolean; scanOutbound: boolean }`; `admitsSender(channels: ChannelPolicy, kind: 'telegram' | 'webhook', senderId: string): boolean`; `channelTaskOverrides(channels: ChannelPolicy, settings: Pick<PublicSettings, 'defaultPermissionMode'>): { agentRole: AgentRole; permissionMode: PermissionMode }`; `scanChannelReply(text: string, dlp: DlpSettings): { text: string; redactions: number }`; `assertPublicHttpTarget(url: string, resolver: (host: string) => Promise<{ address: string }[]>): Promise<void>`.

- [ ] **Step 1: Write the failing stranger test**

`ChannelService` keeps its private methods private, so the policy is a pure module and the call sites only consume it:
```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_GOVERNANCE } from '@shared/governance'
import { admitsSender, channelTaskOverrides } from './channelPolicy'

describe('channel admission', () => {
  it('ignores a telegram message from a chat that was never granted', () => {
    const channels = { ...DEFAULT_GOVERNANCE.channels, telegramAllowedChatIds: [42] }
    expect(admitsSender(channels, 'telegram', '7')).toBe(false)
    expect(admitsSender(channels, 'telegram', '42')).toBe(true)
  })

  it('refuses every sender while the allowlist is empty', () => {
    expect(admitsSender(DEFAULT_GOVERNANCE.channels, 'telegram', '42')).toBe(false)
    expect(admitsSender(DEFAULT_GOVERNANCE.channels, 'webhook', 'secret-sender')).toBe(false)
  })

  it('gives channel-created tasks the channel role and forces manual approval', () => {
    const overrides = channelTaskOverrides(DEFAULT_GOVERNANCE.channels, {
      defaultPermissionMode: 'skip'
    })
    expect(overrides.agentRole).toBe('viewer')
    expect(overrides.permissionMode).toBe('manual')
  })
})
```

- [ ] **Step 2: Run to watch it fail**

```bash
cd /d/selfimpulse/source && npx vitest run src/main/services/channelPolicy.test.ts
```
Expected: FAIL — `channelPolicy.ts` does not exist, and today [channels.ts:339](file:///D:/selfimpulse/source/src/main/services/channels.ts#L339) only skips bot senders.

- [ ] **Step 3: Implement admission before any task exists**

In the Telegram poller and webhook delivery, resolve the sender (`chat.id`, webhook sender id) and require an explicit allowlist entry; when the list is empty, reject with `runtimeAudit` `channel.rejected` and a reply telling the owner which chat id to grant. Channel-created tasks must use `governance.channelRole` (default `viewer`) instead of `defaultRole`, and `requireApprovalForChannels` forces `permissionMode: 'manual'` regardless of the global default.

- [ ] **Step 4: Scan outbound replies**

Before `sendTelegram`, run `governanceService.protectData`-style egress inspection over the reply text with the audit categories so a reply containing an API key is redacted rather than shipped, and log `dlp.channel` when it happens.

- [ ] **Step 4b: Close the shared SSRF gap while touching egress**

Both trees gate `agent/tools/web.ts` on the hostname string only, so `127.0.0.1.nip.io` or `localtest.me` reach loopback. Add to `channelPolicy.ts` (same pure module, same test file) `assertPublicHttpTarget(url: string, resolver: (host: string) => Promise<string[]>): Promise<void>` that resolves the host through `dns.promises.lookup(host, { all: true })` and rejects any answer in `127.0.0.0/8`, `::1`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `0.0.0.0`, or a `file:`/credentials-bearing URL, and call it in `web.ts` before the fetch. Test:
```ts
  it('refuses a public hostname that resolves to loopback', async () => {
    await expect(assertPublicHttpTarget('http://127.0.0.1.nip.io/admin', async () => [{ address: '127.0.0.1' }]))
      .rejects.toThrow(/private|loopback/i)
  })
```
Rebind-check races (DNS answers changing between check and fetch) are documented in `docs/merged-agent.md` as a known limit; the tool still requires approval for network side effects.

- [ ] **Step 5: Add the UI**

In `EnterprisePane.tsx` add the channel allowlist editor (chat ids, sender ids, channel role, require-approval switch) bound to the existing settings save path.

- [ ] **Step 6: Run channel + governance suites, then commit (if approved)** `feat(channels): sender allowlist, role downgrades and egress scanning`

---

## Phase D — Renderer, themes, motion

### Task 11: Themes — 12 Atelier palettes and readable derived tokens

**Files:**
- Modify: `src/renderer/src/lib/themes.ts` (TARGET 456 lines → merged ~830), `src/renderer/src/styles.css`, `src/renderer/src/views/settings/ThemePanes.tsx`
- Test: TARGET `themes.test.ts` extended; copy MOON `themes.test.ts` additions

**Interfaces:**
- Produces: `THEMES` (34), `themeCollection(id) → 'solo' | 'teams'`, `ATELIER_THEME_IDS` (12), `applyTheme(id, animate)` with runtime token painting; `AA_RATIO = 4.5`, `AAA_BODY_RATIO = 7`, `AA_LARGE = 3` exported for tests.

- [ ] **Step 1: Write the failing contrast test**

`MOON/src/renderer/src/lib/themes.test.ts` already defines `luminance(hex)` and `contrast(a, b)` helpers (lines 100-110) — copy them with the donor's other test additions and add this case, which uses the real `tokens: Record<string, string>` shape with dashed keys (the theme id rides in the assertion message so a failure names the palette):
```ts
  it('keeps every derived faint and muted token readable on its canvas', () => {
    for (const theme of THEMES) {
      if (theme.exclusive) continue
      const canvas = theme.tokens['--c-canvas']
      expect(contrast(canvas, theme.tokens['--c-faint']), `${theme.id} faint`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(canvas, theme.tokens['--c-muted']), `${theme.id} muted`).toBeGreaterThanOrEqual(4.5)
    }
  })
```

- [ ] **Step 2: Run to watch it fail** — `npx vitest run src/renderer/src/lib/themes.test.ts`
Expected: FAIL for `afterimage` (2.64), `cinnabar-light` (2.77), `pulsidian` (3.30), `heliodor` (3.52), and the other light house/rare/distinct palettes whose faint is below AA.

- [ ] **Step 3: Derive readable faint/muted values**

Add `readable(candidate, canvas, minimum = 4.5)` that darkens/lightens the candidate's OKLCH lightness toward the canvas in 0.01 steps until the ratio clears the floor, and use it for `--c-faint` and `--c-muted` in every palette generator (`atelierPalette`, rare/distinct builders, and the hand-written light house themes). Keep canvas/surface/ink/signal source colors exactly as authored; the selected theme's own preview swatch must not depend on faint.

- [ ] **Step 4: Port the 12 Atelier themes and the Solo/Teams picker**

Copy MOON's `atelierTheme`, `ATELIER_SOURCES`, `themeCollection`, runtime `paint()` token application, and `ThemePanes.tsx` Solo/Teams tabs with Day/Night groups; keep TARGET's Rare Five, Moon pane, and `moonlight` default, and TARGET's `paneBits.tsx` shared bits.

- [ ] **Step 5: Verify CSS/token parity and run**

```bash
cd /d/selfimpulse/source && npx vitest run src/renderer/src/lib/themes.test.ts && npm run typecheck
```
Expected: PASS; every theme's mirrored CSS block (where present) equals the painted tokens.

- [ ] **Step 6: Commit (if approved)** `feat(themes): atelier collections with AA-readable derived tokens`

---

### Task 12: IPC, preload, and shared type merge

**Files:**
- Modify: `src/shared/types.ts`, `src/shared/ipc.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/main/paths.ts`
- Copy: `MOON/src/main/services/reactions.ts` + test

**Interfaces:**
- Produces: IPC channels `GOVERNANCE_IPC`, `ENTERPRISE_CONTROL_IPC`, `RSIRALS_IPC`, `AUDIT_IPC.{summary,events,export,verify}`, `IPC.taskReact`; preload additions on the existing `contextBridge.exposeInMainWorld('knight', api)` object (`src/preload/index.ts:201`) — `governance`, `enterpriseControl`, `rsirals`, `auditSummary`, `auditEvents`, `auditExport`, `auditVerify`, `reactToMessage`. Keep the `knight` key: every renderer call site already uses `window.knight.*`.
- Consumes: Tasks 4, 5, 6, 9, 10.

- [ ] **Step 1: Land the shared contracts** — merge MOON's `shared/types.ts` additions (`Task.agentRole`, `Task.reactions`, plan/step fields) into TARGET's file without touching TARGET's `Nomos`/`Sphragis`/`Aion` view types; merge `shared/ipc.ts` channel constants; merge `shared/audit.ts` runtime types.

- [ ] **Step 2: Register handlers behind the Task-6 trust seam**

Every new mutating or evidence-bearing handler starts with `assertTrustedMainFrame(event)` (from `src/main/ipcTrust.ts`) and pins its actor to `LOCAL_PRINCIPAL_ID`, exactly as `src/main/enterprise/ipc.ts` does for the kill switch and approvals. Cover: governance reads, `GOVERNANCE_IPC.inspect` (bounded 200 000 characters, allow-listed categories), audit `summary`/`events`/`export`/`verify`, enterprise `snapshot`/`mutate`/`authorize`/`revision`, RSIRALS `snapshot`, and `taskReact` (allow-listed emoji, whole-task JSON commit).

- [ ] **Step 3: Expose them in preload, typed, no generic invoke**

Add the matching methods to the existing `contextBridge` API object; do not expose `ipcRenderer` or a generic `invoke`.

- [ ] **Step 4: Startup wiring**

In `src/main/index.ts`: initialize `runtimeAudit`, `installMissionKv`, enterprise control plane, register the new IPC modules, add startup recovery for running/waiting tasks, and flush journals on `before-quit` (TARGET already flushes Sphragis/Aion; extend, don't duplicate).

- [ ] **Step 5: Fix the settings response shape bug both trees have**

`IPC.settingsSave` must return `{ ...store.getPublicSettings(), backend: getBackend().publicSettings() }`, identical to `settingsGet`, so the renderer never loses `settings.backend`. Add a test asserting both handlers return the same keys.

- [ ] **Step 6: Prove every renderer call resolves**

Create `src/preload/bridge.test.ts` (a source-level check, no Electron needed):
```ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) sources(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

describe('the trusted bridge', () => {
  it('defines every window.knight member the renderer touches', () => {
    const preload = readFileSync(join(ROOT, 'src/preload/index.ts'), 'utf8')
    const exposed = new Set(
      [...preload.matchAll(/^\s{2}([a-zA-Z][\w]*)(?:\??):/gm)].map((match) => match[1])
    )
    const missing = new Set<string>()
    for (const file of sources(join(ROOT, 'src/renderer/src'))) {
      for (const match of readFileSync(file, 'utf8').matchAll(/window\.knight\.([a-zA-Z]\w*)/g)) {
        if (!exposed.has(match[1])) missing.add(`${match[1]} (${file})`)
      }
    }
    expect([...missing]).toEqual([])
  })
})
```
Run `npx vitest run src/preload/bridge.test.ts` → PASS only when no renderer call targets a missing preload member.

- [ ] **Step 7: Commit (if approved)** `feat(ipc): governance, audit, enterprise and reaction surfaces on the trusted bridge`

---

### Task 13: Motion layer and the task panel, without inventing state

**Files:**
- Copy: `MOON/src/renderer/src/motion/**`, `MOON/src/renderer/src/components/task-panel/**`, `MOON/src/renderer/src/lib/{cron,taskOperations}.ts` (+ tests)
- Modify: TARGET `App.tsx`, `main.tsx`, `TitleBar.tsx`, `Composer.tsx`, `Steps.tsx`, `PlanCard.tsx`, `TaskPanel.tsx`, `TaskView.tsx`, `Home.tsx`, `SchedulesView.tsx`, `CaptainComposer.tsx`, `CaptainWelcome.tsx`, `styles.css`

**Interfaces:**
- Produces: `<MotionConfig reducedMotion="user">` at the root; `TaskOrb`, `MetalAction`, `GlimmBorder`, `ActiveWorkIsland`, `CaptainPresence`, `ReactionPicker`, `RolePicker`, `TimeScrubber`, `TaskDeck`; `cron.ts` time helpers.

- [ ] **Step 1: Copy the motion modules and wrap the app root** — add `MotionConfig` in `main.tsx`; keep TARGET's error boundaries and store providers.

- [ ] **Step 2: Wire every indicator to real state**

Orbs derive from `task.steps[].status` + the current tool name only; shimmer/flow only for `running`; `ActiveWorkIsland` opens only for real running/waiting tasks and Crew runs; `TaskDeck` shows real recent tasks with keyboard prev/next and **no autoplay**; `ReactionPicker` persists through `taskReact`; `RolePicker` writes `task.agentRole` and its descriptions must match the enforced capability profiles from `selfimpulse/governance/policy.ts`; `TimeScrubber` edits only fixed-time cron fields (wildcards/intervals are refused, not misrepresented).

- [ ] **Step 3: Keep TARGET's enterprise panes and add the donor's**

`SettingsView.tsx` + `settingsNav.ts`: retain `GovernancePane` (Nomos + kill switch with `killEngaged/killAt/killBy`), `MissionsPane` (Aion resume), `ReceiptsPane` (Sphragis), and add `EnterprisePane` (RBAC/DLP/channels), `EnterpriseControlPlane` (namespaces/roles/bindings/restrictions/revisions), `LearningPane` (RSIRALS), plus MOON's extended `AuditPane` with live integrity, search, export and verify. Fix the stale "Six palettes" copy and delete any unimported dead view.

- [ ] **Step 4: Accessibility and sandbox repairs**

`Modal` gets `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, an initial-focus target, a focus trap, and restore-on-close (used by the approval gate). The PDF iframe gets `sandbox="allow-scripts"` **plus** `srcdoc`/blob isolation from the app origin, matching the already-sandboxed HTML preview; both must refuse `knight-file:` navigation into privileged contexts. `NowPanel` honors `useReducedMotion()`; `CrewRunCard` recomputes expansion when a run's status changes; per-row `TaskOrb` is virtualized or limited to the visible slice, and all offscreen canvases pause.

- [ ] **Step 5: Split the panel refresh so one failure cannot blank it all**

`useTaskCapabilities.refresh` → `Promise.allSettled` with per-source error state; fix the polling effect so the interval does not rebuild on every `statuses` change.

- [ ] **Step 6: Run renderer tests and build**

```bash
cd /d/selfimpulse/source && npx vitest run src/renderer && npm run build 2>&1 | tail -15
```
Expected: renderer tests PASS; main, preload, and renderer bundles built.

- [ ] **Step 7: Manual UI gate (required, cannot be skipped)**

```bash
cd /d/selfimpulse/source && npm run dev
```
Walk: create a task → send → watch Orb/shimmer reflect real step states → approve a `run_command` → toggle an emergency stop in GovernancePane and confirm the persisted red card → switch 3 Atelier themes and check faint text readability → open ActiveWorkIsland → schedule edit via TimeScrubber → export + verify the audit log → RSIRALS pane shows lessons that survive an app restart. Record what was clicked and what was seen in the checkpoint file. If Electron cannot run on this machine, state that explicitly instead of claiming verification.

- [ ] **Step 8: Commit (if approved)** `feat(renderer): premium motion, task panel, and merged enterprise settings`

---

## Phase E — Ship gate

### Task 14: Full verification, packaging, and provenance

**Files:**
- Modify: `electron-builder.yml` (ship the notices), `THIRD-PARTY-NOTICES.md`, `src/main/selfimpulse/**/PROVENANCE.json`, `LICENSES/`
- Create: `docs/merged-agent.md`

**Interfaces:**
- Produces: `release/SelfImpulse-Setup-0.3.0.exe` with an Authenticode-checkable build and bundled attribution.

- [ ] **Step 1: Green gate, in order**

```bash
cd /d/selfimpulse/source && npm run typecheck && npx vitest run src/main/security-sinks.test.ts && npm test
```
Expected: typecheck clean; sink guard PASS; **0 failed tests** (TARGET runs the Electron-bound suites that Moonith's sandbox could not, so no exclusion list is acceptable here).

- [ ] **Step 2: Prove the four security fixes survived**

```bash
cd /d/selfimpulse/source && grep -rn "'cmd', \['/c', 'start'" src/main | head; grep -rn "shell: process.platform" src/main | head; grep -rn "{ plain: value }" src/main/backend/security.ts | head; grep -n "connect-src" src/renderer/index.html
```
Expected: the first three print nothing; the CSP line is TARGET's narrowed `connect-src 'self' knight-file:`.

- [ ] **Step 3: Ship attribution in the installer**

`electron-builder.yml` `files` currently strips `node_modules/**/{LICENSE,LICENCE,NOTICE}*` and includes only `out/**` + `package.json`. Keep the strip (it is about transitive noise) but add real attribution:
```yaml
extraResources:
  - from: THIRD-PARTY-NOTICES.md
    to: THIRD-PARTY-NOTICES.md
  - from: LICENSES
    to: LICENSES
  - from: src/main/selfimpulse/roi/licenses
    to: licenses
```
Adjust the second/third entries for Task 1's chosen runtime root, and list every vendored/derived module (graph runtime, workflow Apache-2.0, durable MIT, glimm, metal-fx, thinking-orbs) with its copyright line.

- [ ] **Step 4: Branding and provenance audit**

```bash
cd /d/selfimpulse/source && grep -rniE "langchain|langgraph|mastra|restate|clawhub" src/main src/renderer --include='*.ts' --include='*.tsx' | grep -v PROVENANCE | grep -v test | head -20
```
Expected: no upstream whole-word names in shipped runtime code (attribution files excepted).

- [ ] **Step 5: Build and inspect the package**

```bash
cd /d/selfimpulse/source && npm run dist:win 2>&1 | tail -8 && npx asar list release/win-unpacked/resources/app.asar | grep -ciE "THIRD-PARTY|LICENSE" ; powershell -NoProfile -Command "Get-AuthenticodeSignature .\release\SelfImpulse-Setup-0.3.0.exe | Select-Object -ExpandProperty Status"
```
Expected: installer produced; attribution present in resources; signature `NotSigned` is acceptable **only** if the user has no certificate — record it, do not claim a signed build.

- [ ] **Step 6: Write `docs/merged-agent.md`** — one architecture page: single graph engine + core policies, gate order (role → control plane → Nomos → schema → DLP → approval → execute → outcome → receipt → evidence), durable/workflow boundaries, RSIRALS storage, channels policy, theme collections, and the verification numbers actually observed.

- [ ] **Step 7: Report to the user, then ask before installing**

Installation into `D:\selfimpulse\app` requires admin (`update-selfimpulse.cmd`) and replaces the running binary. Do not run it without approval. Also remind the user that the live profile still contains the plaintext `gho_…` GitHub token that should be revoked.

- [ ] **Step 8: Commit (if approved)** `chore(release): merged 0.3.0 build with attribution`

---

## Open risks to carry into execution

1. **Task 8 is the risky one.** MOON's `runtime.ts` and TARGET's diverge by ~818 lines; the merge must not silently drop a Nomos or Sphragis call. Mitigation: after Step 1, run `grep -n "nomosGate()\|receiptService\|requiresReceipt" src/main/agent/runtime.ts` and compare the call-site census against TARGET's pre-merge list before writing tests.
2. **Mission files differ on both sides** (`runGraph`, `graphCheckpointer`, `teamExecutor`, `selfEvolveRuntime`, `selfImprove`, `lessons`, `learningReceipt`). Do not bulk-copy; port RSIRALS-specific hunks only, and let TARGET's Aion reconciliation tests decide.
3. **Renderer has 3 hand-merged large files** (`styles.css` 478 changed lines, `themes.ts` 379, `TaskPanel.tsx` 325 where MOON's is *smaller*). Expect conflicts; `TaskPanel.tsx` must keep TARGET's panel plus MOON's `task-panel/` split, not the donor's reduced version.
4. **The `vendor/graphruntime` vs `roi` decision (Task 1)** changes import paths in three donor files and two TARGET files. Make it first; re-running it later means re-editing every engine import.
5. **Web/visual verification is only real in Step 7 of Task 13 and Step 1 of Task 14** — until those are done, this build is code-verified, not product-verified.

---

## Phase F — cross-tree security findings (added after the crew-mesh audit)

These three defects exist in the **trunk** and were independently confirmed in the donor tree. They are base-independent: they ship whether or not Phase B/C land. Tasks 21-23 may run in parallel with Phase B because they touch disjoint files (`backend/**`, `agent/tools/browser.ts` + `services/browser.ts`, `main/index.ts` protocol handler).

### Task 21: Permission-gate the backend integration tools (default deny for unlisted names)

**Files:**
- Modify: `src/main/backend/index.ts:120-125` (`DEFAULT_PERMISSIONS`), `src/main/backend/tools.ts:277-287` (`allowed()`), `src/main/backend/runner.ts:381-399`
- Test: `src/main/backend/runner.gate.test.ts` (create)

**Interfaces:**
- Produces: `ToolRuntime.allowed(name: string): Promise<boolean>` extended with prefix rules so `mcp_*`, `connectors_*`, `computer_*`, and `grounded_actions` are `ask` (and unanswered `ask` already returns false at `tools.ts:283-285`); `runner.ts` must consult it before dispatch.

- [ ] **Step 1: Write the failing bypass test**

```ts
  it('refuses an mcp tool when no permission rule was ever set for it', async () => {
    const invoked: string[] = []
    const runtime = makeRunner({ mcpTool: (name) => { invoked.push(name); return { ok: true } } })
    const result = await runtime.dispatch('mcp_filesystem_read_file', {})
    expect(invoked).toEqual([])
    expect(String(result.error ?? '')).toMatch(/permission|blocked/i)
  })
```

- [ ] **Step 2: Run it, watch it pass or fail honestly** — `npx vitest run src/main/backend/runner.gate.test.ts`. Today the trunk's `allowed()` returns `true` for anything unlisted (`this.permissions[name] ?? 'allow'`), and `runner.ts` never calls `allowed()` on the four integration branches, so this MUST fail. If it passes, the dispatch path is already gated and the finding is stale — record the proof and stop.

- [ ] **Step 3: Add prefix rules and route the dispatch through the gate**

In `backend/tools.ts`, give `allowed()` an explicit default-deny for the integration surface instead of a blanket `'allow'`:
```ts
const DEFAULT_DENY_PREFIXES = ['mcp_', 'connectors_', 'computer_']
const DEFAULT_DENY_NAMES = new Set(['grounded_actions'])
```
Resolve `this.permissions[name]` first; if absent, and the name matches a deny prefix or deny name, return `false` unless an explicit rule says otherwise. In `backend/index.ts`'s `DEFAULT_PERMISSIONS` add `grounded_actions: 'ask'`, `computer_screenshot: 'ask'`, `connectors_invoke: 'ask'`, `mcp_invoke: 'ask'` (matching the names actually used) so a user can grant them deliberately. In `backend/runner.ts`, before each of the four branches at `:381-399`, call the same gate and return `{ ok: false, error: 'Tool "<name>" is blocked by the permission rules.' }` plus an audit event when denied.

- [ ] **Step 4: Prove it and prove the audit**

`npx vitest run src/main/backend` → all green, including a second assertion that a denied integration call records a `denied` outcome.

### Task 22: Egress guard for the browser tools (shared with web.ts)

**Files:**
- Modify: `src/main/services/browser.ts` (`open`), `src/main/agent/tools/browser.ts:20-38,142-160`, `src/main/agent/tools/web.ts:97-125`
- Consume: `assertPublicHttpTarget` from `src/main/services/channelPolicy.ts` (Task 10) — do NOT create a second guard

- [ ] **Step 1: Failing SSRF tests through the real tool**

```ts
  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1:8080/admin',
    'http://[::1]:6379/',
    'http://127.0.0.1.nip.io/'
  ])('refuses %s through browser_open', async (url) => {
    const result = await browserOpenTool.execute({ url }, makeToolContext())
    expect(result.isError).toBe(true)
    expect(result.content).toMatch(/blocked|private|loopback/i)
  })
```
The `.nip.io` case requires the injected resolver; default `resolver = dns.promises.lookup` and allow the tool context to carry a test resolver so the test is deterministic offline.

- [ ] **Step 2: Run to watch it fail** — `npx vitest run src/main/agent/tools/browser.test.ts`
Expected FAIL: `browser_open` has `approval: 'never'` and `services/browser.ts` has no host check at all.

- [ ] **Step 3: Guard once, at the boundary that matters**

Call `assertPublicHttpTarget(url, resolver)` inside `browserService.open()` (not only inside the tool) so `browser_extract`, the panel's manual navigation, and any future caller are covered by construction. Resolve the host and re-check after redirect when the fetch path follows redirects. Keep the existing hostname check as defence in depth rather than replacing it.

- [ ] **Step 4: Re-run both suites** — browser + `agent/tools/web.test.ts` → green.

### Task 23: Harden the `knight-file:` privileged scheme

**Files:**
- Modify: `src/main/index.ts:49-60` (scheme privileges), `:177-201` (`registerFileProtocol`)
- Test: `src/main/protocol.test.ts` (create)

- [ ] **Step 1: Failing tests**

```ts
  it('refuses a symlink inside the task workspace that escapes it', async () => {
    const outside = join(secretsDir, 'id_rsa')
    symlinkSync(outside, join(workspace, 'link'))
    const response = await handler('knight-file://task-1/link')
    expect(response.status).toBe(403)
  })

  it('does not advertise a wildcard CORS origin on a privileged scheme', async () => {
    const response = await handler('knight-file://task-1/a.txt')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
```

- [ ] **Step 2: Run to watch it fail** — `npx vitest run src/main/protocol.test.ts`. Today `isWithin(workspace, target)` compares unresolved paths, so a symlink inside the workspace passes, and the handler sets `access-control-allow-origin: '*'` on a `corsEnabled` scheme.

- [ ] **Step 3: Resolve before containment, and stop widening the origin**

`const real = await fs.realpath(target)` and `const realRoot = await fs.realpath(workspace)`, then `isWithin(realRoot, real)`; 403 on failure. Remove `corsEnabled: true` from the scheme privileges and drop the `access-control-allow-origin: '*'` header, keeping `x-content-type-options: nosniff` and `cache-control: no-store`. If the renderer needs cross-document access to artifacts, grant it by pinning the origin to the app's own `knight-file:` origin rather than `*`, and state which you chose in the report.

- [ ] **Step 4: Prove artifact preview still works** — the HTML/PDF preview paths in `components/Artifacts.tsx` must still load; assert with a unit check on the response status for a normal in-workspace file, and record the manual preview check for Task 13's UI walkthrough.

---

## Addendum A — donor re-pointing (controller ruling, 2026-10-25)

**Ruling: `MOON` now means** `C:\Users\HARSHEN\Documents\Qoder\2026-10-24\5a3181d1\crewmesh-audit\extracted\moonith-0.3.0-impulse-runtime-crew-mesh`. The `premium-agent-workspace` tree stays as historical reference only. Evidence: `ipc.ts` and `preload/index.ts` are byte-identical between the two donors, the rest differ by 2-227 lines, and the newer tree contains tested implementations of repairs Tasks 3/9/10/11 would otherwise author. The **trunk remains the base** — the newer donor still has no `nomos/`, `sphragis/`, `aion/`, `enterprise/`, `agent/governed.ts`, and its `grounded.ts` launch path is weaker than the trunk's `SHELL_SCRIPT`/`isRunnable` refusal.

### Per-task adjustments that override the task text above

| Task | Adjustment | Why (auditor evidence) |
| --- | --- | --- |
| 3 | Port `MOON/src/main/atomic.ts` + `atomic.test.ts` and make `src/main/util.ts:atomicWriteJson` delegate to it instead of hand-rolling fsync/retry. Keep Task 3's 64-writer Windows test. | `atomic.ts` already does per-file serialization + fsync + `EPERM/EACCES/EBUSY` retry and its concurrency test passes; it is **not** read-modify-write serialized, so Task 3's settings-write serialization still applies. |
| 3 | Keep the cancel/resume race test; the *donor engine* race is already fixed (`engine.ts` cancel-during-await), the **workflow** replay keys are still positional (`workflow.ts:484-486`). | Runtime auditor H-3. |
| 4 | Unchanged: the DLP gaps this task must close are still live in the new donor — numeric card values never scanned (`dlp.ts:255-290`), cycles passed unexamined in `block` mode (`:265,278`), `__proto__` key re-pointing the copy's prototype (`:281-284`, reproduced by the auditor). | **Drop the ReDoS item** — the auditor measured 0 ms on pathological input and the separator class is disjoint from `\d`; a timing test here would assert nothing. |
| 4 | Port instead of author: `delegate_to_crew` capability requirement (`policy.ts:60-63`) and role stamped at creation (`store.ts:492-495`). | Both prior gaps are closed in the new donor at the creation boundary. |
| 5 | Unchanged, and now known to be necessary: donor ledger is still HMAC-**symmetric** (`chain.ts:84-86`), `append()` still never re-reads (`runtimeLedger.ts:213-214`), `record()` returns `false` and `governance.ts:139` discards it, and there is **no size cap or rotation anywhere** (entries are held in RAM and copied per append). The anchor is constant-size, so the earlier O(n²) concern is corrected to "memory growth", not rewrite cost. | Security + enterprise auditors. |
| 6 | Port the donor's **improvements** (HMAC-signed revision chain, signed head, fsynced atomic persistence) then apply this task's upgrade to an Ed25519 identity; still required: sender check on `mutate`/`authorize` (`ipc.ts:12-17`) and bounding `ensureAgentPrincipal`, which runs before **every** tool call and appends a full state snapshot per seat (`service.ts:539-589`). | Enterprise auditor: two prior defects fixed, two remain. |
| 7 | Port donor `engine.ts` (713 lines) — it already fixes the background-review escape (`engine.ts:374`, proven by `engine.test.ts:270`), cancellation reaching graph + stream, usage reducer, and budget-vs-final distinction. Add the one permanent mission-load assertion Task 1 deferred. | Runtime auditor Q6/Q4. |
| 8 | **Do not port the donor's steering implementation.** Task 8 Step 4 stays as authored (we consume `pendingSteer`), and must additionally guarantee transcript pairing: a steered user row must never land between an assistant `tool_calls` row and its tool results. New Criticals if ported: C-1 (interleaving rejects every later turn on that task; neither `prepareReplay` nor `reconcileToolResults` repairs it), C-2 (provider failure + pending steer → `restore()` + `finally` relaunch clears `task.error` and re-executes side effects under a new journal key), H-1 (a steer landing during the `await` at `runtime.ts:319` is drained, committed, and never sent to any model — silent permanent message loss). Also add **H-4**: `ToolContext` carries no `signal`, so Stop does not interrupt an in-flight tool — worse ×3 with Crew. | Runtime auditor, with `file:line`. |
| 9 | Port `MOON/src/main/selfimpulse/persist/nodeStorage.ts` + `mainStorage.ts` (wired at `index.ts:44`) and `mission/mainPersistence.test.ts` + `nativeDurable.test.ts` instead of authoring `kvStore.ts`. **New requirement:** the auditor found nothing outside `mission/` imports the learning graph, so the RSIRALS pane reads correct-but-permanently-empty stores — this task must prove a non-empty round trip from the actual UI entry point, or state that the pane is inert. | Enterprise auditor RSIRALS verdict + caveat. |
| 10 | Port `MOON/src/main/services/channelPolicy.ts` + its test (Telegram/webhook allowlist, channel role, outbound DLP — channel replies now cross DLP) instead of authoring it. Then extend the same `assertPublicHttpTarget` to the browser tools per **Task 22**. | Enterprise + security auditors. |
| 11 | Port `MOON/src/renderer/src/lib/themes.ts` + `themes.test.ts`: contrast is re-derived (blend 0.42→0.84) and **gated by a committed test** (`themes.test.ts:166` asserts `--c-muted`/`--c-faint` ≥ 4.5 across themes; 12/12 pass). Keep this task's `readable()` helper only as the mechanism if the ported derivation still fails any trunk-only theme. | Renderer auditor + controller cross-check. |
| 13 | Port donor `components/ui.tsx` Modal (focus trap, `role="dialog"`, `aria-modal`, initial focus, restore) and `Artifacts.tsx` PDF `sandbox=""`; keep trunk's `TaskPanel.tsx` + the donor's `task-panel/` split. Carry the auditor's Minor list: collapsed faint/muted visual hierarchy, dead bridge methods, MCP-poll interval rebuild, `[data-autofocus]` set nowhere while ApprovalDialog autofocuses **Allow**, single 2.73 MB chunk, per-row orb canvases. | Renderer auditor. |
| 14 | Adopt the donor's `electron-builder.yml` pattern (`extraResources` shipping nine upstream licence texts, `node_modules` LICENSE pruning removed) and add **Task 24** below. | Enterprise auditor licensing section. |
| Global | `__SI_BUILT__` build timestamp makes builds non-reproducible; pin or document it at Task 14. | Renderer auditor. |

### Task 24: Resolve the licensing blockers before any redistribution

**Files:** `THIRD-PARTY-NOTICES.md`, `src/main/selfimpulse/**/PROVENANCE.json`, `LICENSES/`

- [ ] **Step 1:** The audit found ports of **Seamoon** and **Knight Cowork** shipped with "licence not stated". Locate each (`grep -rn "Seamoon\|Knight Cowork" src docs THIRD-PARTY-NOTICES.md`), determine the upstream licence or authorisation in writing, and either ship its notice text or remove the ported code. **Until one of those is done, this build must not be redistributed** — that is a blocker, not a polish item.
- [ ] **Step 2:** `roi/PROVENANCE.json` is accurate on the big three but ~11 embedded copies (fast-json-patch, js-sha256, sax-js, uuid, zod-to-json-schema, XXH3, …) carry **no licence text at all**. Add each licence file and a provenance line, or prove the copy was removed.
- [ ] **Step 3:** Verify inside the built asar, not just the source tree: `npx asar list release/win-unpacked/resources/app.asar | grep -icE "LICENSE|NOTICE"` and confirm every entry named in `THIRD-PARTY-NOTICES.md` is present.
