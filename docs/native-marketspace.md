# Native Marketspace and security remediation

## Decision: adapt the ideas, not another agent runtime

The useful parts of **Open CoDesign** and **OpenDesign** are complementary, but
neither should become a second SelfImpulse application:

- [Open CoDesign](https://github.com/OpenCoworkAI/open-codesign) is the closer
  form-factor reference: local Electron workspaces, real design files,
  `DESIGN.md`, previews, and permissioned actions. Its pinned source also
  contains a bundled agent/provider stack, which SelfImpulse does not need.
- [OpenDesign](https://github.com/nexu-io/open-design) has the stronger
  portable design-system, catalog, trust, and marketplace references. Its
  normal daemon/plugin/CLI architecture is deliberately not imported.

The inspected revisions, files, license notices, and no-source-copied scope are
recorded in [`src/main/marketspace/PROVENANCE.json`](../src/main/marketspace/PROVENANCE.json).
Open CoDesign is MIT; OpenDesign is Apache-2.0. Their license texts ship beside
the native module for attribution and future redistribution clarity. The
catalog text and native implementation are SelfImpulse-owned; no upstream
runtime or source file is bundled.

## What is implemented

`src/main/marketspace/` is an in-process catalog of reviewed built-in and local
**design systems**. Each installed entry contains only:

```text
DESIGN.md       Portable design guidance Captain can read
preview.html    Generated static preview
manifest.json   Provenance and format metadata
```

The native path supports:

1. Search and inspection in **Settings → Skills → Native Marketspace**.
2. Installation of reviewed built-in entries without a package manager.
3. Creation of local `DESIGN.md` systems with generated static previews.
4. Application to an existing task under `design-system/<id>/`, with no
   overwrite by default and explicit overwrite only when requested.
5. Captain tools `marketspace_search`, `marketspace_read`,
   `marketspace_install`, and `marketspace_apply` in the existing tool
   registry. Read/search are available in chat mode; writes use per-call
   approval, and Crew cannot mutate the shared catalog.
6. Ordinary task artifact registration and the existing task/policy/audit
   boundaries. No second transcript, provider registry, daemon, MCP server,
   localhost bridge, or external agent CLI is introduced.

The preview iframe has an empty sandbox and the generated document has a
restrictive CSP (`default-src 'none'`, no forms, no base URL, no script source).
Design text is escaped before it becomes preview markup. The native catalog
requires no network access.

The older community skill registries remain optional compatibility surfaces
below the native section. They are not required for native Marketspace
operation.

## Security findings and fixes

These are concrete issues found in the current enforcement paths, not generic
security labels.

| Finding | Enforcement change | Regression evidence |
| --- | --- | --- |
| Marketplace deletion used a string-prefix check and accepted traversal-shaped IDs. | Strict installed-ID/reference validation and realpath-aware containment before recursive deletion in `backend/marketplace.ts`. | `backend/marketplace.test.ts` covers traversal, option-shaped references, symlinked bundles, and normal deletion. |
| The legacy backend tool runtime checked only lexical workspace paths. Symlinked children could read or write outside the workspace. | `backend/tools.ts` now uses the shared `resolveSafePath` realpath boundary for reads, writes, listing, and search; `services/skills.ts` applies the same boundary to skill reads/removal and atomic manifest writes. | `backend/tools.test.ts` proves external content is neither returned nor overwritten, while ordinary workspace I/O still works. Existing `security.test.ts` covers the shared primitive. |
| Backend settings could retain decrypted values in JSON and expose nested integration secrets through the public projection. The keyed settings layout was also read inconsistently. | `backend/index.ts` now reads the namespaced settings record, migrates legacy values to the OS vault, persists a secret-free projection, and recursively redacts public values through `backend/publicSettings.ts`. Grounded Actions and Marketplace credentials are included in the vault lifecycle. | `backend/publicSettings.test.ts` checks nested keys, authorization headers, arrays, short secrets, and ordinary setting preservation. |
| A provider ID could reuse its stored/API-environment key after its endpoint changed, sending credentials to a new trust target. | Endpoint comparison is explicit in `backend/provider.ts`; provider tests/model fetches refuse stale-key reuse, provider edits require re-authentication, and environment fallback is endpoint-bound. | `backend/publicSettings.test.ts` covers endpoint normalization and origin/path/protocol changes. |
| Registry package children inherited credential-bearing environment variables and could run npm lifecycle scripts during installation. | `npx.ts` retains ordinary process configuration but removes credential-shaped variables and loader hooks, sets `npm_config_ignore_scripts=true`, and preserves argument-vector/`shell:false` execution. Explicit compatibility credentials are passed only to the intended CLI invocation. | `npx.test.ts` checks environment scrubbing, lifecycle policy, literal metacharacter arguments, and Windows entrypoint resolution. |
| Registry and provider JSON responses were not consistently bounded, and a provider test could omit a stored custom endpoint while reusing its key. | Shared streamed response-byte limits and result-count caps now protect the registry/model-list paths; provider tests normalize the stored endpoint and still refuse stored-key reuse after an endpoint change. | `util.test.ts` and `agent/providers/index.test.ts` cover byte budgets, malformed JSON, stored endpoints, and changed-endpoint credential refusal. |
| A design preview is an active-content boundary, not just a pretty iframe. | Native previews are generated from escaped text, carry a restrictive CSP, and render in an empty-sandbox iframe. Applying an entry copies only inspected files into a task workspace with symlink-aware paths and no-overwrite defaults. Installed manifest provenance is checked against the built-in catalog. | `marketspace/service.test.ts` covers static/no-network previews, escaping, install/apply/overwrite behavior, invalid IDs, provenance spoofing, and symlinked destinations. |

Verification on the resulting tree: **325 tests across 56 runnable files**,
both TypeScript projects, and the production build pass. The three additional
Electron-binary-dependent suites could not start in this Linux sandbox because
Electron could not be downloaded; they are not counted as passing. Historical
milestone totals are not reused as evidence.

## Remaining limitations — do not overclaim

- The optional community registry CLIs are still third-party executables.
  Scrubbed environments and disabled lifecycle scripts reduce exposure; they do
  not make a package safe, prove its provenance, or provide an OS sandbox.
  Native Marketspace does not depend on them.
- Registry skill text can contain prompt-injection instructions. Installing a
  community skill is a trust decision; review its content before allowing a
  model to follow it. The native design catalog is declarative and contains no
  downloaded skill instructions.
- Workspace containment is application-level path enforcement, not a container,
  VM, or syscall sandbox. Shell commands intentionally remain powerful and are
  subject to the existing approval/policy configuration; they must not be
  described as filesystem-confined merely because file tools are confined.
- Custom/local model endpoints are a supported product feature. Endpoint
  binding prevents accidental credential reuse but does not replace an
  organization’s egress allowlist or DNS/network policy.
- Browser navigation checks and application-level DNS validation are not a
  guarantee against every rebinding or hostile public page. No interactive
  Electron session was available in this Linux verification environment.
- The legacy IPC surface is not presented as a uniform sender-authentication
  boundary. The native Marketspace handlers validate entry/task inputs and
  use the existing trusted preload path, but a compromised trusted renderer
  remains part of the desktop threat model; a complete IPC sender/payload
  audit is separate follow-up work.
- No certification, signed installer, remote immutable audit store, or
  cryptographic signature scheme for community catalog entries is claimed.
