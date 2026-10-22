/**
 * Real-Time Inter-Agent Communication Bus & Shared Blackboard.
 *
 * Enables parallel multi-agent collaboration across the in-process engines.
 *
 * Provides:
 * 1. Pub/Sub Channel Mesh (`#general`, `#architecture`, `#implementation-sync`, `#qa-review`, `#security-audit`)
 * 2. Targeted Peer-to-Peer Mentions (`@coder`, `@reviewer`, `@architect`, `@all`)
 * 3. Shared Blackboard State (API schemas, architectural decisions, test criteria, blocker registry)
 * 4. Threaded Conversation & Intent Routing (proposals, contracts, blockers, handoffs, verifications)
 * 5. Direct Integration with Team Execution & Mission Runtime
 */

import type { HarnessId } from "../domain/harness";
import type { TeamRole } from "./agentTeam";

export type MessageIntent =
  | "proposal"
  | "feedback"
  | "contract"
  | "blocker"
  | "handoff"
  | "operator"
  | "verification"
  | "broadcast";

export interface AgentIdentity {
  seatId: string;
  role: TeamRole;
  harness: HarnessId;
  name: string;
}

export interface InterAgentMessage {
  id: string;
  sequence: number;
  seq?: number;
  replyToId?: string;
  timestamp: string;
  channel: string;
  sender: AgentIdentity;
  mentions: string[];
  intent: MessageIntent;
  content: string;
  data?: Record<string, unknown>;
}

export interface BlackboardEntry {
  key: string;
  author: string;
  updatedAt: string;
  category: "architecture" | "contract" | "test_criteria" | "dependency" | "finding";
  value: string;
  version: number;
}

export interface ChannelTopic {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export const DEFAULT_CHANNELS: ChannelTopic[] = [
  { id: "#general", name: "general", description: "All-agent mission coordination and status updates", icon: "hash" },
  { id: "#architecture", name: "architecture", description: "Interface designs, data flow schemas, and ADRs", icon: "layout" },
  { id: "#implementation-sync", name: "implementation-sync", description: "Real-time branch, worktree, and code sync", icon: "code" },
  { id: "#qa-review", name: "qa-review", description: "Peer review findings, test results, and verification", icon: "check-circle" },
  { id: "#security-audit", name: "security-audit", description: "Vulnerability analysis, permission gates, and threat models", icon: "shield" },
];

export class InterAgentMessageBus {
  private messages: InterAgentMessage[] = [];
  private blackboard: Map<string, BlackboardEntry> = new Map();
  private listeners: Set<(msg: InterAgentMessage) => void> = new Set();
  private blackboardListeners: Set<(entry: BlackboardEntry) => void> = new Set();
  private seqCounter = 0;

  constructor(initialMessages: InterAgentMessage[] = []) {
    this.messages = [...initialMessages];
    this.seqCounter = initialMessages.length;
  }

  subscribe(listener: (msg: InterAgentMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeBlackboard(listener: (entry: BlackboardEntry) => void): () => void {
    this.blackboardListeners.add(listener);
    return () => this.blackboardListeners.delete(listener);
  }

  publish(msg: {
    channel: string;
    sender: AgentIdentity;
    mentions?: string[];
    intent: MessageIntent;
    content: string;
    replyToId?: string;
    data?: Record<string, unknown>;
  }): InterAgentMessage {
    const nextSeq = ++this.seqCounter;
    const full: InterAgentMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sequence: nextSeq,
      seq: nextSeq,
      replyToId: msg.replyToId,
      timestamp: new Date().toISOString(),
      channel: msg.channel,
      sender: msg.sender,
      mentions: msg.mentions ?? [],
      intent: msg.intent,
      content: msg.content,
      data: msg.data,
    };
    this.messages.push(full);
    for (const listener of this.listeners) {
      try {
        listener(full);
      } catch (err) {
        console.error("Inter-agent bus listener error:", err);
      }
    }
    return full;
  }

  getMessages(filter?: string | { channel?: string; mention?: string; sender?: string }): InterAgentMessage[] {
    if (!filter) return [...this.messages];
    if (typeof filter === "string") {
      if (filter === "#all") return [...this.messages];
      return this.messages.filter((m) => m.channel === filter);
    }
    return this.messages.filter((m) => {
      if (filter.channel && filter.channel !== "#all" && m.channel !== filter.channel) return false;
      if (filter.sender && m.sender.seatId !== filter.sender) return false;
      if (filter.mention) {
        const target = filter.mention.startsWith("@") ? filter.mention : `@${filter.mention}`;
        const hasDirect = m.mentions.includes(target) || m.mentions.includes("@all");
        const mentionsInText = m.content.includes(target);
        if (!hasDirect && !mentionsInText) return false;
      }
      return true;
    });
  }

  getThread(messageId: string): InterAgentMessage[] {
    const root = this.messages.find((m) => m.id === messageId);
    if (!root) return [];
    const thread: InterAgentMessage[] = [root];
    const queue: string[] = [root.id];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const replies = this.messages.filter((m) => m.replyToId === currentId && !thread.some((t) => t.id === m.id));
      for (const reply of replies) {
        thread.push(reply);
        queue.push(reply.id);
      }
    }
    return thread.sort((a, b) => a.sequence - b.sequence);
  }

  writeBlackboard(key: string, value: string, author: string, category: BlackboardEntry["category"]): BlackboardEntry {
    const existing = this.blackboard.get(key);
    const entry: BlackboardEntry = {
      key,
      author,
      updatedAt: new Date().toISOString(),
      category,
      value,
      version: (existing?.version ?? 0) + 1,
    };
    this.blackboard.set(key, entry);
    for (const listener of this.blackboardListeners) {
      try {
        listener(entry);
      } catch (err) {
        console.error("Blackboard listener error:", err);
      }
    }
    return entry;
  }

  readBlackboard(key: string): BlackboardEntry | null {
    return this.blackboard.get(key) ?? null;
  }

  getBlackboard(): BlackboardEntry[] {
    return Array.from(this.blackboard.values());
  }

  clear(): void {
    this.messages = [];
    this.blackboard.clear();
    this.seqCounter = 0;
  }
}

export const globalAgentBus = new InterAgentMessageBus();
