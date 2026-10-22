/**
 * Moonwright agent — the turn loop.
 *
 * Ported from agent/conversation_loop.py. Upstream runs a turn as a *phase
 * machine*: each phase returns `return` / `break` / `continue`, and the loop
 * keeps going while
 *
 *     api_call_count < max_iterations && iteration_budget.remaining > 0
 *       || budget_grace_call
 *
 * This is the same structure, expressed as a typed phase list so the order of
 * the phases is data rather than a wall of nested `if`s.
 */
import { IterationBudget } from "./budget";
import { evaluateStopGates, finalizeHeldAnswer, type StopGateContext } from "./stopGates";
import { memoryNudgeMessage, shouldNudgeMemory, shouldNudgeSkill, skillNudgeMessage } from "./nudges";
import {
  DEFAULT_MOONWRIGHT_CONFIG,
  type MoonwrightConfig,
  type MoonwrightPorts,
  type LoopState,
  type ModelMessage,
  type ModelResponse,
  type PhaseResult,
  type ToolResult,
  type TurnResult,
} from "./types";

export interface MoonwrightAgentOptions {
  ports: MoonwrightPorts;
  config?: Partial<MoonwrightConfig>;
  /** The system prompt for the turn. */
  systemPrompt: string;
  /** Where the turn's messages live. */
  history?: ModelMessage[];
  /** A per-turn memory record of the skill/memory counters. */
  state?: Partial<LoopState>;
  /** The parent budget — a sub-agent gets its own. */
  budget?: IterationBudget;
  /** True for a sub-agent (no delegation, no background review). */
  isSubagent?: boolean;
  signal?: AbortSignal;
}

export interface RunTurnInput {
  userMessage: string;
  /** Extra context injected before the user's message (memory, skills index). */
  context?: string;
}

export class MoonwrightAgent {
  readonly ports: MoonwrightPorts;
  readonly config: MoonwrightConfig;
  readonly systemPrompt: string;
  readonly isSubagent: boolean;
  private history: ModelMessage[];
  private budget: IterationBudget;
  private signal?: AbortSignal;

  constructor(options: MoonwrightAgentOptions) {
    this.ports = options.ports;
    this.config = { ...DEFAULT_MOONWRIGHT_CONFIG, ...(options.config || {}) };
    this.systemPrompt = options.systemPrompt;
    this.isSubagent = Boolean(options.isSubagent);
    this.history = options.history ? [...options.history] : [];
    this.budget = options.budget ?? new IterationBudget(this.config.maxIterations);
    this.signal = options.signal;
  }

  get iterationBudget(): IterationBudget {
    return this.budget;
  }

