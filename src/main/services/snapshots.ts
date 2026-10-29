import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { RevertOutcome, SnapshotEntry } from '@shared/types'
import { getPaths } from '../paths'

/**
 * Step checkpoints: the way back, and the way forward.
 *
 * A task's every mutating file operation is bracketed by a capture of what the
 * path held before it ran (`before`) and, once it succeeded, what it holds after
 * (`after`). Restoring an earlier step is therefore undo, and replaying the
 * `after` blobs forward is redo — no second capture pass, because both sides of
 * every step are already stored by content hash.
 *
 * The design is borrowed from OpenCode's session revert (per-message trees,
 * path-scoped restore, a captured `original` that makes redo possible) and
 * deliberately drops its git dependency: this app's users point it at ordinary
 * folders, and a shadow git repo would either refuse to start or, as Roo Code
 * demonstrated, `clean -fd` away files the user never committed.
 *
 * Two rules protect the user's own later work:
 *   - restore is path-scoped, never whole-tree;
 *   - a file whose current bytes are neither side of the step being undone is
 *     refused rather than overwritten, because someone edited it after the task.
 */

export interface GuardOptions {
  /** Identifies the tool call this capture belongs to; the redo unit. */
  stepId?: string
  forDeletion?: boolean
}

export interface GuardResult {
  guarded: boolean
  reason?: string
}

/** Beyond this, no copy is attempted and the change is declared unreversible. */
const SKIP_ABOVE = 512_000_000

const dirFor = (taskId: string): string => join(getPaths().snapshots, taskId)
const indexFile = (taskId: string): string => join(dirFor(taskId), 'index.json')
const objectDir = (taskId: string, oid: string): string =>
  join(dirFor(taskId), 'objects', oid.slice(0, 2))
const objectPath = (taskId: string, oid: string): string => join(objectDir(taskId, oid), oid.slice(2))

const oidOf = (bytes: Buffer | string): string =>
  createHash('sha256').update(typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes).digest('hex')

/**
 * One task's mutations queue behind each other: the Captain and a Crew seat can
 * touch the same file in the same task, and two writers replacing index.json
 * would lose one of them.
 */
const queues = new Map<string, Promise<unknown>>()

async function withinTask<T>(taskId: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(taskId) ?? Promise.resolve()
  const run = previous.then(work, work)
  queues.set(
    taskId,
    run.catch(() => undefined)
  )
  return run
}

async function readIndex(taskId: string): Promise<SnapshotEntry[]> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(indexFile(taskId), 'utf8'))
    return Array.isArray(parsed) ? (parsed as SnapshotEntry[]) : []
  } catch {
    return []
  }
}

async function writeIndex(taskId: string, entries: SnapshotEntry[]): Promise<void> {
  await fs.mkdir(dirFor(taskId), { recursive: true })
  const temp = `${indexFile(taskId)}.${process.pid}.tmp`
  await fs.writeFile(temp, JSON.stringify(entries, null, 2), 'utf8')
  await fs.rename(temp, indexFile(taskId))
}

/** Store bytes by hash, so a file edited ten times costs one copy. */
async function putObject(taskId: string, source: string): Promise<string> {
  const stats = await fs.stat(source)
  if (stats.size > SKIP_ABOVE) throw new Error(`file is ${(stats.size / 1_000_000).toFixed(0)} MB`)
  const digest = createHash('sha256')
  digest.update(await fs.readFile(source))
  const oid = digest.digest('hex')
  const target = objectPath(taskId, oid)
  try {
    await fs.stat(target)
    return oid
  } catch {
    /* not stored yet */
  }
  await fs.mkdir(objectDir(taskId, oid), { recursive: true })
  const temp = `${target}.${process.pid}.tmp`
  /* Always a copy. A hard link would share the live file's content, so editing
   * the file would silently rewrite its own backup — the store only means
   * anything if it cannot change underneath us. */
  try {
    await fs.copyFile(source, temp)
    await fs.rename(temp, target)
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
  return oid
}

async function hasObject(taskId: string, oid: string): Promise<boolean> {
  try {
    await fs.stat(objectPath(taskId, oid))
    return true
  } catch {
    return false
  }
}

function liveSha(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** The newest record for a path, which is the state a revert would leave behind. */
function latestFor(entries: SnapshotEntry[], path: string): SnapshotEntry | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    if (entries[index].path === path) return entries[index]
  }
  return undefined
}

