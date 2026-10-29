import { promises as fs } from 'node:fs'
import { dirname, relative } from 'node:path'
import { z } from 'zod'
import type { ApprovalReview, DiffLine } from '@shared/types'
import type { AgentTool, ToolContext } from './types'
import { defineTool, toolResultError } from './types'
import { resolveSafePath } from '../../security'
import { guard as guardOriginal, markApplied } from '../../services/snapshots'
import { diffLines, diffStat, type LineDiff } from '../diff'

/** Every edit is validated against the disk before the first byte is written,
 *  so a batch that cannot complete does not complete halfway. */
const MAX_EDITS_PER_CALL = 25
const MAX_BATCH_BYTES = 2_500_000
const MAX_REVIEWED_LINES = 600

const batchEditSchema = z.object({
  path: z.string().min(1).describe('File path, relative to the workspace or absolute inside a granted folder.'),
  old_text: z.string().optional().describe('Exact text to replace. Pair it with new_text.'),
  new_text: z.string().optional().describe('Replacement text. May be empty to delete old_text.'),
  content: z.string().optional().describe('Complete new file content. Use it instead of old_text and new_text.'),
  replace_all: z.boolean().optional().describe('Replace every occurrence of old_text instead of requiring one match.')
})

const applyChangesSchema = z.object({
  edits: z
    .array(batchEditSchema)
    .min(1)
    .max(MAX_EDITS_PER_CALL)
    .describe(`Between 1 and ${MAX_EDITS_PER_CALL} edits. Each edit carries either old_text plus new_text, or content.`),
  dry_run: z.boolean().optional().describe('Report what the batch would do without writing anything.')
})

type BatchEdit = z.infer<typeof batchEditSchema>

type RequestedChange =
  | { kind: 'replace'; oldText: string; newText: string; replaceAll: boolean }
  | { kind: 'write'; content: string }

type BatchProblem = { index: number; path: string; reason: string }
type ChangeOutcome = { ok: true; change: RequestedChange } | { ok: false; reason: string }