  /**
   * Run one turn: the phase machine, the stop gates, and the post-turn review.
   */
  async runTurn(input: RunTurnInput): Promise<TurnResult> {
    const state: LoopState = {
      turnId: `turn_${this.ports.now().toString(36)}`,
      messages: [],
      apiCallCount: 0,
      finalResponse: null,
      pendingVerificationResponse: null,
      pendingVerificationResponsePreviewed: false,
      mutatedPaths: [],
      iterationsSinceSkill: 0,
      iterationsSinceMemory: 0,
      skillUsedThisTurn: false,
      memoryWrittenThisTurn: false,
      stopGateNudges: 0,
      budgetGraceCall: false,
      toolCalls: 0,
      usage: { prompt: 0, completion: 0, total: 0 },
    };

    const messages: ModelMessage[] = [
      { role: "system", content: this.systemPrompt },
      ...this.history,
    ];
    if (input.context) messages.push({ role: "user", content: input.context, synthetic: true, name: "context" });
    messages.push({ role: "user", content: input.userMessage });
    state.messages = messages;

    const tools = this.ports.listTools();
    const toolNames = new Set(tools.map((t) => t.name));
    let stopReason: TurnResult["stopReason"] = "final";
    let error: string | undefined;

    // ---- the phase machine ------------------------------------------------
    while (this.budget.allows(state.apiCallCount, this.config.maxIterations, state.budgetGraceCall)) {
      if (this.signal?.aborted) {
        stopReason = "interrupted";
        break;
      }

      // 1. begin_iteration
      const begin = await this.phaseBeginIteration(state);
      if (begin.action === "break") break;

      // 2. prepare_iteration
      await this.phasePrepareIteration(state);

      // 3. assemble_api_request
      await this.phaseAssembleRequest(state);

      // 4. run_preflight_gate
      const preflight = await this.phasePreflightGate(state);
      if (preflight.action === "return") return preflight.result as TurnResult;
      if (preflight.action === "break") {
        stopReason = "prelude_break";
        break;
      }
      if (preflight.action === "continue") continue;

      // 5. announce_api_call + the call itself
      this.ports.emit("agent:api_call", { turnId: state.turnId, call: state.apiCallCount });
      const response = await this.callModel(state, tools);
      if (!response) {
        stopReason = "error";
        error = "the model call failed";
        break;
      }

      // 6. normalize_model_response
      const normalized = await this.phaseNormalizeResponse(state, response);
      if (normalized.action === "return") return normalized.result as TurnResult;
      if (normalized.action === "continue") continue;

      // 7. run_tool_round / finish_text_response
      if (response.toolCalls.length) {
        const round = await this.phaseToolRound(state, response);
        if (round.action === "return") return round.result as TurnResult;
        if (round.action === "break") break;
        if (round.action === "continue") continue;
      } else {
        const finish = await this.phaseFinishTextResponse(state, response);
        if (finish.action === "return") return finish.result as TurnResult;
        if (finish.action === "break") break;
        if (finish.action === "continue") continue;
      }
    }

    if (state.apiCallCount >= this.config.maxIterations || this.budget.remaining === 0) {
      stopReason = this.budget.remaining === 0 ? "budget_exhausted" : "max_iterations";
    }

    // The candidate answer a gate held back becomes the answer when the budget runs out.
    const finalResponse = finalizeHeldAnswer(state) ?? state.finalResponse;

    // ---- the post-turn review (the learning loop) ------------------------
    let review: TurnResult["review"];
    if (this.config.backgroundReview && !this.isSubagent && finalResponse && !error) {
      const shouldSkills = shouldNudgeSkill({
        nudgeInterval: this.config.skillNudgeInterval,
        iterationsSinceSkill: state.iterationsSinceSkill,
        skillToolAvailable: toolNames.has("skill_manage"),
      });
      const shouldMemory = shouldNudgeMemory({
        nudgeInterval: this.config.memoryNudgeInterval,
        iterationsSinceMemory: state.iterationsSinceMemory,
        memoryToolAvailable: toolNames.has("memory_write"),
      });
      if (shouldSkills || shouldMemory) {
        review = { memory: shouldMemory, skills: shouldSkills };
        this.ports.emit("agent:review", { turnId: state.turnId, ...review });
        // The review runs after delivery, so it never competes with the user's task.
        void this.runBackgroundReview(state, review);
      }
    }

    this.ports.emit("agent:turn_done", {
      turnId: state.turnId,
      apiCallCount: state.apiCallCount,
      toolCalls: state.toolCalls,
      usage: state.usage,
      stopReason,
    });

    return {
      finalResponse,
      messages: state.messages,
      apiCallCount: state.apiCallCount,
      usage: state.usage,
      toolCalls: state.toolCalls,
      stopReason,
      error,
      review,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Phases                                                              */
  /* ------------------------------------------------------------------ */

  private async phaseBeginIteration(state: LoopState): Promise<PhaseResult> {
    state.apiCallCount += 1;
    this.budget.consume();
    return { action: "next" };
  }

  private async phasePrepareIteration(state: LoopState): Promise<void> {
    state.iterationsSinceSkill += 1;
    state.iterationsSinceMemory += 1;

    // The nudges fire mid-turn once their counters cross the interval, so the
    // agent is reminded *while* it is still working, not only after the turn.
    if (
      this.config.skillNudgeInterval > 0 &&
      state.iterationsSinceSkill >= this.config.skillNudgeInterval &&
      !state.skillUsedThisTurn
    ) {
      state.messages.push(skillNudgeMessage());
      state.iterationsSinceSkill = 0;
      this.ports.emit("agent:nudge", { turnId: state.turnId, kind: "skill" });
    }
    if (
      this.config.memoryNudgeInterval > 0 &&
      state.iterationsSinceMemory >= this.config.memoryNudgeInterval &&
      !state.memoryWrittenThisTurn
    ) {
      state.messages.push(memoryNudgeMessage());
      state.iterationsSinceMemory = 0;
      this.ports.emit("agent:nudge", { turnId: state.turnId, kind: "memory" });
    }
  }

  private async phaseAssembleRequest(state: LoopState): Promise<void> {
    // The request is the message list as it stands; the phase exists so the
    // ordering of the machine stays explicit and extensible.
    state.messages = state.messages.filter((m) => m.role !== "system" || m.content);
  }

  /**
   * The preflight gate: a tool that may only run when the turn is allowed to
   * continue. Seamoon uses it to surface a pending steer/interrupt.
   */
  private async phasePreflightGate(state: LoopState): Promise<PhaseResult> {
    void state;
    if (this.signal?.aborted) return { action: "break" };
    return { action: "next" };
  }

  private async callModel(state: LoopState, tools: ReturnType<MoonwrightPorts["listTools"]>): Promise<ModelResponse | null> {
    try {
      const response = await this.ports.callModel(state.messages, {
        tools,
        temperature: this.config.temperature,
        maxTokens: this.config.maxOutputTokens,
        signal: this.signal,
      });
      if (response.usage) {
        state.usage.prompt += response.usage.prompt ?? 0;
        state.usage.completion += response.usage.completion ?? 0;
        state.usage.total += response.usage.total ?? 0;
      }
      return response;
    } catch (err) {
      this.ports.emit("agent:error", { turnId: state.turnId, error: String(err) });
      return null;
    }
  }

  private async phaseNormalizeResponse(state: LoopState, response: ModelResponse): Promise<PhaseResult> {
    if (!response.text && !response.toolCalls.length) {
      // an empty response is a known failure mode upstream; retry the turn
      this.ports.emit("agent:empty_response", { turnId: state.turnId });
      return { action: "continue" };
    }
    return { action: "next" };
  }

  private async phaseToolRound(state: LoopState, response: ModelResponse): Promise<PhaseResult> {
    const assistant: ModelMessage = {
      role: "assistant",
      content: response.text,
      toolCalls: response.toolCalls,
    };
    state.messages.push(assistant);

    for (const call of response.toolCalls) {
      state.toolCalls += 1;
      this.ports.emit("agent:tool", { turnId: state.turnId, tool: call.name, args: call.args });

      let result: ToolResult;
      try {
        result = await this.ports.runTool(call.name, call.args);
      } catch (err) {
        result = { ok: false, error: String(err) };
      }

      if (result.mutatedPaths?.length) {
        state.mutatedPaths = [...new Set([...state.mutatedPaths, ...result.mutatedPaths])];
      }
      if (call.name === "skill_manage" || call.name === "skill_use") {
        state.skillUsedThisTurn = true;
        state.iterationsSinceSkill = 0;
      }
      if (call.name === "memory_write" || call.name === "memory_add") {
        state.memoryWrittenThisTurn = true;
        state.iterationsSinceMemory = 0;
      }

      state.messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: JSON.stringify(result.ok ? (result.output ?? "") : { error: result.error }),
      });
    }
    return { action: "next" };
  }