/**
 * Call immediately before a mutating file operation.
 *
 * Never throws: a failed capture must not stop the work the user asked for. The
 * caller is told the change is unreversible so it can say so in its own result.
 */
export async function guard(
  taskId: string,
  target: string,
  options: GuardOptions = {}
): Promise<GuardResult> {
  const path = resolve(target)
  try {
    return await withinTask(taskId, async () => {
      const entries = await readIndex(taskId)
      const existing = latestFor(entries, path)
      if (existing) {
        return { guarded: !existing.skipped, reason: existing.skipped }
      }

      let stats
      try {
        stats = await fs.lstat(path)
      } catch {
        await writeIndex(taskId, [
          ...entries,
          { path, state: 'missing', at: new Date().toISOString(), ...withStep(options) }
        ])
        return { guarded: true }
      }

      if (stats.isDirectory()) {
        const children = await fs.readdir(path).catch(() => ['unknown'])
        const skipped = options.forDeletion && children.length > 0
          ? 'the folder had contents; only the empty folder can come back'
          : undefined
        await writeIndex(taskId, [
          ...entries,
          {
            path,
            state: 'directory',
            ...(skipped ? { skipped } : {}),
            at: new Date().toISOString(),
            ...withStep(options)
          }
        ])
        return { guarded: !skipped, ...(skipped ? { reason: skipped } : {}) }
      }

      if (!stats.isFile()) {
        return { guarded: false, reason: 'the path is neither a file nor a folder, so it cannot be copied' }
      }
      if (stats.size > SKIP_ABOVE) {
        return { guarded: false, reason: `the original was ${(stats.size / 1_000_000).toFixed(0)} MB, past the undo limit` }
      }

      let oid: string
      try {
        oid = await putObject(taskId, path)
      } catch (error) {
        return {
          guarded: false,
          reason: `the original could not be stored (${error instanceof Error ? error.message : 'unknown error'})`
        }
      }

      await writeIndex(taskId, [
        ...entries,
        {
          path,
          state: 'file',
          before: oid,
          bytes: stats.size,
          at: new Date().toISOString(),
          ...withStep(options)
        }
      ])
      return { guarded: true }
    })
  } catch (error) {
    return {
      guarded: false,
      reason: `the undo trail could not be written (${error instanceof Error ? error.message : 'unknown error'})`
    }
  }
}

const withStep = (options: GuardOptions): { stepId?: string } =>
  options.stepId ? { stepId: options.stepId } : {}

/**
 * Call after a mutating operation succeeded. Records the resulting bytes so the
 * step can be replayed forward by redo.
 */
export async function markApplied(taskId: string, target: string, stepId?: string): Promise<void> {
  const path = resolve(target)
  await withinTask(taskId, async () => {
    const entries = await readIndex(taskId)
    const entry = latestFor(entries, path)
    if (!entry || entry.after) return undefined
    try {
      const stats = await fs.lstat(path)
      if (stats.isDirectory()) entry.after = null
      else if (stats.isFile()) entry.after = await putObject(taskId, path)
    } catch {
      entry.after = null
    }
    if (stepId && !entry.stepId) entry.stepId = stepId
    await writeIndex(taskId, entries)
    return undefined
  })
}

export async function list(taskId: string): Promise<SnapshotEntry[]> {
  return withinTask(taskId, () => readIndex(taskId))
}

