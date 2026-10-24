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

## LangGraph — the vendored graph runtime

- **Upstream:** LangChain — `@langchain/langgraph`, `@langchain/core`,
  `@langchain/langgraph-checkpoint`, with `mustache`, `p-queue` and
  `@cfworker/json-schema`
- **Licence:** MIT
- **Used for:** the graph runtime the mission cycle runs on, vendored at
  `src/main/vendor/graphruntime/`. The licence texts ship verbatim in
  `src/main/vendor/graphruntime/licenses/`, and `PROVENANCE.json` records
  what was taken, what was changed and what was left out.
- The package names appear in `PROVENANCE.json` and in the vendored import
  paths and must stay for the code to build. The vendored README points at
  `docs/legal/THIRD-PARTY-NOTICES.md`; this file is the notice it means.
- The persistence guide (`docs/docs/concepts/persistence.md`) and the
  human-in-the-loop guide (`docs/docs/agents/human-in-the-loop.md`)
  informed how the existing mission graph checkpoints and interrupts.

## Paperclip — the retry-lane accounting

- **Upstream:** Paperclip AI — `server/src/services/execution-recovery-attempt.ts`
  and `server/src/services/approved-execution-wait.ts`
- **Licence:** MIT — Copyright (c) 2025 Paperclip AI
- **Used for:** the retry-lane accounting in
  `src/main/selfimpulse/mission/retryLanes.ts`: a retry charge is decided by
  its reason, an ambiguous historical record is read conservatively, and an
  approval wait is bounded from when the ask was presented.
- Note: the source references `LICENSES/paperclip-MIT.txt`, which is not
  present in this repository. The copyright and licence are recorded here;
  the licence text should be restored at that path.

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

## Nomos — the governance gate

- **Upstream:** Microsoft — Agent Governance Toolkit
  (`github.com/microsoft/agent-governance-toolkit`), with the TypeScript
  SDK at `agent-governance-typescript` and the feature matrix at
  `docs/PACKAGE-FEATURE-MATRIX.md`
- **Licence:** MIT
- **Used for:** the ideas, not the code. The governance gate in
  `src/main/nomos/` — named Nomos (νόμος, "law") — follows its model:
  deterministic policy evaluation over registered identities; agents
  holding scoped capabilities under a principal; delegation that can only
  narrow a parent's scopes; a trust score that informs scrutiny but
  authorises nothing by itself; governance decision records; and a kill
  control that refuses every action while engaged.
- No upstream code was copied or linked, and the upstream name appears
  nowhere in the source. This entry is the attribution.

## Sphragis — the signed action receipts

- **Upstream:** Agent Receipts / Obsigna
  (`github.com/agent-receipts/obsigna`), protocol specification under
  `spec/`
- **Licence:** MIT for the specification (see `spec/LICENSE`). The wider
  repository states no licence in its root; that is recorded here
  honestly, and only the specification's ideas informed this layer.
- **Used for:** the ideas, not the code. The receipt layer in
  `src/main/sphragis/` — named Sphragis (σφραγίς, "seal") — follows its
  receipt schema and action taxonomy: Ed25519-signed receipts, chain
  linking, independent verification, and the recording of principal,
  agent, action, authorization and outcome with digests instead of raw
  content.
- No upstream code was copied or linked, and the upstream name appears
  nowhere in the source. This entry is the attribution.

## Aion — the durable mission runner

- **Upstream:** Restate (`github.com/restatedev/restate`), with the
  TypeScript SDK at `github.com/restatedev/sdk-typescript` and the
  service concepts at `docs.restate.dev/concepts/services/`
- **Licence:** Business Source License 1.1. Licensor: Restate Software,
  Inc. and Restate GmbH. Additional Use Grant: the software may not be
  used to operate a public Restate platform service. Change Date: four
  years after release; Change License: Apache License 2.0.
- **Used for:** the ideas, not the code. The durable mission runner in
  `src/main/aion/` — named Aion (αἰών, "enduring time") — follows its
  model of durable workflow execution: an append-only journal per
  mission, durable timers, step journal and recovery, retry policy,
  stable workflow and action ids, idempotent service calls, signals, and
  query and introspection.
- SelfImpulse implements its own local durable-execution engine on the
  desktop; it does not embed, link or communicate with Restate in any
  form. No upstream code was copied, and the upstream name appears
  nowhere in the source. This entry is the attribution.

## Historical references

Comments in the source describe the app's earlier Tauri-based shell. No Tauri
code is included in SelfImpulse.

## npm dependencies

The dependencies declared in `package.json` — Electron, React, the Anthropic
and OpenAI SDKs, the Model Context Protocol SDK and the others — remain
under their own licences.

## Studio engines

The desktop engines driven by `studio_commands` and `studio_run` are covered
separately in `docs/third-party-notices.md`.
