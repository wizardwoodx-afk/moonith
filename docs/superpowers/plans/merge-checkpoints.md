# Merge checkpoints — SelfImpulse × Moonith

Plan: `docs/superpowers/plans/2026-10-25-selfimpulse-moonith-merge.md`

This file is the rollback ledger for the 15-task merge. Each task appends its checkpoint
here. Nothing in the merge may be reverted by guessing — use the shas below.

---

## Task 0 — snapshot the uncommitted verified work

Captured on 2026-10-25 at 01:32 local (IST, UTC+05:30) = 2026-10-24 20:02 UTC,
before any merge work touched the tree.

- Branch at capture: `feat/selfimpulse-engine`
- BASE / restorable baseline (pre-commit `git rev-parse HEAD`):
  `0d1f91a7c08a0ac85213574444338e8769e85a10`
  (`0d1f91a feat(identity): give the build a signature and a provenance stamp`)
- Merge branch created from that state: `feat/merged-agent`
- Outside-git backup zip: `D:\selfimpulse\backup\source-premerge-20261025013227.zip`
  - 2,064,477 bytes compressed; 919 entries; 6,316,107 bytes uncompressed
  - covers `source\src`, `source\package.json`, `source\package-lock.json`,
    `source\electron.vite.config.ts`, `source\tsconfig*.json`
  - does NOT cover `docs/` or `THIRD-PARTY-NOTICES.md`; those are protected by the
    baseline commit only
  - stamp is local time, not UTC: produced verbatim by the brief's command, which uses
    `Get-Date` (local) while its Files line says `<UTC-stamp>`
- Git protection: everything listed below is committed on `feat/merged-agent`, so the
  merge is revertible with `git checkout feat/selfimpulse-engine` or
  `git reset --hard 0d1f91a7c08a0ac85213574444338e8769e85a10` (the latter discards the
  baseline commit — only do it deliberately).

### Dirty-file list at capture

`git status --porcelain` — 36 entries (17 tracked-modified, 19 untracked, of which 4 are
whole directories). Nothing was staged in the index at capture.

```text
 M THIRD-PARTY-NOTICES.md
 M electron.vite.config.ts
 M package-lock.json
 M src/main/agent/runtime.ts
 M src/main/agent/tools/studio.test.ts
 M src/main/agent/tools/studio.ts
 M src/main/backend/external-agent.ts
 M src/main/backend/grounded.ts
 M src/main/backend/marketplace.ts
 M src/main/backend/security.ts
 M src/main/index.ts
 M src/main/ipc.ts
 M src/main/store.ts
 M src/preload/index.ts
 M src/renderer/index.html
 M src/renderer/src/views/settings/AuditPane.tsx
 M src/shared/types.ts
?? docs/enterprise-layers.md
?? docs/superpowers/plans/2026-10-25-selfimpulse-moonith-merge.md
?? src/main/agent/governed.test.ts
?? src/main/agent/governed.ts
?? src/main/agent/runtime.test.ts
?? src/main/aion/
?? src/main/backend/external-agent.test.ts
?? src/main/backend/grounded.test.ts
?? src/main/backend/npx.ts
?? src/main/backend/security.test.ts
?? src/main/enterprise/
?? src/main/nomos/
?? src/main/sphragis/
?? src/main/store.test.ts
?? src/renderer/src/views/settings/GovernancePane.tsx
?? src/renderer/src/views/settings/MissionsPane.tsx
?? src/renderer/src/views/settings/ReceiptsPane.tsx
?? src/renderer/src/views/settings/paneBits.tsx
?? src/shared/enterprise.ts
```

### Untracked directories expanded

`git ls-files --others --exclude-standard` — the 4 collapsed directories above resolve to
24 files, so the baseline commit carries 57 paths in total (17 modified + 39 untracked +
this checkpoint file).

