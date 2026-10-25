# SelfImpulse product vision

## North star

**Make autonomous work governable enough for the enterprise, useful enough for
daily work, and measurable enough to improve with evidence.**

SelfImpulse is a **local-first enterprise agent workstation where autonomous
work is governed, resumable, measurable, and auditable by design.**

The north-star experience is simple to describe:

> An operator delegates a meaningful business outcome. A Captain assembles the
> right specialists, tools, memory, and workflow. Policy is enforced at the
> moment of action; humans decide consequential steps. The work survives a
> restart. The operator can inspect the result, cost, evidence, and recovery.
> RSIRALS proposes what to change next—and proves whether that change helps on
> held-out work before it becomes normal behavior.

The enterprise advantage is not merely a larger tool list. It is the ability to
**delegate with control and verify with evidence**.

## Product principles

### 1. Local-first control, explicit egress

Tasks, memory, credentials, artifacts, policy, journals, and audit state remain
under the user's local application authority. Network access is explicit:
configured model providers and tools can transmit data, so RBAC, DLP,
approvals, and evidence belong at those boundaries. “Local-first” must never be
used to imply that a cloud model is offline.

### 2. One system of authority

Captain, Crew Mesh, Agent Teams, schedules, workflows, and future connectors
use the same provider, tool, memory, approval, and audit architecture. An
integration is successful only when it strengthens that system—not when it
adds another runtime, database, localhost service, or settings island.

### 3. Humans hold consequential authority

Automation should reduce routine work, not hide responsibility. Sensitive
actions need clear summaries, scoped policy, interruptibility, and an inspectable
decision. More autonomy is earned through policy and evidence, not enabled by a
single global “trust the agent” switch.

### 4. Evidence over confidence

A polished answer is not proof of a completed job. SelfImpulse should preserve
real tool results, artifacts, policy decisions, approvals, failures, costs, and
recovery evidence. Product UI should make that evidence understandable without
turning the workspace into a wall of diagnostics.

### 5. Improvement must be measured

Learning is useful only when attribution and evaluation are stronger than the
story told about it. RSIRALS therefore separates development and held-out
evidence, tracks exact strategy/lesson usage, regularizes acceptance, and keeps
skill promotion behind verification and human authority.

### 6. Selective integration, complete product behavior

Use upstream research and permissively licensed source where it adds real
value. Merge selected capabilities beneath product-native names and contracts,
preserve attribution, wire actual UI/UX, and test behavior. Do not ship a
framework dump, a second brand, or a nonfunctional enterprise settings page.

### 7. Premium means calm

The interface should make complex agent work feel legible: minimal chrome,
intentional motion, useful density, accessible themes, reduced-motion support,
and progressive disclosure for technical evidence.

## The enterprise jobs we serve

| Persona | Job to be done | SelfImpulse direction |
| --- | --- | --- |
| **Operator / analyst** | Delegate research, documents, data work, and recurring processes without babysitting every step. | Captain, artifacts, schedules, reusable workflows, clear approvals, and resumable runs. |
| **Engineer / technical lead** | Use specialist agents and real tools without losing repository, workspace, or execution control. | Crew Mesh, durable steps, scoped folders, role policy, diffs/artifacts, and failure lineage. |
| **Team lead** | Coordinate agent work and understand status, cost, exceptions, and outcomes. | Agent Teams, live Crew/Now views, usage attribution, workflow inspection, and outcome summaries. |
| **Security / platform admin** | Decide which identities, models, tools, and data classes are allowed, and roll out policy safely. | Native control plane, RBAC/DLP, policy packs, directory identity, signed distribution, and central administration. |
| **Risk / audit / compliance** | Reconstruct what happened and demonstrate which human or policy authorized it. | Signed evidence, deterministic export, retention/anchoring, approval trails, and reproducible run metadata. |
| **Business-system owner** | Connect agents to systems of record without uncontrolled writes. | Typed read-only connectors first, schema-validated approved writes later, with complete evidence. |

## Six product pillars

### Governed autonomy

**Shipped foundation:** task-role RBAC, native scoped enterprise authorization,
Restrictions and lifecycle state, DLP, folder containment, manual approvals,
immutable control-plane revisions, and signed runtime evidence.

**Where it goes:** organization identity, delegated administration,
separation-of-duty approval chains, reusable policy packs, data-classification
policy, and centrally managed deployment.

### Coordinated agent work

**Shipped foundation:** Captain, supervised Crew Mesh specialists, bounded
parallel teams, Agent Teams/Table, shared goals/proposals, tools, memory,
skills, MCP, connectors, channels, and native Stagehand AI browsing with
actor-scoped profiles, explicit action approvals, and deterministic fallback.

