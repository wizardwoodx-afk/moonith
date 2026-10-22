/**
 * Moonwright agent — memory and delegation.
 *
 * Memory upstream is a hybrid: full-text search over past sessions plus a
 * background summarisation pass, and only the relevant facts are injected into
 * the current prompt. Seamoon's store is a local JSON ledger, so the same shape
 * is provided over the injected port.
 *
 * Delegation gives a sub-agent its own conversation and its own iteration
 * budget, so the total iterations across parent and children may exceed the
 * parent's cap.
 */
import { MoonwrightAgent } from "./loop";
import { IterationBudget } from "./budget";
import type { MoonwrightConfig, MoonwrightPorts, MemoryRecord, ModelMessage } from "./types";

export class MemoryManager {
  constructor(private ports: MoonwrightPorts) {}

  async list(scope?: string): Promise<MemoryRecord[]> {
    return this.ports.memory.list(scope);
  }

  async add(text: string, scope = "global", tags: string[] = []): Promise<MemoryRecord> {
    const record = await this.ports.memory.add({ text, scope, tags });
    this.ports.emit("agent:memory_written", { id: record.id });
    return record;
  }

  async remove(id: string): Promise<boolean> {
    return this.ports.memory.remove(id);
  }

  /** Keyword search over the ledger. */
  async search(query: string, limit = 8): Promise<MemoryRecord[]> {
    return this.ports.memory.search(query, limit);
  }

  /**
   * The facts worth injecting into the next turn: search first, then summarise
   * only what the search returned, so the prompt stays small.
   */
  async context(query: string, limit = 8): Promise<string> {
    const hits = await this.search(query, limit);
    if (!hits.length) return "";
    const summary = await this.ports.memory.summarize(hits).catch(() => "");
    const body = summary || hits.map((h) => `- ${h.text}`).join("\n");
    return `## What you already know\n${body}`;
  }
}

export interface DelegationOptions {
  ports: MoonwrightPorts;
  config: MoonwrightConfig;
  systemPrompt: string;
  instruction: string;
  /** The parent's context handed to the child. */
  context?: string;
  history?: ModelMessage[];
}

/**
 * Run a sub-agent: its own conversation, its own budget, no delegation of its
 * own and no background review.
 */
export async function delegate(opts: DelegationOptions) {
  const child = new MoonwrightAgent({
    ports: opts.ports,
    config: { ...opts.config, maxIterations: opts.config.delegationMaxIterations },
    systemPrompt: opts.systemPrompt,
    history: opts.history,
    isSubagent: true,
    budget: new IterationBudget(opts.config.delegationMaxIterations),
  });
  const result = await child.runTurn({
    userMessage: opts.instruction,
    context: opts.context,
  });
  return {
    text: result.finalResponse,
    usage: result.usage,
    apiCallCount: result.apiCallCount,
    toolCalls: result.toolCalls,
    stopReason: result.stopReason,
  };
}
