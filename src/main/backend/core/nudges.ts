/**
 * ImpulseCore agent — the nudges.
 *
 * Two periodic nudges drive the closed learning loop:
 *   - the skill nudge:  every N iterations without a skill being used, the agent is
 *     reminded that it can create or improve one (upstream `_skill_nudge_interval`);
 *   - the memory nudge: every N iterations without a memory being written, it is
 *     reminded to persist what it learned (upstream `_memory_nudge_interval`).
 *
 * The nudges are appended as *user-role* rows, so the model treats them as the
 * next instruction rather than as its own text.
 */
import type { ModelMessage } from "./types";

export const SKILL_NUDGE = [
  "You have not used a skill in a while. If this task repeats, or you just solved something",
  "non-obvious, write the procedure down as a skill (skill_manage) so the next run starts",
  "from what you learned. Do not write a skill for a one-off answer.",
].join(" ");

export const MEMORY_NUDGE = [
  "Persist what you learned. If a fact about the user, the project or a decision would help a",
  "later session, write it to memory now (one fact per entry). Skip anything that is only true",
  "for this conversation.",
].join(" ");

export function skillNudgeMessage(): ModelMessage {
  return { role: "user", content: SKILL_NUDGE, synthetic: true, name: "skill_nudge" };
}

export function memoryNudgeMessage(): ModelMessage {
  return { role: "user", content: MEMORY_NUDGE, synthetic: true, name: "memory_nudge" };
}

/**
 * Should the skill nudge fire at the end of this turn?
 * Upstream: the interval is checked against the iterations THIS turn used.
 */
export function shouldNudgeSkill(opts: {
  nudgeInterval: number;
  iterationsSinceSkill: number;
  skillToolAvailable: boolean;
}): boolean {
  return (
    opts.nudgeInterval > 0 && opts.iterationsSinceSkill >= opts.nudgeInterval && opts.skillToolAvailable
  );
}

/** The memory equivalent. */
export function shouldNudgeMemory(opts: {
  nudgeInterval: number;
  iterationsSinceMemory: number;
  memoryToolAvailable: boolean;
}): boolean {
  return (
    opts.nudgeInterval > 0 && opts.iterationsSinceMemory >= opts.nudgeInterval && opts.memoryToolAvailable
  );
}
