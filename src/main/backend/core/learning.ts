/**
 * Moonwright agent — the closed learning loop.
 *
 * Ported from agent/learn_prompt.py (the skill contract), agent/curator.py (the
 * inactivity-driven skill lifecycle) and the post-turn background review in
 * agent/turn_finalizer.py.
 *
 * The contract is deliberately strict: the skill index in the system prompt
 * truncates descriptions, so a long description is not cosmetic — it is
 * silently cut and never routes.
 */
import type { MemoryRecord, SkillBundle } from "./types";

export const SKILL_NAME_MAX = 64;
export const SKILL_DESCRIPTION_MAX = 60;
export const SKILL_VERSION = "0.1.0";
/** Skills are shared and published, so the author is never taken from the host. */
export const SKILL_AUTHOR = "Moonwright";

export const SKILL_BODY_SECTIONS = [
  "# <Human Title>",
  "## When to Use",
  "## Prerequisites",
  "## How to Run",
  "## Quick Reference",
  "## Procedure",
  "## Pitfalls",
  "## Verification",
] as const;

/** Curator defaults, from agent/curator.py. */
export const CURATOR_DEFAULTS = {
  intervalHours: 24 * 7,
  idleHours: 2,
  staleAfterDays: 14,
  archiveAfterDays: 30,
  consolidate: false,
};

/** The hard-line rules a maintainer enforces when reviewing a skill. */
export const SKILL_RULES = [
  `name: lowercase-hyphenated, <=${SKILL_NAME_MAX} chars, no spaces.`,
  `description: ONE sentence, <=${SKILL_DESCRIPTION_MAX} characters, ends with a period. State the capability, not the implementation.`,
  `version: ${SKILL_VERSION}`,
  `author: always the literal value "${SKILL_AUTHOR}". NEVER fill it from the host environment.`,
  "platforms: declare [macos], [linux] and/or [windows] only when the skill uses OS-bound primitives.",
  "metadata.moonwright.tags: a few Capitalized, Relevant, Tags.",
  `Body section order: ${SKILL_BODY_SECTIONS.join(" → ")}.`,
] as const;

export interface SkillValidation {
  ok: boolean;
  errors: string[];
}

/** Enforces the skill contract. */
export function validateSkill(bundle: Partial<SkillBundle>): SkillValidation {
  const errors: string[] = [];
  const name = (bundle.name || "").trim();
  const description = (bundle.description || "").trim();

  if (!name) errors.push("name is required");
  else {
    if (name.length > SKILL_NAME_MAX) errors.push(`name is longer than ${SKILL_NAME_MAX} characters`);
    if (!/^[a-z0-9-]+$/.test(name)) errors.push("name must be lowercase-hyphenated");
    if (/\s/.test(name)) errors.push("name must not contain spaces");
  }

  if (!description) errors.push("description is required");
  else {
    if (description.length > SKILL_DESCRIPTION_MAX)
      errors.push(`description is ${description.length} characters — the skill index truncates at ${SKILL_DESCRIPTION_MAX}`);
    if (!description.endsWith(".")) errors.push("description must end with a period");
    if (description.includes(":")) errors.push("wrap a description containing a colon in double quotes");
    if (name && description.toLowerCase().includes(name.toLowerCase()))
      errors.push("description must not repeat the skill name");
  }

  return { ok: errors.length === 0, errors };
}

/** The prompt the background review uses to create or improve a skill. */
export function buildSkillReviewPrompt(input: {
  taskSummary: string;
  existingSkills: SkillBundle[];
  transcriptExcerpt: string;
}): string {
  return [
    "You are reviewing a completed task to decide whether it produced a reusable skill.",
    "",
    "## Rules",
    ...SKILL_RULES.map((r) => `- ${r}`),
    "",
    "## Existing skills",
    input.existingSkills.length
      ? input.existingSkills.map((s) => `- ${s.name}: ${s.description}`).join("\n")
      : "(none)",
    "",
    "## The task that just finished",
    input.taskSummary,
    "",
    "## Transcript excerpt",
    input.transcriptExcerpt,
    "",
    "## What to do",
    "If — and only if — this task solved something non-obvious that will recur, write one skill with",
    "the skill_manage tool. Otherwise do nothing. Never describe a skill you did not write.",
    "Prefer improving an existing skill over adding a near-duplicate.",
  ].join("\n");
}

/** The prompt the background review uses to persist what was learned. */
export function buildMemoryReviewPrompt(input: {
  taskSummary: string;
  existingMemories: MemoryRecord[];
  transcriptExcerpt: string;
}): string {
  return [
    "You are reviewing a completed task to decide whether anything it learned is worth persisting.",
    "",
    "## What to persist",
    "- Facts about the user that are stable and useful later (preferences, constraints).",
    "- Decisions about the project that would otherwise be re-litigated.",
    "- How something in this codebase actually works, when it was not obvious.",
    "",
    "## What NOT to persist",
    "- Anything that is only true for this conversation.",
    "- Secrets, tokens, credentials.",
    "- Restating what the transcript already says verbatim.",
    "",
    "## Existing memories",
    input.existingMemories.length
      ? input.existingMemories.map((m) => `- ${m.text}`).join("\n")
      : "(none)",
    "",
    "## The task that just finished",
    input.taskSummary,
    "",
    "## Transcript excerpt",
    input.transcriptExcerpt,
    "",
    "Write each fact with the memory tool, one fact per entry. If nothing is worth keeping, do nothing.",
  ].join("\n");
}

export type SkillTransition = "pin" | "archive" | "restore" | "consolidate" | "patch";

export interface TransitionPlan {
  id: string;
  name: string;
  transition: SkillTransition;
  reason: string;
}

/**
 * The curator's inactivity transitions. Upstream rules:
 *   - only curator-managed skills are touched;
 *   - never delete, only archive (recoverable);
 *   - pinned skills bypass all auto-transitions;
 *   - a skill unused for `staleAfterDays` is stale; after `archiveAfterDays` it is archived.
 */
export function planSkillTransitions(
  skills: SkillBundle[],
  now: number,
  options: Partial<typeof CURATOR_DEFAULTS> = {},
): TransitionPlan[] {
  const { staleAfterDays, archiveAfterDays } = { ...CURATOR_DEFAULTS, ...options };
  const plans: TransitionPlan[] = [];
  const staleMs = staleAfterDays * 86400000;
  const archiveMs = archiveAfterDays * 86400000;

  for (const skill of skills) {
    if (skill.pinned) continue; // pinned skills bypass all auto-transitions
    if (skill.archived) continue;
    const last = skill.lastUsedAt ?? skill.updatedAt ?? skill.createdAt;
    const idle = now - last;
    if (idle >= archiveMs) {
      plans.push({ id: skill.id, name: skill.name, transition: "archive", reason: `unused for ${Math.floor(idle / 86400000)} days` });
    } else if (idle >= staleMs) {
      plans.push({ id: skill.id, name: skill.name, transition: "consolidate", reason: `unused for ${Math.floor(idle / 86400000)} days` });
    }
  }
  return plans;
}

/** A transcript excerpt the review can work from. */
export function transcriptExcerpt(messages: { role: string; content: string | null }[], limit = 6000): string {
  const text = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role}: ${m.content ?? ""}`)
    .join("\n");
  if (text.length <= limit) return text;
  return `…${text.slice(text.length - limit)}`;
}
