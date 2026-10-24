# Enterprise controls: agent RBAC, signed evidence, and DLP

Status: implemented in the SelfImpulse control plane on 2026-10-24. `src/main/backend/core/` is unchanged.

This milestone adds three related enterprise capabilities to the existing Captain/Crew runtime. It does not create another provider, tool, approval, task, memory, or agent stack.

The later native IAM/revision/lifecycle control plane and the RSIRALS learning upgrade are documented in [Native Enterprise Control Plane and RSIRALS](./native-enterprise-rsirals.md). They extend the controls below without replacing them.

1. **Runtime role-based access control (RBAC)** for agent actions.
2. **Tamper-evident runtime evidence** with searchable events and signed compliance export.
3. **Data-loss prevention (DLP)** before model/provider and outbound-tool egress.

The research basis was current enterprise agent guidance emphasizing action-time least privilege, centralized data-policy enforcement, identity/run correlation, and independently verifiable audit records:

- [Microsoft — Governance and security for AI agents](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ai-agents/governance-security-across-organization)
- [Microsoft Copilot Studio — Security and governance](https://learn.microsoft.com/en-us/microsoft-copilot-studio/security-and-governance)
- [Microsoft — Observability for AI systems](https://learn.microsoft.com/en-us/security/zero-trust/sfi/observability-ai-systems)
- [FINOS — AI Governance Framework](https://air-governance-framework.finos.org/)

These links explain design inspiration; they are not a certification or compliance claim.

## 1. Agent RBAC

### Roles

| Role | Read | Write | Execute | Network | Delegate Crew | Risk ceiling |
| --- | --- | --- | --- | --- | --- | --- |
| Executor | Yes | Yes | Yes | Yes | Yes | High |
| Researcher | Yes | No | No | Yes | Yes | Medium |
| Viewer | Yes | No | No | No | No | Low |
| Custom | Configurable | Configurable | Configurable | Configurable | Configurable | Configurable |

Tools with no side effect remain available when they pass the other Custom checks. `delegate_to_crew` requires the explicit `delegate` capability in addition to any other check.

Custom policy supports:

- An independent capability set and low/medium/high risk ceiling.
- Exact tool names or `*` wildcards in an allowlist.
- Exact names or wildcards in a denylist.
- Deny-first semantics. An empty allowlist means all tools that pass capability/risk checks.

### Assignment and enforcement

- Settings → **Enterprise controls** chooses the default role for **new** tasks.
- A task's menu changes that task's explicit role. Its subtitle displays the active role.
- Tasks created before this feature use **Executor**, preserving their behavior even if the default for new tasks later changes.
- The advertised provider tool list is filtered by role for usability.
- Every actual Captain or Crew call is authorized **again** immediately before schema validation, approval, or execution. A cached/replayed/injected call for a newly hidden tool therefore receives an explicit policy denial rather than bypassing the role.
- Crew receives the intersection of the inherited task role and its existing no-prompt/read-only restrictions. It never receives a privilege union and cannot recursively delegate.
- Background learning review receives the already-filtered tool set and the same provider-egress protection.
- Role and Custom-policy changes take effect at the next action boundary, including during an active run. Newly allowed tools are advertised on the next collected turn.

RBAC is additive: manual/auto/skip approval behavior, folder containment, shell settings, MCP allowlists, and tool-specific approval rules still apply. These are **local agent authorization roles**, not hosted SSO, SCIM, or a human directory implementation.

## 2. DLP / data-boundary enforcement

### Modes

- **Off** — compatibility default; no task-payload scanning.
- **Redact** — replaces each match with `[redacted:category]` on the outbound copy.
- **Block** — throws a `DataPolicyError` before the provider request or tool side effect.

The local task transcript is not rewritten. Redaction can intentionally make a URL, authorization header, command, or connector request unusable; Block is available when stopping is preferable to transforming the operation.

### Detection categories

- API keys and common token formats, including OpenAI/Anthropic-style keys, GitHub tokens, AWS access-key IDs, Slack tokens, and Bearer tokens.
- PEM private keys.
- JSON web tokens.
- Password/secret assignments and sensitive nested field names, including short values that do not match a token signature.
- Email addresses.
- Payment-card numbers validated with the Luhn checksum and repeated-digit rejection.
- Optional phone-number detection. Phone detection is available but not enabled in the default detector set.

Nested objects and arrays are protected without mutating the original payload. Overlapping matches are resolved deterministically. Detection results contain categories and offsets/counts, not the matched secret. Content nested beyond 30 levels is treated as unsafe rather than skipped: Redact replaces that subtree and Block stops the boundary. Circular audit values are serialized as bounded markers rather than crashing the evidence writer.

### Enforcement boundaries

**Provider boundary:** immediately before every model call, covering the complete message array: system prompt, history, current user message, context, memory/skill text, assistant tool calls, tool results, Crew messages, and background review. Durable replay does not repeat a provider call; a new attempt always crosses the hook.

**Tool boundary:** after schema validation and before approval/execution for `network` and `execute` arguments. This covers connectors, MCP, web/browser actions, shell commands, and delegation briefs. Local `read`/`write` file and memory operations are outside this argument-redaction scope; their content is still protected if subsequently sent to a provider.

Settings → Enterprise controls → **Local DLP scanner** runs the selected detectors through a bounded IPC call. The sample is not sent to a model and is not written to the runtime audit ledger.

DLP is pattern/field-based defense in depth. It cannot identify every secret, custom encoding, encrypted payload, or all confidential business content, and it is not a replacement for choosing trusted providers/tools. An attacker can also exfiltrate information not represented in a scanned argument through a sufficiently powerful allowed tool; use RBAC, folder boundaries, and approvals together with DLP.

## 3. Runtime audit and signed compliance evidence

### Recorded events

The live runtime ledger records, as applicable:

- Role-policy allow/deny decisions and administrative role/settings changes.
- DLP model/tool redactions and blocks with category counts, never the matched values.
- Provider attempts, model errors, turn usage/counts, and review outcomes.
- Approval requests, decisions, and cancellations.
- Tool starts/completions with call IDs, privacy-scrubbed argument/result hashes, mutated paths, errors, and durations.
- Captain task completion/failure/stop events and Crew start/parallel/completion events.

Audit metadata is recursively scrubbed with **all** DLP categories independently of the task's DLP mode. Strings, collection sizes, and nesting depth are bounded. The runtime ledger stores metadata and hashes, not raw prompts, arguments, or results. Older engine receipts/traces retain their existing export behavior and may contain work content.

### Live file format

Under the Electron profile's user-data directory:

- `audit/runtime.jsonl` — append-only canonical JSON lines.
- `audit/runtime.jsonl.head.json` — signed entry-count/chain-head anchor.

Each runtime line contains `{i, entry, prev, hash, sig}`:

- `hash` is SHA-256 over canonical `{i, entry, prev}`.
- `sig` is HMAC-SHA-256 over `{i, entry, prev, hash}` using the existing OS-keychain-protected audit key.
- The anchor contains `{version: 1, entries, head, sig}` and is atomically replaced after the line is synchronized.

Writes are serialized and fsynced. Verification detects modified, inserted, deleted, reordered, wrongly signed, and anchor-truncated records. If a crash leaves a complete authentic signed line after the previous anchor, verification safely advances the anchor; missing anchored lines fail instead. After an integrity failure, new appends are refused rather than extending a contradicted chain.

This is **tamper evidence on the local profile**, not remote immutable storage. It cannot stop a whole-profile rollback to an older valid snapshot or an attacker who controls the user's OS keychain and profile. Export retention/WORM storage remains an operational responsibility.

### Search, summary, and export

Settings → **Audit log** provides:

- Live integrity status, signed head, runtime/engine counts, and date range.
- Search over the latest 100 matching runtime events by action, tool, task, actor, role, or scrubbed metadata, plus outcome filtering and task links.
- Combined engine + runtime export as deterministic, chronological JSONL using the existing per-entry chain and HMAC-signed trailer.
- Independent verification of a selected export.

Export is all-or-nothing: an unreadable/corrupt runtime ledger fails the export rather than silently producing a plausible but incomplete file. The OS keychain must be available for live signing and export. Signing/ledger failures are shown in integrity status; no unsigned compliance file is substituted.

## Main paths

| Path | Purpose |
| --- | --- |
| `src/shared/governance.ts` | Shared role/DLP contracts, defaults, labels, and untrusted-settings normalization |
| `src/main/selfimpulse/governance/policy.ts` | Pure role/capability/risk/tool authorization |
| `src/main/selfimpulse/governance/dlp.ts` | Pure detection, recursive redaction, audit scrubbing, and block error |
| `src/main/services/governance.ts` | Existing-settings façade joining policy, DLP, and runtime evidence |
| `src/main/agent/engine.ts` | Optional synchronous pre-provider protection hook; backend core untouched |
| `src/main/agent/runtime.ts` | Captain/Crew action enforcement, effective arguments, approvals, and evidence |
| `src/main/audit/runtimeLedger.ts` | Signed live JSONL chain, head anchor, verification, fsync, and append refusal |
| `src/main/audit/runtimeService.ts` | Privacy-safe bounded event recording, integrity status, and filtered queries |
| `src/main/audit/runtime.ts` | Lazy application singleton using the existing profile paths |
| `src/main/audit/index.ts` | Combined summary/export/verify and bounded DLP-scanner IPC |
| `src/renderer/src/views/settings/EnterprisePane.tsx` | Role, Custom policy, DLP, scanner, and evidence controls |
| `src/renderer/src/views/settings/AuditPane.tsx` | Integrity, search, counts, export, and verification UI |
| `src/renderer/src/views/TaskView.tsx` | Per-task role display and assignment |

## Verification

The milestone uses pure detector/policy tests, service-boundary tests with mocked settings/audit sinks, engine provider-egress tests, and real temporary-file ledger tests. Ledger cases cover valid export conversion, edits, wrong keys, suffix truncation, append refusal, crash-safe authentic suffix recovery, metadata scrubbing, and filtered queries.

| Check | Final result |
| --- | --- |
| `npm run typecheck` | Passed — main/preload and renderer TypeScript |
| Full `npm test` | **191 passed across 27 files**; no assertion failures |
| `npm run build` | Passed — main, preload, and renderer production bundles |
| `npm audit --omit=dev` | **0 vulnerabilities** |
| Spreadsheet/presentation regression | 13/13 studio tool tests passed with patched transitive dependencies |
| Backend-core boundary | `src/main/backend/core/` unchanged |
| Branding/provenance/license audit | Passed; referenced license files present and non-empty |
| `git diff --check` | Passed |

Pinned transitive overrides update `body-parser` to 2.4.0, `image-size` to 2.0.4, and `uuid` to 11.1.1 to resolve the production advisories present before this milestone. No new runtime package or upstream agent dependency was added.

The full test command still cannot load `memory.test.ts`, `skills.test.ts`, and `usage.test.ts` because this sandbox lacks the Electron binary and cannot download it (`TypeError: fetch failed`). These are suite-loading environment failures, not assertion failures. Interactive Electron/UI verification is therefore unavailable here. The production build retains the repository's existing Vite configuration notices and backend-core ineffective-dynamic-import warning; they do not fail the build.
