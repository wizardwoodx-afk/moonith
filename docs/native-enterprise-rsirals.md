# Native Enterprise Control Plane and RSIRALS

Status: implemented in the SelfImpulse source tree on 2026-10-24. The protected `src/main/backend/core/` tree is unchanged by this milestone.

This milestone adds two product-native capabilities beneath the existing application authority:

1. **Enterprise Control Plane** — native identity, scoped authorization, restrictions, revisions, and lifecycle governance.
2. **RSIRALS — Recursive Self-Improving Reinforcement Agentic Learning System** — a stronger measured learning loop inside the existing mission runtime.

Neither capability starts another agent runtime, provider path, local server, MCP adapter, external CLI, OCC sidecar, database, or infrastructure service.

## 1. Enterprise Control Plane

### Native architecture

```text
Settings → Enterprise controls → Enterprise Control Plane
                  │ typed IPC
                  ▼
       EnterpriseControlService (Electron main)
        ├─ default-deny policy evaluation
        ├─ atomic local JSON persistence
        ├─ checksummed immutable revision history
        └─ existing signed runtime audit
                  ▲
Mission graph → registered native admission authorizer
                  └─ human mission.run + every seat's mission.run / agent.invoke
```

The UI and mission runtime call the same service. The renderer cannot supply a different management principal: administrative mutations are authorized as the main-process local-owner identity. Per-agent identities are created by the mission runtime with stable team/seat provenance.

### Implemented semantics

- **Namespaces:** exact resource namespace matching; namespace-wide or resource-kind/id scopes.
- **Principals:** the protected local human recovery owner and one native identity per mission team/seat.
- **Roles:** explicit action and resource-kind grants.
- **AccessBindings:** bind one principal to one same-namespace Role at a namespace, resource-kind, or exact-resource scope.
- **Restrictions:** principal-specific or namespace-wide deny rules, evaluated before and overriding every grant.
- **Lifecycle:** active, disabled, and archived. Archived records cannot be edited in the current revision. The default namespace and local recovery path cannot be disabled or archived, and a mutation that would lock out local control-plane recovery is rejected.
- **Immutable revisions:** each mutation appends a complete state snapshot with SHA-256 digest and previous-digest link. Restore clones an old state into a **new** revision; history is not rewritten. Optimistic `expectedRevision` checks reject stale writes.
- **Persistence:** atomic unique-temp-file rename with owner-only file creation. Invalid or corrupt storage fails closed and is never silently replaced by defaults.
- **Evidence:** native authorization and administrative decisions are sent to the existing signed runtime audit. Recent decisions are also available in the control-plane view.
- **Enrollment:** first mission admission enrolls an agent and its default native-agent binding in one revision. Later enrollment is idempotent and never recreates a removed grant or removes a Restriction.

The built-in native-agent Role allows assigned mission/tool/memory work but not control-plane administration or deciding its own approvals. Existing task-tool RBAC, DLP, manual approvals, folder containment, provider rules, and mission merge gates remain separate and additive.

### Mission enforcement

Electron startup registers `authorizeMissionTeam` with the mission graph's lightweight admission port. Before `executeTeam` can create worktrees or invoke a seat, admission checks:

- local owner `mission.run` on the exact mission id;
- each seat identity's `mission.run` on that mission;
- each seat identity's `agent.invoke` on that exact agent resource.

A missing grant, disabled identity/binding/Role, archived namespace, or matching Restriction throws an explicit refusal and stops the mission. Non-Electron pure probes do not create a user profile implicitly; they can inject the same admission port. Production Electron fails closed if startup registration is absent.

### Action-time enforcement matrix

| Boundary | Native actions enforced |
| --- | --- |
| Mission graph before `executeTeam` | `mission.run`, `agent.invoke` |
| Existing Captain/Crew action boundary, after task-role RBAC and before execution | `tool.use`; `remember` maps to `memory.write`, `recall_memory` to `memory.read` |
| Captain memory IPC | local-owner `memory.read` / `memory.write` on the `captain` memory resource |
| Backend memory IPC | local-owner `memory.read` / `memory.write` on the `backend` memory resource |
| Approval response IPC | local-owner `approval.decide` on the exact approval id |
| Control-plane administration | local-owner `enterprise.manage` |