/** Distinct steps in capture order, oldest first. The UI's timeline. */
export async function steps(taskId: string): Promise<string[]> {
  const entries = await list(taskId)
  const seen: string[] = []
  for (const entry of entries) {
    const id = entry.stepId ?? 'task'
    if (!seen.includes(id)) seen.push(id)
  }
  return seen
}

async function restoreFile(taskId: string, path: string, oid: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const temp = `${path}.selfimpulse-${process.pid}.tmp`
  await fs.copyFile(objectPath(taskId, oid), temp)
  await fs.rm(path, { force: true })
  await fs.rename(temp, path)
}

/**
 * Put paths back to the state recorded at `toStep`, or to the task's start when
 * no step is given. Only paths in the trail are touched.
 */
export async function revert(taskId: string, options: { toStep?: string } = {}): Promise<RevertOutcome> {
  return moveBackward(taskId, options.toStep, 'before')
}

/** Replay a reverted step's captured result, forward again to the tip. */
export async function redo(taskId: string, options: { toStep?: string } = {}): Promise<RevertOutcome> {
  return moveForward(taskId, options.toStep)
}

async function moveBackward(
  taskId: string,
  toStep: string | undefined,
  side: 'before'
): Promise<RevertOutcome> {
  return withinTask(taskId, async () => {
    const entries = await readIndex(taskId)
    const boundary = toStep ? stepIndex(entries, toStep) : -1
    const targets = entries.filter((entry, index) => index > boundary)
    const outcome: RevertOutcome = { restored: [], removed: [], left: [] }
    const undone = new Set<SnapshotEntry>()

    for (const entry of [...targets].reverse()) {
      const blocked = await applyEntry(taskId, entry, side, outcome)
      if (!blocked) undone.add(entry)
    }

    /* The trail survives a revert on purpose: redo replays it. Objects are only
     * dropped when the task itself goes, or when the user redoes to the tip. */
    void undone
    return outcome
  })
}

async function moveForward(taskId: string, toStep: string | undefined): Promise<RevertOutcome> {
  return withinTask(taskId, async () => {
    const entries = await readIndex(taskId)
    const outcome: RevertOutcome = { restored: [], removed: [], left: [] }
    const replay = toStep ? entries.slice(0, stepIndex(entries, toStep) + 1) : entries

    for (const entry of replay) {
      await applyEntry(taskId, entry, 'after', outcome)
    }
    return outcome
  })
}

const stepIndex = (entries: SnapshotEntry[], step: string): number =>
  entries.findIndex((entry) => entry.stepId === step)

/**
 * Apply one record. Returns true when it was refused, so the caller keeps the
 * trail instead of spending a step that never landed.
 */