  /**
   * The model answered with text. The stop gates get the chance to keep the turn
   * alive before the answer is accepted.
   */
  private async phaseFinishTextResponse(state: LoopState, response: ModelResponse): Promise<PhaseResult> {
    state.messages.push({ role: "assistant", content: response.text });

    const ctx: StopGateContext = {
      mutatedPaths: state.mutatedPaths,
      finalResponse: response.text,
      messages: state.messages,
      nudges: state.stopGateNudges,
    };
    const outcome = await evaluateStopGates(ctx);

    if (outcome.continueTurn && outcome.nudge) {
      state.stopGateNudges += 1;
      state.pendingVerificationResponse = outcome.pendingVerificationResponse;
      state.finalResponse = null;
      // the held answer becomes an interim row, and the nudge is the next user turn
      state.messages.push({
        role: "assistant",
        content: outcome.pendingVerificationResponse,
        synthetic: true,
        name: "interim_answer",
      });
      state.messages.push({ role: "user", content: outcome.nudge, synthetic: true, name: "stop_gate" });
      this.ports.emit("agent:stop_gate", { turnId: state.turnId, nudge: outcome.nudge });
      return { action: "continue" };
    }

    state.finalResponse = response.text;
    // The model answered. Unless a gate held the answer back, the turn ends here —
    // continuing would call the model again with the conversation ending in an
    // assistant turn, which several providers reject.
    return { action: "break" };
  }

  /**
   * The background review: a fork of the agent that may write memories and
   * maintain skills. It runs after delivery and never touches this turn's
   * prompt cache.
   */
  private async runBackgroundReview(state: LoopState, review: { memory: boolean; skills: boolean }): Promise<void> {
    try {
      const reviewTools = this.ports
        .listTools()
        .filter((t) => (review.skills ? t.name === "skill_manage" : false) || (review.memory ? t.name.startsWith("memory_") : false));

      if (!reviewTools.length) return;

      const transcript = state.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => `${m.role}: ${m.content ?? ""}`)
        .join("\n")
        .slice(-6000);

      const summary = state.finalResponse ?? "(no answer)";
      const existingSkills = review.skills ? await this.ports.skills.list() : [];
      const existingMemories = review.memory ? await this.ports.memory.list() : [];

      const instructions: string[] = [];
      if (review.skills) {
        const { buildSkillReviewPrompt } = await import("./learning");
        instructions.push(buildSkillReviewPrompt({ taskSummary: summary, existingSkills, transcriptExcerpt: transcript }));
      }
      if (review.memory) {
        const { buildMemoryReviewPrompt } = await import("./learning");
        instructions.push(buildMemoryReviewPrompt({ taskSummary: summary, existingMemories, transcriptExcerpt: transcript }));
      }

      const reviewAgent = new MoonwrightAgent({
        ports: this.ports,
        config: { ...this.config, backgroundReview: false, maxIterations: this.config.reviewMaxIterations },
        systemPrompt: [
          "You are the background reviewer for an AI agent. You never answer the user directly.",
          "You review the completed turn and, only if it is warranted, persist what was learned.",
        ].join("\n"),
        isSubagent: true,
      });

      const result = await reviewAgent.runTurn({ userMessage: instructions.join("\n\n") });
      this.ports.emit("agent:review_done", {
        turnId: state.turnId,
        wrote: result.toolCalls,
        text: result.finalResponse,
      });
    } catch (err) {
      this.ports.emit("agent:review_error", { turnId: state.turnId, error: String(err) });
    }
  }
}
