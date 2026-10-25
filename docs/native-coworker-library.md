# Native Coworker, privacy boundary, and Library

**Status:** implemented in the SelfImpulse source line on 2026-10-25.

This milestone selectively adapts useful coworker and page-review ideas into
SelfImpulse. It does not install a second agent framework, a hosted workspace,
or a localhost service. `src/main/backend/core/` is unchanged.

## Research and integration decision

| Source | What was used | What was deliberately excluded |
| --- | --- | --- |
| [CopilotKit OpenBot](https://github.com/CopilotKit/OpenBot) | MIT source at `46642d6c91daa663bccff673595f4e12a419a496`; destination classification and policy-before-action concepts. | Intelligence/cloud coupling, gateway/server, Docker/PostgreSQL deployment, service ports, external browser runtime. |
| [CopilotKit OpenDots](https://github.com/CopilotKit/OpenDots) | MIT source at `8091324942b86789ed0da7facbee855145d933b0`; optimistic page revisions, parent-cycle checks, exact-draft review receipts, and human-reviewed save UX. | SQLite, Intelligence APIs, hosted Spaces/Dots access service, server dependencies, upstream product names in the integrated UI/tools. |
| [CopilotKit Soar](https://www.copilotkit.ai/blog/introducing-soar) | Product requirements research only: supervised computer work, explicit control, and durable coworker behavior. | No public Soar source was identified; no claim that Soar code or its engine was copied. |
| Original **Grok Bot coworker product** | Product-category research only. This means the coworker product, not the Grok LLM. | Proprietary source, reverse engineering, unofficial reconstructions, and a substitute LLM integration. |
| OpenAI Dots / OpenSOAR comparisons | Terminology and scope checks. | No OpenAI Dots source/API was imported. The unrelated OpenSOAR Python SOC project was excluded. |
| [Motion Primitives](https://github.com/ibelick/motion-primitives) and [Animata](https://github.com/codse/animata) | MIT animated-number and status-transition techniques, pinned in `src/renderer/src/motion/PROVENANCE.json`. | A second animation runtime, demo timers, fake status, and decorative effects disconnected from real state. |

The complete copyright and permission texts are beside the adapted modules;
attribution and exclusions are recorded in `THIRD-PARTY-NOTICES.md`. The
module licenses and repository notices are included in packaged resources.

## One authoritative action path

```text
Captain / Crew delegation
          │
          ▼
Existing AgentRuntime and tool admission
          │
          ├─ task RBAC + native enterprise authorization
          ├─ schema validation + configured DLP
          ├─ existing approval broker (including full page-draft review)
          └─ signed runtime audit
          │
          ▼
Native coworker/browser tools or Library service
```

There is no parallel OpenBot gateway, OpenDots tool runtime, or second approval
system. Crew retains its no-prompt boundary: tools requiring an unconditional
human decision, including `review_library_page`, are not granted to specialists.

## Coworker isolation

### Private workspaces and explicit handoff

- Captain keeps the existing task workspace.
- Every Crew run receives a private workspace under the local profile's
  `coworkers/` directory, outside the Captain's task folder. Run IDs are hashed
  for storage paths; durable IDs and audit identities are not changed.
- Crew read roots can include the shared task workspace and explicitly granted
  folders. Write/execute roots contain the private Crew workspace and granted
  folders, not the shared Captain root.
- A file deliberately registered as a Crew artifact is copied by the trusted
  runtime into the Captain workspace under `crew/<opaque-run>/`. Symlink escapes
  and sources outside the private workspace are rejected.
- Crew run records created by this boundary carry an explicit isolation marker;
  the existing Crew panel displays it. Historical runs are not relabeled.

This is path and actor containment inside the desktop process, **not a claim of
container, VM, OS-user, or hard multi-tenant isolation**.

### Scoped Chromium sessions

- Captain and each Crew run use separate persistent Chromium partitions.
  Cookies, local storage, cache, and authenticated browser state are not shared
  by default.
- The browser remains a real Chromium window with the original load waits,
  clicks, typing, key input, screenshots, and human `show()` takeover.
- A persistent scope registry lets task deletion find Crew profiles even after
  an app restart. Deleting a task closes its Captain/Crew windows, clears
  storage/cache/auth state, removes private Crew workspaces, and then deletes
  the task record.
- The former shared `persist:knight-browser` profile is cleared rather than
  silently migrated into a supposedly isolated session.

### Navigation and request protections

Before browser navigation, and again for HTTP(S) requests/redirects and page
subresources, the native boundary rejects:

- non-HTTP(S) destinations and URLs containing credentials;
- localhost, local/private hostnames, and cloud metadata hostnames;
- loopback, RFC1918, link-local, carrier-grade NAT, multicast, documentation,
  benchmark, reserved, and IPv4-mapped/IPv6 local addresses;
- public hostnames whose DNS answers include any private or non-routable
  address, empty DNS answers, and unverifiable DNS lookups (fail closed);
- new-window escapes and WebSocket destinations through the same request
  boundary.

These checks reduce SSRF and accidental local-service exposure. They are not a
proof that every public web page is safe, a replacement for Chromium security,
or a guarantee against all DNS/network attacks. Cloud model/provider egress
still follows the user's configured provider and the existing DLP boundary.

## Native Library

The Library is a local collection/page store at the profile's `library.json`,
with bounded records and atomic writes. It is not SQLite and does not require a
server, account, CopilotKit Intelligence, or an external CLI.

### Pages and collections

- Collections contain hierarchical Markdown pages.
- Human pages support up to 100,000 characters; titles and collection counts
  are bounded.
- Updates require `expectedRevision`. Concurrent or stale writes fail with a
  conflict instead of overwriting a newer revision.
- Parent cycles are rejected. Deleting a page reparents its children.
- Corrupt or unsupported storage fails visibly; it is never replaced with an
  empty library.

### Agent-reviewed drafts

Captain has three product-native tools:

- `list_library_pages` — list collections and page metadata;
- `read_library_page` — read untrusted Markdown and its current revision;
- `review_library_page` — present a complete draft for human review before a
  create or edit.

The review uses the existing approval broker with a full Markdown preview,
**Approve & save**, and no always-allow shortcut. The exact draft is bound to
the task/tool-call receipt. A durable retry returns the original result without
creating a duplicate; a changed draft requires a new review; a deleted page is
not resurrected. Agent edits also require the current revision.

Captain can read the local Library. Crew read tools expose only pages whose
source task is the current Crew task; unrelated user pages are not enumerated
by default. The Captain can delegate specific reference text explicitly.

Human Library mutations pass the local-owner enterprise check and emit signed
audit events with IDs/revisions, not page contents. Agent actions use the
existing tool/approval audit events.

### Library surface

The rail's **Library** surface (Ctrl/Cmd+4) provides:

- collection and page-tree navigation, search, and real page counts;
- Markdown writing and preview, local autosave, revision/status details, and
  Ctrl/Cmd+S;
- conflict recovery through **Reload latest** or **Save as new page**;
- page deletion with an explicit confirmation;
- **Discuss with Captain**, which opens a normal Captain composer with a
  transparent page-specific prompt. It does not silently start a provider run.

## Motion and performance

`LiveNumber` and `SaveStatus` use the existing Framer Motion runtime and real
count/save state. They include reduced-motion behavior and avoid continuous
decorative animation. Library updates use serialized local writes and targeted
change events rather than polling or a duplicate renderer-owned store.

## Verification

- `npm run typecheck` — passed for main/preload and renderer.
- Runnable Vitest aggregate — **50 files / 302 tests passed**; the three known
  Electron-binary-dependent suites were excluded in this sandbox.
- Focused Coworker/Library/UI-helper coverage — **37 tests passed** within that
  aggregate.
- `npm run build` — passed for main, preload, and renderer production bundles.
- Protected-core status — no changes under `src/main/backend/core/`.
- Packaged notices — `electron-builder.yml` includes the new module license
  files as well as the repository notices.

Interactive Electron verification requires a local Electron binary and is not
claimed here.

## Attribution

See:

- `src/main/selfimpulse/coworker/PROVENANCE.json` and `LICENSE.openbot.txt`;
- `src/main/selfimpulse/library/PROVENANCE.json` and `LICENSE.opendots.txt`;
- `src/renderer/src/motion/PROVENANCE.json` and the two motion license texts;
- repository `THIRD-PARTY-NOTICES.md`.
