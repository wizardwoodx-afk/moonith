# Third-party notices

SelfImpulse is built on work from several upstream open-source projects.
Each entry records the project, its authors, its licence, and what it was
used for here. Each project's copyright notice and permission text are
retained by reference and ship with that project's own distribution;
nothing in the SelfImpulse licence transfers any rights in these projects.

## Hermes agent — the agent core

- **Upstream:** Nous Research — `github.com/NousResearch/hermes-agent`
- **Licence:** MIT
- **Used for:** the agent core in `src/main/backend/core/` is a TypeScript
  port of its design: the phase machine, the iteration budget, the stop
  gates, the nudges, the learning loop, memory and the skill manager.
- The upstream name has been removed from the source; this entry is the
  attribution. The port map — which upstream file each module corresponds
  to — is recorded in the core's module documentation.

## OpenClaw Enterprise — native IAM policy semantics

- **Upstream:** OpenClaw Enterprise — `github.com/openclaw/openclaw-enterprise`,
  inspected at revision `6244dc498bfdf77b2ad036ebefe2e62a7d90a0aa`.
- **Licence:** MIT — Copyright (c) 2026 OpenAI. The complete copyright and
  permission text ships at
  `src/main/enterpriseControl/LICENSE.openclaw-enterprise.txt`.
- **Used for:** authorization and governance semantics adapted into the
  SelfImpulse-native **Enterprise Control Plane**: default-deny grants, human
  and per-agent identities, namespace-scoped Roles and AccessBindings,
  deny-overriding Restrictions, immutable revisions, and lifecycle state.
- **Local implementation:** `src/main/enterpriseControl/` and
  `src/shared/enterpriseControl.ts` are SelfImpulse-owned native code, not a
  vendored upstream workspace or a running OCE distribution. They integrate
  with the existing mission-admission and signed-audit paths. No controller,
  worker, OCC sidecar, PostgreSQL, Kubernetes, local server, MCP adapter, or
  external CLI is used. The same-process policy boundary is not presented as
  OCE-equivalent hard tenant or workload isolation. Exact scope is recorded in
  `src/main/enterpriseControl/PROVENANCE.json`.

## OpenClaw — the gateway contracts

- **Upstream:** the OpenClaw gateway (`github.com/openclaw`), also
  referenced in the source as the ExternalAgent project
  (`github.com/externalAgent/externalAgent`)
- **Licence:** MIT
- **Used for:** the local gateway in `src/main/backend/gateway/` follows its
  gateway contracts — channels, routing, session keys, automations — ported
  to run inside SelfImpulse's main process. SelfImpulse can also hand a
  task to a running ExternalAgent gateway and install skills from its
  registry.
- **Retained identifiers** (kept because the code resolves them): the
  `openclaw@latest` npm package invoked via `npx`, the `https://openclaw.ai`
  endpoint, and the `clawhub@latest` CLI with `https://clawhub.ai` for the
  skill registry.

## LangGraph — the SELF-ΡΟΗ execution runtime

- **Upstream:** LangChain — `@langchain/langgraph` 1.5.1, `@langchain/core`
  1.2.18, and `@langchain/langgraph-checkpoint` 1.2.0. The targeted local
  source also bundles `@cfworker/json-schema`, `eventemitter3`, `mustache`,
  `p-finally`, `p-queue`, and `p-timeout` at the versions recorded in
  `PROVENANCE.json`.
- **Licence:** MIT. Copyright and permission texts ship in
  `src/main/selfimpulse/roi/licenses/` and beside the bundled packages.
- **Used for:** the graph, checkpoint, streaming, command, and interrupt
  runtime underneath SelfImpulse's Captain/Crew turns and durable mission
  cycles. The integrated source is at `src/main/selfimpulse/roi/`.
- **Local changes:** product terminology and imports were localized, missing
  pinned dependency distributions were restored, and hosted/duplicate
  provider surfaces were excluded or disabled. `PROVENANCE.json` records the
  exact upstream versions and local modifications. Upstream names are kept in
  this attribution rather than in the integrated implementation.

## Mastra — the workflow capability reference

- **Upstream:** Kepler Software, Inc. — `@mastra/core` 1.79.0.
- **Licence:** Apache-2.0. Copyright (c) 2025 Kepler Software, Inc. The full
  licence and upstream notice ship in `src/main/selfimpulse/workflow/`.
