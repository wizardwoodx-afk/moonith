/**
 * The agent core — public surface.
 *
 * The phase machine every turn runs through. Its design is a TypeScript port of
 * an MIT-licensed upstream agent (see THIRD-PARTY-NOTICES.md). It is
 * transport-agnostic: everything external (the model, the tools,
 * memory, skills, the event bus) is injected through `ImpulsePorts`, so the
 * same core runs in the Electron main process today and could run in a worker
 * tomorrow.
 *
 * What was ported, and from where upstream:
 *   loop.ts        agent/conversation_loop.py  — the phase machine
 *   budget.ts      agent/iteration_budget.py  — consume/refund iteration budget
 *   stopGates.ts   agent/turn_stop_gates.py   — four gates that can hold an answer
 *   nudges.ts      agent/turn_finalizer.py    — the skill and memory nudges
 *   learning.ts    agent/learn_prompt.py      — the skill contract
 *                 agent/curator.py           — the skill lifecycle transitions
 *   memory.ts      agent/memory_manager.py    — search, summarise, inject
 *   skills.ts      agent/skill_bundles.py     — the agentskills.io manager
 */
export { ImpulseAgent } from "./loop";
export { IterationBudget, normalizeBudgetWarningRatio } from "./budget";
export { evaluateStopGates, finalizeHeldAnswer } from "./stopGates";
export {
  SKILL_NUDGE,
  MEMORY_NUDGE,
  skillNudgeMessage,
  memoryNudgeMessage,
  shouldNudgeSkill,
  shouldNudgeMemory,
} from "./nudges";
export {
  SKILL_RULES,
  SKILL_BODY_SECTIONS,
  SKILL_AUTHOR,
  SKILL_VERSION,
  SKILL_NAME_MAX,
  SKILL_DESCRIPTION_MAX,
  CURATOR_DEFAULTS,
  validateSkill,
  buildSkillReviewPrompt,
  buildMemoryReviewPrompt,
  planSkillTransitions,
  transcriptExcerpt,
} from "./learning";
export { SkillManager } from "./skills";
export { MemoryManager, delegate } from "./memory";
export {
  DEFAULT_MOONWRIGHT_CONFIG,
  type ImpulseConfig,
  type ImpulsePorts,
  type LoopState,
  type ModelMessage,
  type ModelResponse,
  type PhaseAction,
  type PhaseResult,
  type SkillBundle,
  type MemoryRecord,
  type ToolSpec,
  type ToolCall,
  type ToolResult,
  type TurnResult,
} from "./types";
