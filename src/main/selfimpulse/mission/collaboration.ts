/**
 * COLLABORATION — worktrees, briefings, claim sequencing and cross-vendor verification.
 */

import type { HarnessId } from "../domain/harness";
import type { CliAgentTeam, TeamSeat } from "./agentTeam";

/* ------------------------------------------------------------------ 1. worktrees */

export interface WorktreePlan {
  seatId: string;
  /** The branch this seat's work lands on. Empty for a deferred read-only seat until its target resolves. */
  branch: string;
  path: string;
  /** Git argv to create it. Empty for deferred seats, which the executor fills in at wave time. */
  createArgv: string[][];
  removeArgv: string[][];
  shared: boolean;
  deferred: boolean;
  reason: string;
}

/** Sanitise a seat id into something safe as a branch name and a directory suffix. */
function branchSafe(s: string): string {
  return (
    s
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/\.{2,}/g, ".")
      .replace(/^\.+|\.+$/g, "")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "seat"
  );
}

/**
 * Plan the isolation for every seat.
 *
 * Writers get a private branch and a sibling directory. Read-only seats share the base checkout
 * so they inspect what was actually built.
 */
export function planWorktrees(
  team: CliAgentTeam,
  opts: { repoRoot: string; baseBranch: string; missionSlug: string; deferReview?: boolean },
): WorktreePlan[] {
  const plans: WorktreePlan[] = [];
  const root = opts.repoRoot.replace(/\/+$/, "");
  const hasWriter = team.seats.some((s) => s.mayWrite);

  for (const seat of team.seats) {
    if (!seat.mayWrite) {
      if (opts.deferReview && hasWriter) {
        const path = `${root}-si-review-${branchSafe(opts.missionSlug)}-${branchSafe(seat.id)}`;
        plans.push({
          seatId: seat.id,
          branch: "",
          path,
          createArgv: [],
          removeArgv: [["worktree", "remove", "--force", path]],
          shared: false,
          deferred: true,
          reason: `${seat.role} is read-only, so it gets its own worktree on the REVIEW SNAPSHOT — the base plus every writer branch merged. Pointing it at the base checkout would have it review the tree as it was before the work happened, which is the bug this replaces.`,
        });
        continue;
      }
      plans.push({
        seatId: seat.id,
        branch: opts.baseBranch,
        path: root,
        createArgv: [],
        removeArgv: [],
        shared: true,
        deferred: false,
        reason: `${seat.role} is read-only — giving a reviewer its own worktree would mean it would review a tree nobody is writing to. Read-only seats share the base checkout.`,
      });
      continue;
    }

    const branch = `vh/${opts.missionSlug}/${branchSafe(seat.id)}`;
    /* The DIRECTORY is keyed by the mission as well as the seat, and it has to
     * be. It used to be `${root}-si-${seat}` alone, which meant a second mission
     * for the same seat in the same repository asked git for a worktree that
     * already existed: the branch name differed, the path did not. Depending on
     * what the previous mission left behind, the new run either failed to create
     * its worktree or inherited the old one — including a reviewer worktree
     * holding a previous mission's changes. That is not a test artifact; it is
     * what happens when one teammate is handed two delegations against one repo,
     * which is the normal case, not an exotic one. */
    const path = `${root}-si-${branchSafe(opts.missionSlug)}-${branchSafe(seat.id)}`;
    plans.push({
      seatId: seat.id,
      branch,
      path,
      createArgv: [["worktree", "add", "-b", branch, path, opts.baseBranch]],
      removeArgv: [["worktree", "remove", "--force", path]],
      shared: false,
      deferred: false,
      reason: `${seat.role} writes, so it gets its own worktree on ${branch}. Two agents in one working tree overwrite each other.`,
    });
  }
  return plans;
}

/** The name of the branch that holds the merged state the reviewers look at. */
export function reviewSnapshotBranch(missionSlug: string): string {
  return `vh/${missionSlug}/review`;
}

export function reviewSnapshotArgv(opts: {
  repoRoot: string;
  baseBranch: string;
  missionSlug: string;
  writerBranches: string[];
}): { argv: string[][]; snapshotBranch: string; problem: string | null } {
  const snapshotBranch = reviewSnapshotBranch(opts.missionSlug);
  if (opts.writerBranches.length === 0) {
    return { argv: [], snapshotBranch, problem: "No writer produced a branch, so there is nothing to snapshot." };
  }
  const argv: string[][] = [
    ["checkout", "-B", snapshotBranch, opts.baseBranch],
  ];
  for (const b of opts.writerBranches) argv.push(["merge", "--no-ff", "--no-edit", b]);
  return { argv, snapshotBranch, problem: null };
}

