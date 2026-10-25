# Impulse Runtime and Crew Mesh

**Status:** implemented in the SelfImpulse source tree on 2026-10-25.

This is a selective source integration, not an installation of either upstream
platform. SelfImpulse remains the only task, provider, tool, approval, memory,
and persistence authority. `src/main/backend/core/` is unchanged.

## What was merged

### Impulse Runtime

`src/main/selfimpulse/impulseRuntime/` adapts two small core modules from the
pinned OpenClaw source revision recorded in its `PROVENANCE.json`:

- **Transactional steering:** user input is drained at model-iteration
  checkpoints, fenced from later input, committed after a successful model
  response, and restored after a failed one. The initial transcript checkpoint
  commits already-represented messages so they cannot be injected twice.
- **Live output safety:** bounded repeated-text detection runs on actual
  provider deltas and stops a dominated response instead of spending the rest
  of the turn budget on a loop.

The upstream private workspace, Gateway, CLI, provider registry, session store,
and external processes are excluded.

### Crew Mesh

`src/main/selfimpulse/crewMesh/` adapts VoltAgent supervisor handoff and
forwarded-event semantics into the existing `delegate_to_crew` and
`runSubAgent` path:

- one specialist or a team of up to four independent specialists per call;
- at most three concurrent workers, with result order preserved;
- independent per-specialist failures and parent cancellation;
- stable job suffixes for durable replay, while single-call IDs remain
  compatible with earlier journals;
- specialist purposes, Captain/specialist paths, batch metadata, usage, and
  lifecycle/tool events on the existing persisted Crew run.

The full upstream package, provider integrations, telemetry stack, registry,
server, and second agent loop are deliberately excluded.

## Captain contract

The existing tool name is unchanged. A single job remains:

```json
{
  "name": "Docs Scout",
  "purpose": "Check the implementation guidance",
  "instruction": "Read the relevant local docs and report the exact constraints."
}
```

A team uses the same tool with independent jobs:

```json
{
  "jobs": [
    {
      "name": "Docs Scout",
      "purpose": "Evidence",
      "instruction": "Inspect the local documentation and report constraints."
    },
    {
      "name": "Test Runner",
      "purpose": "Verification",
      "instruction": "Run the focused tests and report failures with file paths."
    }
  ]
}
```

Crew specialists still receive the intersection of Captain's role, enterprise
policy, DLP, workspace, and no-prompt tool restrictions. They cannot delegate
again or widen their own permissions.

## UI

- **Task → Crew:** Crew Mesh cards show live status, current tool, purpose,
  lineage, team size, reported token usage, reports, and forwarded activity.
- **Settings → Crew Mesh:** the full history exposes the same real metadata;
  old persisted runs without the new optional fields still render.
- The existing composer/task error surface reports a repetition-guard stop;
  there is no synthetic runtime health indicator or separate upstream console.

## Attribution

Product-facing names are SelfImpulse-native. Upstream copyright and MIT notices
remain in `THIRD-PARTY-NOTICES.md`, the two integration directories, and the
Electron extra-resource license set. See each `PROVENANCE.json` for exact
revisions, source files, adaptations, and exclusions.

## Verification

- `npm run typecheck` — passed for main/preload and renderer.
- Runnable Vitest aggregate — **46 files / 268 tests passed**; the three known
  Electron-binary-dependent suites remain excluded in this sandbox.
- Focused engine, runtime, Crew Mesh, and UI projection tests — **33 passed**.
- `npm run build` — passed for main, preload, and renderer production bundles.
- Protected-core status — no changes under `src/main/backend/core/`.

Interactive Electron verification requires a local Electron binary and is not
claimed here.
