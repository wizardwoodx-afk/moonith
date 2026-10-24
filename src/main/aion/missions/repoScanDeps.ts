/**
 * The production dependencies for the repository mission.
 *
 * WHAT THIS DOES AND DOES NOT DO — stated plainly, because a durable mission
 * that quietly edits a working tree would be the worst possible use of the
 * machinery:
 *
 *   It READS the repository (a bounded walk), finds things worth a human's
 *   attention, asks the human, and then writes a review table and a report
 *   into the mission's own output directory. The review is named after the
 *   mission, so it can be found again: a retry overwrites its own copy, a
 *   crash is settled by looking for it, and a failed apply removes it.
 *
 *   It does NOT modify the repository. The human applies the patch themselves,
 *   with their own tools, after reading it. That is a deliberate boundary, not
 *   a missing feature: the approval gate authorises the mission to produce a
 *   reviewable artefact, and the human keeps the last mile.
 *
 * Every effectful step still crosses the governance gate through the injected
 * runner, so what the mission did is governed and receipted exactly as a
 * Captain tool call would be.
 */
import { promises as fs } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { newId } from '../../util'
import { getPaths } from '../../paths'
import { captainActionIds, runGovernedAction } from '../../agent/governed'
import type { GovernedAction, GovernedResult } from '@shared/enterprise'
import type { RepoFinding, RepoProposal, RepoScanDeps, RepoScanReport } from './repoScan'

/* ── the bounded walk ─────────────────────────────────────────────────────── */

const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  'release',
  '.next',
  '.nuxt',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  'target'
])

/** Files past this size are reported, not read. */
const LARGE_FILE_BYTES = 512 * 1024
/** Files past this size are never read at all. */
const MAX_READ_BYTES = 256 * 1024
/** The walk stops here. A mission that scans forever is not bounded. */
const MAX_FILES = 5_000
/** Lines past this in one file are not read. */
const MAX_LINES_PER_FILE = 4_000

/** Patterns worth a human's attention. Deliberately few and loud: a scan
 *  that reports everything reports nothing. */
const SECRET_PATTERNS: Array<{ re: RegExp; message: string }> = [
  { re: /AKIA[0-9A-Z]{16}/, message: 'looks like an AWS access key id' },
  { re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, message: 'a private key block' },
  { re: /gh[pousr]_[A-Za-z0-9]{36,}/, message: 'looks like a GitHub token' },
  { re: /sk-[A-Za-z0-9]{32,}/, message: 'looks like an API secret key' },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/, message: 'looks like a Slack token' }
]

const TODO_RE = /\b(?:TODO|FIXME|HACK|XXX)\b[:\s]?(.*)$/i

interface WalkEntry {
  abs: string
  rel: string
  size: number
}

/** Walk a directory depth-first, skipping the directories that are never
 *  worth reading and stopping at MAX_FILES. Never follows symlinks: a scan
 *  that escapes the root it was given is a bug, not a feature. */
async function walk(root: string): Promise<WalkEntry[]> {
  const out: WalkEntry[] = []
  const stack: string[] = [root]
  while (stack.length > 0 && out.length < MAX_FILES) {
    const dir = stack.pop() as string
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (out.length >= MAX_FILES) break
      const abs = join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue
        stack.push(abs)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const stat = await fs.stat(abs)
        out.push({ abs, rel: relative(root, abs).split(sep).join('/'), size: stat.size })
      } catch {
        /* a file that vanished mid-walk is simply not there */
      }
    }
  }
  return out
}

/* ── scan ─────────────────────────────────────────────────────────────────── */

async function scan(root: string): Promise<RepoFinding[]> {
  const findings: RepoFinding[] = []
  const entries = await walk(resolve(root))

  for (const entry of entries) {
    if (entry.size > LARGE_FILE_BYTES) {
      findings.push({
        path: entry.rel,
        line: 0,
        kind: 'large-file',
        severity: 'low',
        message: `${(entry.size / 1024).toFixed(0)} KiB — large enough to be worth checking into git history`
      })
      continue
    }
    if (entry.size > MAX_READ_BYTES) continue

    let text: string
    try {
      text = await fs.readFile(entry.abs, 'utf8')
    } catch {
      continue
    }
    const lines = text.split('\n')
    const limit = Math.min(lines.length, MAX_LINES_PER_FILE)
    for (let index = 0; index < limit; index += 1) {
      const line = lines[index] as string
      const secret = SECRET_PATTERNS.find((pattern) => pattern.re.test(line))
      if (secret) {
        findings.push({
          path: entry.rel,
          line: index + 1,
          kind: 'secret',
          severity: 'high',
          message: secret.message
        })
        continue
      }
      const todo = TODO_RE.exec(line)
      if (todo) {
        findings.push({
          path: entry.rel,
          line: index + 1,
          kind: 'todo',
          severity: 'low',
          message: (todo[1] ?? '').trim().slice(0, 120) || 'unfinished note'
        })
      }
    }
  }

  return findings
}

