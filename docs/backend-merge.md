# The merged backend

SelfImpulse runs on **one** backend. It was built from two apps: the original
Knight Cowork TypeScript runtime, and a second Electron agent stack whose
services were ported into `src/main/backend/`. The agent core now drives every
turn, and the renderer talks to the result over one IPC contract.

## What lives where

```
src/main/backend/
  index.ts          the Backend facade — owns every service and the settings
  ipc.ts            the backend surface the renderer calls
  provider.ts       one client: chat-completion SSE and direct APIs, with failover
  anthropic.ts      the direct-API wire format, same event contract
  adapter.ts        the agent-core ports — the seam between the core and the app
  runner.ts         the AgentRunner: roles, delegation, per-run accounting
  moonwright.ts     the agent turn, plus the learning-loop tools
  core/             the agent core (loop, budget, stop gates, nudges, learning,
                    memory, skills)
  gateway/          the local gateway: routing, sessions, channels, automations
  store.ts          the backend collections (sessions, messages, agents, teams,
                    memories, usage, MCP servers, settings)
  security.ts       the OS-keychain secret store, the gateway token, the
                    permission broker, the environment scrubber
  memory.ts         the memory ledger
  usage.ts          the usage ledger
  tools.ts          the sandboxed file and shell tool runtime
  mcp.ts            MCP clients (stdio and HTTP)
  marketplace.ts    the skill marketplace client
  external-agent.ts the public skill registry and the external agent gateway
  connectors.ts     the app-toolkit service
  work.ts           the subscription account and the work-account service
  computer.ts       screen capture, mouse, keyboard
  grounded.ts       the grounded action model for GUI tasks
  themes.ts         the appearance styles
```

## The seam

The agent core is platform-neutral: it never imports `electron` and never knows
about the host. It drives the turn through a small port interface:

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

The crew sub-agents run on the **same** engine — `runSubAgent` calls
`runEngineTurn` with a restricted tool set. There is one loop in this app.

`src/main/backend/adapter.ts` implements the same ports over the backend's own
sandboxed tool runtime — that path serves the local gateway, where the agent
runs without a host task.

## The two tool shapes

The core declares a **flat** tool spec (`{ name, description, parameters }`);
the provider needs the **wire** shape
(`{ type: 'function', function: { … } }`). The conversion happens at the port
boundary in `adapter.ts` — `toFlatTool` and `toWireTool`. Nothing else in the
app should care which shape it is holding.

## Naming

Every service the app exposes has a host name. The app never advertises a
third party's product in its own chrome — the panes read *Connectors*,
*Work Files*, *Grounded Actions*, *Subscription Account*, *Marketplace* and
*Registry*, and the provider presets read *Cloud Provider*, *Fast Cloud
Provider*, *Enterprise Cloud*, *Accelerated Cloud* and *Subscription Account*.

The upstream service names survive only where they are the protocol:
the SDK imports, the HTTP header a subscription API requires, and the endpoint
URLs. None of those are shown in the interface. A provider's *own* name and
model remain the user's own configuration and are displayed as such.

## What was deliberately left behind

The other app's renderer was a pixel-level reconstruction of a third product:
its compiled stylesheet, its fonts and its artwork were copied from that
product's bundle. None of it came across. The React renderer and its own design
language are the interface; the backend brought the *machinery*, not the skin.

## Bugs found and fixed on the way in

- **The agent bridge handed the core the wrong tool shape.** The core reads
  `tool.name`; the bridge supplied the wire shape, so the core could never see
  a tool name. Fixed at the port boundary.
- **An undefined CLI identifier** in the external-agent runner — every spawn
  would have thrown. The CLI package is now a constructor argument.
- **Provider keys leaked into spawned shells.** `runCommand` passed the raw
  `process.env` to the child. It now uses `scrubEnv`, which drops the key
  patterns the providers read.
- **The subscription token was moved to the keychain but still read from the
  plain settings file.** The client now reads the keychain first.
- **Work-account writes used `update` on a collection with no such key**, so
  the first sign-in lost the device code. They use `set` with the merged
  account.

## Third-party work

The agent core is a TypeScript port of the
[Hermes agent](https://github.com/NousResearch/hermes-agent) (MIT). The local
gateway follows the [OpenClaw](https://github.com/openclaw) gateway contracts
(MIT). Both are used under their licences, with attribution.