export function reviewWorktreeArgv(snapshotBranch: string, path: string): string[][] {
  return [["worktree", "add", "--detach", path, snapshotBranch]];
}

export function snapshotPreflightArgv(baseBranch: string, writerBranches: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < writerBranches.length; i += 1) {
    for (let j = i + 1; j < writerBranches.length; j += 1) {
      const a = writerBranches[i];
      const b = writerBranches[j];
      if (a && b) out.push(["merge-tree", "--write-tree", "--name-only", a, b]);
    }
  }
  void baseBranch;
  return out;
}

/* ------------------------------------------------------------------ 2. the briefing */

export interface ContextFile {
  path: string;
  contents: string;
  forHarness: HarnessId;
}

// One briefing file, for the one runtime that exists — there is no second
// process left to hand a different file to.
const CONTEXT_PATHS: Array<{ harness: HarnessId; path: string }> = [
  { harness: "hermes", path: "AGENTS.md" },
];

export function briefingContents(opts: {
  objective: string;
  constraints?: string[];
  doNotTouch?: string[];
  testCommand?: string[];
  seat?: TeamSeat;
  readOnly?: boolean;
}): string {
  const constraintsList = opts.constraints && opts.constraints.length ? opts.constraints.map((c) => `- ${c}`).join("\n") : "- (none declared)";
  const doNotTouchList = opts.doNotTouch && opts.doNotTouch.length ? opts.doNotTouch.map((p) => `- ${p}`).join("\n") : "- (none declared)";

  return [
    `# MISSION BRIEFING — Generated by VH`,
    ``,
    `## Objective`,
    opts.objective,
    ``,
    `## Constraints`,
    constraintsList,
    ``,
    `## Off-limits files (Do not touch)`,
    doNotTouchList,
    ``,
    `## Collaboration Rules`,
    `- OTHER worktrees are active simultaneously. Work ONLY on files matching your task scope.`,
    `- Do not reformat unrelated code; clean diffs make peer reviews possible.`,
    opts.testCommand ? `- Verify command: \`${opts.testCommand.join(" ")}\`` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function writeContextFiles(
  team: CliAgentTeam,
  opts: { objective: string; constraints?: string[]; doNotTouch?: string[]; testCommand?: string[] },
): ContextFile[] {
  const activeHarnesses = new Set(team.seats.map((s) => s.harness));
  const out: ContextFile[] = [];
  const seenPaths = new Set<string>();
  const body = briefingContents(opts);

  for (const entry of CONTEXT_PATHS) {
    if (activeHarnesses.has(entry.harness)) {
      if (seenPaths.has(entry.path)) continue;
      seenPaths.add(entry.path);
      out.push({
        path: entry.path,
        contents: body,
        forHarness: entry.harness,
      });
    }
  }

  if (out.length === 0 && team.seats.length > 0) {
    out.push({
      path: "AGENTS.md",
      contents: body,
      forHarness: team.seats[0].harness,
    });
  }

  return out;
}

/* ------------------------------------------------------------------ 3. claims */

export interface Claim {
  seatId: string;
  paths: string[];
  symbols: string[];
  declaredAt: string;
}

export interface ClaimConflict {
  a: string;
  b: string;
  severity: "symbol" | "path";
  on: string[];
  overlap: string[];
  detail: string;
  advice: string;
}

function globsOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  const normA = a.replace(/\*\*/g, "*").replace(/\/+$/, "");
  const normB = b.replace(/\*\*/g, "*").replace(/\/+$/, "");
  if (normA.startsWith(normB.replace(/\*$/, "")) || normB.startsWith(normA.replace(/\*$/, ""))) return true;
  return false;
}

export function findClaimConflicts(claims: Claim[]): ClaimConflict[] {
  const out: ClaimConflict[] = [];
  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      const a = claims[i];
      const b = claims[j];
      if (!a || !b) continue;
      const symbols = a.symbols.filter((s) => b.symbols.includes(s));
      if (symbols.length) {
        out.push({
          a: a.seatId,
          b: b.seatId,
          severity: "symbol",
          on: symbols,
          overlap: symbols,
          detail: `Both claim symbols: ${symbols.join(", ")}.`,
          advice: `Both claim ${symbols.join(", ")}. Merging two edits to one symbol produces something that is clean-looking and semantically broken — sequence these seats into separate waves.`,
        });
        continue;
      }
      const pathOverlap = a.paths.filter((pa) => b.paths.some((pb) => globsOverlap(pa, pb)));
      if (pathOverlap.length) {
        out.push({
          a: a.seatId,
          b: b.seatId,
          severity: "path",
          on: pathOverlap,
          overlap: pathOverlap,
          detail: `Paths overlap: ${pathOverlap.join(", ")}.`,
          advice: `Both claim overlapping paths: ${pathOverlap.join(", ")}. Serialise these seats if they modify the same regions.`,
        });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ 4. verification pairs */

export interface VerificationPair {
  writerSeatId: string;
  verifierSeatId: string | null;
  verifierId?: string;
  independent: boolean;
  producerHarness?: HarnessId;
  verifierHarness?: HarnessId;
  reason: string;
  detail: string;
}

export function planVerification(team: CliAgentTeam): VerificationPair[] {
  const verifiers = team.seats.filter((s) => s.role === "reviewer" || s.role === "security");
  const out: VerificationPair[] = [];
  const writers = team.seats.filter((s) => s.mayWrite);

  if (writers.length === 0) {
    return [];
  }

  for (const w of writers) {
    const independent = verifiers.find((v) => v.harness !== w.harness);
    const chosen = independent ?? verifiers[0] ?? null;

    if (!chosen) {
      out.push({
        writerSeatId: w.id,
        verifierSeatId: "",
        verifierId: "",
        independent: false,
        producerHarness: w.harness,
        verifierHarness: undefined,
        reason: "Self-certification is not verification — this writer has no reviewer.",
        detail: `${w.id} has no verifier on this team. Nothing checks its work.`,
      });
      continue;
    }

    const isIndep = chosen.harness !== w.harness;
    const reason = isIndep
      ? `${chosen.id} (${chosen.harness}) verifies ${w.id} (${w.harness}) — blind spots are not shared.`
      : `WARNING: ${chosen.id} verifies ${w.id}, but both are ${w.harness}. A single-vendor review is advisory, not as verification.`;

    out.push({
      writerSeatId: w.id,
      verifierSeatId: chosen.id,
      verifierId: chosen.id,
      independent: isIndep,
      producerHarness: w.harness,
      verifierHarness: chosen.harness,
      reason,
      detail: reason,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ 5. the plan */

export interface CollaborationPlan {
  teamId: string;
  missionSlug: string;
  worktrees: WorktreePlan[];
  contextFiles: ContextFile[];
  conflicts: ClaimConflict[];
  verification: VerificationPair[];
  waves: Array<{ seats: string[]; why: string }>;
  problems: string[];
}

export function planCollaboration(
  team: CliAgentTeam,
  opts: { repoRoot: string; baseBranch: string; missionSlug: string; objective: string; constraints?: string[]; doNotTouch?: string[]; claims?: Claim[]; testCommand?: string[] },
): CollaborationPlan {
  const worktrees = planWorktrees(team, opts);
  const contextFiles = writeContextFiles(team, {
    objective: opts.objective,
    constraints: opts.constraints ?? [],
    doNotTouch: opts.doNotTouch ?? [],
    testCommand: opts.testCommand,
  });
  const conflicts = findClaimConflicts(opts.claims ?? []);
  const verification = planVerification(team);

  const byRole = (r: string) => team.seats.filter((s) => s.role === r).map((s) => s.id);
  const waves: CollaborationPlan["waves"] = [];
  const scheduled = new Set<string>();
  const push = (seats: string[], why: string) => {
    const fresh = seats.filter((s) => !scheduled.has(s));
    if (!fresh.length) return;
    for (const s of fresh) scheduled.add(s);
    waves.push({ seats: fresh, why });
  };

  push(byRole("planner"), "Planning first: nothing should write before the approach exists.");
  push(byRole("architect"), "Architecture next, still read-only, so the writers inherit a design.");

  const conflicted = new Set(conflicts.flatMap((c) => [c.a, c.b]));
  const writers = team.seats.filter((s) => s.mayWrite).map((s) => s.id);

  if (writers.length > 0) {
    const parallelWriters = writers.filter((w) => !conflicted.has(w));
    if (parallelWriters.length > 0) {
      push(parallelWriters, "Implementation: separate worktrees, so parallel writers cannot overwrite each other.");
    }
    for (const s of writers.filter((w) => conflicted.has(w))) {
      push([s], "Sequenced alone: its claim overlaps another seat's, so running them together would produce a merge that looks clean and is semantically wrong.");
    }
  }

  push(byRole("tester"), "Testing, against the merged result — so it must follow the writers, never join them.");
  push([...byRole("reviewer"), ...byRole("security")], "Independent review and security verification.");
  push(byRole("synthesizer"), "Synthesis of findings.");

  for (const s of team.seats) {
    if (!scheduled.has(s.id)) {
      push([s.id], `${s.role} execution.`);
    }
  }

  const problems: string[] = [];
  if (conflicts.some((c) => c.severity === "symbol")) {
    problems.push(`${conflicts.filter((c) => c.severity === "symbol").length} symbol-level claim conflict(s). Resolve these before starting, not at merge time.`);
  }
  if (verification.some((v) => !v.independent)) {
    problems.push(`${verification.filter((v) => !v.independent).length} writing seat(s) have no independent verifier.`);
  }
  const writerHarnesses = new Set(team.seats.filter((s) => s.mayWrite).map((s) => s.harness));
  if (writerHarnesses.size > 1) {
    problems.push(`${writerHarnesses.size} different CLIs will write in parallel. That is the point, but it means ${writerHarnesses.size} sets of edits to reconcile — review the merge, not just the branches.`);
  }

  return { teamId: team.id, missionSlug: opts.missionSlug, worktrees, contextFiles, conflicts, verification, waves, problems };
}

export function setupArgv(plan: CollaborationPlan): string[][] {
  const out: string[][] = [];
  for (const w of plan.worktrees) {
    if (w.shared || w.deferred) continue;
    for (const argv of w.createArgv) out.push(["git", ...argv]);
  }
  return out;
}

/**
 * Everything that has to happen to leave the repository clean after a run.
 *
 * The parameter is deliberately `worktrees`, not the whole plan: the executor
 * owns the worktree list it built at wave time and has no reason to reconstruct
 * a briefing or a wave plan just to tear it down. A `CollaborationPlan` satisfies
 * this, so existing callers are unchanged.
 */
export function teardownArgv(plan: Pick<CollaborationPlan, "worktrees">): string[][] {
  const out: string[][] = [];
  for (const w of plan.worktrees) {
    if (w.shared) continue;
    for (const argv of w.removeArgv) out.push(["git", ...argv]);
    /* Whichever seat brand its worktree carries, the OWNER of that branch is
       the mission, not the seat — so teardown owns the branch too. A removed
       worktree leaves its branch behind, and a second delegation against the
       same teammate and repo then asks git for a branch that already exists
       (`git worktree add -b`) and fails outright. Deleting on teardown makes
       the next run a legitimate operation rather than a dice roll. */
    if (w.branch) out.push(["git", "branch", "-D", w.branch]);
  }
  out.push(["git", "worktree", "prune"]);
  return out;
}

export function renderPlan(plan: CollaborationPlan): string {
  const lines: string[] = [];
  lines.push(`TEAM ${plan.teamId} — mission "${plan.missionSlug}"`);
  lines.push("");
  lines.push("execution waves:");
  plan.waves.forEach((w, i) => {
    lines.push(`  wave ${i + 1}: ${w.seats.join(", ")}`);
    lines.push(`    ${w.why}`);
  });
  lines.push("");
  lines.push("isolation:");
  for (const w of plan.worktrees) {
    const kind = w.shared ? "shared base" : w.deferred ? "review snapshot (deferred)" : "private worktree";
    lines.push(`  ${w.seatId.padEnd(12)} ${kind.padEnd(26)} ${w.branch || "(resolved at wave time)"}`);
    lines.push(`    ${w.path}`);
  }
  lines.push("");
  lines.push("briefings:");
  for (const f of plan.contextFiles) lines.push(`  ${f.path}  (read by ${f.forHarness})`);
  if (plan.verification.length) {
    lines.push("");
    lines.push("verification:");
    for (const v of plan.verification) lines.push(`  ${v.detail} (independent: ${v.independent ? "yes" : "no"})`);
  }
  if (plan.problems.length) {
    lines.push("");
    lines.push("before you start:");
    for (const p of plan.problems) lines.push(`  ! ${p}`);
  }
  return lines.join("\n");
}