/** Every edit is either one targeted replacement or one whole-file write. */
function changeRequestedFor(edit: BatchEdit): ChangeOutcome {
  const hasOld = edit.old_text !== undefined
  const hasNew = edit.new_text !== undefined
  const hasContent = edit.content !== undefined
  const targeted = hasOld || hasNew
  if (targeted && hasContent) {
    return { ok: false, reason: 'Give either old_text with new_text, or content — never both.' }
  }
  if (!targeted && !hasContent) {
    return { ok: false, reason: 'Provide old_text with new_text, or content for a whole-file write.' }
  }
  if (hasOld !== hasNew) {
    return { ok: false, reason: hasOld ? 'new_text is missing for this replacement.' : 'old_text is missing for this replacement.' }
  }
  if (!hasOld) return { ok: true, change: { kind: 'write', content: edit.content! } }
  if (!edit.old_text) return { ok: false, reason: 'old_text must not be empty.' }
  return { ok: true, change: { kind: 'replace', oldText: edit.old_text, newText: edit.new_text!, replaceAll: !!edit.replace_all } }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function firstOccurrence(text: string, needle: string, replacement: string): string {
  const at = text.indexOf(needle)
  if (at < 0) return text
  // A string pattern would still expand $& and $1 in the replacement.
  return text.slice(0, at) + replacement + text.slice(at + needle.length)
}

function appliedChange(base: string, change: RequestedChange): string {
  if (change.kind === 'write') return change.content
  return change.replaceAll ? base.split(change.oldText).join(change.newText) : firstOccurrence(base, change.oldText, change.newText)
}

function occurrenceProblem(count: number, replaceAll: boolean, baseName: string): string | null {
  if (count === 0) return `Old text was not found in ${baseName}.`
  if (count > 1 && !replaceAll) {
    return `Old text appears ${count} times in ${baseName}. Add more context or set replace_all.`
  }
  return null
}

/** One path, evolving through the batch: what is on disk plus every edit so far. */
interface StagedFile {
  target: string
  path: string
  onDiskContent: string | null
  contentAfterEarlierEdits: string
  editIndexes: number[]
}

/** A staged path that actually differs from the disk, with its change measured. */
interface PreparedFile extends StagedFile {
  diff: LineDiff
}

interface BatchPlan {
  staged: StagedFile[]
  problems: BatchProblem[]
  cleanEditIndexes: number[]
}

async function planBatch(edits: BatchEdit[], ctx: ToolContext): Promise<BatchPlan> {
  const stagedByTarget = new Map<string, StagedFile>()
  const stagedInBatchOrder: StagedFile[] = []
  const problems: BatchProblem[] = []
  const cleanEditIndexes: number[] = []

  const stageFor = async (target: string, path: string): Promise<StagedFile> => {
    const existing = stagedByTarget.get(target)
    if (existing) return existing
    let onDiskContent: string | null
    try {
      onDiskContent = await fs.readFile(target, 'utf8')
    } catch {
      onDiskContent = null
    }
    const fresh: StagedFile = {
      target,
      path,
      onDiskContent,
      contentAfterEarlierEdits: onDiskContent ?? '',
      editIndexes: []
    }
    stagedByTarget.set(target, fresh)
    stagedInBatchOrder.push(fresh)
    return fresh
  }

  for (let index = 0; index < edits.length; index++) {
    const edit = edits[index]
    const outcome = changeRequestedFor(edit)
    if (!outcome.ok) {
      problems.push({ index, path: edit.path, reason: outcome.reason })
      continue
    }

    let target: string
    try {
      target = await resolveSafePath(ctx.roots, edit.path, { mode: 'write' })
    } catch (error) {
      problems.push({ index, path: edit.path, reason: messageOf(error) })
      continue
    }
    const path = relative(ctx.workspace, target) || target

    const stage = await stageFor(target, path)
    if (stage.onDiskContent?.includes('\0')) {
      problems.push({ index, path, reason: 'This file is not text, so the batch cannot edit it safely.' })
      continue
    }
    if (outcome.change.kind === 'write' && Buffer.byteLength(outcome.change.content, 'utf8') > MAX_BATCH_BYTES) {
      problems.push({ index, path, reason: 'Content exceeds the 2.5 MB write limit.' })
      continue
    }
    if (outcome.change.kind === 'replace' && !stage.editIndexes.length && stage.onDiskContent === null) {
      problems.push({ index, path, reason: 'The file does not exist yet, so there is no text to replace.' })
      continue
    }

    if (outcome.change.kind === 'replace') {
      const count = stage.contentAfterEarlierEdits.split(outcome.change.oldText).length - 1
      const baseName = stage.editIndexes.length
        ? 'the file as changed by earlier edits in this batch'
        : 'the file'
      const problem = occurrenceProblem(count, outcome.change.replaceAll, baseName)
      if (problem) {
        problems.push({ index, path, reason: problem })
        continue
      }
    }

    stage.contentAfterEarlierEdits = appliedChange(stage.contentAfterEarlierEdits, outcome.change)
    stage.editIndexes.push(index)
    cleanEditIndexes.push(index)
  }

  return { staged: stagedInBatchOrder, problems, cleanEditIndexes }
}

function changedAgainstDisk(stage: StagedFile): boolean {
  return stage.onDiskContent === null || stage.contentAfterEarlierEdits !== stage.onDiskContent
}

function filesToWrite(plan: BatchPlan): PreparedFile[] {
  return plan.staged
    .filter(changedAgainstDisk)
    .map((stage) => ({ ...stage, diff: diffLines(stage.onDiskContent ?? '', stage.contentAfterEarlierEdits) }))
}

function abortedReport(edits: BatchEdit[], plan: BatchPlan): string {
  const failed = plan.problems.map((problem) => `  edit[${problem.index}] ${problem.path}: ${problem.reason}`)
  const skipped = plan.cleanEditIndexes.map((index) => `  edit[${index}] ${edits[index].path}`)
  const lines = [
    `Batch rejected: ${plan.problems.length} of ${edits.length} edits failed. Nothing on disk was changed.`,
    '',
    'Failed:',
    ...failed
  ]
  if (skipped.length) lines.push('', 'Valid but not applied:', ...skipped)
  lines.push('', 'Fix every edit listed above and send the batch again.')
  return lines.join('\n')
}

function outcomeReport(
  plan: BatchPlan,
  files: PreparedFile[],
  totalAdded: number,
  totalRemoved: number,
  dryRun: boolean
): string {
  const head = dryRun
    ? `Dry run: ${plan.cleanEditIndexes.length} edits across ${files.length} file${files.length === 1 ? '' : 's'} would apply cleanly. Nothing was written.`
    : `Applied ${plan.cleanEditIndexes.length} edit${plan.cleanEditIndexes.length === 1 ? '' : 's'} across ${files.length} file${files.length === 1 ? '' : 's'}.`
  const body = files.map((stage) => `  ${stage.path}  ${diffStat(stage.diff)}`)
  const total = `Total  +${totalAdded} −${totalRemoved}`
  return [head, ...body, total].join('\n')
}

/** The writes happen back to back here; a failure part-way restores the files
 *  already written so the batch never lands half-applied. */
async function commitBatch(taskId: string, stepId: string | undefined, files: PreparedFile[]): Promise<string | null> {
  const written: PreparedFile[] = []
  try {
    for (const stage of files) {
      await guardOriginal(taskId, stage.target, { stepId })
      await fs.mkdir(dirname(stage.target), { recursive: true })
      await fs.writeFile(stage.target, stage.contentAfterEarlierEdits, 'utf8')
      await markApplied(taskId, stage.target, stepId)
      written.push(stage)
    }
    return null
  } catch (error) {
    const unrestored: string[] = []
    for (const stage of written.reverse()) {
      try {
        if (stage.onDiskContent === null) {
          await fs.rm(stage.target, { force: true })
        } else {
          await fs.writeFile(stage.target, stage.onDiskContent, 'utf8')
        }
      } catch {
        unrestored.push(stage.path)
      }
    }
    const detail = written.length
      ? `${written.length} ${written.length === 1 ? 'file' : 'files'} already written were restored${
          unrestored.length ? `, but these may still be changed: ${unrestored.join(', ')}` : ''
        }.`
      : 'No file was written.'
    return `${messageOf(error)} ${detail}`
  }
}

function totalsOf(files: PreparedFile[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const stage of files) {
    added += stage.diff.added
    removed += stage.diff.removed
  }
  return { added, removed }
}

function batchDiffLines(files: PreparedFile[]): { lines: DiffLine[]; truncated: boolean } {
  const lines: DiffLine[] = []
  let truncated = false
  for (let index = 0; index < files.length; index++) {
    const stage = files[index]
    truncated = truncated || stage.diff.truncated
    if (lines.length >= MAX_REVIEWED_LINES) {
      const hidden = files.length - index
      lines.push({ sign: ' ', text: `… ${hidden} more ${hidden === 1 ? 'file' : 'files'} not shown; the whole batch is applied on approval` })
      return { lines, truncated: true }
    }
    lines.push({ sign: ' ', text: `── ${stage.path} ──` }, ...stage.diff.lines)
  }
  return { lines, truncated }
}

function batchReview(edits: BatchEdit[], plan: BatchPlan): ApprovalReview | undefined {
  const files = filesToWrite(plan)
  if (!files.length && !plan.problems.length) return undefined
  const { added, removed } = totalsOf(files)
  const { lines, truncated } = batchDiffLines(files)
  const batch = edits.length === 1 ? 'edit' : 'edits'
  const note = plan.problems.length
    ? `${plan.problems.length} of ${edits.length} ${batch} would fail, so nothing is written. `
    : ''
  return {
    kind: 'diff',
    path: `${files.length} ${files.length === 1 ? 'file' : 'files'}`,
    added,
    removed,
    truncated,
    lines,
    note: `${note}This batch shows every file it changes, one after another.`
  }
}

const applyChangesTool = defineTool({
  name: 'apply_changes',
  title: 'Apply batch of edits',
  description:
    'Apply several file edits as one all-or-nothing batch: every edit is read and validated first, and nothing is written unless the whole batch can succeed. Each edit gives either old_text with new_text (replace_all optional) or content (whole-file write). Edits that share a path apply in array order, each seeing the last result. Batch order also decides which edit fails first when two target the same text.',
  schema: applyChangesSchema,
  sideEffect: 'write',
  risk: 'medium',
  approval: 'policy',
  approvalReview: async (args, ctx) => {
    const edits = args.edits ?? []
    if (edits.length > MAX_EDITS_PER_CALL || !edits.length) return undefined
    const plan = await planBatch(edits, ctx)
    return batchReview(edits, plan)
  },
  execute: async (args, ctx) => {
    try {
      const edits = args.edits ?? []
      if (edits.length > MAX_EDITS_PER_CALL) {
        return {
          content: `Batch rejected: apply_changes takes at most ${MAX_EDITS_PER_CALL} edits per call and got ${edits.length}. Nothing was written.`,
          isError: true
        }
      }

      const plan = await planBatch(edits, ctx)
      if (plan.problems.length) {
        return { content: abortedReport(edits, plan), isError: true }
      }

      const files = filesToWrite(plan)
      const { added: totalAdded, removed: totalRemoved } = totalsOf(files)
      if (args.dry_run) {
        return { content: outcomeReport(plan, files, totalAdded, totalRemoved, true) }
      }
      if (!files.length) {
        return { content: `Applied ${edits.length} edit${edits.length === 1 ? '' : 's'}; every file already held the requested text, so nothing was written.` }
      }

      const rollback = await commitBatch(ctx.task.id, ctx.callId, files)
      if (rollback) return { content: `Batch aborted while writing: ${rollback}`, isError: true }
      for (const stage of files) await ctx.addArtifact(stage.target)

      return { content: outcomeReport(plan, files, totalAdded, totalRemoved, false) }
    } catch (error) {
      return toolResultError(error)
    }
  },
  summarize: (args) => {
    const edits = args.edits ?? []
    const paths: string[] = []
    for (const edit of edits) {
      if (edit.path && !paths.includes(edit.path)) paths.push(edit.path)
    }
    const shown = paths.length <= 4 ? paths.join(', ') : `${paths.slice(0, 4).join(', ')} and ${paths.length - 4} more`
    return `Batch ${edits.length} edit${edits.length === 1 ? '' : 's'} in ${paths.length} ${paths.length === 1 ? 'file' : 'files'} (${shown})`
  }
})

export const patchTools: AgentTool[] = [applyChangesTool]
