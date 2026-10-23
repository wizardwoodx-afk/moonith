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
