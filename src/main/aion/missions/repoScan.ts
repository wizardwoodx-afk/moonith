/**
 * The bounded durable mission — a repository scan.
 *
 * Deliberately ONE mission, not a port of every desktop tool. Aion earns its
 * keep on work worth surviving a restart, and a repository scan is the
 * clearest case in this app: it reads a lot, proposes changes, stops for a
 * human, applies them, runs the tests, writes the report. Each of those must
 * not happen twice.
 *
 *   scan -> propose -> APPROVAL -> apply -> test -> report
 *
 * Two rules shape the code below:
 *
 *   1. A step never re-derives what an earlier step already produced. It
 *      reads `ctx.results`, which the orchestrator folds back out of the
 *      journal — so the step behaves identically whether the previous step
 *      ran a millisecond ago in this process or before a restart.
 *   2. Every effectful step crosses the governance gate through the injected
 *      runner. A durable mission is not a licence to bypass the gate; the
 *      gate is what authorises `apply` and `test`, and its decision is what
 *      lands in the receipt chain.
 */
import { defineWorkflow, type ApprovalRequest, type StepContext, type StepKeyContext, type Workflow } from '../workflow'
import type { GovernedAction, GovernedResult } from '@shared/enterprise'

/* ── the shapes ───────────────────────────────────────────────────────────── */

/** One thing the scan found worth changing. */
export interface RepoFinding {
  path: string
  line: number
  kind: 'todo' | 'secret' | 'large-file' | 'stale-dependency' | 'other'
  severity: 'low' | 'medium' | 'high'
  message: string
}

/** What the human is asked to approve. */
export interface RepoProposal {
  root: string
  findings: RepoFinding[]
  /** How many findings the apply step intends to act on. */
  planned: number
}

export interface RepoScanReport {
  root: string
  findings: number
  applied: number
  testsOk: boolean
  testOutput: string
}

/** Everything the mission needs from the outside world. Injected, never
 *  imported: the mission must run identically in a test and in the app, and
 *  the governance gate must be the thing that authorises the effects. */
export interface RepoScanDeps {
  /** Read the repository and report what is worth changing. */
  scan: (root: string) => Promise<RepoFinding[]>
  /** Turn findings into the proposal the human reads. */
  propose: (root: string, findings: RepoFinding[]) => Promise<RepoProposal>
  /** Apply the proposal. The mission id names the artefact, so a retry
   *  overwrites its own work instead of leaving a second copy, a crash can be
   *  settled by looking for that one file, and a failure can undo exactly what
   *  it wrote. */
  apply: (proposal: RepoProposal, missionId: string) => Promise<{ applied: number }>
  /** Did this mission's effect land? The one question a reconciliation asks. */
  applied: (missionId: string) => Promise<boolean>
  /** Undo an apply that failed after writing. */
  unapply: (missionId: string) => Promise<void>
  /** Run the tests after applying. */
  test: () => Promise<{ ok: boolean; output: string }>
  /** Write the report somewhere durable. */
  report: (report: RepoScanReport) => Promise<string | null>
  /** The gate every effectful step crosses. The mission id is passed so the
   *  decision, the receipt and the mission can be joined afterwards. */
  runner: (action: GovernedAction, missionId: string) => Promise<GovernedResult>
}

export interface RepoScanInput {
  root: string
  deps: RepoScanDeps
}

export const REPO_SCAN_WORKFLOW_ID = 'repo-scan'

/* ── helpers ──────────────────────────────────────────────────────────────── */

/** The idempotency key for a step: stable per mission and step, so an
 *  external system asked twice about the same work can dedupe it. Aion does
 *  not promise exactly-once effects — this is the caller's half of that
 *  contract, and it is why the key names the mission, not the attempt. */
function keyFor(stepId: string) {
  return (ctx: StepKeyContext<RepoScanInput>): string => `${ctx.missionId}:${stepId}`
}

/** Wrap one effect as a governed action. The risk level is what decides
 *  whether the gate asks a human: applying changes always does, running the
 *  tests does not. */
function governed(
  tool: string,
  detail: string,
  risk: 'medium' | 'high',
  effect: () => Promise<{ content: string; isError?: boolean }>
): GovernedAction {
  return {
    tool,
    args: {},
    detail,
    sideEffect: risk === 'high' ? 'execute' : 'write',
    risk,
    approval: risk === 'high' ? 'always' : 'never',
    effect
  }
}

/** Run an effect through the gate, and fail the step if the gate refused.
 *  A refused action must stop the mission, not quietly continue past it. */
async function throughGate(
  deps: RepoScanDeps,
  missionId: string,
  action: GovernedAction
): Promise<GovernedResult> {
  const outcome = await deps.runner(action, missionId)
  if (outcome.isError) throw new Error(outcome.content)
  return outcome
}

/* ── the workflow ─────────────────────────────────────────────────────────── */

