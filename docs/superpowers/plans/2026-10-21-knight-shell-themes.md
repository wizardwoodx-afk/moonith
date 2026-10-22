# Knight Cowork M1 — Shell, Fixed Themes, Company, Table Preview

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first runnable Knight checkpoint: a three-surface shell, exactly two fixed themes (Study and Table), local Company logic, and a labeled Collab Table preview, with the old LLM loop quarantined and unwired.

**Architecture:** Keep the existing Electron main process and security layer. Replace the renderer's default navigation with a three-surface shell. Apply Study tokens at the root and Table tokens inside the Table surface. Put Company and Table authority logic in pure functions so it is testable without a DOM. The Captain surface is an honest design preview until M2 wires the SelfImpulse bridge.

**Tech Stack:** Electron 44, React 19, TypeScript 5.9, Tailwind 4, Zustand 5, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-21-knight-self-collab-design.md`

## Global Constraints

- No commits. Leave all changes uncommitted for user review.
- Do not modify `D:\selfimpulse` or `C:\Users\HARSHEN\Documents\seamoon`.
- Exactly two themes: Study and Table. No light/dark/system picker.
- The old agent runtime (`src/main/agent/runtime.ts`) must not be called by any new surface.
- No secrets or provider keys in the renderer.
- Preserve the existing Electron security posture: context isolation, sandbox, no node integration, narrow IPC.
- Every task ends with `npm run typecheck` and `npm test` passing.

---

### Task 1: Replace light/dark/system with fixed Study and Table tokens

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/store.ts`
- Modify: `src/main/window.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/components/ui.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/views/SettingsView.tsx`
- Test: `src/renderer/src/shell/surfaces.ts` + `src/renderer/src/shell/surfaces.test.ts` (created in Task 2)

**Interfaces:**
- Produces: no `ThemeSetting`, no `theme` field in `PublicSettings`/`SettingsPatch`/`StoredSettings`.
- Produces: `applyTitleBarTheme()` and `createMainWindow()` take no theme argument and always use Study colors.
- Produces: CSS tokens under `:root` (Study) and `.space-table` (Table), including `--c-identity-a`, `--c-identity-b`.

- [ ] **Step 1: Remove the theme type and settings field**

In `src/shared/types.ts` delete `ThemeSetting` and remove `theme` from `PublicSettings` and `SettingsPatch`.

In `src/main/store.ts` remove `theme` from `StoredSettings`, `DEFAULT_SETTINGS`, `getPublicSettings`, and `saveSettings`.

In `src/main/ipc.ts` change the settings-save handler to `applyTitleBarTheme()`.

In `src/main/index.ts` change the three theme call sites to `createMainWindow()` / `applyTitleBarTheme()` and remove the `nativeTheme` listener.

In `src/main/window.ts` remove `ThemeSetting` and `nativeTheme`, make `titleBarColors()` return Study colors only, and make the two exported functions take no argument:

```ts
function titleBarColors(): { color: string; symbolColor: string } {
  return { color: '#E9EDE6', symbolColor: '#171A17' }
}

export function applyTitleBarTheme(): void { /* ... */ }
export function createMainWindow(): BrowserWindow { /* backgroundColor: '#E9EDE6' */ }
```

- [ ] **Step 2: Replace the CSS token layer**

In `src/renderer/src/styles.css` delete the `.dark` block, the `@custom-variant dark` line, and every `.dark ...` rule. Set `:root` to the Study palette:

```css
:root {
  --c-canvas: #e9ede6;
  --c-canvas-deep: #e1e6de;
  --c-surface: #f7f9f4;
  --c-surface-2: #eef1ea;
  --c-ink: #171a17;
  --c-muted: #626b63;
  --c-faint: #8a948b;
  --c-line: rgba(23, 26, 23, 0.11);
  --c-line-strong: rgba(23, 26, 23, 0.2);
  --c-accent: #a63a1e;
  --c-accent-soft: #f1dcd3;
  --c-accent-ink: #7a2b17;
  --c-positive: #2f6b4f;
  --c-warn: #8a5a00;
  --c-danger: #a3271c;
  --c-ink-button: #1d221e;
  --c-on-ink: #f7f9f4;
  --c-identity-a: #a63a1e;
  --c-identity-b: #626b63;
  color-scheme: light;
}

.space-table {
  --c-canvas: #0b100e;
  --c-canvas-deep: #0f1512;
  --c-surface: #121815;
  --c-surface-2: #1a211d;
  --c-ink: #e8e3d6;
  --c-muted: #9aa69e;
  --c-faint: #6f7c74;
  --c-line: rgba(232, 227, 214, 0.1);
  --c-line-strong: rgba(232, 227, 214, 0.18);
  --c-accent: #e4674a;
  --c-accent-soft: #3a211a;
  --c-accent-ink: #f0b296;
  --c-positive: #74c39a;
  --c-warn: #e2b45f;
  --c-danger: #f07a5e;
  --c-ink-button: #e8e3d6;
  --c-on-ink: #0b100e;
  --c-identity-a: #e4674a;
  --c-identity-b: #7fb2d6;
  color-scheme: dark;
}

.joint-marker {
  background: linear-gradient(90deg, var(--c-identity-a) 50%, var(--c-identity-b) 50%);
}
```

