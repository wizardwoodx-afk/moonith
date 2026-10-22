/**
 * Moon Gateway — session keys.
 *
 * Ported from OpenClaw's routing/session-key.ts. A session key is the identity
 * a conversation is persisted under; it encodes the agent, the channel, the
 * account and the peer, plus the scope that decides how direct messages
 * collapse onto shared sessions.
 */
import type { ChatType, DmScope, GroupScope, RoutePeer } from "./types";

export const DEFAULT_AGENT_ID = "main";
export const DEFAULT_MAIN_KEY = "main";

export function normalizeLowercaseStringOrEmpty(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeAccountId(value: string | null | undefined): string {
  const v = normalizeLowercaseStringOrEmpty(value);
  return v || "default";
}

/** Agent ids are lowercase, hyphenated and bounded. */
export function sanitizeAgentId(value: string | null | undefined): string {
  const v = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return v || DEFAULT_AGENT_ID;
}

export function buildAgentMainSessionKey(params: { agentId: string; mainKey?: string }): string {
  return `agent:${sanitizeAgentId(params.agentId)}:${params.mainKey || DEFAULT_MAIN_KEY}`;
}

/**
 * The key for a peer conversation.
 *
 *   agent:<agent>:<channel>:<account>:direct:<peer>   (per-account-channel-peer)
 *   agent:<agent>:<channel>:direct:<peer>           (per-channel-peer)
 *   agent:<agent>:direct:<peer>                      (per-peer)
 *   agent:<agent>:main                               (main)
 */
export function buildAgentPeerSessionKey(params: {
  agentId: string;
  mainKey?: string;
  channel: string;
  accountId?: string | null;
  peerKind?: ChatType | null;
  peerId?: string | null;
  identityLinks?: Record<string, string[]>;
  dmScope?: DmScope;
  groupScope?: GroupScope;
}): string {
  const peerKind = params.peerKind ?? "direct";
  const agentId = sanitizeAgentId(params.agentId);

  if (peerKind === "direct") {
    const dmScope = params.dmScope ?? "main";
    let peerId = (params.peerId ?? "").trim();
    const linked = resolveLinkedDirectPeerId({
      identityLinks: params.identityLinks,
      channel: params.channel,
      peerId,
    });
    if (linked) peerId = linked;
    peerId = normalizeLowercaseStringOrEmpty(peerId);

    if (dmScope === "per-account-channel-peer" && peerId) {
      const channel = normalizeLowercaseStringOrEmpty(params.channel) || "unknown";
      return `agent:${agentId}:${channel}:${normalizeAccountId(params.accountId)}:direct:${peerId}`;
    }
    if (dmScope === "per-channel-peer" && peerId) {
      const channel = normalizeLowercaseStringOrEmpty(params.channel) || "unknown";
      return `agent:${agentId}:${channel}:direct:${peerId}`;
    }
    if (dmScope === "per-peer" && peerId) {
      return `agent:${agentId}:direct:${peerId}`;
    }
    return buildAgentMainSessionKey({ agentId, mainKey: params.mainKey });
  }

  if ((params.groupScope ?? "main") === "main") {
    return buildAgentMainSessionKey({ agentId, mainKey: params.mainKey });
  }
  const channel = normalizeLowercaseStringOrEmpty(params.channel) || "unknown";
  const peerId = normalizeLowercaseStringOrEmpty(params.peerId) || "unknown";
  return `agent:${agentId}:${channel}:${peerKind}:${peerId}`;
}

/** The key for a routed peer, taking the route scopes into account. */
export function buildAgentSessionKey(params: {
  agentId: string;
  mainKey?: string;
  channel: string;
  accountId?: string | null;
  peer?: RoutePeer | null;
  dmScope?: DmScope;
  groupScope?: GroupScope;
  identityLinks?: Record<string, string[]>;
}): string {
  return buildAgentPeerSessionKey({
    agentId: params.agentId,
    mainKey: params.mainKey ?? DEFAULT_MAIN_KEY,
    channel: normalizeLowercaseStringOrEmpty(params.channel) || "unknown",
    accountId: params.accountId,
    peerKind: params.peer?.kind ?? "direct",
    peerId: params.peer ? normalizeLowercaseStringOrEmpty(params.peer.id) || "unknown" : null,
    dmScope: params.dmScope,
    groupScope: params.groupScope,
    identityLinks: params.identityLinks,
  });
}

/** Which agent owns a session key. */
export function resolveAgentIdFromSessionKey(key: string | undefined | null): string | undefined {
  if (!key) return undefined;
  const m = /^agent:([^:]+):/.exec(key);
  return m ? sanitizeAgentId(m[1]) : undefined;
}

/** The shape of a session key, for the session list. */
export function classifySessionKeyShape(key: string | undefined | null): "main" | "direct" | "group" | "channel" {
  if (!key) return "main";
  const parts = key.split(":");
  if (parts.length <= 3) return "main";
  const kind = parts[parts.length - 2];
  if (kind === "direct") return "direct";
  if (kind === "group") return "group";
  return "channel";
}

/** Identity links collapse the same person across channels. */
export function resolveLinkedDirectPeerId(params: {
  identityLinks?: Record<string, string[]>;
  channel: string;
  peerId: string;
}): string | null {
  const links = params.identityLinks || {};
  const key = `${normalizeLowercaseStringOrEmpty(params.channel)}:${params.peerId}`;
  const linked = links[key] || links[params.peerId];
  if (!linked || !linked.length) return null;
  return linked[0];
}

/** A group history key, used to share context inside one group. */
export function buildGroupHistoryKey(params: { agentId: string; channel: string; groupId: string }): string {
  return `agent:${sanitizeAgentId(params.agentId)}:${normalizeLowercaseStringOrEmpty(params.channel)}:group:${normalizeLowercaseStringOrEmpty(params.groupId)}`;
}

/** The store key for a session (the key plus its agent scope). */
export function toAgentStoreSessionKey(params: { agentId: string; sessionKey: string }): string {
  return `agent:${sanitizeAgentId(params.agentId)}:${params.sessionKey}`;
}
