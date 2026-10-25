# SelfImpulse agent/workflow and durable-execution merge plan

Status: implemented; see `docs/agent-workflow-durability-themes.md` for the implementation and verification report
Date: 2026-10-24
Upstream inputs audited: `@mastra/core` 1.79.0 (Apache-2.0) and `@restatedev/restate-sdk` 1.17.4 (MIT)

## 1. Objective and non-negotiables

Deliver one coherent SelfImpulse agent, not three competing runtimes.

- SelfImpulse remains the product and policy owner.
- `src/main/backend/core/` remains unchanged.
- Existing providers, tools, approvals, artifacts, tasks, events, memory, skills, MCP, connectors, and SELF-ΡΟΗ graph control flow remain authoritative.
- Captain and Crew continue through the same engine and transcript contracts.
- Imported capabilities live below those contracts as SelfImpulse-owned workflow and durable-execution modules.
- Upstream package names are confined to dependency/provenance/license documentation; integrated source and file names use SelfImpulse terminology.
- No hosted studio, second provider registry, second memory system, second tool system, or duplicate agent UI is introduced.

## 2. Source audit and merge decision

The audited agent package is approximately 88 MB before its dependencies and includes agents, workflows, storage, vector search, model routing, memory, MCP, observability, server adapters, and UI-related surfaces. Importing all of it would duplicate existing SelfImpulse systems and greatly increase the desktop bundle.

The audited durable SDK is approximately 8.3 MB and expects its runtime core plus an execution/ingress environment. Treating its context as a standalone local journal would be incorrect.

The merge is therefore a targeted capability implementation with upstream attribution:

- Adopt typed workflow steps, composable control flow, run snapshots, event streaming, suspension/resumption, and agent-run integration beneath the existing Captain graph.
- Adopt journaled execution, deterministic replay, retries with backoff, durable timers, keyed state, deterministic randomness, awakeables, and named durable promises beneath model/tool execution.
- Keep SelfImpulse's existing provider, policy, persistence, and UI implementations.

This is an embedded desktop runtime, not a bundled remote execution cluster or a hosted development studio.

## 3. Target architecture

```text
React task / Appearance UI
          │ existing IPC and events
          ▼
SelfImpulse AgentRuntime ─────────────── existing task store
          │                             existing approval broker
          │ stable task/user/run IDs     existing artifacts
          ▼
Captain + Crew engine (SELF-ΡΟΗ graph)
          │
          ├── typed workflow step runner
          │     ├── sequential / parallel / branch / foreach / loop
          │     ├── schema validation and run snapshots
          │     └── suspend / resume / watch / stream / cancel
          │
          └── durable execution context
                ├── journaled model and tool steps
                ├── retries, backoff, and recovery
                ├── durable sleep and keyed state
                ├── awakeables and named promises
                └── deterministic random values
          │
          ▼
Existing providers / tools / memory / skills / MCP / connectors
```

The workflow layer reports step lifecycle. The durable layer decides whether a step must execute or can be replayed. Neither layer calls a provider or tool directly on its own.

## 4. Capability merge matrix

| Capability | Merge location | Integration rule |
| --- | --- | --- |
| Typed steps and schema validation | `selfimpulse/workflow` | Shared by composable workflows and Captain model/tool execution |
| Sequential composition | Workflow builder | Output of one operation feeds the next |
| Parallel and bounded foreach | Workflow builder | Deterministic result ordering; Crew retains its existing parallel batches |
| Conditional branch and bounded loop | Workflow builder | Explicit termination limits prevent unbounded local runs |
| Workflow snapshots | Workflow run + durable journal | Status, result/error, suspension, and step history are inspectable |
| Suspend/resume | Workflow run | Completed steps replay; the suspended step receives resume data |
| Watch/event stream/cancel | Workflow run | Uses existing abort signals at the agent boundary |
| Multi-agent execution | Existing Captain/Crew engine | Crew is extended with stable durable identities, not replaced |
| Background learning review | Existing engine | Remains detached and non-durable so it cannot collide with Captain journal keys |
| Model/tool durability | Durable context in the engine | Completed model/tool entries return their journaled values without repeating the side effect |
| Retry/backoff | Durable context | Explicit policy per step; provider failover remains provider-owned |
| Durable timers | Durable context | Wake time is journaled before waiting and survives restart |
| Keyed state | Durable journal | JSON state is scoped to one durable run |
| Awakeables/named promises | Durable store | External resolution persists before waking waiters |
| Deterministic randomness | Durable context | Values derive from stable run identity and replay sequence |
| Active-run recovery | AgentRuntime | Running/waiting tasks can replay after restart; paused tasks remain user-controlled |

## 5. Durable data and identity contract

