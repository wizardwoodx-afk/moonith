/**
 * §BANDIT-ROUTED EVOLUTION — the evolve loop learns WHERE to search (VH 11.9.4-Major).
 *
 * RecHarness (2026) showed the winning shape for self-evolving systems under
 * limited trial budgets: a bandit router allocates trials across structured
 * edit dimensions, and the LLM reasons *inside* the chosen direction; AEL
 * (2026) showed a Thompson-style bandit over retrieval policies plus a
 * stagnation "jump" arm beats free-form self-mutation. VH's team evolution
 * already evolves seat instructions with honest gates — what it lacked was a
 * router: every candidate edit searched the same dimensions in the same way.
 *
 * This module is that router, as a pure, deterministic UCB1 over three
 * structured dimensions plus a structural-jump arm:
 *
 *   review  : shallow | standard | deep      (how hard reviewers attack)
 *   exec    : serial  | wave                 (task wave parallelism)
 *   check   : lenient | strict               (verification strictness)
 *   jump    : structural                     (activated on stagnation)
 *
 * HONESTY RULES (inherited from teamEvolution, non-negotiable)
 *   1. Posteriors update ONLY on measured, non-simulated runs. A simulated
 *      run is logged as experience but moves nothing — a fixture is not
 *      evidence (recordOutcome returns the state untouched, with the attempt
 *      noted in `experience`).
 *   2. No score is invented: arms start at an uninformative Beta(1,1); the
 *      digest reports pulls and means, never a claimed win before a run.
 *   3. The jump arm cannot be pulled by curiosity — only `stagnationStreak`
 *      ≥ JUMP_STREAK (consecutive measured runs without a new best) arms it.
 *   4. `seedFromSeatStats` lets the router start from the evolution ledger's
 *      measured seat history instead of a blank prior, so existing teams do
 *      not re-explore what they already paid to learn.
 */

export type ArmDimension = "review" | "exec" | "check" | "jump";
export type ArmId =
  | "review:shallow"
  | "review:standard"
  | "review:deep"
  | "exec:serial"
  | "exec:wave"
  | "check:lenient"
  | "check:strict"
  | "jump:structural";

export const DIMENSIONS: Record<Exclude<ArmDimension, "jump">, ArmId[]> = {
  review: ["review:shallow", "review:standard", "review:deep"],
  exec: ["exec:serial", "exec:wave"],
  check: ["check:lenient", "check:strict"],
};

export const JUMP_ARM: ArmId = "jump:structural";
export const JUMP_STREAK = 3;

export interface ArmStat {
  /** Beta posterior successes/failures from MEASURED runs only. */
  alpha: number;
  beta: number;
  pulls: number;
}

export interface BanditExperienceEntry {
  ts: string;
  arms: ArmId[];
  verified: boolean;
  simulated: boolean;
}

export interface BanditState {
  arms: Record<ArmId, ArmStat>;
  totalPulls: number;
  /** Consecutive measured runs without a new best verified score. */
  stagnationStreak: number;
  bestVerifiedShare: number | null;
  history: BanditExperienceEntry[];
}

export function emptyBandit(): BanditState {
  const arms = {} as Record<ArmId, ArmStat>;
  for (const list of Object.values(DIMENSIONS)) for (const id of list) arms[id] = { alpha: 1, beta: 1, pulls: 0 };
  arms[JUMP_ARM] = { alpha: 1, beta: 1, pulls: 0 };
  return { arms, totalPulls: 0, stagnationStreak: 0, bestVerifiedShare: null, history: [] };
}

const mean = (a: ArmStat): number => a.alpha / (a.alpha + a.beta);

/** UCB1 score: exploit the mean, explore the uncertain. Deterministic. */
export function ucbScore(s: BanditState, id: ArmId): number {
  const a = s.arms[id];
  if (a.pulls === 0) return Number.POSITIVE_INFINITY; // try everything once first
  return mean(a) + Math.sqrt((2 * Math.log(Math.max(2, s.totalPulls))) / a.pulls);
}

/** Pick one arm per dimension (+ the jump arm when stagnation arms it). */
export function selectArms(s: BanditState): ArmId[] {
  const picked: ArmId[] = [];
  for (const list of Object.values(DIMENSIONS)) {
    let best: ArmId = list[0];
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const id of list) {
      const sc = ucbScore(s, id);
      if (sc > bestScore) {
        bestScore = sc;
        best = id;
      }
    }
    picked.push(best);
  }
  if (s.stagnationStreak >= JUMP_STREAK) picked.push(JUMP_ARM);
  return picked;
}