export function repoScanWorkflow(): Workflow<RepoScanInput> {
  return defineWorkflow<RepoScanInput>({
    id: REPO_SCAN_WORKFLOW_ID,
    version: 1,
    steps: [
      {
        id: 'scan',
        kind: 'action',
        capability: 'fs.read',
        idempotencyKey: keyFor('scan'),
        /* A read is safe to retry: re-reading a directory cannot have
         * changed anything out there. */
        retry: { attempts: 2, backoffMs: 250 },
        async run(ctx) {
          const findings = await ctx.input.deps.scan(ctx.input.root)
          return { findings }
        }
      },
      {
        id: 'propose',
        kind: 'action',
        capability: 'fs.read',
        idempotencyKey: keyFor('propose'),
        async run(ctx) {
          const findings = (ctx.results.scan as { findings: RepoFinding[] }).findings
          const proposal = await ctx.input.deps.propose(ctx.input.root, findings)
          return { proposal }
        }
      },
      {
        id: 'approve',
        kind: 'approval',
        describe(ctx): ApprovalRequest {
          const proposal = ctx.results.propose as { proposal: RepoProposal } | undefined
          const planned = proposal?.proposal.planned ?? 0
          return {
            title: 'Apply the proposed repository changes',
            summary: planned
              ? `The scan found ${planned} ${planned === 1 ? 'change' : 'changes'} worth making under ${ctx.input.root}. Approving applies them and runs the tests; refusing stops here with nothing changed.`
              : `The scan found nothing worth changing under ${ctx.input.root}. Approving still runs the tests; refusing stops here.`,
            risk: 'high'
          }
        }
      },
      {
        id: 'apply',
        kind: 'action',
        capability: 'fs.write',
        idempotencyKey: keyFor('apply'),
        /* Applying is NOT freely retryable: a second attempt after a partial
         * apply could double the effect. The key is what lets an external
         * system dedupe; the retry here is one attempt, because the mission's
         * recovery path for a crash mid-apply is reconciliation, not retry. */
        retry: { attempts: 1, backoffMs: 0 },
        async run(ctx) {
          const { deps, root } = ctx.input
          const proposal = (ctx.results.propose as { proposal: RepoProposal }).proposal
          await throughGate(
            deps,
            ctx.missionId,
            governed(
              'apply_repository_changes',
              `Apply ${proposal.planned} proposed ${proposal.planned === 1 ? 'change' : 'changes'} under ${root}`,
              'high',
              async () => {
                const outcome = await deps.apply(proposal, ctx.missionId)
                return { content: `applied ${outcome.applied}`, isError: false }
              }
            )
          )
          return { applied: proposal.planned }
        },
        /* An apply that failed after writing is undone, so a failed mission
         * leaves the output directory as it found it. Nothing is undone when
         * nothing landed — a gate refusal is the common case, and recording
         * a compensation for work that never happened would be a lie in the
         * journal. */
        async compensate(ctx) {
          const { deps } = ctx.input
          if (await deps.applied(ctx.missionId)) await deps.unapply(ctx.missionId)
        },
        /* A crash mid-apply is settled by looking for the mission's artefact,
         * not by re-running the write: present means the effect landed,
         * absent means it did not. When it did land, the result the step would
         * have returned is still derivable from the proposal — and the report
         * step reads it, so it must be handed back. */
        async reconcile(ctx) {
          if (!(await ctx.input.deps.applied(ctx.missionId))) return 'failed' as const
          const proposal = (ctx.results.propose as { proposal: RepoProposal }).proposal
          return { resolution: 'done' as const, result: { applied: proposal.planned } }
        }
      },
      {
        id: 'test',
        kind: 'action',
        capability: 'shell.exec',
        idempotencyKey: keyFor('test'),
        /* Running the suite twice is wasteful but harmless, so a single
         * retry is affordable here — unlike apply. */
        retry: { attempts: 2, backoffMs: 500 },
        async run(ctx) {
          const { deps } = ctx.input
          const outcome = await throughGate(
            deps,
            ctx.missionId,
            governed('run_repository_tests', 'Run the repository test suite after applying', 'medium', async () => {
              const result = await deps.test()
              return { content: result.output, isError: !result.ok }
            })
          )
          return { ok: !outcome.isError }
        }
      },
      {
        id: 'report',
        kind: 'action',
        capability: 'fs.write',
        idempotencyKey: keyFor('report'),
        async run(ctx) {
          const { deps, root } = ctx.input
          const applied = (ctx.results.apply as { applied: number }).applied
          const scan = ctx.results.scan as { findings: RepoFinding[] }
          const test = ctx.results.test as { ok: boolean }
          const path = await deps.report({
            root,
            findings: scan.findings.length,
            applied,
            testsOk: test.ok,
            testOutput: ''
          })
          return { reportPath: path }
        }
      }
    ]
  })
}
