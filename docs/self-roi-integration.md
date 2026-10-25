# SELF-ΡΟΗ / Self-Roí integration

**Status:** implemented in the SelfImpulse source tree on 2026-10-24.

SELF-ΡΟΗ is the local execution core underneath SelfImpulse. SelfImpulse remains
the product and orchestration/policy layer: providers, credentials, tools,
approvals, artifacts, tasks, usage, memory, skills, and renderer events continue
through the existing application seams. No separate hosted agent stack or second
provider path was added.

## Architecture

```text
SelfImpulse task runtime and UI
  ├─ provider / tool / approval / artifact / task ports
  ├─ budgets / stop gates / nudges / learning policy
  └─ Captain engine (src/main/agent/engine.ts)
       └─ SELF-ΡΟΗ state graph and RoiExecutor
            ├─ prepare → model → tools → prepare
            │                    └─ adjacent Crew jobs run concurrently
            └─ prepare → model → answer → complete

Durable mission cycle
  └─ mission graph → existing run-chain checkpointer → interrupt/resume gate
```

The Captain adapter still accepts `EngineInput` and returns `TurnResult`.
`src/main/backend/core/` is unchanged. The engine imports the existing budget,
stop-gate, nudge, and learning functions rather than maintaining a competing
copy of those policies.

## Integrated behavior

- **Streaming:** provider deltas continue directly to the current assistant
  message, with token usage aggregated across model calls.
- **Tools:** original call IDs, arguments, results, errors, mutated paths, and
  later-turn transcripts are preserved. Ordinary tool calls remain ordered.
- **Multi-agent:** Captain and Crew use the same graph engine. Crew receives a
  filtered tool set and an independent budget; adjacent delegations execute in
  parallel. Approval prompts are not launched in parallel.
- **Cancellation:** the task abort signal reaches both graph execution and the
  active provider stream. Interrupted Captain/Crew runs are marked stopped or
  paused, not done.
- **Failures:** provider exceptions propagate to the task error path. Iteration
  or budget exhaustion is distinguished from a final answer and cannot be
  silently recorded as a successful completion.
- **Persistence:** assistant tool calls and tool results survive in task history.
  Per-task writes are serialized so parallel Crew completions cannot overwrite
  newer task snapshots; atomic temporary files are unique per write.
- **Durable missions:** the existing mission graph retains checkpointed human
  interrupts and thread isolation. Captain does not replay side-effecting graph
  checkpoints over provider/tool calls; its durable user state stays in the
  existing task store.
- **Local-only integration:** hosted control-plane, duplicate model-binding,
  remote-rendering, and external tracing surfaces are excluded, stubbed, or
  disabled as recorded in provenance.

## Main integration points

| Path | Role |
| --- | --- |
| `src/main/agent/engine.ts` | Graph-backed Captain/Crew adapter and shared turn contract |
| `src/main/agent/runtime.ts` | Existing task/provider/tool/approval lifecycle, Crew service, failure handling |
| `src/main/selfimpulse/roi/` | SELF-ΡΟΗ runtime, checkpoints, dependencies, tests, licenses, provenance |
| `src/main/selfimpulse/mission/runGraph.ts` | Durable mission cycle and human gate |
| `src/main/selfimpulse/mission/graphCheckpointer.ts` | Existing run-chain checkpoint adapter |
| `src/main/store.ts` | Serialized per-task persistence for parallel completions |
| `THIRD-PARTY-NOTICES.md` | Repository-level attribution |

## Verification

Verified in the Linux sandbox:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed — main/preload and renderer TypeScript |
| Focused integration tests | **21 passed** — engine, durable runtime, atomic writes |
| Full `npm test` run | **135 tests passed across 20 files**; no assertion failures |
| `npm run build` | Passed — main, preload, and renderer production bundles |
| Core-boundary check | No diff under `src/main/backend/core/` |
| Branding audit | No upstream runtime names in integrated source paths/content outside attribution |
| License audit | All files listed in `PROVENANCE.json` are present |

The same full test command could not load `memory.test.ts`, `skills.test.ts`,
and `usage.test.ts` because the sandbox lacks the Electron binary and cannot
download it. These are suite-loading environment failures, not test failures.
Interactive Electron/UI verification was therefore not available.

To verify on a development machine with dependencies installed:

```bash
npm run typecheck
npx vitest run src/main/agent/engine.test.ts src/main/selfimpulse/roi/runtime.test.ts src/main/util.test.ts
npm test
npm run build
```

## Attribution and redistribution

The integrated implementation uses SELF-ΡΟΗ naming. Upstream package names,
versions, copyright notices, and MIT license texts are deliberately retained in
`src/main/selfimpulse/roi/PROVENANCE.json`, `licenses/`, bundled package license
files, and `THIRD-PARTY-NOTICES.md`. Keep those files with redistributed source
or binaries.
