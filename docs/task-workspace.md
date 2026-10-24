# Task workspace: Now, Crew, Tools, and Files

The task view's right-hand workspace is a product-native operations panel inspired
by operational agent dashboards, not a copy of another application's layout. It
uses the existing SelfImpulse task, Crew, skills, MCP, artifact, browser, and
workspace-grant contracts.

## Now

- Shows the authoritative task status, current step, plan/step progress, update
  time, and any real pending approval.
- Summarizes current-task Crew runs, installed skills, ready MCP services,
  exposed MCP tools, and created artifacts.
- Loading and read-failure states are distinct from genuine zero counts.
- Opens the corresponding detailed workspace without adding a second activity
  store or synthetic live feed.

## Crew

- Filters and sorts only runs belonging to the open task; active runs come first.
- Shows the real provider/model, elapsed time, current tool, finished-step
  progress, instructions, individual steps, errors, and persisted Crew report.
- A newly delegated running Crew run opens the workspace once. Later step events
  do not reopen it after the user closes it.
- The full-history action opens the existing Sub-agents settings surface.
- Crew continues to inherit the Captain's role, enterprise policy, DLP, memory,
  approval, and tool boundaries. No separate agent runtime was introduced.

## Tools

- Lists installed skills and reads their real playbook content through the
  existing skills IPC. Management opens the full Skills settings pane.
- Lists configured local MCP stdio services with their real stopped, starting,
  ready, or error state.
- Enable/disable and restart actions use the existing MCP APIs and refresh the
  authoritative renderer settings afterward. Errors never produce a success
  toast merely because a restart was requested.
- Tool inspection distinguishes all discovered tools from the subset actually
  exposed by the server's allowlist. Disabled or non-ready services contribute
  zero exposed tools.
- Status polling runs only while a service is actually starting. Connected app
  toolkits remain available through the existing Connectors settings pane.

“Available” does not mean “used by this task”; SelfImpulse does not invent
per-task skill-usage telemetry. The local-services view covers real MCP
processes, not an unsupported list of arbitrary operating-system processes.

## Files and Sources

- Retains the existing artifact preview/open/reveal and task-browser surfaces.
- Adds explicit workspace folder grants and unique, visible message attachments.
- Folder removal changes only the grant and never deletes the folder.
- Files and sources remain attached to their existing task records.

## Accessibility and performance

- All actions are keyboard reachable and have explicit labels where icon-only.
- Panel and expansion transitions respect reduced-motion preferences.
- Crew elapsed time ticks only while a current-task run is active.
- Existing Orb wrappers pause offscreen and while the document is hidden.
- The renderer store gained a settings-refresh seam; no new preload IPC channel,
  backend core change, dependency, or duplicate capability service was needed.

Focused tests in `src/renderer/src/lib/taskOperations.test.ts` cover Crew
scoping/order/filtering, genuine current steps and progress, visible attachment
deduplication, MCP allowlist exposure, and elapsed-time formatting.

Final automated verification on 2026-10-24:

- Node and renderer TypeScript checks passed.
- **229 tests passed across 35 runnable test files.**
- Main, preload, and renderer production builds passed.
- `src/main/backend/core/` remains unchanged.
- The same three pre-existing suites (`memory`, `skills`, and `usage`) remain
  excluded from the runnable aggregate because the sandbox cannot download the
  Electron binary. Interactive Electron/visual verification is not claimed.