Journal root: the application data directory's `durable/` folder. Files use a SHA-256 of the full run ID, so arbitrary IDs cannot escape the directory.

Run IDs:

- Captain: task ID + visible user-message ID.
- Crew: task ID + model tool-call ID, retained across replay.
- Background review: no parent durable context; it is intentionally independent.

A journal contains versioned run metadata, step entries, keyed JSON state, timestamps, attempts, error information, timer wake times, and promise outcomes. Writes are serialized and atomic.

### Replay algorithm

1. Load the journal and convert incomplete `running` entries to retryable entries.
2. Re-run the deterministic Captain/workflow control flow from its stable input.
3. For a completed step, return its recorded output and emit a replay event; do not invoke its callback.
4. For an incomplete step, persist the attempt before invoking the callback.
5. Validate and persist successful output before marking the step complete.
6. Preserve retryable error/attempt metadata when execution fails.
7. Reconstruct the engine transcript from cached model responses and tool outcomes.

Model journal keys use model iteration number. Tool journal keys use the provider tool-call ID, which is itself recovered from the journaled model response.

### Crash guarantee and limit

Completed steps are replayed without re-execution. Arbitrary tools are not transactional: a process death between an external side effect and the journal/task commit can still cause that incomplete step to run again. The integration therefore provides completed-step replay and at-least-once execution for incomplete side effects, not an unsupported exactly-once claim.

Approvals remain mandatory. A replay never converts an unfinished approval into an approval. A finished tool result, including a denial returned as a tool outcome, can replay without repeating the tool.

## 6. Recovery behavior

- Manual Resume prepares a clean replay transcript for the current user turn and reuses the same durable run ID.
- Partial assistant/tool rows from the interrupted attempt are removed before reconstruction; hidden user context is retained.
- Interrupted step records are marked rather than left indefinitely `running` or `waiting`.
- Running/waiting tasks are eligible for startup recovery after the window/event surface exists.
- Paused tasks stay paused until the user resumes them.
- Crew IDs are deterministic, preventing a recovered delegation from becoming an unrelated Crew run.

## 7. Theme merge

Add the supplied design as five selectable theme families, each with light and dark variants:

| Family | Canvas | Ink | Signal | Reference default |
| --- | --- | --- | --- | --- |
| Cinnabar | `#F5F1EA` | `#140C0A` | `#D1553B` | Light |
| Viridian | `#EDF2EE` | `#050D09` | `#218F6A` | Light |
| Sulfur | `#F0F0E4` | `#12130D` | `#8F8B2D` | Dark |
| Glacial | `#E8F0F2` | `#0E161B` | `#4E8FA9` | Dark |
| Quartz | `#F0EAF2` | `#120B13` | `#A875B2` | Dark |

The existing house themes and default remain available. Theme tokens are derived in the registry and mirrored in the stylesheet; registry/stylesheet parity tests remain authoritative. Signal-colored CTAs use the family ink color, as specified by the design.

## 8. Implementation sequence

1. Add versioned durable journal, context, store, errors, timers, state, promises, and deterministic randomness.
2. Add focused replay/restart/retry/timer/state/promise tests using temporary directories and no Electron.
3. Add typed workflow step runner and composition/snapshot/stream/suspend/resume tests.
4. Connect the shared step runner to Captain model/tool nodes.
5. Add stable Captain/Crew run IDs, replay preparation, and startup recovery without changing backend core.
6. Add the five theme families and picker/registry/stylesheet coverage.
7. Add license/provenance records and an implementation report.
8. Run focused tests, full tests, typecheck, production build, forbidden-name/core-difference audits, and source archive verification.

## 9. Explicit non-duplication decisions

- No second model/provider registry: existing Provider and failover remain.
- No second memory or skill store: existing services and background review remain.
- No replacement tool protocol: existing SelfImpulse and MCP tools remain.
- No parallel approval UI: the existing approval broker and task waiting state remain.
- No bundled hosted studio or remote admin console.
- No external durable server is pretended to exist; the merged runtime is a local desktop journal with the agent-relevant durable primitives above.
- No core edits and no change to the existing SELF-ΡΟΗ module boundary.

## 10. Acceptance checks

- A completed model/tool callback runs once across two context instances over the same journal.
- An interrupted callback is retryable and failed attempts retain diagnostic metadata.
- Retry backoff, aborts, timers, keyed state, awakeables, named promises, and deterministic random values have focused tests.
- Workflow branch/parallel/foreach/loop results are deterministic; suspend/resume does not repeat completed steps.
- Captain/Crew integration compiles without backend-core changes and retains existing engine tests.
- All five new theme families render through the existing picker and pass exact registry/CSS parity checks.
- Attribution and license texts are present, while integrated runtime file/code names contain no upstream framework branding.