Add `--color-identity-a` and `--color-identity-b` to the `@theme inline` block so `bg-identity-a` / `text-identity-b` work.

- [ ] **Step 3: Remove the dark bootstrap and dark utilities**

In `src/renderer/index.html` delete the inline `<script>` that adds `.dark`.

In `src/renderer/src/components/ui.tsx` change the modal backdrop class to `bg-[#201b14]/35 backdrop-blur-[2px]`.

In `src/renderer/src/components/Sidebar.tsx` remove the theme popover, `Moon`/`Sun` imports, and `isDark`/`cycleTheme`. Keep the task list behavior for the legacy view.

In `src/renderer/src/views/SettingsView.tsx` remove `ThemeSetting`, `Moon`, `Sun`, and `ThemeThumb`. Replace the Appearance section with two fixed theme cards (Study and Table) that are not selectable and say "Theme follows the space."

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test`
Expected: no type errors; existing tests pass.

---

### Task 2: Add the surface model and three-surface shell

**Files:**
- Create: `src/renderer/src/shell/surfaces.ts`
- Create: `src/renderer/src/shell/surfaces.test.ts`
- Create: `src/renderer/src/shell/AppRail.tsx`
- Modify: `src/renderer/src/components/TitleBar.tsx`
- Modify: `src/renderer/src/store.ts`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Produces: `type Surface = 'chat' | 'company' | 'table'`
- Produces: `SURFACES: readonly { id: Surface; label: string }[]`
- Produces: `spaceForSurface(surface: Surface): 'study' | 'table'`
- Produces: `spaceClass(surface: Surface): 'space-study' | 'space-table'`
- Produces: `View` includes `{ kind: 'surface'; surface: Surface }`
- Produces: `useApp().openSurface(surface)`.

- [ ] **Step 1: Write the failing surface test**

```ts
import { describe, expect, it } from 'vitest'
import { SURFACES, spaceForSurface } from './surfaces'

describe('surfaces', () => {
  it('has exactly three surfaces and two spaces', () => {
    expect(SURFACES.map((item) => item.id)).toEqual(['chat', 'company', 'table'])
    expect(new Set(SURFACES.map((item) => spaceForSurface(item.id))).size).toBe(2)
  })

  it('keeps private surfaces in Study and the shared surface in Table', () => {
    expect(spaceForSurface('chat')).toBe('study')
    expect(spaceForSurface('company')).toBe('study')
    expect(spaceForSurface('table')).toBe('table')
  })
})
```

Run: `npm test -- src/renderer/src/shell/surfaces.test.ts`
Expected: FAIL because `./surfaces` does not exist.

- [ ] **Step 2: Implement the surface model**

```ts
export const SURFACES = [
  { id: 'chat', label: 'Chat' },
  { id: 'company', label: 'Company' },
  { id: 'table', label: 'Table' }
] as const

export type Surface = (typeof SURFACES)[number]['id']
export type Space = 'study' | 'table'

export function spaceForSurface(surface: Surface): Space {
  return surface === 'table' ? 'table' : 'study'
}

export function spaceClass(surface: Surface): string {
  return spaceForSurface(surface) === 'table' ? 'space-table' : 'space-study'
}
```

Run the test again. Expected: PASS.

- [ ] **Step 3: Update the renderer store**

In `src/renderer/src/store.ts`:

```ts
export type View =
  | { kind: 'surface'; surface: Surface }
  | { kind: 'task'; taskId: string }
  | { kind: 'settings'; tab: SettingsTab }
  | { kind: 'schedules' }
