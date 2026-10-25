# Verified Outcomes and earned, scoped autonomy

Status: implemented in the native SelfImpulse runtime on 2026-10-25. No parallel agent runtime, localhost service, MCP sidecar, or second approval system was added. No file under `src/main/backend/core/` was edited for this capability.

## Product rule

> **Verified Outcomes supplies evidence; the autonomy ladder controls how much authority that evidence can unlock.**

Evidence creates **eligibility, not authorization**. A local enterprise administrator must approve every expansion of authority. SelfImpulse may automatically demote a grant or open its circuit, but an agent, Crew member, RSIRALS process, or model cannot promote itself.

There is deliberately **no global agent trust score**. Autonomy is earned per workflow and exact execution scope.

## Native flow

```text
Versioned Outcome Contract
  ├─ downstream business result
  ├─ deterministic acceptance checks
  ├─ human-review policy
  └─ evidence thresholds + autonomy ceiling
                │
                ▼
Task pins contract revision + data class + environment
                │
                ▼
Captain / Crew action-time authorization
  RBAC → native enterprise policy → schema → DLP
       → scoped autonomy decision → existing approval broker → tool
                │
                ▼
Terminal run produces a signed outcome receipt
  ├─ verified / pending human review
  └─ failed or invalid → circuit break + regression candidate
                │
                ▼
Reviewed regression → later-run check or human gate → policy shadow
                │
                ▼
Measured eligibility → administrator-only promotion
```

Unbound tasks retain their existing behavior. Binding a task adds outcome enforcement; it does not remove or bypass an existing control.

## 1. Outcome Contracts

A contract belongs to one stable `workflowId` and contains immutable numbered revisions. The active revision declares:

- The **downstream business result** in plain language. This declaration is not treated as proof by itself.
- One to twenty deterministic checks:
  - task completed;
  - no failed tool steps;
  - every plan step completed;
  - a minimum number of output artifacts;
  - a minimum number of successful calls to an exact tool.
- Required versus optional checks.
- Whether passing evidence also needs local-administrator outcome review.
- Minimum settled runs, pass rate, and lookback window for promotion eligibility.
- A hard autonomy ceiling: Observe, Suggest, Approved action, or Bounded autonomy.

A task binding pins the active `contractId`, `contractRevision`, data class, and environment. Home, Captain, and the existing task menu all use the same picker and main-process binding resolver. A running task cannot be rebound to another contract or scope mid-flight. Activating a new contract revision does not silently rewrite an existing task or grant.

The current check library is intentionally generic and read-only. It proves declared operational facts from task metadata; it does **not** pretend to prove an arbitrary ITSM/ERP/CRM state without a real verifier for that system.

## 2. Scoped Autonomy Grants

A grant matches all of these dimensions:

| Scope | Enforcement |
| --- | --- |
| Agent | Exact stable ID such as `captain` or `crew` |
| Workflow | Exact contract and active pinned revision |
| Action | Exact tool name; no wildcard authority |
| Data | Exact public, internal, confidential, or restricted class |
| Environment | Exact development, staging, or production environment |
| Model | Exact provider ID and model for bounded autonomy |
| Policy | Exact semantic governance/enterprise-policy digest for bounded autonomy |

New grants cannot start at Bounded autonomy. Administrators can create a lower grant with a bounded ceiling, but promotion requires attributable evidence on one exact model/policy execution context. Mixed model failover or mixed policy versions do not qualify as one promotion sample.

The policy fingerprint hashes effective role, governance settings, and semantic enterprise namespace/role/restriction content. Routine enrollment of a new per-task identity does not masquerade as a policy change. Separately, native enterprise authorization still runs live before **every** tool action, so excluding per-task enrollment IDs from the fingerprint does not bypass a revoked binding or restriction.

### What Bounded autonomy can waive

Only an eligible routine **policy-based** approval. It cannot waive:

