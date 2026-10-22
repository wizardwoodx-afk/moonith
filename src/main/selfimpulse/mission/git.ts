/**
 * GIT EVIDENCE — asking the repository what actually happened.
 *
 * WHY THIS IS SEPARATE FROM THE AGENTS
 *
 * An agent's account of its own work is a claim. A diff is a measurement. Every "the agent changed X"
 * statement in VH comes from here, never from parsing what the agent said.
 *
 * THREE STATES, NOT TWO
 *
 * "No changes", "changes found" and "could not read the repository" are three different facts and the
 * UI has to render them differently. Collapsing the third into the first is how an agent that never
 * ran ends up looking like one that ran and did nothing wrong.
 */

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** null means the command could not run at all, which is not the same as exiting non-zero. */
  exitCode: number | null;
  reason: string | null;
}

/** A runner for git. Injected so this module is testable and so a browser build can refuse honestly. */
export type GitRunner = (args: string[], cwd: string) => Promise<GitResult>;

export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked" | "copied";

export interface DiffHunk {
  header: string;
  added: string[];
  removed: string[];
  lines: string[];
}

export interface DiffFile {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  /** The hunks, kept so a reviewer seat can be shown the actual change. */
  hunks: DiffHunk[];
}

export interface DiffSummary {
  files: DiffFile[];
  totalAdditions: number;
  totalDeletions: number;
  /** Net line change. Negative means more was removed than added. */
  netLines: number;
  binaryFiles: number;
  /** True when nothing changed at all. Distinct from "could not read". */
  empty: boolean;
  /** Largest file by churn, which is where a reviewer should start. */
  largest: string | null;
}

const OK: Omit<GitResult, "stdout"> = { ok: true, stderr: "", exitCode: 0, reason: null };

function fail(reason: string): GitResult {
  return { ok: false, stdout: "", stderr: "", exitCode: null, reason };
}

/** A runner for environments with no git access. Every call fails honestly. */
export const NO_GIT: GitRunner = async () => fail("No git runner is available in this environment, so VH cannot read the repository. Nothing was inspected and no diff is shown.");

/**
 * Parse `git status --porcelain=v1 -z`.
 *
 * The `-z` form is used deliberately: filenames with spaces, newlines or unicode are quoted in the
 * default format, and unquoting them reliably is a parser of its own. NUL-separated output has no such
 * ambiguity.
 */
export function parseStatusPorcelainZ(raw: string): Array<{ status: FileStatus; path: string; oldPath: string | null }> {
  if (!raw) return [];
  const fields = raw.split("\0");
  const out: Array<{ status: FileStatus; path: string; oldPath: string | null }> = [];
  for (let i = 0; i < fields.length; i += 1) {
    const entry = fields[i];
    if (!entry || entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    let oldPath: string | null = null;
    // Rename and copy entries are followed by the source path as a separate NUL field.
    if (code === "R " || code === "RM" || code === "C " || code === "CM") {
      oldPath = fields[i + 1] ?? null;
      i += 1;
    }
    const status: FileStatus =
      code === "??" ? "untracked"
      : code.startsWith("R") ? "renamed"
      : code.startsWith("C") ? "copied"
      : code.startsWith("A") ? "added"
      : code.startsWith("D") ? "deleted"
      : "modified";
    out.push({ status, path, oldPath });
  }
  return out;
}

/**
 * Parse a unified diff into per-file records.
 *
 * Rename detection matters here: without `git diff -M` a moved file appears as an unexplained
 * deletion plus a new file, which is exactly the wrong thing to put in front of a reviewer.
 */
export function parseUnifiedDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  const flush = () => {
    if (current) files.push(current);
    current = null;
    currentHunk = null;
  };

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      flush();
      // `diff --git a/path b/path` — paths can contain spaces, so split on the b/ marker rather than
      // on whitespace.
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
      current = { path: m?.[2] ?? m?.[1] ?? "unknown", oldPath: null, status: "modified", additions: 0, deletions: 0, binary: false, hunks: [] };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("rename from ")) current.oldPath = line.slice("rename from ".length);
    else if (line.startsWith("copy from ")) current.oldPath = line.slice("copy from ".length);
    else if (line.startsWith("new file mode")) current.status = "added";
    else if (line.startsWith("deleted file mode")) current.status = "deleted";
    else if (line.startsWith("Binary files") || line.startsWith("GIT binary patch")) current.binary = true;
    else if (line.startsWith("@@")) {
      currentHunk = { header: line, added: [], removed: [], lines: [] };
      current.hunks.push(currentHunk);
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      current.additions += 1;
      if (currentHunk) {
        currentHunk.added.push(line.slice(1));
        currentHunk.lines.push(line);
      }
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.deletions += 1;
      if (currentHunk) {
        currentHunk.removed.push(line.slice(1));
        currentHunk.lines.push(line);
      }
    } else if (currentHunk) {
      currentHunk.lines.push(line);
    }
  }
  flush();

  // A rename shows up in the body only as `rename from`, so fold it into the status.
  for (const f of files) if (f.oldPath && f.status === "modified") f.status = "renamed";
  return files;
}

export function summariseDiff(files: DiffFile[]): DiffSummary {
  const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);
  let largest: string | null = null;
  let biggest = -1;
  for (const f of files) {
    const churn = f.additions + f.deletions;
    if (churn > biggest) {
      biggest = churn;
      largest = f.path;
    }
  }
  return {
    files,
    totalAdditions,
    totalDeletions,
    netLines: totalAdditions - totalDeletions,
    binaryFiles: files.filter((f) => f.binary).length,
    empty: files.length === 0,
    largest: files.length ? largest : null,
  };
}