async function applyEntry(
  taskId: string,
  entry: SnapshotEntry,
  side: 'before' | 'after',
  outcome: RevertOutcome
): Promise<boolean> {
  const want = side === 'before' ? entry.before : entry.after

  if (side === 'before' && entry.skipped) {
    outcome.left.push({ path: entry.path, reason: entry.skipped })
    return true
  }

  if (entry.state === 'missing') {
    /* The path did not exist at capture time: undo removes what the task made,
     * redo re-applies the task's result. Both need the stored bytes. */
    const shouldExist = side === 'after' && Boolean(entry.after)
    if (!shouldExist) {
      try {
        const now = await fs.lstat(entry.path)
        if (now.isDirectory()) await fs.rmdir(entry.path)
        else await fs.rm(entry.path, { force: true })
        outcome.removed.push(entry.path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
        outcome.left.push({
          path: entry.path,
          reason: error instanceof Error ? error.message : 'the task output could not be removed'
        })
        return true
      }
      return false
    }
    try {
      await restoreFile(taskId, entry.path, entry.after as string)
      outcome.restored.push(entry.path)
    } catch (error) {
      outcome.left.push({
        path: entry.path,
        reason: error instanceof Error ? error.message : 'the task output could not be replayed'
      })
      return true
    }
    return false
  }

  if (entry.state === 'directory') {
    try {
      await fs.lstat(entry.path)
    } catch {
      try {
        await fs.mkdir(entry.path)
        outcome.restored.push(entry.path)
      } catch (error) {
        outcome.left.push({
          path: entry.path,
          reason: error instanceof Error ? error.message : 'the folder could not be recreated'
        })
        return true
      }
    }
    return false
  }

  if (entry.state === 'moved') {
    const destination = entry.movedTo
    if (!destination) {
      outcome.left.push({ path: entry.path, reason: 'the destination was never recorded' })
      return true
    }
    const back = side === 'before'
    const from = back ? entry.path : destination
    const to = back ? destination : entry.path
    try {
      await fs.lstat(to)
      outcome.left.push({ path: entry.path, reason: `${to} is occupied, so the move was left alone` })
      return true
    } catch {
      /* free to move */
    }
    try {
      await fs.mkdir(dirname(to), { recursive: true })
      await fs.rename(from, to)
      outcome.restored.push(to)
    } catch (error) {
      outcome.left.push({
        path: entry.path,
        reason: error instanceof Error ? error.message : 'the move could not be reversed'
      })
      return true
    }
    return false
  }

  /* A file. Refuse to overwrite anything the user touched after the task. */
  if (!want) {
    outcome.left.push({ path: entry.path, reason: 'no stored copy for this step' })
    return true
  }
  if (!(await hasObject(taskId, want))) {
    outcome.left.push({ path: entry.path, reason: 'the stored copy is missing from the trail' })
    return true
  }
  try {
    const current = await fs.readFile(entry.path)
    const other = side === 'before' ? entry.after : entry.before
    if (other && liveSha(current) !== other) {
      outcome.left.push({
        path: entry.path,
        reason: 'the file changed after this task, so it was left alone'
      })
      return true
    }
  } catch {
    /* absent: nothing to clobber */
  }
  try {
    await restoreFile(taskId, entry.path, want)
    outcome.restored.push(entry.path)
  } catch (error) {
    outcome.left.push({
      path: entry.path,
      reason: error instanceof Error ? error.message : 'the copy failed'
    })
    return true
  }
  return false
}

/** Drop blobs no remaining record references any more. */
async function pruneObjects(taskId: string, kept: SnapshotEntry[]): Promise<void> {
  const needed = new Set<string>()
  for (const entry of kept) {
    if (entry.before) needed.add(entry.before)
    if (typeof entry.after === 'string') needed.add(entry.after)
  }
  const objectsRoot = join(dirFor(taskId), 'objects')
  let prefixes: string[] = []
  try {
    prefixes = await fs.readdir(objectsRoot)
  } catch {
    return
  }
  for (const prefix of prefixes) {
    const dir = join(objectsRoot, prefix)
    const names = await fs.readdir(dir).catch(() => [] as string[])
    for (const name of names) {
      if (needed.has(prefix + name)) continue
      await fs.rm(join(dir, name), { force: true }).catch(() => undefined)
    }
    if (!(await fs.readdir(dir).catch(() => ['x'])).length) {
      await fs.rmdir(dir).catch(() => undefined)
    }
  }
}

/** Record a rename or move so it can be reversed in either direction. */
export async function recordMove(taskId: string, from: string, to: string, stepId?: string): Promise<void> {
  const source = resolve(from)
  const destination = resolve(to)
  await withinTask(taskId, async () => {
    const entries = await readIndex(taskId)
    if (
      entries.some(
        (entry) => entry.state === 'moved' && entry.path === source && entry.movedTo === destination
      )
    ) {
      return undefined
    }
    await writeIndex(taskId, [
      ...entries,
      {
        path: source,
        state: 'moved',
        movedTo: destination,
        at: new Date().toISOString(),
        ...withStep({ stepId })
      }
    ])
    return undefined
  })
}

/** Drop the whole trail; called when the task itself goes. */
export async function clear(taskId: string): Promise<void> {
  await withinTask(taskId, async () => {
    await fs.rm(dirFor(taskId), { recursive: true, force: true })
    return undefined
  })
}