Captain and Crew must pass both their pre-existing task-role policy and this native check. Tool-list filtering remains only a usability optimization; the runtime checks again at the action boundary and fails closed if native policy cannot decide. External mission harnesses still run their own internal tools: SelfImpulse enforces their mission/agent admission but does not claim to intercept every tool call inside those separate harness processes.

### Boundary

This is **native in-process policy enforcement**, not hosted SSO, SCIM, directory sync, OS-sandboxed execution, or hard multi-tenant isolation. It deliberately does not reproduce OCE's controller/worker/PostgreSQL/Kubernetes distribution. OCE semantics were adapted, not presented as an OCE service or an OCE-equivalent isolation boundary.

## 2. RSIRALS

### One integrated learning loop

RSIRALS upgrades the existing self-evolution path rather than adding a parallel branded framework:

```text
nextRunStrategy
  → exact development or held-out assignment
  → executeTeam with those real parameters
  → report strategy id + exact briefing lesson ids + measured outcomes/cost/tokens
  → settleSelfEvolution
       ├─ utility-credit only retrieved lessons
       ├─ measured reflection and world beliefs
       ├─ regularized baseline/candidate settlement
       ├─ verifier-backed skill proposals (human approval remains)
       └─ signed/digest learning receipt
```

The mission graph now actually calls both assignment and settlement. Previously exported but unwired strategy settlement is therefore part of the real execute→adapt path, and the pre-existing separate lesson fold was replaced by the single RSIRALS settlement to avoid double learning.

### Policy improvement

- One deterministic sparse strategy dimension changes per generation; numeric `checkBias` steps anneal over later generations.
- Baseline/candidate assignment alternates on the runs each arm actually governed. Unattributed history cannot score for an arm.
- Each arm needs at least three uncontaminated real development runs before a verdict.
- Acceptance uses **regularized utility**, while retaining the raw verified rate:
  - verified quality is dominant;
  - Bernoulli standard-error uncertainty penalizes sparse mixed evidence;
  - reported dollar cost and policy-token use apply small logarithmic penalties;
  - review depth, evidence depth, serial execution, lesson budget, and causal-briefing complexity apply explicit small penalties.
- A promising development margin must exceed `0.05`. Only then is the next balanced pair reserved as **held-out**. Development scores exclude these held-out records.
- Any observed held-out verified-rate regression rejects the candidate. A favourable held-out result cannot rescue a candidate that already lost on development evidence.
- Inconclusive experiments retire at the existing eight-attributed-run cap. Simulations and records explicitly marked `evidenceLeak` are excluded, not converted to failures or successes.
- Unknown provider dollar cost remains unknown: tokens-only usage is not recorded as measured zero. Usage penalties average only values actually reported; unknown values contribute no invented measurement.

These are conservative harness-policy experiments, not proof of a statistically significant or permanent improvement. One held-out run per arm is a guard against obvious transfer regression, not a comprehensive benchmark.

### Utility-aware memory and skills

- Briefing selection returns both lines and the exact lesson ids used. Settlement credits only those ids; it does not reinforce every memory record after a good run.
- Real outcomes apply a bounded incremental utility update with a small measured-cost adjustment. Simulated or contaminated runs apply no utility credit.
- Retrieval ranking multiplies the existing strength/recency/goal-overlap score by a bounded utility factor.
- `retrievalCount` and `utilityCount` are distinct from `useCount`, so merely retrieving a failure lesson cannot fabricate the repeated evidence required for a skill proposal.
- Existing skill verification and human-approval authority remains intact. Approved skills still enter later briefings through the existing path.

### Learning receipts and UI

Optional receipt fields bind memory-credit ids/model and evaluation metadata (development/held-out, contamination flag, reported cost/tokens) into the canonical SHA-256 evidence digest. Older receipts without those fields retain their previous canonical digest shape. Existing Ed25519 signing behavior and explicit unsigned status remain unchanged.

Settings → **RSIRALS learning** reads the live stores and shows adopted/candidate policies, recent attributed runs, memory utility, skill counts, learning receipts, and boundaries. It is a read-only evidence view, not a settings façade or a claim of on-demand model training.

### Research basis

Research was used for mechanisms, not copied as unsupported claims:

- [RRSI](https://arxiv.org/abs/2609.24972) — sparse annealed edits, evidence-aware credit, conservative/noise-aware selection, complexity discipline, and held-out transfer checks.
- [RSIPO](https://arxiv.org/abs/2610.15772) — policy/skill co-evolution and controlled trajectory comparison. SelfImpulse adapts only runtime-policy ideas; it does **not** perform weight training.
- [MemRL](https://arxiv.org/abs/2601.03192) — intent/experience/utility memory and value-aware retrieval with a frozen model.
- [Reflexion](https://proceedings.neurips.cc/paper_files/paper/2023/file/1b44b878bb782e6954cd888628510e90-Paper-Conference.pdf) — feedback-grounded verbal lessons without weight updates.
- [Voyager](https://arxiv.org/abs/2305.16291) — reusable skills, execution feedback, and verification.
- [SAGE](https://aclanthology.org/2026.acl-long.69/) — sequential skill-library rollout and skill-integrated verified rewards.
- [AIDE²](https://arxiv.org/abs/2609.26457) — nested improvement loops, hidden evaluation, compact failure memory, and measured acceptance.

The `evidenceLeak` field is an explicit trust boundary for callers that know an evaluation was contaminated; this milestone does not claim an automatic contamination detector. RSIRALS remains non-parametric runtime/harness learning. It does not train model weights, perform unrestricted recursive source rewriting, or guarantee future performance.

## Main paths

| Path | Purpose |
| --- | --- |
| `src/shared/enterpriseControl.ts` | Native control-plane IPC and policy contracts |
| `src/main/enterpriseControl/policy.ts` | Pure default-deny / deny-overrides authorization |
| `src/main/enterpriseControl/service.ts` | Atomic persistence, revisions, lifecycle, enrollment, audit sink |
| `src/main/enterpriseControl/runtime.ts` | Lazy native singleton and mission-team admission |
| `src/main/selfimpulse/mission/enterpriseAdmission.ts` | Host-independent mission admission port |
| `src/renderer/src/views/settings/EnterpriseControlPlane.tsx` | Functional IAM/restriction/revision/lifecycle UI |
| `src/main/selfimpulse/mission/rsiralsPolicy.ts` | Pure regularized development and held-out comparison |
| `src/main/selfimpulse/mission/selfImprove.ts` | Sparse annealed candidates, attribution, settlement |
| `src/main/selfimpulse/mission/lessons.ts` | Utility-aware retrieval and exact-id outcome credit |
| `src/main/selfimpulse/mission/selfEvolveRuntime.ts` | Integrated RSIRALS assignment/briefing/settlement |
| `src/main/selfimpulse/mission/runGraph.ts` | Actual mission assignment, execution, and settlement wiring |
| `src/main/selfimpulse/mission/rsiralsSnapshot.ts` | Read-only live evidence projection |
| `src/renderer/src/views/settings/LearningPane.tsx` | RSIRALS evidence UI |
| `src/main/enterpriseControl/PROVENANCE.json` | Upstream revision, scope, and native boundary |
| `THIRD-PARTY-NOTICES.md` | Separate upstream attribution and license location |

## Verification

Focused tests cover default deny, per-agent enrollment, deny-overrides, idempotent revocation, lifecycle changes, revision restore, restart persistence, stale-write rejection, recovery-lockout prevention, corrupt-store refusal, namespace grants, regularization, development/held-out acceptance and rejection, contamination exclusion, exact memory credit, and admission refusal propagation.

| Check | Final result |
| --- | --- |
| `npm run typecheck` | Passed — main/preload and renderer TypeScript |
| Focused native enterprise/RSIRALS/navigation tests | **30 passed across 6 files** |
| Full `npm test` | **211 passed across 32 files; no assertion failures** |
| `npm run build` | Passed — main, preload, and renderer production bundles |
| `git diff --check` | Passed |
| Protected core boundary | No diff under `src/main/backend/core/` |

The full test command still cannot load `memory.test.ts`, `skills.test.ts`, and `usage.test.ts` because the sandbox lacks the Electron binary and cannot download it (`TypeError: fetch failed`). These are the same three suite-loading environment failures as the prior baseline, not assertion failures. Interactive Electron/UI verification is therefore unavailable. The production build retains the existing nonfatal Vite notices and backend-core ineffective-dynamic-import warning.