- task RBAC or native enterprise authorization;
- schema validation or DLP;
- folder/workspace containment;
- high-risk or always-approval tool boundaries;
- a contract or grant revision mismatch;
- a model or policy mismatch;
- a suspended, revoked, or circuit-broken grant;
- an exact agent/tool/data/environment scope mismatch.

Crew never receives an interactive approval prompt from this path. If an action still needs a separate human decision, Crew receives a denial instead of a bypass or hidden approval.

## 3. Evidence receipts and verification

Terminal Captain runs, including Crew participation, produce an outcome receipt for a bound task. Receipts contain:

- task/run IDs and a SHA-256 digest of the DLP-scrubbed stable task record;
- pinned contract and binding;
- participating agent IDs;
- unique provider/model attempts and policy digests;
- sanitized operational observations, not raw prompts, arguments, paths, page content, or tool output;
- deterministic check results, applied regression IDs, review state, and circuit-broken grant IDs.

Verification is independent of the model's self-assessment. Checks only read stored metadata and never perform an external write. Evidence is invalid for bounded-autonomy promotion unless it has exactly one provider/model context and one policy context. Fail-open self-certification is not supported.

The volatile persistence `updatedAt` timestamp is excluded from the task source digest so a later save does not become a different outcome. Receipt writes are idempotent for the same task/run/source digest.

Outcome state is atomically written with mode `0600` and HMAC-signed using the existing OS-keychain-backed audit key. Runtime events also enter the existing signed audit path. If the runtime audit refuses an outcome, the receipt is marked invalid and the failure is surfaced; it is not counted as verified success. Local signed state is tamper-evident, not remote WORM storage or protection against whole-profile rollback by an OS-level attacker.

## 4. Human outcome review

When required, deterministic success starts as **Pending review**, not Verified. A local administrator can:

- **Accept** only valid evidence whose required checks passed; or
- **Reject** the downstream result with a sanitized note.

Rejection is a material failure. It opens matching autonomy circuits and creates a regression candidate. Accepting a result never directly expands a grant; it only makes that receipt eligible for the separate promotion calculation.

## 5. Failure → reviewed regression → later-run enforcement

Material failures produce DLP-sanitized, deduplicated candidates keyed by workflow, data class, environment, and normalized failure codes. Raw traces and secrets are not embedded in candidate titles or fingerprints. Recurrences retain source receipt links and occurrence counts.

Administrator approval activates the candidate for later matching runs:

- If a failed deterministic check exists, SelfImpulse copies that check into the regression and evaluates it alongside the contract on later runs in the same scope.
- If the failure was subjective or downstream-only and no deterministic check exists, SelfImpulse creates a **mandatory human-review gate**. It does not fabricate an executable test from prose.
- Approved regressions also become expected-failure cases in policy shadow; recent verified receipts become expected-pass cases.
- Regression-generated IDs normalize back to the original failure fingerprint, preventing a recurrence from creating endless new candidates.
- Administrators can retire superseded regressions. More than sixteen approved regressions in one exact scope makes evidence invalid until the set is reduced, rather than allowing unbounded evaluation.

A regression does not retrain a model, modify source, or promote an agent.

## 6. Policy shadow

Policy shadow replays **sanitized historical observations** against a draft contract plus applicable approved regression checks:

- known reviewed failures should still fail;
- recently verified outcomes should still pass.

A compatible passing shadow is required before activating a draft when historical coverage exists. New scopes with no historical cases are reported honestly as having no shadow coverage rather than displaying fabricated success.

This is **policy/verifier shadow only**. It does not rerun a model, launch a second agent, perform external writes, or constitute safe shadow deployment of a new agent/policy. True agent shadow execution remains later work.

## 7. Promotion, demotion, and recovery

Promotion recommendations use only receipts matching the grant's agent, active contract revision, data class, and environment. For Bounded autonomy, samples are separated by exact provider/model/policy context.