```text
docs/enterprise-layers.md
docs/superpowers/plans/2026-10-25-selfimpulse-moonith-merge.md
src/main/agent/governed.test.ts
src/main/agent/governed.ts
src/main/agent/runtime.test.ts
src/main/aion/aion.test.ts
src/main/aion/index.ts
src/main/aion/journal.ts
src/main/aion/missions/repoScan.ts
src/main/aion/missions/repoScanDeps.ts
src/main/aion/orchestrator.ts
src/main/aion/workflow.ts
src/main/backend/external-agent.test.ts
src/main/backend/grounded.test.ts
src/main/backend/npx.ts
src/main/backend/security.test.ts
src/main/enterprise/ipc.test.ts
src/main/enterprise/ipc.ts
src/main/nomos/gate.ts
src/main/nomos/identity.ts
src/main/nomos/index.ts
src/main/nomos/journal.ts
src/main/nomos/kill.ts
src/main/nomos/nomos.test.ts
src/main/nomos/policy.ts
src/main/nomos/trust.ts
src/main/nomos/types.ts
src/main/sphragis/index.ts
src/main/sphragis/schema.ts
src/main/sphragis/service.ts
src/main/sphragis/signer.ts
src/main/sphragis/sphragis.test.ts
src/main/sphragis/verify.ts
src/main/store.test.ts
src/renderer/src/views/settings/GovernancePane.tsx
src/renderer/src/views/settings/MissionsPane.tsx
src/renderer/src/views/settings/ReceiptsPane.tsx
src/renderer/src/views/settings/paneBits.tsx
src/shared/enterprise.ts
```

Excluded from the commit by `.gitignore` (`node_modules/ out/ release/
release-selfimpulse/ dist/ *.log .env* dev-data/`) and by the nested
`.superpowers/sdd/.gitignore` (content `*`), which is why the plan's SDD briefs and
reports under `.superpowers/` are intentionally not versioned.

Baseline = verified fixes (250/250 tests, typecheck, build, dist) not yet committed.
Post-commit HEAD: `f671d2e824d2102d3be1fdf00da4b90ebe6f7bf7`
(`f671d2e fix(security,governance): land the 0.3.0 audit remediation before the Moonith
merge`, branch `feat/merged-agent`, parent = BASE `0d1f91a`; 57 files changed,
11,417 insertions(+), 211 deletions(-)). This one line is the only change to the tree
after that commit and is deliberately left uncommitted, because a committed file cannot
contain its own sha and Task 0 authorises exactly one commit; the next task's
`git add -A` carries it.

---

## Task 1 — one vendored graph runtime

Chosen root: **`src/main/selfimpulse/roi/`** (the Moonith/donor tree, copied verbatim).
`src/main/vendor/graphruntime/` is deleted. One runtime now; the graph engine imports
`../roi/runtime/index.js`, `../roi/checkpoint/index.js`, `../roi/core/runnables/index.js`.

Decision rule as ruled by the reviewer (not re-litigated): both `PROVENANCE.json` declare
the same upstream — `@langchain/langgraph 1.5.1`, `@langchain/core 1.2.18`,
`@langchain/langgraph-checkpoint 1.2.0`, all MIT — roi additionally ships
`runtime/executor/*` (TARGET has `runtime/pregel/*` instead), and TARGET's
`mission/graphCheckpointer.ts` differs from the donor's by exactly 6 lines, all of them
import paths, which proves the checkpoint API is interchangeable. Task 7's engine is
written against roi, so roi survives.

### Export-diff evidence (HEAD TARGET vs donor roi, `diff --strip-trailing-cr`)

- `checkpoint/index.js` → **0 differing lines** (the two checkpoint roots are identical).
- `runtime/index.js` → 19 differing lines. The substantive ones are internal paths and the
  rebrand of one exported class; the export list is otherwise the same and both sides
  export everything the engine imports (`Annotation`, `END`, `START`, `StateGraph`,
  `Command`, `interrupt`):

```text
< import { ... BaseLangGraphError, ... } from "./errors.js";
> import { ... BaseSelfRoiError, ... } from "./errors.js";
< import { getConfig, getCurrentTaskInput, getStore, getWriter } from "./pregel/utils/config.js";
> import { getConfig, getCurrentTaskInput, getStore, getWriter } from "./executor/utils/config.js";
< import { RunControl } from "./pregel/runtime.js";
> import { RunControl } from "./executor/runtime.js";
```

- `runtime/` directory: TARGET had `runtime/pregel/*` (28 files); roi has `runtime/executor/*`.
- `PROVENANCE.json` differs in bookkeeping only (roi lists 6 more third-party deps and 10
  licence files vs 5; `files: 594` / `bytes: 2445039` vs `files: 498` / `bytes: 2165370`).

Note for the reviewer: the literal first branch of the plan's Step 2 ("TARGET already
exports everything the engine imports → keep TARGET") is *satisfied* by that export list.
The ruling overrides it on the executor / Task-7 grounds above; recorded here so the
override is visible rather than silent.

### Files touched

- Added: `src/main/selfimpulse/roi/**` — 594 files, copied with `cp -r`, **byte-identical**
  to the donor (per-file md5 manifest of both trees matches; `diff -r` silent). Nothing
  inside roi was hand-edited, reformatted, renamed or deleted: `PROVENANCE.json`,
  `README.md`, `licenses/` (6), `thirdparty/` licences (4), `stubs/` (3) and
  `runtime.test.ts` all came across intact.
