# SELF-ΡΟΗ — SelfImpulse's local execution runtime

SELF-ΡΟΗ (Self-Roí) is the graph and durable-execution core underneath
SelfImpulse. The application remains the product, policy, provider, approval,
artifact, and user-interface layer; this directory supplies state channels,
graph scheduling, streaming, commands, checkpoints, stores, retries, timeouts,
and interrupts.

The runtime is committed as readable source rather than hidden in
`node_modules`. It is a targeted local integration: hosted control-plane,
remote-rendering, external model-binding, and tracing surfaces are excluded or
replaced with refusing first-party stubs. SelfImpulse's own provider and tool
runtime are the only execution paths.

Upstream copyright and license information is intentionally kept separate from
the integrated implementation. See `PROVENANCE.json`, `licenses/`, the license
files beside bundled third-party packages, and the repository's
`THIRD-PARTY-NOTICES.md`.

## Layout

| Directory | Purpose |
| --- | --- |
| `runtime/` | State graphs, the RoiExecutor, functional tasks, streaming, commands, sends, retries, timeouts, and interrupts |
| `checkpoint/` | Checkpoint contracts, in-memory persistence, serde, and stores |
| `core/` | Supporting messages, runnables, callbacks, tools, and schema utilities |
| `stubs/` | First-party boundaries that refuse unsupported hosted or duplicate provider functionality |
| `thirdparty/` | Small runtime dependencies required by the committed source |
| `licenses/` | Verbatim notices for the imported runtime and schema dependency |
| `PROVENANCE.json` | Upstream versions, local modifications, bundled dependencies, and exclusions |

## Integrated execution paths

### Captain and Crew

`src/main/agent/engine.ts` compiles every Captain turn as a typed graph:

```text
prepare → model → tools → prepare
                  └─────→ answer → done
```

SelfImpulse still owns the model stream, tool schemas, approvals, task records,
artifacts, budgets, stop gates, and learning policy. Crew sub-agents use the
same engine with filtered tools and their own iteration budget. Adjacent Crew
delegations execute concurrently; ordinary tools and approval prompts remain
ordered.

Captain does not replay a graph checkpoint over side-effecting provider/tool
calls. Durable user-facing state remains in SelfImpulse's task store, and an
interrupted tool call is reconciled through the existing task transcript. This
avoids repeating a write or approval after a process restart.

### Missions

`src/main/selfimpulse/mission/runGraph.ts` uses the runtime for the mission
cycle and its human gate. `graphCheckpointer.ts` connects durable runs to the
existing tamper-evident run chain. Non-durable cycles avoid unnecessary journal
writes; pausable or explicitly durable cycles checkpoint their supersteps.

## Local modifications

The integrated source uses SELF-ΡΟΗ terminology and local import paths. Missing
runtime dependency distributions were restored from their pinned package
artifacts, and their imports were localized so the application builds without
installing another agent stack. Network-capable utility surfaces remain blocked
as recorded in `PROVENANCE.json`.

## Verification

After changing the runtime or either integration seam, run:

```bash
npm run typecheck
npx vitest run src/main/agent/engine.test.ts src/main/selfimpulse/roi/runtime.test.ts
npm run build
```

Keep generated dependencies, application build output, user data, and archives
out of this source tree. When code from an upstream release is intentionally
imported, update `PROVENANCE.json` and retain the corresponding license in the
same change.