Eligibility requires the active contract's run/pass-rate thresholds, no relevant pending review, a latest attributable verified outcome, and clean recovery after material failure. After a circuit opens, pre-incident success cannot be replayed as recovery evidence; only newer receipts count.

The UI presents a recommendation, but the mutation still requires local enterprise administrator authorization. There is no agent-accessible promotion IPC or tool.

Material failure or degraded evidence automatically:

1. reduces any Bounded grant to Approved action without raising lower grants;
2. clears its pinned execution authorization;
3. opens its circuit with a receipt-linked reason; and
4. creates or updates a regression candidate.

Administrators can also suspend, demote, revoke, or permanently retire authority through explicit audited mutations. Optimistic state revisions prevent stale UI writes.

## Product surfaces

- **Home / Captain composer:** optional contract, data-class, and environment binding.
- **Task menu:** bind an idle task or inspect its pinned scope; live-run rebinding is rejected by main.
- **Task header:** active contract and pinned revision.
- **Settings → Enterprise controls → Verified Outcomes:** Overview, Contracts, Autonomy, Evidence, and Regressions.
- **Existing approval and audit surfaces:** remain authoritative; no duplicate broker or ledger was introduced.

All renderer calls use typed preload IPC. Administrative mutations require the existing local-owner enterprise check. Snapshot read access and local administration are not organization-wide SSO/SCIM claims.

## Main implementation paths

| Path | Purpose |
| --- | --- |
| `src/shared/verifiedOutcomes.ts` | Shared contracts, grants, receipts, regressions, shadow records, mutations, and IPC constants |
| `src/main/selfimpulse/verifiedOutcomes/policy.ts` | Definition validation, deterministic checks, exact-scope action decisions, promotion eligibility |
| `src/main/selfimpulse/verifiedOutcomes/evidence.ts` | Sanitized task observations and stable source digest |
| `src/main/selfimpulse/verifiedOutcomes/service.ts` | Signed atomic state, administration, binding, receipts, circuits, regressions, and policy shadow |
| `src/main/selfimpulse/verifiedOutcomes/runtime.ts` | Lazy native singleton using existing profile/audit services |
| `src/main/selfimpulse/verifiedOutcomes/ipc.ts` | Snapshot and local-admin mutation IPC |
| `src/main/agent/runtime.ts` | Captain/Crew action enforcement, attempt/policy capture, terminal settlement |
| `src/main/store.ts` | Binding resolution, running-task guard, and task binding audit |
| `src/renderer/src/components/OutcomeContractPicker.tsx` | Shared task binding picker |
| `src/renderer/src/views/settings/VerifiedOutcomesPane.tsx` | Native administrative workflows |
| `src/main/selfimpulse/verifiedOutcomes/service.test.ts` | Adversarial scope, evidence, recovery, review, regression, shadow, tamper, and audit tests |

## Verification and limits

Current source verification in the Linux sandbox:

| Check | Result |
| --- | --- |
| Focused Verified Outcomes suite | **10/10 passed** |
| `npm run typecheck` | Passed — main/preload and renderer |
| Full `npm test` | **371 passed across 66 runnable files**; no assertion failures |
| `npm run build` | Passed — main, preload, and renderer production bundles |
| `npm audit --omit=dev` | **0 vulnerabilities** |

`memory.test.ts`, `skills.test.ts`, and `usage.test.ts` could not start because this sandbox has no installed Electron binary and cannot download it. They executed zero tests and are not counted as passing. No interactive Electron/provider run is claimed from unit tests and production bundling. A configured live model and local administrator should perform the first UI acceptance run.

This milestone does not claim compliance certification, arbitrary downstream-system verification, remote immutable evidence, hosted multi-tenant administration, true agent shadow deployment, or autonomous policy promotion. Industry-specific connector verifiers, richer independent read-only checks, true agent shadow infrastructure, and organization-managed policy distribution remain separate increments.
