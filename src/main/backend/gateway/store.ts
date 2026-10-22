/**
 * Moon Gateway — the local store.
 *
 * Agents, channels, route bindings, sessions and automations, persisted as
 * JSON next to Seamoon's other data.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentConfig, CronJob, RouteBinding, SessionRecord } from "./types";

export type GatewayState = {
  version: number;
  agents: AgentConfig[];
  bindings: RouteBinding[];
  sessions: SessionRecord[];
  automations: CronJob[];
  /** Per-channel settings the desktop keeps (tokens, enabled flags…). */
  channelConfig: Record<string, Record<string, unknown>>;
};

export function emptyState(): GatewayState {
  return {
    version: 1,
    agents: [],
    bindings: [],
    sessions: [],
    automations: [],
    channelConfig: {},
  };
}

export class GatewayStore {
  private state: GatewayState;
  private listeners: (() => void)[] = [];

  constructor(private file: string) {
    this.state = this.read();
  }

  private read(): GatewayState {
    try {
      const raw = readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw);
      return { ...emptyState(), ...parsed };
    } catch {
      return emptyState();
    }
  }

  private write() {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.state, null, 2), "utf8");
    } catch {
      /* the store is best-effort; the agent keeps working in memory */
    }
    for (const l of this.listeners) l();
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== fn);
    };
  }

  get(): GatewayState {
    return this.state;
  }

  patch(next: Partial<GatewayState>) {
    this.state = { ...this.state, ...next };
    this.write();
    return this.state;
  }

  upsertAgent(agent: AgentConfig) {
    const agents = [...this.state.agents];
    const i = agents.findIndex((a) => a.id === agent.id);
    if (i === -1) agents.push(agent);
    else agents[i] = agent;
    return this.patch({ agents });
  }

  removeAgent(id: string) {
    return this.patch({
      agents: this.state.agents.filter((a) => a.id !== id),
      bindings: this.state.bindings.filter((b) => b.agentId !== id),
    });
  }

  upsertBinding(binding: RouteBinding) {
    const bindings = [...this.state.bindings];
    const i = bindings.findIndex((b) => b.id === binding.id);
    if (i === -1) bindings.push(binding);
    else bindings[i] = binding;
    return this.patch({ bindings });
  }

  removeBinding(id: string) {
    return this.patch({ bindings: this.state.bindings.filter((b) => b.id !== id) });
  }

  putSession(session: SessionRecord) {
    const sessions = [...this.state.sessions];
    const i = sessions.findIndex((s) => s.key === session.key);
    if (i === -1) sessions.push(session);
    else sessions[i] = session;
    return this.patch({ sessions });
  }

  session(key: string): SessionRecord | undefined {
    return this.state.sessions.find((s) => s.key === key);
  }

  removeSession(key: string) {
    return this.patch({ sessions: this.state.sessions.filter((s) => s.key !== key) });
  }

  setAutomations(automations: CronJob[]) {
    return this.patch({ automations });
  }
}