**Where it goes:** reusable team/workflow templates, explicit capability
discovery, cross-run handoffs, and stronger outcome verification. More agents
are valuable only when coordination remains bounded and attributable.

### Durable business processes

**Shipped foundation:** typed workflows, durable model/tool steps, retries,
backoff, timers, snapshots, suspend/resume, recovery, schedules, and Crew run
finalization.

**Where it goes:** a workflow catalog, run inspector, human-input steps,
schedule integration, compensation patterns, and explicit external-side-effect
contracts. Long-running business work needs operational visibility, not only a
transcript.

### Measured learning and economics

**Shipped foundation:** RSIRALS strategy assignment and settlement,
development/held-out comparisons, utility-credited lessons, regularized
candidate acceptance, verifier-backed skill proposals, signed learning
receipts, and model/token/cost visibility.

**Where it goes:** governed evaluation packs, champion/challenger rollout,
contamination-resistant benchmarks, outcome-based cost dashboards, and
admin-controlled promotion across teams. Learning should optimize verified
outcomes, not token volume or self-reported confidence.

### Evidence and interoperability

**Shipped foundation:** runtime audit, signed export, control-plane decision
evidence, MCP/connectors/channels, artifacts, and typed integration contracts.

**Where it goes:** redacted SIEM/OpenTelemetry export, remote audit anchoring,
retention controls, ITSM/ERP connections, and reproducibility metadata. External
systems should receive the same redacted evidence contract, not a raw transcript
dump by default.

### Enterprise-grade delivery and experience

**Shipped foundation:** Electron desktop application, local secret storage,
premium themes and workspace, accessible settings, Windows packaging scripts,
and third-party attribution.

**Where it goes:** signed installers, SBOM and release provenance, managed
configuration, private endpoints/proxy controls, update policy, OS sandboxing,
and interactive enterprise acceptance testing.

## Prioritized roadmap

Status language is intentional:

- **Now** describes capabilities implemented in the current source line.
- **Next** describes the recommended product increments, not shipped claims.
- **Later** describes larger capabilities that need new infrastructure or
  organizational requirements.

### Now — the foundation is real

- One local-first Captain/Crew/agent-team runtime.
- Native enterprise identity, scoped authorization, restrictions, lifecycle,
  revisions, RBAC, DLP, approvals, and signed audit.
- Typed workflows and durable execution beneath actual agent operations.
- RSIRALS measured runtime-policy learning.
- Native headless Stagehand observe/act/structured extraction through the
  existing provider, DLP, usage, task, approval, and artifact architecture.
- Local artifacts, memory, skills, schedules, MCP/connectors/channels, and a
  premium configurable desktop workspace.

### Next — make governance reusable and operations visible

Priority is ordered by enterprise value and by how well each item builds on the
existing architecture.

| Priority | Proposed increment | Acceptance boundary |
| --- | --- | --- |
| **1** | **Reusable workflow catalog** | Versioned, typed templates with declared inputs, tools, data classes, permissions, schedules, and expected artifacts. Instantiating a template must use the existing AgentRuntime and policy path. |
| **2** | **Workflow run inspector** | Real run/step status, retries, suspension, resume payload, duration, cost/token attribution where available, artifacts, and failure lineage. No decorative or fabricated progress. |
| **3** | **Governed human-input workflow steps** | Typed suspend/resume payloads connected to the existing approval broker, persistent waiting state, cancellation, timeout policy, actor identity, and audit evidence. No second approval system. |
| **4** | **Policy packs and delegated approvals** | Signed/versioned policy export/import, diff and migration, reusable data/tool classifications, time-bound grants, multi-stage approvals, and separation of duties. Local recovery authority must remain protected. |
| **5** | **Evidence export and remote anchoring** | Redacted OTLP/SIEM events, deterministic correlation IDs, retry/backpressure, optional remote hash anchoring, and explicit retention/residency controls. Export must not silently bypass DLP. |
| **6** | **Enterprise release and deployment controls** | Signed Windows packages, SBOM, dependency/provenance attestations, managed defaults, proxy/private-endpoint configuration, and a deliberate update/rollback policy. |
| **7** | **Governed RSIRALS operations** | Admin-defined evaluation suites, champion/challenger comparison, stronger holdout separation, approval-to-promote workflows, and cost per verified outcome. No autonomous skill promotion. |
| **8** | **Read-only systems of record** | A governed ERP/ITSM connector profile with typed queries, field-level DLP, scoped credentials, result citations, and audit. Writes come later as separately typed, approved actions. |