```

Set the default to `{ kind: 'surface', surface: 'chat' }`. Add `openSurface: (surface: Surface) => void` and implement it as `set({ view: { kind: 'surface', surface }, currentTask: null, preview: null })`. Make `goHome()` call `get().openSurface('chat')`.

- [ ] **Step 4: Build the rail and title bar**

`AppRail.tsx` is a 64px-wide vertical rail. Use `MessageSquare`, `Building2`, `Handshake`, and `Settings` from `lucide-react`. Each item has an `aria-label`, an active state with `bg-accent-soft text-accent-ink`, and a tiny label under the icon. The settings button calls `openSettings('general')`. The rail footer shows a mode pill: `Self` for chat/company, `Collab` for table.

`TitleBar.tsx` takes `{ surface: Surface }`. It keeps the drag region and shows the Knight mark, "Knight Cowork", the surface label, and a mode pill. Table shows a `Preview` suffix. Remove the "Local" dot or change it to a `Self`/`Collab` pill.

- [ ] **Step 5: Rewrite the App shell**

In `App.tsx` remove `useSystemTheme`, the `isDark` effect, and the `Sidebar` render. Keep bootstrap, task/approval event subscriptions, onboarding, approval dialog, and Toaster (use `theme="light"`).

Render:

```tsx
<div className="flex h-full flex-col bg-canvas text-ink">
  <TitleBar surface={activeSurface} />
  <div className="flex min-h-0 flex-1">
    <AppRail />
    <main className={cn('relative min-w-0 flex-1 overflow-hidden', spaceClass(activeSurface))}>
      {view.kind === 'settings' ? <SettingsView /> : null}
      {view.kind !== 'settings' && activeSurface === 'chat' ? <CaptainSurface /> : null}
      {view.kind !== 'settings' && activeSurface === 'company' ? <CompanySurface /> : null}
      {view.kind !== 'settings' && activeSurface === 'table' ? <TableSurface /> : null}
    </main>
  </div>
</div>
```

`activeSurface` is `view.kind === 'surface' ? view.surface : 'chat'`. Add `Ctrl+1/2/3` shortcuts for the three surfaces and keep `Ctrl+,` for settings. Add `Ctrl+N` to open Chat.

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm test`
Expected: PASS.

---

### Task 3: Build the Captain preview surface

**Files:**
- Create: `src/renderer/src/features/captain/captainPreview.ts`
- Create: `src/renderer/src/features/captain/CaptainSurface.tsx`

**Interfaces:**
- Consumes: `Button` and the Study tokens.
- Produces: a static, labeled preview; no calls to `window.knight` task APIs.

- [ ] **Step 1: Add preview data**

Define `PREVIEW_THREAD` with five entries: a user request, a Captain plan, a `captain → consul` handoff, an `adept` execution, and a signed receipt. Each entry has `id`, `kind` (`user | captain | handoff | gate | receipt`), `title`, `body`, and optional `meta`.

Define `BRIDGE_STATE = 'not-connected'`.

- [ ] **Step 2: Build the surface**

Header: a Knight/Captain mark, "Captain", a `Self` pill, and a `Bridge not connected` status pill. Under it, a callout: "The SelfImpulse Captain bridge is the next milestone. This surface is a design preview; the local executor is not connected here."

Thread: render the preview entries as a vertical timeline. Use the existing `serif-display` for the Captain's voice, `font-mono` for handoff chips, and a gate card with a single keyhole labeled "Your key" and a receipt card with a check icon and `ECDSA attestation` meta.

Composer: a textarea and a disabled `Send` button. Placeholder: "Captain bridge not connected". Include a secondary disabled `Attach` button.

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: PASS.

---

### Task 4: Company domain logic and surface

**Files:**
- Create: `src/renderer/src/features/company/company.ts`
- Create: `src/renderer/src/features/company/company.test.ts`
- Create: `src/renderer/src/features/company/companyStore.ts`
- Create: `src/renderer/src/features/company/CompanySurface.tsx`
- Create: `src/renderer/src/features/company/OrgChart.tsx`
- Create: `src/renderer/src/features/company/GoalTree.tsx`
- Create: `src/renderer/src/features/company/ApprovalQueue.tsx`
- Create: `src/renderer/src/features/company/BudgetPanel.tsx`
- Create: `src/renderer/src/features/company/ActivityFeed.tsx`

**Interfaces:**
- Produces: `type CompanyState`, `seedCompany`, `addApprovalKey`, `rejectApproval`, `setBudgetLimit`, `budgetTone`.
- Produces: `useCompanyStore` with `approve(id)`, `reject(id)`, `setBudget(id, cents)`, `reset()`.

- [ ] **Step 1: Write the failing domain tests**