- Deleted: `src/main/vendor/graphruntime/**` — 544 tracked files removed with `git rm -r`
  (that tree's own `PROVENANCE.json` declared 498 vendored files; git tracked 544).
- Repointed (the only three edits outside roi):
  - `src/main/selfimpulse/mission/graphCheckpointer.ts:40,48,49` →
    `../roi/checkpoint/index.js`, `../roi/checkpoint/index.js`,
    `../roi/core/runnables/index.js`
  - `src/main/selfimpulse/mission/runGraph.ts:86` → `../roi/runtime/index.js`
  - `src/main/selfimpulse/ORIGIN.md` — the "plus vendor/graphruntime at src/main/vendor"
    clause now describes the runtime's real location and its PROVENANCE.json.
  Both repointed importers use the donor's spelling exactly; graphCheckpointer.ts is now
  byte-identical to the donor's copy, while runGraph.ts keeps TARGET's body (it still
  differs from the donor by 56 lines of not-yet-merged Task 7 features).
- No tsconfig/vite alias was added; `vitest.config.ts`, `electron.vite.config.ts`,
  `scripts/build.mjs`, `package.json` untouched. `src/main/backend/core/**` untouched
  (clean in `git status`).

### Verification (what actually ran)

- `npm run typecheck` → clean, exit 0 (both `tsconfig.node.json` and `tsconfig.web.json`;
  `src/main/**/*.ts` includes the whole roi tree, so all six repointed specifiers resolve).
- `npx vitest run src/main/selfimpulse/roi/runtime.test.ts` → **2 passed** (interrupt +
  checkpoint-resume through `MemorySaver`, and per-thread checkpoint isolation).
- `npx vitest run src/main/security.test.ts src/main/backend/security.test.ts` →
  **18 passed** (see the gate note below — the planned `src/main/security-sinks.test.ts`
  does not exist yet).
- `npx esbuild src/main/selfimpulse/mission/runGraph.ts
  src/main/selfimpulse/mission/graphCheckpointer.ts --bundle --platform=node
  --format=esm --external:*` → exit 0: every relative specifier, including all four roi
  ones, resolves on disk; no `Could not resolve`. Output written outside the repo.
- `grep -rn "vendor/graphruntime" src` → no matches. `src/main/vendor` → gone.
  `find src/main/selfimpulse/roi -type f | wc -l` → 594 (donor: 594).

### Gate deviations (flagged, not silently patched)

- `.gitignore:5` (`dist/`) silently swallowed **48 vendored roi files** under
  `src/main/selfimpulse/roi/thirdparty/p-queue/dist/**` and
  `src/main/selfimpulse/roi/thirdparty/_cfworker_json-schema/dist/**`. `git add -A`
  staged 546 of 594, and a fresh clone would have died with `Cannot find module` on
  `roi/core/singletons/callbacks.js`, `roi/core/tools/index.js`,
  `roi/core/utils/async_caller.js`, `roi/core/utils/json_schema.js`,
  `roi/core/output_parsers/transform.js` and `roi/core/prompts/template.js`, all of which
  import those dists by relative path. Fixed with `git add -f` on those 48 paths — the
  tracked tree now carries all 594 — and `.gitignore` was deliberately **not** edited
  (out of this task's scope). Follow-up worth a ruling: a `!src/main/selfimpulse/roi/**/dist/`
  negation, or the hole reopens on the next vendored copy. For reference the deleted
  `vendor/graphruntime` tree never hit this, because it vendored those same deps under
  `thirdparty/*/src/` rather than `dist/`.
- The plan's Step 4 command `npx vitest run src/main/selfimpulse/mission -t checkpoint`
  exits 1 with **"No test files found"**: TARGET has **zero** `*.test.ts` under
  `src/main/selfimpulse/mission/`. The donor has 4 (enterpriseAdmission,
  rsiralsIntegration, rsiralsPolicy, selfEvolveRuntime) — they arrive with later tasks.
  That is a missing-suite problem, not an API gap, so the esbuild resolution proof plus
  `roi/runtime.test.ts` are the substitute evidence.
- `src/main/security-sinks.test.ts` is a **Task 2** deliverable (plan line 130, "Create:"),
  so that gate could not run as written; the two existing security suites ran instead.
- Stale prose still pointing at the deleted path, deliberately left for the attribution
  task (not code, not under `src/`): `THIRD-PARTY-NOTICES.md:43-44`,
  `docs/enterprise-layers.md:142`, and the plan/brief files themselves.
