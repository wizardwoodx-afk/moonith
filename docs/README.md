# SelfImpulse documentation

Start with the [product README](../README.md) for the current capability
overview and [VISION.md](../VISION.md) for the enterprise direction and
roadmap.

This directory contains implementation guides, architecture decisions, and
point-in-time verification reports. They go deeper than the product front door;
they do not replace it.

## Current product capabilities

| Document | What it covers |
| --- | --- |
| [Verified Outcomes and scoped autonomy](./verified-outcomes.md) | Versioned outcome contracts, exact-scope grants, signed evidence, human review, enforced regressions, policy shadow, administrator-only promotion, and circuit breaking. |
| [Native Enterprise Control Plane and RSIRALS](./native-enterprise-rsirals.md) | Native namespaces, principals, Roles, bindings, Restrictions, lifecycle, revisions, action-time enforcement, and the measured RSIRALS learning loop. |
| [Enterprise controls](./enterprise-controls.md) | Executor/Researcher/Viewer/Custom RBAC, tool/provider DLP, manual approvals, hash-chained signed audit, search, verification, export, and security boundaries. |
| [Impulse Runtime and Crew Mesh](./impulse-runtime-crew-mesh.md) | Product-native steering, output safety, specialist delegation, bounded teams, durable run lineage, live activity, and OpenClaw/VoltAgent provenance. |
| [Native Coworker, privacy boundary, and Library](./native-coworker-library.md) | Scoped Chromium sessions, private Crew workspaces, navigation protections, local Markdown collections/pages, reviewed agent drafts, and restrained motion. |
| [Native AI Browser](./native-browser.md) | In-app Stagehand, existing-provider AI observe/act/extract, deterministic Chromium fallback, individual action approvals, fail-closed request protection, live activity, takeover, and residual limits. |
| [Native Marketspace and security remediation](./native-marketspace.md) | Open CoDesign/OpenDesign research pins, native `DESIGN.md` systems, static previews, Captain tools, and concrete security fixes with residual-risk boundaries. |
| [Typed workflows, durable execution, and themes](./agent-workflow-durability-themes.md) | Mastra-derived workflow semantics, Restate-derived local durability, real agent/runtime wiring, theme catalog, tests, and limitations. |
| [Task workspace](./task-workspace.md) | The Now/Crew/Tools/Files operations surface, transcript and artifacts, usage, and task-level work inspection. |

## Integration and architecture decisions

| Document | Why to read it |
| --- | --- |
| [Mastra/Restate merge plan](./mastra-restate-merge-plan.md) | Why selected workflow/durable semantics were integrated beneath SelfImpulse rather than adding parallel frameworks. |
| [Self-ROI integration](./self-roi-integration.md) | The earlier self-evolution and return-on-investment integration report; later RSIRALS work supersedes its learning-loop scope where they differ. |
| [Backend merge](./backend-merge.md) | Historical backend/provider integration decisions and the protected-core boundary. |

## Experience, build, and distribution

| Document | What it covers |
| --- | --- |
| [Premium motion and color](./premium-motion-and-color.md) | Motion, responsive behavior, reduced-motion accessibility, and the light/dark theme system. |
| [Build and release](./build-and-release.md) | Node prerequisites, development, verification, Windows packaging, artifact locations, signing and updater limitations. |
| [Studio third-party notices](./third-party-notices.md) | External Studio engine names, installation expectations, licensing, and redistribution obligations. |
| [Repository third-party notices](../THIRD-PARTY-NOTICES.md) | Attribution for integrated third-party components and adapted source. |
| [SelfImpulse license](../LICENSE) | Proprietary product license. Third-party components retain their own licenses. |

## How to read status and verification

- **Current shipped scope:** the root README and the implementation guides for
  each capability.
- **Planned scope:** [VISION.md](../VISION.md), explicitly marked Next or Later.
- **Current code:** the tagged source tree and Git history.
- **Historical evidence:** milestone documents retain the test totals and
  environment limitations from when they were written. A smaller test count in
  an older report does not mean current tests were removed.
- **Source versus application:** a GitHub source ZIP contains the repository,
  not a compiled installer. Build outputs and packaging commands are documented
  in [build and release](./build-and-release.md).

Enterprise deployment decisions should include the limitations in each guide.
In particular, local signed audit is not remote WORM storage, native in-process
IAM is not hosted SSO/SCIM, and durable replay does not make arbitrary external
side effects exactly-once.
