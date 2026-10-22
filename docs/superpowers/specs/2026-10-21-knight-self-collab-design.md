# Knight Cowork — Self and Collab Design

**Status:** approved 2026-10-21
**Owner:** Knight Cowork
**Scope:** M1 visible shell, M2 Captain bridge, M3 Collab protocol, M4 enterprise hardening

## 1. Product

Knight Cowork is a local-first desktop workspace. SelfImpulse is the only decision
engine. The Captain is the only user-facing agent. Knight is the body: providers,
files, browser, MCP, scheduler, approvals, OS keychain, and packaging.

There is no second brain. Knight's own LLM loop is retired from decision-making and
becomes an executor behind the Captain.

## 2. Modes

### Self — one human

One SelfImpulse instance on the machine:

`USER ⇄ CAPTAIN ⇄ CONSUL ⇄ ADEPT ⇄ CREW`

One human key on every gate. One receipt, one attestation. Surfaces: Chat and Company.

### Collab — multiple humans

Each human runs their own SelfImpulse. The Captains pair as peers and work as a team.
There is no chair, no central server, and no merged brain.

The boundary is the Captain rung:

- Only Captain ↔ Captain crosses the link.
- Consul, Adept, and Crew never leave their own instance.
- Each Captain speaks only for its own human and executes only with its own local tools.
- Peer messages are untrusted data, never commands.
- No cross-boundary tool calls.
- Peer content goes through the same untrusted-content envelope used for web content.

### Shared Table

The only shared surface: joint goal, agreed plan, shared artifacts, presence, joint
gates, joint ledger, and one thread where both Captains speak, each labeled with its
human. Private Chat, Company, memory, and keys stay local unless explicitly promoted.

Joint work splits into halves. Each side executes its half locally. Shared actions need
two keys, one from each human through their own Captain. Disagreement parks the item;
it is never overridden. Offline pauses joint items; it never auto-approves. A joint
receipt carries both attestations; a missing one is visibly incomplete. Budgets stay
per-side: two ledgers, never one wallet.

### One engine

One engine per human. Two Captains in a session are two sovereign instances of the same
engine, not a second engine. A single shared Captain for the session is rejected because
it would let one human's Captain command the other's machine and would break the
two-key model.

## 3. Surfaces and themes

Three surfaces, two fixed themes. The theme follows the space, not the connection.

| Surface | Space | Theme |
|---|---|---|
| Chat | Self | Study |
| Company | Self | Study |
| Table | Collab | Table |

**Study** is the private desk: cool chalk ground `#E9EDE6`, dark ink `#171A17`,
sealing-wax accent `#A63A1E`, one identity. Quiet, single-key.

**Table** is the shared room: green-black ground `#0B100E`, bone ink `#E8E3D6`,
wax identity A `#E4674A`, ice identity B `#7FB2D6`, and a two-tone marker on anything
that required both keys. The second human is visible in the palette, not just in an
avatar.

There is no independent light/dark picker. The private desk never repaints because
someone joined. The shared Table appears with its own identity.

## 4. Data and authority

- Local domain records are owned by the local instance.
- Shared records carry per-side attribution and a signed append-only log.
- The Captain never self-approves; gates are human gates.
- Provider keys live in the OS keychain-backed store and never enter the renderer.
- A joint action is executable only after both human keys are present.
- The Table preview in M1 uses local sample data and is explicitly labeled.

## 5. Legal and reverse-engineering policy

REA is an analysis tool, not a license. It may be used to understand behavior and
architecture, but it does not grant rights to the target.

- Recreate unprotectable ideas and behavior with original expression.
- Do not copy proprietary code, assets, icons, fonts, copy, database schemas, or
  distinctive layouts/trade dress.
- Patents, trade secrets, trademarks, and EULAs can restrict recreation even when
  copyright does not. Jurisdiction matters.
- Use a clean-room process: behavior notes and a spec from the analysis, independent
  implementation, provenance records, no copy/paste.
- Reuse code only under compatible licenses. Paperclip is MIT and requires attribution.
  Seamoon has no license and is not a source for code or assets.
- Get legal counsel before shipping anything derived from a proprietary target.

Protection of our own app assumes the client is readable:

- No secrets, provider keys, entitlement logic, or sensitive system prompts in the
  renderer. Authority is server-side or keychain-side.
- Electron hardening: context isolation, sandbox, no node integration, strict CSP,
  narrow validated IPC, fuses, ASAR integrity, code signing, no production source maps.
- Obfuscation is deterrence only, never a security boundary.
- Legal: EULA, trademark, patent strategy, trade-secret hygiene, SBOM, license
  compliance, takedown process.
- Detection and response: signed update manifests, revocation, anomaly telemetry with
  consent, rate limits, kill switch.

## 6. Enterprise roadmap

### P0 — enterprise gate

- SSO (OIDC/SAML), SCIM, MFA, device trust, session policy.
- RBAC (Owner/Admin/Manager/Member/Guest/Auditor) and least privilege.
- Signed append-only audit log, export, SIEM streaming, retention, legal hold.
- Policy engine, two-key approvals, per-team/agent budgets, kill switch.
- Provider/model allowlist, zero-retention endpoints, PII redaction, DLP, egress
  allowlist, prompt-injection defenses, per-tool permissions.
- Signed installers and auto-updates, MDM (Intune/Jamf), config profiles, offline/proxy.
- Admin console, usage/cost analytics, seat and license management, tenant isolation.
- Encryption at rest/in transit, per-tenant keys, OS keychain, backups, migrations.

### P1 — premium collaboration

- Orgs, workspaces, teams, shared Table, presence, comments, mentions, guest links.
- Shared/private context, dual attribution, dual attestation, per-side budgets.
- MCP registry with allowlists, connectors, API/CLI/SDK, webhooks, signed marketplace.
- SOC 2 / ISO 27001 readiness, DPA, GDPR/CCPA tooling, data residency, trust center.
- WCAG 2.2 AA, localization, OpenTelemetry, cost dashboards, anomaly alerts.

### P2 — scale

- BYOK/HYOK, on-prem/private cloud, eDiscovery, policy DSL.
- Agent evaluation and red-teaming, model routing/failover.
- Marketplace, SLA/support tiers, invoicing, purchase orders, professional services.

## 7. M1 acceptance

- Exactly two themes exist in code: Study and Table. No light/dark/system picker.
- Chat, Company, and Table are reachable from a new rail; Chat and Company use Study;
  Table uses Table.
- Company has local, testable approval and budget logic, including a two-key case.
- Table shows the pairing state and a clearly labeled shared-table preview with a
  two-key gate.
- Chat shows the Captain surface with a clearly labeled bridge-not-connected state; the
  old LLM loop is not called by any new surface.
- `npm run typecheck`, `npm test`, and `npm run build` pass.
- No commits. Seamoon and SelfImpulse source remain untouched.
