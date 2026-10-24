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
