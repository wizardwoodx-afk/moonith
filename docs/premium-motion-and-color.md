# Premium motion and Solo / Teams color collections

## Scope

This layer upgrades the existing SelfImpulse product surfaces. It does not add a
separate animation demo, change the agent core, or create decorative task,
security, mission, or Crew activity. All activity indicators are derived from
existing task, step, plan, schedule, subagent, policy, and audit records.

The protected implementation in `src/main/backend/core/` is outside this work.
Captain, Crew, providers, tools, memory, approvals, durable execution, native
enterprise controls, RSIRALS, Mastra-derived workflows, and Restate-derived
journaling remain on their existing paths.

## Motion integrated into real workflows

| Surface | Implementation | State and behavior |
| --- | --- | --- |
| Captain and task composers | `Composer.tsx`, `CaptainComposer.tsx`, `motion/Composer*.tsx` | Existing controlled textareas and submit/steer paths; real slash actions, real `@` file/memory/connector context, native file picking, and validated file drops. Enter, Shift+Enter, IME composition, model and permission controls are retained. |
| Send actions | `MetalAction.tsx`, `GlimmBorder.tsx` | A shared liquid-metal circle treatment and a one-shot Glimm edge sweep after a genuine composer submission. No sweep is used as a progress indicator. |
| Task activity and plans | `Steps.tsx`, `PlanCard.tsx`, `ActionNodeCard.tsx` | Orbs map the current tool to searching, connecting, solving, composing, shaping, weaving, or working. Shimmer and flow lines appear only for actual running states. Checks and progress use persisted step/plan status. |
| Crew runs | `TaskPanel.tsx`, `ActiveWorkIsland.tsx` | Running Crew records drive Orb activity and counts. Waiting tasks are labeled waiting, not working. The title-bar island opens only for real running/waiting tasks. |
| Messages | `ReactionPicker.tsx` | Local-profile emoji toggles use typed IPC and whole-task JSON persistence. There are no invented counts, users, or server sync claims. |
| Home | `CaptainWelcome.tsx`, `TaskDeck.tsx` | A manual recent-task deck opens real task summaries. Previous/next controls are keyboard accessible; there is no autoplay. |
| Captain presence | `CaptainPresence.tsx` | Pointer-responsive pupils, blinking, and a restrained orbit are decorative only. No camera, microphone, screen capture, or activity inference is used. |
| Schedules | `TimeScrubber.tsx`, `lib/cron.ts` | A native range control with animated digits and AM/PM controls updates fixed-time cron expressions in five-minute steps. Wildcard/interval expressions are not misrepresented as fixed times; non-time fields are preserved. |
| Task roles | `RolePicker.tsx` | An animated role menu updates the existing task-role RBAC assignment. Its descriptions match the enforced Executor, Researcher, Viewer, and Custom capability profiles. |
| Mission policy and audit | `EnterpriseControlPlane.tsx`, `AuditPane.tsx` | Existing native policy entities, evaluator decisions, signed evidence, integrity results, and event searches receive entrance/layout motion. Loading Orbs correspond to real reads; verification results remain explicit text. |

`main.tsx` wraps the app in `MotionConfig reducedMotion="user"`. The Orb wrapper
also pauses offscreen and hidden-document canvases. Glimm resources and one-shot
handles are cancelled/destroyed on cleanup. CSS animations and WebGL decoration
have reduced-motion fallbacks, and primary content remains readable without
WebGL.

## Color catalog

All 22 pre-existing house, Rare Five, and Distinct palettes remain registered.
Twelve supplied Atelier variants were added, for **34 themes total**. Runtime
token painting lets the new palettes share the existing token system without
replacing older stylesheet themes.

- **Solo — 22 themes:** quiet neutrals, editorial papers, subdued botanicals,
  and spatial darks for individual focus. New variants are Nocturne Light,
  Nocturne Dark, Studio, Sand, Dune, Eclipse, and Void.
- **Teams — 12 themes:** distinct operational hues and multi-agent identities.
  New variants are Harbor, Meadow, Midnight, Forest, and Plum.

The Colors settings pane defaults to the active theme's collection and offers
explicit Solo/Teams tabs with Day/Night groups. Supplied canvas, surface, ink,
and signal colors are preserved; supporting semantic tokens are derived from
them. CTA foregrounds use the highest-contrast candidate and focused tests
require AA CTA contrast and AAA body contrast for the new palettes. The default
theme remains `moonlight`, and the exclusive Moon theme remains available.

## Dependencies and attribution

- `metal-fx@2.0.11` — liquid-metal button, badge, and text effects.
- `thinking-orbs@0.3.2` — canvas-rendered task/tool activity states.
- `glimm@0.3.1` — framework-independent one-shot shader sweep; no Next.js
  adapter or global random-number patch is used.

MIT notices are retained in `LICENSES/` and `THIRD-PARTY-NOTICES.md`. The other
interaction primitives are SelfImpulse-owned implementations; no Bencho block
source is included.

## Verification

Focused coverage includes theme registration/collection/contrast, cron time
preservation and bounds, and reaction allow-list/toggle behavior.

Final automated verification on 2026-10-24:

- `npm run typecheck` — passed for Node and renderer projects.
- Vitest, excluding the three Electron-download-only suites below — **223
  tests passed across 34 files**.
- `npm run build` — passed for main, preload, and renderer production bundles.
- `git diff -- src/main/backend/core/` — empty; the protected core is unchanged.
- The unrestricted `npm test` was also attempted. `memory.test.ts`,
  `skills.test.ts`, and `usage.test.ts` still cannot load because the sandboxed
  Electron installer cannot download its binary (`@electron/get`: `fetch
  failed`). These are suite-loading failures, not test assertion failures.

Interactive Electron/visual verification is not claimed for this environment.
The existing nonfatal Vite config notices and backend-core dynamic-import warning
remain. The package intentionally excludes `node_modules`, build output, user
data, secrets, and transient artifacts.
