# The vendored graph runtime

This directory holds the **source of the graph runtime SelfImpulse's mission
cycle runs on**. It is not a build artefact and it is not a dependency
wrapper: the files here are the upstream files, readable, patchable, and
committed, so that the one piece of machinery this project borrows rather
than writes can be read by the people who have to fix it.

The upstream project is named in the attribution, not here: see
`docs/legal/THIRD-PARTY-NOTICES.md` for the copyright notice and the
licence texts, and `LICENSES/` for the licences themselves.

## What it is

| Directory | What it holds |
|---|---|
| `runtime/` | the graph runtime — `StateGraph`, `Annotation`, `interrupt`, `Command`, the Pregel loop |
| `checkpoint/` | the checkpointer contract — `BaseCheckpointSaver`, the checkpoint and pending-write types |
| `core/` | the supporting runtime — messages, runnables, tools, channels, the callback manager |
| `stubs/` | **first-party SelfImpulse code** that replaces upstream surfaces this product must not have |
| `thirdparty/` | upstream packages the runtime imports at runtime, copied in verbatim (`p-queue`, `mustache`, `@cfworker/json-schema`) |
| `licenses/` | the upstream licence texts, verbatim |
| `PROVENANCE.json` | what was taken, what was left out, what was changed, and why |

## Why it is here rather than in `node_modules`

Three reasons, in the order they mattered.

**The point of borrowing a runtime is that it can be fixed.** When a graph
run misbehaves, the answer has to be readable in this repository. A package
in `node_modules` is a version number; a directory in `vendor/` is the code.

**This product runs on the owner's machine.** Every surface in this tree that
could reach a hosted service has been removed or made to refuse, and that
work is only possible because the code is here to be edited. See
"What was changed" below.

**The licence permits it, and it is recorded.** The upstream licence texts
travel with the software: `licenses/`, `LICENSES/`, and the attribution in
`docs/legal/THIRD-PARTY-NOTICES.md`.

## What was left out, and why

- **The hosted-server client** (`@langchain/langgraph-sdk`, `remote/`).
  That is the LangGraph PLATFORM surface. SelfImpulse has no server, and a
  licence-keyed server would break the promise that a mission record
  verifies offline with one command and no state.
- **The model bindings** (`prebuilt/`). SelfImpulse reaches providers
  through `src/engine/providers.ts`, which owns the key, the redaction and
  the token ledger. A second path to a provider is a second path that is
  not receipted.

## What was changed, and why

Some upstream files could reach the network. Each is vendored with its export
names unchanged — so its importers are untouched — and made to refuse in
words instead. `PROVENANCE.json` records each one under `patched`.

| File | What it did | What it does now |
|---|---|---|
| `core/utils/tiktoken.js` | fetched an encoding table from `tiktoken.pages.dev` | refuses; the engine counts tokens itself (`src/engine/tokenOptim.ts`) |
| `core/utils/gateway.js` | resolved a hosted gateway base URL from the environment | refuses; there is no hosted gateway here |
| `core/runnables/graph_mermaid.js` | posted a graph's contents to `mermaid.ink` to render it | refuses; the diagram's text form is still available |

And the upstream surfaces this product must not have are replaced wholesale
by first-party stubs in `stubs/` — the tracing client, the model classes,
the prompt templates, the message history, the output parsers, the schema
helpers, the text splitters, the token encoder, and the remote renderer. Each
one refuses in words and says where SelfImpulse's own seam is. A stub that
quietly worked would be a second, unrecorded way to do something the product
already does properly.

## How it is updated

```bash
npm run vendor:graph-runtime                  # refresh from the repository's node_modules
npm run vendor:graph-runtime -- --refresh     # reinstall the pinned versions first
```

The pins live at the top of `tools/vendor-graph-runtime.mjs`. A refresh
rewrites this directory, this README, `PROVENANCE.json` and the `LICENSES/`
copies in one pass, so the attribution and the code cannot drift apart.

A refresh also re-checks every patch: if an upstream file no longer matches
the text a patch expects, the tool **fails loudly** rather than silently
vendoring a file whose patch no longer applies. A patch that quietly stopped
working would be worse than no patch at all.

## What uses it

`src/mission/runGraph.ts` — the mission cycle as a graph, with a gate that
can stop a run and a checkpointer that writes into SelfImpulse's own
tamper-evident run chain (`src/mission/graphCheckpointer.ts`). The cycle's
engines are unchanged: `executeTeam` still runs the seats, the inter-agent
bus still carries the dispatch, the evolution engine and the signed receipt
are folded exactly as before. What changed is the control flow, and what it
bought is a run that can stop and be continued.

The runtime is loaded **lazily** — the cycle imports it on the first cycle,
not on the first paint. A user who never runs a cycle does not download it.
In the browser build it lands in its own chunk (`runGraph-*.js`); the engine
chunk is the same size it was before this directory existed.

## What it costs

A cycle that cannot stop writes nothing to the run chain — a run with nothing
to resume has no reason to leave a trail of its own steps, and the run's
outcome is recorded by the receipt chain either way. So the default path adds
one graph's worth of scheduling and no journal writes.

A run that may stop keeps its steps in the chain, because that is the point:
the state it paused on has to survive the pause, and the chain that proves it
is the chain the product already used. That is twelve journal entries per
run, which is the price of a resumable, auditable graph run.