/**
 * Fold one measured (or simulated) run. Simulated runs are EXPERIENCE ONLY:
 * they enter the log but never move a posterior, the streak, or the best.
 */
export function recordOutcome(s: BanditState, arms: ArmId[], verified: boolean, simulated: boolean): BanditState {
  const entry: BanditExperienceEntry = { ts: new Date().toISOString(), arms, verified, simulated };
  const history = [...s.history.slice(-49), entry];
  if (simulated) {
    return { ...s, history };
  }
  const armsNext = { ...s.arms };
  for (const id of arms) {
    const a = armsNext[id];
    armsNext[id] = { alpha: a.alpha + (verified ? 1 : 0), beta: a.beta + (verified ? 0 : 1), pulls: a.pulls + 1 };
  }
  const totalPulls = s.totalPulls + 1;
  const share = arms.length > 0 ? (verified ? 1 : 0) : 0;
  // Stagnation = consecutive measured runs with no verified success. A verified
  // run always breaks the streak (with binary outcomes "a new best" is "it worked").
  return {
    arms: armsNext,
    totalPulls,
    stagnationStreak: verified ? 0 : s.stagnationStreak + 1,
    bestVerifiedShare: s.bestVerifiedShare === null ? share : Math.max(s.bestVerifiedShare, share),
    history,
  };
}

/**
 * Inform the priors from the evolution ledger's measured seat history (rule 4).
 *
 * HONESTY (11.9.4-Major+ review fix): historical runs did NOT pull these arms —
 * the old seeding spread real runs across every arm and pretended pulls that
 * never happened, which made the UCB statistics look more meaningful than they
 * were. Now the ledger only shifts the Beta PRIOR (alpha/beta mass, capped so a
 * long history cannot drown fresh measurements); `pulls` stays 0, so UCB still
 * explores every arm once and the digest can tell prior mass from experience.
 */
export function seedFromSeatStats(s: BanditState, stats: Array<{ runs: number; verifiedRuns: number; simulatedRuns: number }>): BanditState {
  const armsNext = { ...s.arms };
  let real = 0;
  let ver = 0;
  for (const st of stats) {
    const realHere = Math.max(0, st.runs - st.simulatedRuns);
    real += realHere;
    ver += Math.min(st.verifiedRuns, realHere);
  }
  // Cap prior mass at 4 pseudo-observations per arm: informative, never dominant.
  const mass = Math.min(4, Math.floor(real / 2));
  const vMass = mass > 0 ? Math.round(mass * (ver / Math.max(1, real))) : 0;
  if (mass > 0) {
    for (const list of Object.values(DIMENSIONS)) {
      for (const id of list) {
        const a = armsNext[id];
        armsNext[id] = { alpha: a.alpha + vMass, beta: a.beta + (mass - vMass), pulls: a.pulls };
      }
    }
  }
  return { ...s, arms: armsNext };
}

/** The Experiment-Skill digest: incumbent, arms tried, rejected directions. */
export function skillDigest(s: BanditState): string {
  const lines: string[] = [];
  lines.push(`incumbent best verified run: ${s.bestVerifiedShare === null ? "none measured yet" : s.bestVerifiedShare === 1 ? "yes" : "no"}; ${s.totalPulls} measured pull(s)`);
  for (const [dim, list] of Object.entries(DIMENSIONS)) {
    const ranked = [...list].sort((a, b) => mean(s.arms[b]) - mean(s.arms[a]));
    const top = ranked[0];
    lines.push(`${dim}: lead ${top} (mean ${mean(s.arms[top]).toFixed(2)}, ${s.arms[top].pulls} pulls)`);
    for (const id of ranked.slice(1)) {
      const a = s.arms[id];
      if (a.pulls >= 3 && mean(a) < 0.4) lines.push(`  rejected direction: ${id} (mean ${mean(a).toFixed(2)} over ${a.pulls} pulls)`);
    }
  }
  lines.push(
    s.stagnationStreak >= JUMP_STREAK
      ? `stagnation ${s.stagnationStreak} run(s) — structural-jump arm ARMED`
      : `stagnation ${s.stagnationStreak}/${JUMP_STREAK} — jump arm disarmed`,
  );
  const sim = s.history.filter((h) => h.simulated).length;
  if (sim > 0) lines.push(`note: ${sim} simulated run(s) logged as experience, excluded from posteriors`);
  return lines.join("\n");
}
