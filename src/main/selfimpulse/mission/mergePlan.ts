/**
 * MERGE PLANNING — turning N isolated worktrees back into one repository.
 *
 * THE PART EVERYONE GETS WRONG
 *
 * Worktrees solve the collision *during* the work. They do nothing about the moment the work comes
 * back. Merging three agent branches at once means the second merge does not know about the first,
 * which produces conflicts that look like the agents disagreed when really the order was wrong.
 *
 * What this module implements:
 *
 *   1. SERIALIZE. One branch at a time, so each merge sees everything that landed before it.
 *   2. PRE-FLIGHT. `git merge-tree` performs a three-way merge in memory, so conflicts are found
 *      BEFORE anything is merged.
 *   3. DEPENDENCY ORDER. Shared abstractions merge before their consumers, tests last.
 *   4. TEST ON THE BASE AFTER ALL MERGES. Two agents can each pass their own suite and still break the
 *      combination. Integration failures hide exactly there.
 *   5. CLEAN UP. Remove merged worktrees and prune, or they accumulate.
 *
 * THE HONESTY RULE
 *
 * Git detects textual conflicts. It does not detect semantic ones — two agents can each write a
 * correct, non-overlapping change that composes into something broken. So this module never reports
 * "merged cleanly" as "correct". It reports what was merged, in what order, and that the test suite on
 * the base branch is the only thing that settles whether the result works.
 */

export interface MergeCandidate {
  seatId: string;
  branch: string;
  /** Where the work happened. Kept so the plan can clean up. */
  worktreePath: string;
  /** Seat role, used to order the merge. */
  role: string;
  /** Branches this one depends on. Merged after them, or not at all. */
  dependsOn: string[];
  /** Did the seat's own verification pass? A branch that failed its checks does not merge. */
  verified: boolean;
  additions: number;
  deletions: number;
}

export interface MergeStep {
  order: number;
  branch: string;
  seatId: string;
  /** The exact argv, for the native layer to run in order. */
  argv: string[][];
  /** What must be true before this step runs. */
  requires: string[];
  note: string;
}

export interface MergePlan {
  steps: MergeStep[];
  /** Branches excluded, with the reason. Excluding is a decision, not a silent drop. */
  excluded: Array<{ branch: string; seatId: string; reason: string }>;
  /** Pre-flight conflict pairs to check with `git merge-tree` before any merge starts. */
  preflight: Array<{ a: string; b: string; argv: string[]; why: string }>;
  /** The test command to run on the base branch after every merge has landed. */
  postMergeCheck: string[];
  /** Cleanup, in order. */
  cleanup: string[][];
  problems: string[];
}

/** Role order: shared foundations land before the things that consume them. */
const ROLE_ORDER: Record<string, number> = {
  architect: 0,
  coder: 1,
  debugger: 2,
  tester: 3,
  security: 4,
  reviewer: 5,
  synthesizer: 6,
};

/**
 * Topologically order branches by their declared dependencies, falling back to role order.
 *
 * A cycle is reported rather than silently broken: two branches that each claim to depend on the other
 * is a decomposition bug, and picking one at random would hide it.
 */
export function orderBranches(candidates: MergeCandidate[]): { ordered: MergeCandidate[]; cycles: string[] } {
  const byBranch = new Map(candidates.map((c) => [c.branch, c]));
  const ordered: MergeCandidate[] = [];
  const placed = new Set<string>();
  const cycles: string[] = [];

  const visit = (c: MergeCandidate, stack: string[]) => {
    if (placed.has(c.branch)) return;
    if (stack.includes(c.branch)) {
      cycles.push([...stack.slice(stack.indexOf(c.branch)), c.branch].join(" -> "));
      return;
    }
    for (const dep of c.dependsOn) {
      const d = byBranch.get(dep);
      if (d) visit(d, [...stack, c.branch]);
    }
    placed.add(c.branch);
    ordered.push(c);
  };

  const sorted = [...candidates].sort((a, b) => {
    const ra = ROLE_ORDER[a.role] ?? 99;
    const rb = ROLE_ORDER[b.role] ?? 99;
    if (ra !== rb) return ra - rb;
    // Bigger changes first among equals: a small patch on top of a large one merges more cleanly than
    // the reverse, because the large one sets the shape.
    return b.additions + b.deletions - (a.additions + a.deletions);
  });
  for (const c of sorted) visit(c, []);
  return { ordered, cycles };
}

