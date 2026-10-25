# SelfImpulse

### The governed, local-first enterprise agent workspace

SelfImpulse turns a request into real work—research, files, code, documents,
scheduled jobs, and multi-agent execution—while keeping identity, policy,
approvals, memory, evidence, and recovery inside one coherent desktop runtime.

**Our vision:** an enterprise should be able to delegate an outcome to an agent
team and verify not only the answer, but also **who acted, under which policy,
with which data, at what cost, what was recovered, and whether the system
measurably improved.**

[Product vision](./VISION.md) · [Documentation](./docs/README.md) ·
[Latest source release](https://github.com/wizardwoodx-afk/moonith/releases/latest)

---

## Why SelfImpulse

Most agent demos optimize for an impressive answer. SelfImpulse is being built
for the work around that answer:

- **Earned, scoped autonomy** — versioned Outcome Contracts, exact-scope grants,
  action-time RBAC, DLP, approvals, signed outcome evidence, reviewed regressions,
  and automatic circuit breaking. Evidence creates eligibility; only administrators
  expand authority.
- **Reliable execution** — typed workflows, durable model/tool steps, retries,
  timers, recovery, and stable Captain/Crew identities.
- **Measured learning** — RSIRALS evaluates runtime-policy changes on real,
  attributed development and held-out runs instead of declaring every new
  lesson an improvement.
- **One product, not a framework pile** — selected upstream capabilities are
  merged beneath SelfImpulse's existing provider, tool, memory, approval, and
  UI contracts. We do not install competing agent stacks side by side.

## What is shipped today

The current source line is **0.3.0**. These are implemented product
capabilities, not roadmap items.

| Area | Current capability |
| --- | --- |
| **Captain** | A desktop agent that plans, calls real tools, streams responses, verifies stop conditions, and produces task artifacts. |
| **Crew Mesh** | Supervised specialists, single or multi-job delegation, bounded parallel teams, independent failures, durable lineage, usage, and live activity. New runs have private workspaces and scoped browser sessions. |
| **Native coworker privacy** | Per-Captain/Crew Chromium storage, private Crew write roots with explicit artifact handoff, task-deletion cleanup, and localhost/private-network/metadata navigation protections. |
| **Native AI Browser** | Headless Stagehand 4.3 sessions in the app, using the task's existing provider/DLP/usage path; AI observe, individually approved act, schema-validated extraction, deterministic controls, isolated Captain/Crew profiles, live activity cards, visible takeover, and an honest built-in Chromium fallback. |
| **Library** | Local collections and hierarchical Markdown pages, revision-checked autosave, conflict recovery, full human review for Captain drafts, and idempotent approved saves. |
| **Native Marketspace** | Reviewed/local `DESIGN.md` systems, static sandboxed previews, explicit install/apply actions, and Captain-native search/read/install/apply tools—without a second design runtime. |
| **Agent Teams & Table** | Peer Captain collaboration with shared goals, proposals, and an explicit shared ledger. |
| **Verified Outcomes** | Versioned business-outcome contracts, pinned task scope, exact agent/tool/data/environment/model/policy grants, deterministic receipts, human outcome review, enforced regression checks, policy shadow, administrator-only promotion, and automatic circuit breaking. |
| **Enterprise Control Plane** | Native namespaces, human/agent principals, Roles, AccessBindings, deny-overriding Restrictions, lifecycle state, optimistic concurrency, and immutable revisions. |
| **Runtime RBAC & DLP** | Executor/Researcher/Viewer/Custom roles, action-time checks, tool allow/deny rules, secret and sensitive-data detection, redaction, and blocking before configured egress boundaries. |
| **Approvals** | Manual or policy-controlled tool approval, persistent task waiting state, cancellation, and durable approval decisions. |
| **Audit evidence** | Searchable runtime events, hash-chained and HMAC-signed local records, integrity verification, and deterministic signed export. |
| **RSIRALS** | Recursive Self-Improving Reinforcement Agentic Learning System: attributed strategy experiments, regularized development/held-out evaluation, utility-aware memory, verified skill proposals, and learning receipts. |
| **Typed workflows** | Zod-validated steps, sequential/parallel/branch/foreach/loop composition, snapshots, event streams, cancellation, and suspend/resume beneath agent execution. |
| **Durable execution** | Completed-step replay, bounded retries and backoff, durable timers, keyed state, awakeables, named promises, deterministic values, and active-run recovery. |
| **Impulse Runtime** | Transactional steering queues, continuation fencing, and bounded repetitive-output protection derived from selected OpenClaw core source. |
| **Memory & skills** | Scoped local memory, utility-aware retrieval, installable skill bundles, a registry/marketplace path, and human-approved learning outcomes. |
| **Tools & integrations** | Workspace files, shell and browser tools, documents/spreadsheets/presentations, web research, MCP, connectors, channels, schedules, and Studio command bridges. |
| **Premium workspace** | Now/Crew/Tools/Files task operations, artifacts, responsive animated surfaces, reduced-motion support, and a broad light/dark theme catalog. |

### Verified Outcomes in plain language

An Outcome Contract names the downstream business result and the evidence that
must support it. Each task pins a contract revision, data class, and environment.
Captain and Crew still pass RBAC, enterprise policy, schema, DLP, and existing
approval controls; a grant can waive only an eligible routine approval inside its
exact agent/tool/model/policy scope.

Every bound terminal run produces signed evidence. A material failure opens the
matching autonomy circuit and becomes a sanitized regression candidate. After
human review, that regression runs on later matching outcomes—or requires human
review when no honest deterministic check exists. Sufficient evidence makes a
promotion **eligible**; only a local administrator can authorize it. Read
[Verified Outcomes and scoped autonomy](./docs/verified-outcomes.md) for the
security and verification boundaries.

### RSIRALS in plain language

SelfImpulse can learn from work without retraining a model. RSIRALS tracks
which runtime strategy and exact briefing lessons were used, credits only
those lessons, compares candidates against a baseline using measured quality,
cost, tokens, and uncertainty, and checks promising candidates on held-out
runs. Skill promotion still requires verification and human authority.

It is **non-parametric runtime learning**: no weight training, no unrestricted
recursive source rewriting, and no guarantee that a candidate will generalize.

## Enterprise architecture

```text
Captain / Agent Teams / Schedules
                │
                ▼
      SelfImpulse AgentRuntime
      ├─ Impulse Runtime steering + output safety
      ├─ Crew Mesh supervised delegation
      ├─ Typed workflow steps + durable journal
      ├─ Outcome Contracts + scoped Autonomy Grants
      └─ RSIRALS assignment / briefing / settlement
                │
                ▼
   Action-time enterprise and data boundaries
   ├─ task RBAC + native scoped authorization
   ├─ DLP + workspace containment + approvals
   ├─ scoped autonomy + deterministic outcome checks
   └─ hash-chained / signed runtime evidence
                │
                ▼
 Existing providers, tools, memory, skills, MCP,
 connectors, artifacts, local stores, and UI
```

There is one authoritative task transcript and one tool/policy path. Imported
ideas live below that boundary; they do not become separate control planes.

## Where Mastra fits

**Mastra-derived workflow capabilities are already integrated.** The local
`src/main/selfimpulse/workflow/` layer provides typed steps, composition,
snapshots, streams, cancellation, and suspend/resume. Captain model/tool nodes
use the same step boundary as standalone workflows.

We deliberately do **not** install the full `@mastra/core` distribution. At the
October 2026 assessment its package was roughly 83 MB unpacked and also spanned
agents, providers, memory, storage, vector, MCP, observability, server, and
Studio surfaces that would duplicate or conflict with SelfImpulse.

The valuable next Mastra-inspired work is product-specific:

1. A governed catalog of reusable workflow templates.
2. A workflow run inspector built from real snapshots and event streams.
3. Reusable human-input/approval steps connected to the existing approval
   broker—not a second approval UI.
4. Workflow definitions that can be scheduled through the existing Schedules
   surface and audited through the existing evidence ledger.

The integration decision and current scope are recorded in
[the workflow/durable merge plan](./docs/mastra-restate-merge-plan.md) and
[the implementation report](./docs/agent-workflow-durability-themes.md).

## Enterprise roadmap

The detailed vision and priorities are in [VISION.md](./VISION.md). The next
high-value additions are:

- **Policy packs and delegation:** reusable admin policy templates, signed
  policy export/import, time-bound grants, and separation-of-duty approvals.
- **Workflow operations:** reusable workflow catalog, run inspector,
  human-input steps, and schedule integration using the existing engine.
- **Evidence everywhere:** redacted SIEM/OpenTelemetry export and optional
  remote audit anchoring/retention.
- **Enterprise rollout:** signed installers, SBOM/release provenance, managed
  deployment configuration, proxy/private-endpoint controls, and update
  strategy.
- **Organization identity:** OIDC SSO, SCIM/directory mapping, and centrally
  distributed policy—explicitly separate from today's native local control.
- **Measured organizational learning:** admin-approved evaluation packs,
  champion/challenger rollout, cost-per-verified-outcome dashboards, and
  stronger contamination controls for RSIRALS.
- **Outcome verifiers and true agent shadowing:** governed read-only business
  connector checks and isolated candidate-agent shadow runs. Today's policy
  shadow replays observations only; it does not claim agent shadow deployment.
- **Business systems:** governed ERP/ITSM connectors, beginning read-only and
  adding typed, approved writes only after the evidence path is strong.

These are **planned**, not represented as shipped.

## Product surfaces

- **Home & Tasks** — compose work, attach sources, follow the transcript, and
  inspect artifacts.
- **Now / Crew / Tools / Files** — live operational views of the current task.
- **Library** — local Markdown collections and pages, with revision-safe editing
  and explicit human approval for agent-created drafts.
- **Native Marketspace** — reviewed/local design systems, inspectable static
  previews, and approved application to real task artifacts in the existing
  Captain runtime.
- **Agent Teams & Table** — deliberate peer-agent collaboration.
- **Schedules** — recurring work while SelfImpulse is running.
- **Settings** — models, tiers, memory, skills, Crew Mesh, MCP, connectors,
  channels, AI Browser, appearance, enterprise controls, RSIRALS evidence, and audit.

## Run from source

### Prerequisites

- Node.js **22.18 or newer**
- A supported platform for the installed Electron version
- At least one model provider/endpoint configured by you
- Google Chrome or Chromium for Stagehand AI browsing (the deterministic
  built-in Chromium fallback does not need a separate Chrome installation)

```bash
npm ci
npm run dev
```

Open **Settings → Models** to configure a provider and model. SelfImpulse is
local-first, not necessarily offline: prompts and tool arguments can leave the
machine when you configure a cloud provider or network tool. Local RBAC, DLP,
approval, and audit boundaries apply before their respective actions.

Open **Settings → AI Browser** to check Chrome discovery, choose Stagehand or
built-in Chromium, and set the new-session headless preference. Stagehand does
not include a Chrome binary; set `CHROME_PATH` if your executable is outside the
standard install locations. See [Native AI Browser](./docs/native-browser.md)
for takeover behavior, approvals, containment, and residual security limits.

### Verify and build

```bash
npm run typecheck
npm test
npm run build
```

For a Windows NSIS installer:

```bash
npm run dist:win
```

`npm run build` writes compiled main/preload/renderer bundles to `out/`.
`npm run dist:win` writes installer artifacts to `release/`. A GitHub **Source
code (zip)** asset is a source snapshot, not an installable application.

The current Verified Outcomes source line passed both TypeScript projects and
production builds. Its full test command executed **371 passing tests across 66
runnable files** in the Linux verification sandbox. Three
Electron-binary-dependent suites could not start there and are not counted as
passing; `npm test` remains the canonical full-suite command on a development
machine. No interactive Electron/model acceptance run or local Chrome executable
was available, so live provider and Stagehand/Chrome behavior is not claimed by
that result.
See [build and release](./docs/build-and-release.md) for packaging details.

## Security and scope

SelfImpulse is enterprise-focused, but does not claim certification or every
enterprise deployment feature today:

- Native enterprise control is **in-process and local**, not hosted SSO, SCIM,
  or hard multi-tenant isolation.
- Coworker workspaces use actor/path containment, not containers or VMs;
  scoped Stagehand/Chromium sessions and DNS/private-network checks do not make
  every public page or network destination trustworthy. Browser takeover can
  reset unsaved page state; profiles are not an encrypted credential vault.
- Library pages are local atomic JSON records, not an encrypted-at-rest
  document vault; provider and network-tool egress still depends on your
  configuration and the existing DLP boundary.
- Local signed audit and outcome state are tamper-evident, not remote immutable/WORM storage.
- Generic outcome checks verify declared task metadata, not arbitrary downstream
  business-system state. Human-only outcomes stay behind human review; policy
  shadow is not a live agent shadow deployment.
- DLP is pattern/field-based defense in depth, not a guarantee that every
  secret or confidential business fact will be recognized.
- Completed durable steps replay safely; incomplete arbitrary external side
  effects remain at-least-once, not magically exactly-once.
- RSIRALS improves runtime policy from measured evidence; it does not train
  model weights or approve its own skills.

Read the detailed boundaries in each capability document before making a
deployment or compliance decision.

## Documentation

Start with the [documentation index](./docs/README.md).

- [Product vision and enterprise roadmap](./VISION.md)
- [Verified Outcomes and earned, scoped autonomy](./docs/verified-outcomes.md)
- [Native Enterprise Control Plane and RSIRALS](./docs/native-enterprise-rsirals.md)
- [Runtime RBAC, DLP, and signed audit](./docs/enterprise-controls.md)
- [Impulse Runtime and Crew Mesh](./docs/impulse-runtime-crew-mesh.md)
- [Native Coworker, privacy boundary, and Library](./docs/native-coworker-library.md)
- [Native AI Browser, Stagehand integration, and containment](./docs/native-browser.md)
- [Native Marketspace, design-system research, and security remediation](./docs/native-marketspace.md)
- [Typed workflows and durable execution](./docs/agent-workflow-durability-themes.md)
- [Task workspace](./docs/task-workspace.md)
- [Build and release](./docs/build-and-release.md)

Historical milestone reports preserve the verification numbers from their
implementation date. The latest release and repository history are the source
of truth for the current combined state.

## License and attribution

SelfImpulse is **source-available proprietary software, not open source**; see
[LICENSE](./LICENSE).

Third-party components and adapted capabilities retain their own licenses and
copyright notices. See [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md) and the
`PROVENANCE.json` / license files beside integrated modules.