### Later — organization-scale control and execution

These are valuable, but should not be pretended into existence by adding labels
to the current desktop application.

- **OIDC SSO and SCIM:** managed organization identities, group-to-role mapping,
  deprovisioning, and centralized policy distribution.
- **Shared multi-user workspaces:** authoritative multi-user state, concurrent
  approvals, team-level artifacts, and clear tenant/namespace isolation.
- **Remote immutable evidence:** organization-controlled WORM/retention storage
  and independently verifiable audit anchors.
- **Optional distributed execution:** durable workers and shared state only when
  real scale requirements justify them, with explicit idempotency and side-effect
  semantics rather than an exactly-once marketing claim.
- **Stronger execution isolation:** OS containers/sandbox profiles for shell,
  browser, and untrusted connector work, with usable policy diagnostics.
- **Approved business writes:** schema-validated ERP/ITSM/CRM mutations with
  separation of duties, compensating actions where possible, and complete
  before/after evidence.

## Mastra: the right integration strategy

### Decision

**Deepen the existing SelfImpulse workflow layer; do not add the full Mastra
framework as a parallel runtime.**

The current local workflow layer already covers the highest-value primitive:
typed, composable, resumable execution. It is wired into Captain model/tool
nodes and durable execution. Mastra's documented workflow direction—typed
steps, branching/parallel/loops, snapshots, streaming, and typed
suspend/resume for human interaction—validates this architecture.

The full package is not a drop-in enterprise upgrade. It would add substantial
weight and overlapping opinions about agents, providers, memory, tools,
storage, MCP, servers, observability, and visualization. Those are exactly the
places where SelfImpulse must remain authoritative.

### Next Mastra-inspired capabilities

1. **Workflow templates as governed product objects** — typed schemas, version,
   owner, required permissions, data classification, expected outputs, and a
   signed definition digest.
2. **A real run inspector** — render the existing workflow snapshots/events and
   connect each run to its task, Crew lineage, approvals, artifacts, and audit.
3. **Reusable human-in-the-loop steps** — map typed suspend/resume to existing
   approval requests, durable waiting state, response authorization, and
   cancellation. Human input can include approve/reject, structured edits, and
   explicit re-entry into a prior workflow node.
4. **Scheduled workflows** — reference a versioned workflow definition from the
   existing Schedules surface; preserve the fact that schedules run only while
   the application is running unless a future hosted scheduler is explicitly
   introduced.
5. **Workflow evaluation and observability** — record verified outcome, retry,
   latency, model/token/cost, and policy evidence using existing stores and
   exporters. Feed evaluation signals to RSIRALS only with exact attribution.

### Explicit exclusions

Do not import Mastra Studio, a second provider registry, a second memory or
storage stack, a second agent network, or another local server merely to check
a feature box. Add a dependency only for a concrete capability that cannot be
implemented more cleanly behind the existing contracts, and reassess package
size, license, security, and maintenance at that time.

## How we will measure the vision

No target values are claimed yet. These are the measures that should determine
whether future enterprise work is succeeding:

- **Verified outcome rate:** completed work that passes declared verification,
  not merely a final model response.
- **Human intervention quality:** approval latency, overrides, rejected actions,
  and avoided high-risk operations.
- **Recovery quality:** successful resumption after interruption without
  duplicated completed steps or lost task lineage.
- **Governance coverage:** percentage of consequential actions evaluated by
  policy and represented in evidence.
- **Data protection:** exercised DLP block/redaction paths, egress denials, and
  false-positive review—not a claim of perfect detection.
- **Learning quality:** held-out candidate acceptance, rollback rate, evaluation
  contamination checks, and downstream outcome changes.
- **Unit economics:** provider/token/tool cost and elapsed time per verified
  outcome, with unavailable measurements shown as unavailable.
- **Operator trust:** task abandonment, manual rework, evidence inspection, and
  repeatable use of governed templates.

## Non-goals

- Unrestricted self-modifying autonomy or hidden self-approval.
- Claiming that local-first means all processing is offline.
- Treating a compliance feature checklist as a compliance certification.
- Replacing SelfImpulse's architecture with whichever agent framework is newest.
- Multi-agent activity for its own sake, fake progress, or synthetic enterprise
  dashboards.
- Promising exactly-once arbitrary external side effects or perfect DLP.
- Training foundation-model weights inside the desktop runtime.

## The enduring product idea

SelfImpulse should feel like a capable colleague with an exceptionally good
operations record: it can do the work, ask at the right moment, recover when
something goes wrong, show its evidence, and improve only when the results
justify it.