```ts
import { describe, expect, it } from 'vitest'
import { addApprovalKey, budgetTone, rejectApproval, seedCompany, setBudgetLimit } from './company'

describe('company authority', () => {
  it('approves a one-key request with one human key', () => {
    const state = addApprovalKey(seedCompany, 'approval-release', 'you')
    expect(state.approvals.find((a) => a.id === 'approval-release')?.status).toBe('approved')
  })

  it('keeps a two-key request pending until both humans turn their keys', () => {
    const once = addApprovalKey(seedCompany, 'approval-vendor', 'you')
    expect(once.approvals.find((a) => a.id === 'approval-vendor')?.status).toBe('pending')
    const twice = addApprovalKey(once, 'approval-vendor', 'partner')
    expect(twice.approvals.find((a) => a.id === 'approval-vendor')?.status).toBe('approved')
  })

  it('does not count the same key twice', () => {
    const state = addApprovalKey(seedCompany, 'approval-vendor', 'you')
    const again = addApprovalKey(state, 'approval-vendor', 'you')
    expect(again.approvals.find((a) => a.id === 'approval-vendor')?.keys).toEqual(['you'])
  })

  it('rejects a pending request and refuses to approve it afterwards', () => {
    const rejected = rejectApproval(seedCompany, 'approval-release', 'you')
    const approved = addApprovalKey(rejected, 'approval-release', 'you')
    expect(approved.approvals.find((a) => a.id === 'approval-release')?.status).toBe('rejected')
  })

  it('ignores negative budgets and flags hard stops', () => {
    expect(setBudgetLimit(seedCompany, 'budget-company', -1)).toBe(seedCompany)
    expect(budgetTone(25000, 26000)).toBe('hard_stop')
    expect(budgetTone(25000, 21000)).toBe('warning')
    expect(budgetTone(25000, 4000)).toBe('healthy')
  })
})
```

Run: `npm test -- src/renderer/src/features/company/company.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement the pure domain**

`company.ts` defines the types, `seedCompany`, and pure functions. `addApprovalKey` returns the same state for a non-pending approval, an unknown approval, a duplicate key, or a key not in the allowed set. It appends the key and sets `status: 'approved'` when `keys.length >= requiredKeys`. `rejectApproval` sets `status: 'rejected'` only when pending. `setBudgetLimit` ignores non-finite or negative cents and recomputes `status` with `budgetTone(limit, observed)`.

`budgetTone(limit, observed)` returns `hard_stop` at or above 100%, `warning` at or above 80%, and `healthy` otherwise; a zero limit is `healthy` (disabled).

Seed data: company "Knight Studio"; goals "Ship the alpha", "Prove the research desk", "Cut run cost"; agents (Captain, three Consuls, four Adepts/Crew); tasks; approvals `approval-release` (requiredKeys 1) and `approval-vendor` (requiredKeys 2); budgets `budget-company` and `budget-research`; activity; artifacts.

Run the test again. Expected: PASS.

- [ ] **Step 3: Add the store**

`companyStore.ts` uses Zustand and wraps the pure functions. It persists to `localStorage` under `knight.company.v1` when available, and falls back to memory in tests.

```ts
export const useCompanyStore = create<CompanyStore>((set) => ({
  state: loadCompany(),
  approve: (id) => set((current) => ({ state: addApprovalKey(current.state, id, 'you') })),
  reject: (id) => set((current) => ({ state: rejectApproval(current.state, id, 'you') })),
  setBudget: (id, cents) => set((current) => ({ state: setBudgetLimit(current.state, id, cents) })),
  reset: () => set({ state: seedCompany })
}))
```

- [ ] **Step 4: Build the Company surface**

Layout: a header with "Company", a `Self` pill, and a reset button. Below, a responsive grid:

- Left column: `OrgChart` (Captain at the top, Consuls in a row, Adepts/Crew below, with connector borders) and `GoalTree`.
- Center: active tasks grouped by status, each with owner and priority; keep it dense and tabular.
- Right: `ApprovalQueue`, `BudgetPanel`, `ActivityFeed`.

`ApprovalQueue` renders each approval with risk, requester, key indicators, Approve/Reject buttons, and a "Two-key" badge for joint approvals. `BudgetPanel` renders observed/limit, a progress bar, and an inline USD input that calls `setBudget` in cents. `GoalTree` is recursive with expand/collapse. `ActivityFeed` is a simple signed-style list with actor and time.

All interactions are local and persist. No `window.knight` calls.

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm test`
Expected: PASS.

---

