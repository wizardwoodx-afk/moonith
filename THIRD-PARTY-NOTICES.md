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

## OpenClaw — Impulse Runtime steering and output safety

- **Upstream:** OpenClaw Foundation — `github.com/openclaw/openclaw`, pinned at
  revision `c668bc0565187494726a7d065841ff7c551357f5`.
- **Licence:** MIT — Copyright (c) 2026 OpenClaw Foundation. The complete
  copyright and permission text ships at
  `src/main/selfimpulse/impulseRuntime/LICENSE.openclaw.txt`.
- **Used for:** targeted source adaptations from `packages/agent-core/` for
  transactional steering queues, provider-continuation admission fencing, and
  bounded live repetitive-output detection in SelfImpulse's existing engine.
- **Local implementation:** `src/main/selfimpulse/impulseRuntime/` is merged
  beneath the SelfImpulse provider, transcript, tool, approval, and persistence
  boundaries. The private upstream workspace is not installed, and no Gateway,
  CLI, provider registry, session store, or external process is included.
- **Additional repetition-guard attribution:** the adapted upstream guard
  credits Hermes Agent and Nous Research for its detection algorithms. MIT
  Copyright (c) 2025 Nous Research; the complete permission text ships at
  `src/main/selfimpulse/impulseRuntime/LICENSE.hermes.txt`. Exact source and
  adaptation scope are recorded in that directory's `PROVENANCE.json`.

## VoltAgent — Crew Mesh supervised delegation

- **Upstream:** VoltAgent Inc. — `github.com/VoltAgent/voltagent`, pinned at
  revision `72a46c76b4507e1f98b41d5050a92bd30587eb70` (`@voltagent/core` 2.11.0).
- **Licence:** MIT — Copyright (c) 2025 VoltAgent Inc. The complete copyright
  and permission text ships at
  `src/main/selfimpulse/crewMesh/LICENSE.voltagent.txt`.
- **Used for:** targeted supervisor/sub-agent source semantics: multi-target
  handoffs, independent per-agent outcomes, ordered results, agent-path
  metadata, and forwarded-event filtering.
- **Local implementation:** `src/main/selfimpulse/crewMesh/` and the existing
  `delegate_to_crew` / `runSubAgent` path form SelfImpulse's native **Crew
  Mesh**. It adds bounded parallel teams, purposes, lineage, usage, and real
  lifecycle/tool activity to the existing Crew UI. The full VoltAgent package,
  AI SDK providers, OpenTelemetry, registry, servers, and second agent loop are
  deliberately excluded. Exact scope is recorded in `PROVENANCE.json`.

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

## Native Coworker and Library references

- **OpenBot:** CopilotKit, `CopilotKit/OpenBot` at commit
  `46642d6c91daa663bccff673595f4e12a419a496`. MIT; Copyright (c) 2026
  CopilotKit. The destination-classification concepts in
  `src/main/selfimpulse/coworker/navigation.ts` were selectively adapted from
  `server/src/computer/target.ts`; policy/audit placement was reviewed in
  `gateway.ts` and `policy-network.ts`. The full permission text ships beside
  the module in `LICENSE.openbot.txt`. No OpenBot gateway, Intelligence,
  Docker, PostgreSQL, localhost service, or external browser runtime is
  included.
- **OpenDots:** Atai Barkai, `CopilotKit/OpenDots` at commit
  `8091324942b86789ed0da7facbee855145d933b0`. MIT; Copyright (c) Atai Barkai.
  Optimistic page revisions, hierarchy checks, and exact-draft review receipts
  in `src/main/selfimpulse/library/service.ts` were selectively adapted from
  `src/server/pages.ts` and `src/shared/page-review.ts`; the review interaction
  was reviewed in `src/client/PageReviewCard.tsx`. The full permission text
  ships beside the module in `LICENSE.opendots.txt`. Collections, Library
  pages, local JSON persistence, native approvals, and the editor are
  SelfImpulse-owned adaptations. SQLite, Intelligence, hosted workspaces, and
  service dependencies are excluded.
