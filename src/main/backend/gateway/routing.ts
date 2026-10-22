/**
 * Moon Gateway — route resolution.
 *
 * Ported from ExternalAgent's routing/resolve-route.ts: an inbound message is
 * matched against the configured bindings, the most specific match wins, and the
 * match decides both the agent and the session key.
 */
import {
  buildAgentSessionKey,
  normalizeAccountId,
  normalizeLowercaseStringOrEmpty,
  sanitizeAgentId,
  DEFAULT_AGENT_ID,
} from "./sessionKey";
import type {
  AgentConfig,
  DmScope,
  GroupScope,
  ResolvedAgentRoute,
  RouteBinding,
  RoutePeer,
} from "./types";

export type ResolveAgentRouteInput = {
  channel: string;
  accountId?: string | null;
  peer: RoutePeer;
  agents: AgentConfig[];
  bindings: RouteBinding[];
  dmScope?: DmScope;
  groupScope?: GroupScope;
  identityLinks?: Record<string, string[]>;
};

function bindingScore(binding: RouteBinding, input: ResolveAgentRouteInput): number {
  const channel = normalizeLowercaseStringOrEmpty(input.channel);
  const account = normalizeLowercaseStringOrEmpty(input.accountId);
  const peer = normalizeLowercaseStringOrEmpty(input.peer.id);
  const bChannel = normalizeLowercaseStringOrEmpty(binding.channel);
  const bAccount = normalizeLowercaseStringOrEmpty(binding.accountId);
  const bPeer = normalizeLowercaseStringOrEmpty(binding.peerId);
  const bKind = binding.peerKind;

  if (bChannel && bChannel !== channel) return -1;
  if (bAccount && bAccount !== account) return -1;
  if (bPeer && bPeer !== peer) return -1;
  if (bKind && bKind !== input.peer.kind) return -1;

  // More specific bindings score higher.
  let score = binding.priority ?? 0;
  if (bPeer) score += 100;
  if (bKind) score += 50;
  if (bAccount) score += 25;
  if (bChannel) score += 10;
  return score;
}

/** The fallback agent: the first enabled one, or the default. */
export function pickFirstExistingAgentId(agents: AgentConfig[], requested?: string): string {
  if (requested) {
    const found = agents.find((a) => a.id === sanitizeAgentId(requested) && a.enabled !== false);
    if (found) return found.id;
  }
  const first = agents.find((a) => a.enabled !== false);
  return first ? first.id : DEFAULT_AGENT_ID;
}

/**
 * Resolve an inbound message to an agent and a session.
 */
export function resolveAgentRoute(input: ResolveAgentRouteInput): ResolvedAgentRoute {
  const channel = normalizeLowercaseStringOrEmpty(input.channel) || "unknown";
  const accountId = normalizeAccountId(input.accountId);

  let best: RouteBinding | null = null;
  let bestScore = -1;
  let matchedBy: ResolvedAgentRoute["matchedBy"] = "default";

  for (const binding of input.bindings || []) {
    const score = bindingScore(binding, input);
    if (score < 0) continue;
    if (score > bestScore) {
      bestScore = score;
      best = binding;
      const bPeer = normalizeLowercaseStringOrEmpty(binding.peerId);
      const bAccount = normalizeLowercaseStringOrEmpty(binding.accountId);
      const bChannel = normalizeLowercaseStringOrEmpty(binding.channel);
      matchedBy = bPeer
        ? "binding.peer"
        : bAccount
          ? "binding.account"
          : bChannel
            ? "binding.channel"
            : "default";
    }
  }

  const agentId = best ? best.agentId : pickFirstExistingAgentId(input.agents);
  const isGroup = best?.peerKind === "group" || input.peer.kind === "group";
  const dmScope: DmScope | undefined = isGroup ? undefined : (input.dmScope ?? "main");
  const groupScope: GroupScope | undefined = isGroup ? (input.groupScope ?? "per-group") : input.groupScope;

  const sessionKey = buildAgentSessionKey({
    agentId,
    channel,
    accountId,
    peer: input.peer,
    dmScope,
    groupScope,
    identityLinks: input.identityLinks,
  });

  const mainSessionKey = buildAgentSessionKey({
    agentId,
    channel,
    accountId,
    peer: { kind: "direct", id: "" },
    dmScope: "main",
    groupScope: "main",
  });

  return {
    agentId: sanitizeAgentId(agentId),
    channel,
    accountId,
    dmScope,
    groupScope,
    sessionKey,
    mainSessionKey,
    lastRoutePolicy: dmScope === "main" ? "main" : "session",
    matchedBy,
  };
}

/** Every group binding that is currently in effect. */
export function listEffectiveGroupRouteBindings(bindings: RouteBinding[]): RouteBinding[] {
  return (bindings || []).filter((b) => b.peerKind === "group");
}
