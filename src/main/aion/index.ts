/**
 * Aion — the barrel, and the production wiring.
 *
 * `aionOrchestrator()` hands out the one orchestrator the app runs on. It is
 * built lazily so importing this module never touches the filesystem: tests
 * construct a `MemoryMissionOrchestrator` directly, and only the running app
 * gets the file-backed journals.
 *
 * The mission set is deliberately small. `startRepoScanMissionForRoot` is the
 * one bounded mission that ships, and its production dependencies are honest
 * about what it does: it reviews a repository and writes a patch the human
 * can read and apply themselves. It does NOT edit the working tree — a
 * durable mission is a reason to be more careful about side effects, not
 * less.
 */
import { join } from 'node:path'
import { getPaths } from '../paths'
import { MissionOrchestrator, type MissionState } from './orchestrator'
import { REPO_SCAN_WORKFLOW_ID, repoScanWorkflow, type RepoScanDeps, type RepoScanInput } from './missions/repoScan'
import { productionRepoScanDeps } from './missions/repoScanDeps'
import type {
  MissionStatusView,
  MissionStepView,
  MissionSummaryView
} from '@shared/enterprise'

export * from './workflow'
export * from './journal'
export {
  MissionOrchestrator,
  MemoryMissionOrchestrator,
  foldMission,
  type MissionState,
  type MissionOrchestratorOptions,
  type StepRuntime,
  type StepRuntimeStatus,
  type PendingApproval
} from './orchestrator'
export {
  REPO_SCAN_WORKFLOW_ID,
  repoScanWorkflow,
  type RepoFinding,
  type RepoProposal,
  type RepoScanDeps,
  type RepoScanInput,
  type RepoScanReport
} from './missions/repoScan'

/* ── the view the renderer renders ───────────────────────────────────────── */

/** Map a folded mission onto what the audit pane shows. The pane gets a
 *  view, never the orchestrator's own objects — the step ledger is what makes
 *  the durability legible, so it is carried across whole. */
export function toMissionView(state: MissionState<unknown>): MissionSummaryView {
  const steps: MissionStepView[] = state.steps.map((step) => ({
    id: step.id,
    kind: step.kind,
    status:
      step.status === 'waiting'
        ? 'waiting'
        : step.status === 'running' && state.status === 'needs-reconciliation'
          ? 'running'
          : step.status,
    attempts: step.attempts
  }))
  return {
    missionId: state.missionId,
    workflowId: state.workflowId,
    status: state.status as MissionStatusView,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    steps,
    pendingApproval: state.pendingApproval
      ? {
          stepId: state.pendingApproval.stepId,
          title: state.pendingApproval.request.title,
          summary: state.pendingApproval.request.summary
        }
      : null,
    error: state.error
  }
}

/* ── production wiring ────────────────────────────────────────────────────── */

let singleton: MissionOrchestrator | null = null

/** The one orchestrator, rooted at the app profile. */
export function aionOrchestrator(): MissionOrchestrator {
  if (!singleton) {
    singleton = new MissionOrchestrator({
      dir: join(getPaths().root, 'aion', 'missions'),
      /* The repository mission's input carries its governance gate and the
       * tools it calls. A journal keeps data, not functions, so the bindings
       * are re-attached when a mission is adopted after a restart — without
       * this, a mission that parked at its approval could not take a single
       * step once the app came back. */
      resolveInput: (workflowId, journaled) => {
        if (workflowId !== REPO_SCAN_WORKFLOW_ID) return journaled
        const data = (journaled ?? {}) as Record<string, unknown>
        return { ...data, deps: productionRepoScanDeps() }
      }
    })
    singleton.registerWorkflow(repoScanWorkflow())
  }
  return singleton
}

/** Probe/test helper: replace the singleton. */
export function setAionOrchestrator(orchestrator: MissionOrchestrator | null): void {
  singleton = orchestrator
}

/** Start the bounded repository mission for a root. */
export async function startRepoScanMissionForRoot(
  root: string,
  deps?: RepoScanDeps
): Promise<MissionSummaryView> {
  const orchestrator = aionOrchestrator()
  const missionId = await orchestrator.start(REPO_SCAN_WORKFLOW_ID, {
    root,
    deps: deps ?? productionRepoScanDeps()
  } satisfies RepoScanInput)
  const state = await orchestrator.query(missionId)
  if (!state) throw new Error(`mission ${missionId} produced no journal`)
  return toMissionView(state)
}