/**
 * Build the merge plan.
 *
 * `baseBranch` is what everything merges into. `testCommand` is the repository's own suite, run on the
 * base branch after the last merge — not inside a worktree, because that is not the thing being shipped.
 */
export function planMerge(
  candidates: MergeCandidate[],
  opts: { baseBranch: string; repoRoot: string; testCommand?: string[] },
): MergePlan {
  const problems: string[] = [];
  const excluded: MergePlan["excluded"] = [];
  const mergeable: MergeCandidate[] = [];

  for (const c of candidates) {
    if (!c.verified) {
      excluded.push({ branch: c.branch, seatId: c.seatId, reason: "Its own verification did not pass, so it does not merge. A branch that failed its checks would put a known-broken state on the base branch." });
      continue;
    }
    if (c.additions + c.deletions === 0) {
      excluded.push({ branch: c.branch, seatId: c.seatId, reason: "It changed nothing. Merging an empty branch adds a commit and a conflict surface for no benefit." });
      continue;
    }
    mergeable.push(c);
  }

  const { ordered, cycles } = orderBranches(mergeable);
  for (const cyc of cycles) problems.push(`Dependency cycle: ${cyc}. Two branches each claim to depend on the other, which is a decomposition bug — VH will not guess an order.`);

  const steps: MergeStep[] = ordered.map((c, i) => ({
    order: i + 1,
    branch: c.branch,
    seatId: c.seatId,
    argv: [
      ["checkout", opts.baseBranch],
      ["merge", "--no-ff", "--no-edit", c.branch],
    ],
    requires: i === 0 ? [opts.baseBranch] : [ordered[i - 1]?.branch ?? opts.baseBranch],
    note:
      c.role === "tester"
        ? "Tests merge after the code they test, so the base branch is never in a state where tests reference code that is not there."
        : c.dependsOn.length
          ? `Depends on ${c.dependsOn.join(", ")}, so it merges after them.`
          : `${c.role} work; +${c.additions}/-${c.deletions}.`,
  }));

  // Pre-flight every pair that could plausibly collide. Only pairs not already ordered by a declared
  // dependency are checked — those are the ones where a conflict would be a surprise.
  const preflight: MergePlan["preflight"] = [];
  for (let i = 0; i < mergeable.length; i += 1) {
    for (let j = i + 1; j < mergeable.length; j += 1) {
      const a = mergeable[i];
      const b = mergeable[j];
      if (!a || !b) continue;
      if (a.dependsOn.includes(b.branch) || b.dependsOn.includes(a.branch)) continue;
      preflight.push({
        a: a.branch,
        b: b.branch,
        // merge-tree does a three-way merge in memory. No working tree is touched, so this is safe to
        // run while agents are still working.
        //
        // It takes TWO branches, not three: the merge base is derived from their history. Passing the
        // base as a third argument makes git reject the command with a usage error (exit 129), which is
        // easy to mistake for "these branches conflict" — verified on git 2.47.3.
        argv: ["merge-tree", "--write-tree", "--name-only", a.branch, b.branch],
        why: `Neither declares a dependency on the other, so a conflict here would be a surprise. Check before merging, not after.`,
      });
    }
  }

  if (mergeable.length > 4) {
    problems.push(`${mergeable.length} branches are queued to merge. Four is about where review stops keeping up; consider splitting the mission.`);
  }
  if (excluded.length === candidates.length && candidates.length > 0) {
    problems.push("Every branch was excluded, so nothing will be merged. The mission produced no verified change.");
  }

  const cleanup: string[][] = [];
  for (const c of mergeable) {
    cleanup.push(["worktree", "remove", "--force", c.worktreePath]);
    cleanup.push(["branch", "-d", c.branch]);
  }
  cleanup.push(["worktree", "prune"]);

  return { steps, excluded, preflight, postMergeCheck: opts.testCommand ?? [], cleanup, problems };
}