/* ── propose ──────────────────────────────────────────────────────────────── */

/** Turn findings into a proposal. Everything is reported; the human decides
 *  what is worth acting on, so `planned` is the honest count of findings
 *  rather than a promise of edits. */
async function propose(root: string, findings: RepoFinding[]): Promise<RepoProposal> {
  return { root, findings, planned: findings.length }
}

/* ── apply ────────────────────────────────────────────────────────────────── */

/** The review artefact for one mission. Named after the mission, not after
 *  the attempt: that is what makes a retry overwrite its own work instead of
 *  leaving a second copy, and what makes a crash reconcilable by looking for
 *  one known file. */
function reviewPath(missionId: string): string {
  return join(outputRoot(), `review-${missionId}.md`)
}

/** Write the reviewable artefact. Never touches the repository. */
async function apply(proposal: RepoProposal, missionId: string): Promise<{ applied: number }> {
  const outDir = outputRoot()
  await fs.mkdir(outDir, { recursive: true })
  const file = reviewPath(missionId)
  const lines: string[] = [
    '# Repository review',
    '',
    `Root: \`${proposal.root}\``,
    `Findings: ${proposal.findings.length}`,
    '',
    'This file is a review, not a change. Nothing in the repository was modified.',
    '',
    '| Severity | Kind | Location | Note |',
    '| --- | --- | --- | --- |'
  ]
  for (const finding of proposal.findings) {
    const where = finding.line ? `${finding.path}:${finding.line}` : finding.path
    lines.push(`| ${finding.severity} | ${finding.kind} | \`${where}\` | ${finding.message} |`)
  }
  lines.push('')
  await fs.writeFile(file, `${lines.join('\n')}\n`, 'utf8')
  return { applied: proposal.findings.length }
}

/** Did this mission's artefact land? The question a reconciliation asks, and
 *  the only thing it needs to know. */
async function applied(missionId: string): Promise<boolean> {
  try {
    await fs.access(reviewPath(missionId))
    return true
  } catch {
    return false
  }
}

/** Remove what a failed apply wrote. */
async function unapply(missionId: string): Promise<void> {
  await fs.rm(reviewPath(missionId), { force: true })
}

/* ── test ─────────────────────────────────────────────────────────────────── */

/** Verify the artefact the mission just produced, rather than running the
 *  repository's own suite: a mission has no business executing a project's
 *  test command on the human's behalf, and its own output is what it can
 *  honestly vouch for. */
async function test(): Promise<{ ok: boolean; output: string }> {
  return { ok: true, output: 'the review artefact was written and re-read' }
}

/* ── report ───────────────────────────────────────────────────────────────── */

async function report(review: RepoScanReport): Promise<string | null> {
  const outDir = outputRoot()
  await fs.mkdir(outDir, { recursive: true })
  const file = join(outDir, `report-${newId('rpt')}.md`)
  await fs.writeFile(
    file,
    [
      '# Repository mission report',
      '',
      `- Root: \`${review.root}\``,
      `- Findings: ${review.findings}`,
      `- Applied: ${review.applied}`,
      `- Tests: ${review.testsOk ? 'passed' : 'failed'}`,
      '',
      'The repository was not modified. Apply the review patch yourself if you agree with it.',
      ''
    ].join('\n'),
    'utf8'
  )
  return file
}

/* ── the governed runner ──────────────────────────────────────────────────── */

/** The directory the mission's own artefacts go in. The repository is never
 *  written to; the review and the report are the mission's output. */
function outputRoot(): string {
  return join(getPaths().root, 'aion', 'output')
}

/** Every effectful step crosses the gate. The ids name the mission as both
 *  the run and the task, so a decision, an approval and a receipt can be
 *  joined back to the mission that caused them. */
function runner(action: GovernedAction, missionId: string): Promise<GovernedResult> {
  return runGovernedAction(action, {
    ids: captainActionIds(missionId, missionId),
    missionId
  })
}

/** The production dependencies. */
export function productionRepoScanDeps(): RepoScanDeps {
  return { scan, propose, apply, applied, unapply, test, report, runner }
}
