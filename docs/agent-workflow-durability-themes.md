# Agent workflows, durable execution, and Distinct Color

Status: implemented and verified in the Linux sandbox on 2026-10-24.

This milestone extends the existing SelfImpulse Captain/Crew agent beneath the SELF-ΡΟΗ control flow. It does not add a second provider, memory, tool, approval, storage, or hosted agent stack. The merge contract is in `docs/mastra-restate-merge-plan.md`.

## What was merged

### Typed workflows

`src/main/selfimpulse/workflow/` provides:

- Typed steps with Zod input, output, suspend-payload, and resume-data validation.
- Sequential steps, named parallel steps, conditional branches, bounded concurrent foreach, and bounded loops.
- Durable sleep steps.
- Run snapshots with step history, results/errors, and suspension details.
- Suspend/resume with persisted resume data and recovery of active runs.
- Watch callbacks, async event streams, and cancellation.
- A shared `executeStep` boundary used by both standalone workflows and Captain's model/tool nodes.

Loop termination is checked inside the durable callback, so a cached final iteration always represents a genuinely completed loop.

### Durable execution

`src/main/selfimpulse/durable/` provides:

- Versioned JSON journals with atomic, serialized writes and corruption-safe loading.
- Completed-step replay without re-invoking the callback.
- Incomplete-step recovery, bounded retries, exponential backoff, and terminal/retryable errors.
- Durable timers, keyed JSON state, deterministic clocks, and stable idempotency keys.
- Awakeables and one-time named promises with persist-before-wake resolution.
- Deterministic random values, including sequence restoration when a completed step is replayed.
- Single-writer profile operation, matching Electron's existing single-instance lock.

The implementation is local to the desktop profile. It does not pretend that an external durable server or cluster is present.

### Captain, Crew, approvals, and recovery

`src/main/agent/engine.ts` and `runtime.ts` now use stable durable identities:

- Captain runs are scoped by task and visible user-message ID.
- Model steps use the model iteration; tool steps use the original provider tool-call ID.
- Crew IDs include the parent Captain run and tool-call ID, preventing collisions even when providers reuse simple call IDs in later turns.
- Crew has a separate journal, while adjacent Crew delegations retain their existing parallel behavior.
- Approval decisions have their own durable boundary. An approved but unfinished tool can recover without asking again; an aborted outcome is not committed.
- Usage telemetry stores the resulting cumulative value and reapplies it idempotently on replay.
- Manual Resume removes only the interrupted attempt's assistant/tool rows and marks interrupted step records before reconstruction.
- Startup recovery includes running/waiting tasks only. Paused tasks remain under explicit user control.
- Background learning review deliberately has no parent durable context, preventing model-key collisions.

Completed steps are replay-safe. Arbitrary shell, filesystem, network, or other external side effects are not transactional: if the process dies between the side effect and its journal/task commit, the incomplete operation remains at-least-once. The code and notices do not claim exactly-once execution for those operations.

### Distinct Color themes

The supplied five families are available in Settings → Appearance → Colors → Distinct color studies:

- Cinnabar — light and dark
- Viridian — light and dark
- Sulfur — light and dark
- Glacial — light and dark
- Quartz — light and dark

Each variant is a real persisted application theme with a stylesheet mirror and miniature picker preview. Existing house themes, the Rare Five, the exclusive Moon pane, and the Moonlight default remain intact.

The source canvas/ink/signal colors are preserved. Dark variants swap the canvas/ink surface roles. Signal CTAs use source-ink labels. Tests verify exact TypeScript/CSS token parity, source-color preservation, AAA-range body contrast, AA CTA labels, and AA non-text signal contrast.

## Main paths

| Path | Role |
| --- | --- |
| `src/main/selfimpulse/workflow/` | Typed workflow implementation, tests, Apache-2.0 notice, provenance |
| `src/main/selfimpulse/durable/` | Durable journal/context/store, tests, MIT license, provenance |
| `src/main/agent/engine.ts` | Shared model/tool step boundaries and review isolation |
| `src/main/agent/runtime.ts` | Stable run IDs, approvals, Crew recovery, usage, replay preparation |
| `src/main/services/subagents.ts` | Stable Crew identity reuse with active-run duplicate protection |
| `src/main/paths.ts` | Profile `durable/` journal directory |
| `src/main/index.ts` | Startup recovery and shutdown journal flush |
| `src/renderer/src/lib/themes.ts` | Ten new theme definitions and palette derivation |
| `src/renderer/src/styles.css` | Rendered theme token blocks |
| `src/renderer/src/views/settings/ThemePanes.tsx` | Distinct Color picker section and contrast-safe selected state |
| `THIRD-PARTY-NOTICES.md` | Repository-level upstream attribution |

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed — main/preload and renderer TypeScript |
| Focused milestone suites | **39 passed** — engine, workflow, durable, and theme tests |
| Full `npm test` | **160 passed across 22 files**; no assertion failures |
| `npm run build` | Passed — main, preload, and renderer production bundles |
| Backend-core boundary | `src/main/backend/core/` unchanged |
| Branding audit | No upstream whole-word names in integrated agent/workflow/durable TypeScript |
| License/provenance audit | JSON valid; all referenced license files present and non-empty |
| Built theme audit | All ten new theme selectors present in production CSS |
| Dependency audit | No duplicate upstream runtime packages added |
| `git diff --check` | Passed |

The full test command still cannot load `memory.test.ts`, `skills.test.ts`, and `usage.test.ts` because this sandbox lacks the Electron binary and cannot download it (`TypeError: fetch failed`). These are the same suite-loading environment failures seen before this milestone, not assertion failures. Interactive Electron/UI verification is therefore unavailable here.

The production build retains the repository's existing Vite configuration notices and ineffective-dynamic-import warning; they do not fail the build.

## Attribution and scope

The audited upstream packages are `@mastra/core` 1.79.0 (Apache-2.0) and `@restatedev/restate-sdk` 1.17.4 (MIT). The integrated modules are targeted SelfImpulse-owned implementations of the agent-relevant capabilities, not copies of the upstream distribution bundles. Exact merged/excluded scope, copyright, and license texts are retained beside each module and in `THIRD-PARTY-NOTICES.md`.