### Task 5: Table pairing preview and two-key gate

**Files:**
- Create: `src/renderer/src/features/table/table.ts`
- Create: `src/renderer/src/features/table/table.test.ts`
- Create: `src/renderer/src/features/table/TableSurface.tsx`
- Create: `src/renderer/src/features/table/PairingPanel.tsx`
- Create: `src/renderer/src/features/table/SharedTable.tsx`
- Create: `src/renderer/src/features/table/TwoKeyGate.tsx`

**Interfaces:**
- Produces: `type JointKey = 'a' | 'b'`, `turnJointKey`, `withdrawJoint`, `seedTable`.
- Produces: `useTableStore` with `turn(key)`, `withdraw()`, `togglePreview()`, `reset()`.

- [ ] **Step 1: Write the failing two-key test**

```ts
import { describe, expect, it } from 'vitest'
import { seedTable, turnJointKey, withdrawJoint } from './table'

describe('joint approval', () => {
  it('stays pending after one key and approves after both', () => {
    const one = turnJointKey(seedTable.approval, 'a')
    expect(one.status).toBe('pending')
    const two = turnJointKey(one, 'b')
    expect(two.status).toBe('approved')
  })

  it('is idempotent for the same key', () => {
    const one = turnJointKey(seedTable.approval, 'a')
    expect(turnJointKey(one, 'a')).toEqual(one)
  })

  it('cannot be approved after withdrawal', () => {
    const withdrawn = withdrawJoint(seedTable.approval)
    expect(turnJointKey(withdrawn, 'a').status).toBe('withdrawn')
    expect(turnJointKey(withdrawn, 'b').status).toBe('withdrawn')
  })
})
```

Run: `npm test -- src/renderer/src/features/table/table.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement the two-key logic**

`table.ts` defines `JointApproval` with `keys: { a: boolean; b: boolean }`, `status: 'pending' | 'approved' | 'withdrawn'`, and the pure functions. `turnJointKey` returns the same object for a non-pending approval or an already-true key; otherwise it returns the updated keys and `approved` only when both are true. `withdrawJoint` sets `withdrawn` and is idempotent.

Seed data: two identities (`You`, `Maya`), a shared goal "Ship the partner brief", a joint approval "Publish the shared brief" (needs both), a ledger with three entries, and two side budgets.

Run the test again. Expected: PASS.

- [ ] **Step 3: Add the table store**

`useTableStore` holds `paired: boolean`, `preview: boolean`, `approval`, and `ledger`. `turn('a')` is the local human; the UI also exposes a clearly labeled "Simulate partner key" button for the preview. `togglePreview` flips the preview. `reset` returns to the seed.

- [ ] **Step 4: Build the Table surface**

When `paired` is false, show `PairingPanel`: a hero with the line "Two desks. One table." and a diagram of two Captain cards joined by a dotted line to a table. Primary button "Start a session" (sets paired true for the preview), secondary "Join with a code" (opens a small input). A `Preview shared table` toggle lets the user inspect the shared layout without pairing.

When paired or previewing, show `SharedTable`:

- Header: "Table", `Collab` pill, `Preview data` amber badge when not actually paired, presence chips with identity colors.
- Shared goal and plan split into "Yours" and "Maya's" halves.
- `TwoKeyGate`: two keyholes, one for each identity, with the joint marker. The action button is enabled only when both keys are on. Buttons: "Turn your key" and, in preview, "Simulate partner key". Withdraw button.
- Ledger: entries with identity dots, attribution, timestamps, and status.
- Budgets: two columns, never merged, each with a per-side bar.

Use `bg-identity-a` and `bg-identity-b` for identity dots and the `joint-marker` class for the gate bar.

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm test`
Expected: PASS.

---

### Task 6: Full verification and first run

**Files:** none.

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 2: Tests**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: exit 0, `out/` updated.

- [ ] **Step 4: Run the app**

Run: `npm run dev` in the background.
Expected: Electron window opens on the Chat surface. Check:
- Rail switches Chat, Company, Table, Settings.
- Study appears on Chat and Company; Table appears on Table.
- Company approvals and budget edits work and persist.
- Table two-key gate requires both keys.
- Chat says the bridge is not connected and does not start a task.
- No old light/dark/system picker remains.

Capture a screenshot of each surface if the environment supports it. If screenshot capture fails, report that honestly.

- [ ] **Step 5: Report**

Summarize what changed, the verification output, the exact files touched, and the two remaining decisions for M2 (bridge transport and key custody). Do not commit.