- **Used for:** typed workflow/agent-run concepts and behavior: composable
  steps, schema validation, parallel/branch/foreach/loop operations, run
  snapshots, event streams, and suspend/resume underneath Captain and Crew.
- **Local implementation:** `src/main/selfimpulse/workflow/` is a targeted
  SelfImpulse-owned implementation, not a copy of the upstream distribution.
  Hosted studio, server, provider, memory, storage, vector, MCP, enterprise,
  and duplicate tool surfaces are excluded. Exact scope is recorded in that
  directory's `PROVENANCE.json`.

## Restate — the durable execution reference

- **Upstream:** Restate Software, Inc. and Restate GmbH —
  `@restatedev/restate-sdk` 1.17.4.
- **Licence:** MIT. Copyright (c) 2023-2024 Restate Software, Inc., Restate
  GmbH. The permission text ships in `src/main/selfimpulse/durable/LICENSE.txt`.
- **Used for:** agent-relevant durable semantics: journaled steps, retries,
  timers, keyed state, awakeables, named promises, deterministic replay, and
  external-event coordination for Captain, Crew, and approvals.
- **Local implementation:** `src/main/selfimpulse/durable/` is a targeted local
  journal, not an embedded remote server or a copy of the SDK/native runtime.
  Arbitrary incomplete external side effects remain at-least-once. Exact scope
  and the single-writer contract are recorded in `PROVENANCE.json`.

## Paperclip — the retry-lane accounting

- **Upstream:** Paperclip AI — `server/src/services/execution-recovery-attempt.ts`
  and `server/src/services/approved-execution-wait.ts`
- **Licence:** MIT — Copyright (c) 2025 Paperclip AI
- **Used for:** the retry-lane accounting in
  `src/main/selfimpulse/mission/retryLanes.ts`: a retry charge is decided by
  its reason, an ambiguous historical record is read conservatively, and an
  approval wait is bounded from when the ask was presented.
- The complete copyright and permission text ships at
  `LICENSES/paperclip-MIT.txt`.

## Seamoon — the ported backend services

- **Upstream:** Seamoon
- **Licence:** not stated in this repository. The design spec in
  `docs/superpowers/` records that Seamoon carries no licence; the ported
  files are attributed here for provenance, and each ported module's header
  names the upstream file it came from.
- **Used for:** the backend services in `src/main/backend/` — the
  multi-provider client, the store, the keychain secret store, the sandboxed
  tool runtime, MCP, the skill marketplace, the work-account service,
  computer use, grounded actions and the appearance themes.

## Knight Cowork — the original app shell

- **Upstream:** Knight Cowork
- **Licence:** not stated in this repository.
- **Used for:** the application shell SelfImpulse was built from. Identifiers
  derived from its name remain where the code or persisted user data
  requires them: the `knight-cowork` userData directory in
  `src/main/paths.ts` is read as a migration source so existing installs
  keep their data, and internal identifiers such as the `window.knight`
  API, the `knight-file:` protocol, the `KNIGHT_*` environment variables and
  stored preference keys are kept for compatibility.

## Historical references

Comments in the source describe the app's earlier Tauri-based shell. No Tauri
code is included in SelfImpulse.

## Product motion libraries

- **Metal FX:** `metal-fx` 2.0.11 by Jakub Antalik, MIT, Copyright (c)
  2026 Jakub Antalik. Used for the shared liquid-metal primary action and
  Captain signature. Licence: `LICENSES/metal-fx-MIT.txt`.
- **Thinking Orbs:** `thinking-orbs` 0.3.2 by Jakub Antalik, MIT, Copyright
  (c) 2026 Jakub Antalik. Used for real working, composing, connecting,
  solving, and breathing states. Licence: `LICENSES/thinking-orbs-MIT.txt`.
- **Glimm:** `glimm` 0.3.1 by Noman Ijaz, MIT, Copyright (c) 2026 Noman
  Ijaz - iamnoman.com. Used for one-shot send-button border sweeps through
  its framework-independent core. Licence: `LICENSES/glimm-MIT.txt`.
- The task deck, role picker, reaction burst, Captain presence, action node,
  upload treatment, and time scrubber are SelfImpulse-owned interaction
  implementations. No Bencho block source is included.

## npm dependencies

The dependencies declared in `package.json` — Electron, React, the Anthropic
and OpenAI SDKs, the Model Context Protocol SDK and the others — remain
under their own licences.

## Studio engines

The desktop engines driven by `studio_commands` and `studio_run` are covered
separately in `docs/third-party-notices.md`.