- **Motion Primitives:** ibelick, `ibelick/motion-primitives` at commit
  `120f64f6ca60348e251f929e9c81f11ccbe45eda`. MIT; Copyright (c) 2024
  ibelick. `LiveNumber.tsx` adapts the animated-number technique to the
  existing Framer Motion runtime and reduced-motion behavior. The full
  permission text ships at `src/renderer/src/motion/LICENSE.motion-primitives.txt`.
- **Animata:** Animata, `codse/animata` at commit
  `e7478b835a3b5c4153e71f60666634e91bb38813`. MIT; Copyright (c) Animata. `SaveStatus.tsx`
  adapts the status-transition technique, driven by real save/conflict state
  rather than demo timers. The full permission text ships at
  `src/renderer/src/motion/LICENSE.animata.txt`.

## Open CoDesign and OpenDesign — native Marketspace references

- **Open CoDesign:** OpenCoworkAI contributors,
  `OpenCoworkAI/open-codesign` at commit
  `4cf33932edc5f687e3cf7190261ebbb02c898d08`. MIT; Copyright (c) 2026
  OpenCoworkAI Contributors. The complete permission text ships at
  `src/main/marketspace/LICENSE.open-codesign.txt`.
- **OpenDesign:** Open Design contributors, `nexu-io/open-design` at commit
  `9724c44142ea0afaee3d207f37901b31c66a44ad`. Apache-2.0; Copyright 2026
  Open Design contributors. The complete license text ships at
  `src/main/marketspace/LICENSE.open-design.txt`.
- **Used for:** research and selective product concepts around portable
  `DESIGN.md` systems, workspace-backed artifacts, static preview isolation,
  declarative trust, and catalog UX. The inspected files and exact scope are
  recorded in `src/main/marketspace/PROVENANCE.json`.
- **Local implementation:** `src/main/marketspace/`, the native Marketspace
  agent tools, and `MarketspaceSection.tsx` are SelfImpulse-owned code and
  original catalog text. No upstream source file, daemon, Electron shell,
  bundled agent/provider runtime, MCP/localhost bridge, or external CLI is
  included. The upstream license notices are retained for attribution and
  future redistribution; they do not change the SelfImpulse license.

## Stagehand — native AI browser engine

- **Upstream:** Browserbase Inc., `browserbase/stagehand`; local SDK behavior
  was reviewed at revision `8023f34161d650c196dc343d2c232fb5e129a826`.
- **Runtime dependency:** `@browserbasehq/stagehand` **4.3.0**, pinned exactly.
- **Licence:** MIT — Copyright (c) 2024 Browserbase Inc. The complete copyright
  and permission text ships at `LICENSES/stagehand-MIT.txt`; the npm package's
  own licence is also retained in production dependencies.
- **Used for:** local Chrome launch, deterministic page operations, and the
  `observe` / `act` / structured `extract` browser primitives. The integration
  uses `Stagehand.create` with a SelfImpulse provider callback. Browserbase
  hosting is optional and is not configured by SelfImpulse.
- **Local implementation:** `src/main/browser/` and the existing browser tool,
  approval, DLP, usage, task, artifact, and settings paths provide actor-scoped
  profiles, loopback-only CDP control, request verification, sanitized errors,
  and product-native presentation. No upstream agent loop, MCP/server bridge,
  external CLI, or Browserbase cloud session is introduced. Integration scope
  is recorded in `src/main/browser/PROVENANCE.json`.

## npm dependencies

The dependencies declared in `package.json` — Electron, React, Stagehand, the Anthropic
and OpenAI SDKs, the Model Context Protocol SDK and the others — remain
under their own licences.

## Studio engines

The desktop engines driven by `studio_commands` and `studio_run` are covered
separately in `docs/third-party-notices.md`.
