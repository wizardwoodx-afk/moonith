/**
 * Moon Gateway — the native desktop replacement for the ExternalAgent gateway.
 *
 * The contracts below are ported from the ExternalAgent source (MIT):
 *   routing/session-key.ts              → sessionKey.ts
 *   routing/resolve-route.ts            → routing.ts
 *   channels/plugins/types.adapters.ts   → channels.ts
 *   cron/store/row-codec.ts             → automations.ts
 *   sessions/session-controller.contracts.ts → types.ts
 *
 * Unlike ExternalAgent, nothing here shells out: the gateway runs inside this app's
 * own process, talks to ImpulseCore directly, and persists to the local store.
 */

/** A conversation is either a direct chat, a group, or a named channel. */
export type ChatType = "direct" | "group" | "channel";

/** How direct messages collapse onto a session. */
export type DmScope = "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer";

/** How group chats collapse onto a session. */
export type GroupScope = "main" | "per-group";

export type RoutePeer = {
  kind: ChatType;
  id: string;
};

/** The agent a binding sends work to. */
export type AgentConfig = {
  id: string;
  name: string;
  workspace?: string;
  model?: string;
  enabled: boolean;
  createdAt: number;
};

/** A binding: route a channel/account/peer to an agent. */
export type RouteBinding = {
  id: string;
  agentId: string;
  channel: string;
  accountId?: string;
  peerKind?: ChatType;
  peerId?: string;
  priority: number;
};

export type ResolvedAgentRoute = {
  agentId: string;
  channel: string;
  accountId: string;
  dmScope?: DmScope;
  groupScope?: GroupScope;
  /** The internal key used for persistence and concurrency. */
  sessionKey: string;
  /** The alias used when direct chats collapse onto one session. */
  mainSessionKey: string;
  /** Which session receives inbound last-route updates. */
  lastRoutePolicy: "main" | "session";
  /** How the route was matched — useful for debugging. */
  matchedBy:
    | "binding.peer"
    | "binding.peer.parent"
    | "binding.peer.wildcard"
    | "binding.account"
    | "binding.channel"
    | "default";
};

export type InboundMessage = {
  messageId: string;
  channel: string;
  accountId: string;
  peer: RoutePeer;
  text: string;
  attachments?: { name: string; mime?: string }[];
  receivedAt: number;
};

export type OutboundMessage = {
  channel: string;
  accountId: string;
  peer?: RoutePeer;
  text: string;
};

/** The link state of a channel account, as ExternalAgent models it. */
export type ChannelAccountLinkState = "linked" | "not-linked" | "unknown";

export type ChannelStatus = {
  id: string;
  name: string;
  connected: boolean;
  linkState: ChannelAccountLinkState;
  detail?: string;
  accounts: { id: string; linked: boolean; label?: string }[];
};

/**
 * A channel adapter. ExternalAgent splits this across many narrow interfaces
 * (auth, status, secrets, heartbeat, directory, allowlist, approval); the earlier shell
 * keeps one adapter with optional capabilities, which is enough for a native
 * desktop gateway.
 */
export type ChannelAdapter = {
  id: string;
  name: string;
  /** Does this channel need credentials before it can send? */
  requiresAuth: boolean;
  /** Can it receive inbound messages? */
  supportsInbound: boolean;
  connect?(): Promise<void>;
  disconnect?(): Promise<void>;
  send(message: OutboundMessage): Promise<void>;
  status?(): Promise<ChannelStatus>;
  /** Inbound messages arrive here. */
  onMessage?(handler: (message: InboundMessage) => void): void;
};

export type ReplyTurnKind = "visible" | "heartbeat" | "queued_followup";

export type ReplyOperationPhase = "active" | "completed" | "failed" | "aborted";

export type SessionTurn = {
  id: string;
  kind: ReplyTurnKind;
  phase: ReplyOperationPhase;
  role: "user" | "assistant";
  text: string;
  at: number;
};

export type SessionRecord = {
  key: string;
  agentId: string;
  channel: string;
  accountId: string;
  peer?: RoutePeer;
  title: string;
  turns: SessionTurn[];
  createdAt: number;
  updatedAt: number;
};

export type CronJob = {
  id: string;
  agentId: string;
  sessionKey: string;
  prompt: string;
  /** A five-field cron expression, or an interval in seconds. */
  schedule: string;
  enabled: boolean;
  /** Groups a family of jobs so a family can be replaced as a unit. */
  family?: string;
  lastRunAt?: number;
  nextRunAt?: number;
  lastStatus?: "ok" | "failed";
  createdAt: number;
};
