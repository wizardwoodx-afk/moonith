# The merged backend

Knight Cowork runs on **one** backend. It was built from two apps: Knight's own
TypeScript runtime, and the Seamoon backend (a Node/Electron agent stack).
Seamoon's services were ported into `src/main/backend/`, the Moonwright agent
core now drives every turn, and Knight's renderer talks to the result over one
IPC contract.

## What lives where

```
src/main/backend/
  index.ts        the Backend facade — owns every service and the settings
  ipc.ts          the backend surface the renderer calls
  provider.ts     one client: OpenAI-compatible SSE + Anthropic, with failover
  anthropic.ts    the Anthropic wire format, same event contract
  adapter.ts      the Moonwright ports — the seam between the core and the app
  runner.ts       the AgentRunner: roles, delegation, per-run accounting
  moonwright.ts   the Moonwright turn, plus the learning-loop tools
  core/           the Moonwright agent core (loop, budget, stop gates, nudges,
                  learning, memory, skills)
  gateway/        the Moon Gateway: routing, sessions, channels, automations
  store.ts        the backend collections (sessions, messages, agents, teams,
                  memories, usage, MCP servers, settings)
  security.ts     the OS-keychain secret store, the gateway token, the
                  permission broker, the environment scrubber
  memory.ts       the memory ledger
  usage.ts        the usage ledger
  tools.ts        the sandboxed file and shell tool runtime
  mcp.ts          MCP clients (stdio and HTTP)
  lobe.ts         the LobeHub skill marketplace
  openclaw.ts     ClawHub and the OpenClaw gateway
  composio.ts     Composio toolkits
  microsoft.ts    GitHub Copilot and Microsoft 365
  computer.ts     screen capture, mouse, keyboard
  uitars.ts       the UI-TARS grounding model
  themes.ts       the appearance styles
  qoder-parity.ts the static skill and connector tables
```

## The seam

Moonwright's core is platform-neutral: it never imports `electron` and never
knows about Knight. It drives the turn through a small port interface:

```ts
interface MoonwrightPorts {
  callModel(messages, options): Promise<ModelResponse>
  listTools(): ToolSpec[]
  runTool(name, args): Promise<ToolResult>
  memory: MemoryPort
  skills: SkillsPort
  emit(event, payload): void
  now(): number
}
```

`src/main/agent/engine.ts` implements those ports over Knight's own tools and
the backend's provider. That is the whole integration: the core's phase
machine, budget, stop gates and learning loop drive the turn, while the tool
set, the approval flow, the artifact registry and the plan stay in
`src/main/agent/runtime.ts`.

`src/main/backend/adapter.ts` implements the same ports over the backend's own
sandboxed tool runtime — that path serves the Moon Gateway, where the agent
runs without a Knight task.

## The two tool shapes

The core declares a **flat** tool spec (`{ name, description, parameters }`);
the provider needs the **OpenAI wire** shape
(`{ type: 'function', function: { … } }`). The conversion happens at the port
boundary in `adapter.ts` — `toFlatTool` and `toWireTool`. Nothing else in the
app should care which shape it is holding.

## What was deliberately left behind

Seamoon's renderer was a pixel-level reconstruction of another product: its
compiled stylesheet, its fonts and its artwork were copied from that product's
bundle. None of it came across. Knight's React renderer and its own design
language are the interface; the backend brought the *machinery*, not the skin.

## Bugs found and fixed on the way in

- **The Moonwright bridge handed the core the wrong tool shape.** The core reads
  `tool.name`; the bridge supplied the OpenAI wire shape, so the core could
  never see a tool name. Fixed at the port boundary.
- **`openclaw.js` referenced an undefined `CLI` identifier** — every spawn would
  have thrown. The CLI package is now a constructor argument.
- **Provider keys leaked into spawned shells.** `runCommand` passed the raw
  `process.env` to the child. It now uses `scrubEnv`, which drops the key
  patterns the providers read.
- **The Copilot token was moved to the keychain but still read from the plain
  settings file.** The `Copilot` client now reads the keychain first.
- **`M365` account writes used `update` on a collection with no such key**, so
  the first sign-in lost the device code. They use `set` with the merged
  account.

## Third-party work

The Moonwright core is a TypeScript port of the
[Hermes agent](https://github.com/NousResearch/hermes-agent) (MIT). The Moon
Gateway follows the [OpenClaw](https://github.com/openclaw) gateway contracts
(MIT). Both are used under their licences, with attribution.