/** Render the plan so a human can approve it before VH touches the repository. */
export function renderMergePlan(plan: MergePlan, baseBranch: string): string {
  const lines: string[] = [];
  lines.push(`MERGE PLAN -> ${baseBranch}`);
  if (plan.steps.length === 0) lines.push("  (nothing to merge)");
  for (const s of plan.steps) {
    lines.push(`  ${s.order}. ${s.branch}  [${s.seatId}]`);
    lines.push(`     requires: ${s.requires.join(", ")}`);
    lines.push(`     ${s.note}`);
  }
  if (plan.preflight.length) {
    lines.push("");
    lines.push("pre-flight conflict checks (run these first):");
    for (const p of plan.preflight) lines.push(`  git ${p.argv.join(" ")}   # ${p.a} vs ${p.b}`);
  }
  if (plan.excluded.length) {
    lines.push("");
    lines.push("excluded:");
    for (const e of plan.excluded) lines.push(`  ${e.branch} [${e.seatId}] — ${e.reason}`);
  }
  if (plan.postMergeCheck.length) {
    lines.push("");
    lines.push(`after the last merge, on ${baseBranch}: ${plan.postMergeCheck.join(" ")}`);
    lines.push("  Two agents can each pass their own suite and still break the combination.");
  }
  if (plan.problems.length) {
    lines.push("");
    lines.push("before you start:");
    for (const p of plan.problems) lines.push(`  ! ${p}`);
  }
  return lines.join("\n");
}

/**
 * Interpret a `git merge-tree --write-tree` result.
 *
 * Exit 0 means a clean merge. Exit 1 means conflicts, and with `--name-only` the conflicted paths
 * follow the tree oid. Any other exit is an error, not a conflict — and must not be reported as one,
 * because "these two branches conflict" and "git could not run" call for different responses.
 */
export function interpretMergeTree(exitCode: number | null, stdout: string): { clean: boolean; conflicted: string[]; error: string | null } {
  if (exitCode === 0) return { clean: true, conflicted: [], error: null };
  if (exitCode === 1) {
    // Real output shape, verified on git 2.47.3 with --write-tree --name-only:
    //   <tree oid>
    //   <conflicted path>...        <- only with --name-only
    //   <blank line>
    //   <informational messages>    "Auto-merging f.txt", "CONFLICT (content): ..."
    // The blank line separates the paths from the messages, so stopping there keeps prose out of the
    // file list. Without --name-only the same position holds `<mode> <oid> <stage>\t<path>`, so the
    // tab-separated path is extracted instead of the whole line.
    const lines = stdout.split(/\r?\n/);
    const oid = (lines[0] ?? "").trim();
    const body = lines.slice(1);
    const cut = body.findIndex((l) => !l.trim());
    const paths = (cut === -1 ? body : body.slice(0, cut)).map((l) => l.trim()).filter(Boolean);
    const conflicted = paths.map((l) => (l.includes("\t") ? (l.split("\t").pop() ?? l) : l)).filter((l) => l !== oid);
    return { clean: false, conflicted, error: null };
  }
  return {
    clean: false,
    conflicted: [],
    error:
      exitCode === null
        ? "git merge-tree did not run at all."
        : exitCode === 129
          ? "git merge-tree rejected its arguments (exit 129 is a usage error). This is VH's mistake in how it called git, NOT a conflict between the branches."
          : `git merge-tree exited ${exitCode}, which is neither clean (0) nor conflict (1).`,
  };
}