export interface GitApi {
  isRepo(cwd: string): Promise<{ ok: boolean; reason: string | null }>;
  status(cwd: string): Promise<{ ok: boolean; entries: ReturnType<typeof parseStatusPorcelainZ>; reason: string | null }>;
  diff(cwd: string, opts?: { staged?: boolean; ref?: string; paths?: string[] }): Promise<{ ok: boolean; summary: DiffSummary | null; raw: string; reason: string | null }>;
  head(cwd: string): Promise<{ ok: boolean; sha: string | null; subject: string | null; reason: string | null }>;
  branch(cwd: string): Promise<{ ok: boolean; name: string | null; reason: string | null }>;
}

export function gitApi(runner: GitRunner): GitApi {
  const run = async (args: string[], cwd: string): Promise<GitResult> => runner(args, cwd);

  return {
    async isRepo(cwd) {
      const r = await run(["rev-parse", "--is-inside-work-tree"], cwd);
      if (!r.ok) return { ok: false, reason: r.reason ?? (r.stderr || "git rev-parse failed.") };
      return { ok: r.stdout.trim() === "true", reason: r.stdout.trim() === "true" ? null : "This directory is not inside a git work tree." };
    },

    async status(cwd) {
      const r = await run(["status", "--porcelain=v1", "-z"], cwd);
      if (!r.ok) return { ok: false, entries: [], reason: r.reason ?? (r.stderr || "git status failed.") };
      return { ok: true, entries: parseStatusPorcelainZ(r.stdout), reason: null };
    },

    async diff(cwd, opts = {}) {
      // -M turns on rename detection. Without it git reports a moved file as a deletion plus an
      // unexplained new file, which is exactly the wrong thing to show a reviewer.
      const args = ["diff", "--no-color", "--no-ext-diff", "-M"];
      if (opts.staged) args.push("--staged");
      if (opts.ref) args.push(opts.ref);
      args.push("--");
      for (const p of opts.paths ?? []) args.push(p);
      const r = await run(args, cwd);
      if (!r.ok) return { ok: false, summary: null, raw: "", reason: r.reason ?? (r.stderr || "git diff failed.") };
      return { ok: true, summary: summariseDiff(parseUnifiedDiff(r.stdout)), raw: r.stdout, reason: null };
    },

    async head(cwd) {
      const r = await run(["log", "-1", "--format=%H%x00%s"], cwd);
      if (!r.ok) return { ok: false, sha: null, subject: null, reason: r.reason ?? (r.stderr || "git log failed — is there a commit yet?") };
      // `git log --format=...` terminates its output with a newline, which lands on the LAST field.
      // Without the trim, subject was "initial commit\n" and every equality check against it failed.
      const [sha, subject] = r.stdout.replace(/\n+$/, "").split("\0");
      return { ok: true, sha: (sha ?? "").trim() || null, subject: subject ?? null, reason: null };
    },

    async branch(cwd) {
      const r = await run(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
      if (!r.ok) return { ok: false, name: null, reason: r.reason ?? (r.stderr || "git rev-parse failed.") };
      return { ok: true, name: r.stdout.trim() || null, reason: null };
    },
  };
}

/** Render a diff summary as a review header, so a verdict is about a diff that was shown. */
export function renderDiffSummary(s: DiffSummary): string {
  if (s.empty) return "No changes. The working tree matches HEAD.";
  const lines = [`${s.files.length} files changed, +${s.totalAdditions} / -${s.totalDeletions} (net ${s.netLines >= 0 ? "+" : ""}${s.netLines})`];
  if (s.binaryFiles) lines.push(`${s.binaryFiles} binary file(s) — contents not shown, so they cannot be reviewed from this diff.`);
  if (s.largest) lines.push(`largest change: ${s.largest} (start the review there)`);
  for (const f of s.files.slice(0, 20)) {
    lines.push(`  ${f.status.padEnd(9)} ${f.oldPath ? `${f.oldPath} -> ${f.path}` : f.path}  +${f.additions}/-${f.deletions}${f.binary ? "  [binary]" : ""}`);
  }
  if (s.files.length > 20) lines.push(`  …and ${s.files.length - 20} more`);
  return lines.join("\n");
}

/**
 * Truncate a diff for inclusion in a prompt.
 *
 * Agents have context limits, and a huge diff silently pushed out the instructions is worse than a
 * truncated diff with a note. The omitted file count is returned so the prompt can say what is missing.
 */
export function truncateDiffForPrompt(raw: string, maxChars = 24000): { text: string; truncated: boolean; omittedFiles: number } {
  if (raw.length <= maxChars) return { text: raw, truncated: false, omittedFiles: 0 };
  const kept: string[] = [];
  let size = 0;
  let omitted = 0;
  for (const chunk of raw.split(/(?=^diff --git )/m)) {
    if (size + chunk.length > maxChars) {
      omitted += 1;
      continue;
    }
    kept.push(chunk);
    size += chunk.length;
  }
  const notice = `\n\n[DIFF TRUNCATED: ${omitted} file(s) omitted. Do not report that you reviewed everything — note the truncation in your review.]\n`;
  return { text: kept.join("") + notice, truncated: true, omittedFiles: omitted };
}

export const GIT_RESULT_OK = OK;
