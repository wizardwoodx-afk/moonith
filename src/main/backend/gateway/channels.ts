/**
 * Moon Gateway — channels.
 *
 * Ported from OpenClaw's channels/plugins/types.adapters.ts. OpenClaw defines a
 * dozen narrow adapter interfaces (auth, status, secrets, heartbeat, directory,
 * allowlist, approval…); Seamoon keeps one adapter with optional capabilities,
 * which is what a native desktop gateway actually needs.
 */
import type { ChannelAdapter, ChannelStatus, InboundMessage, OutboundMessage } from "./types";

export type ChannelRegistry = {
  register(adapter: ChannelAdapter): void;
  get(id: string): ChannelAdapter | undefined;
  list(): ChannelAdapter[];
  remove(id: string): boolean;
  status(): Promise<ChannelStatus[]>;
};

export function createChannelRegistry(): ChannelRegistry {
  const adapters = new Map<string, ChannelAdapter>();
  return {
    register(adapter) {
      adapters.set(adapter.id, adapter);
    },
    get(id) {
      return adapters.get(id);
    },
    list() {
      return [...adapters.values()];
    },
    remove(id) {
      return adapters.delete(id);
    },
    async status() {
      const out: ChannelStatus[] = [];
      for (const adapter of adapters.values()) {
        if (adapter.status) {
          out.push(await adapter.status());
          continue;
        }
        out.push({
          id: adapter.id,
          name: adapter.name,
          connected: true,
          linkState: adapter.requiresAuth ? "unknown" : "linked",
          accounts: [],
        });
      }
      return out;
    },
  };
}

/**
 * The built-in channel: a local HTTP endpoint other programs (or the
 * companion mobile app) can post to. This is Seamoon's own "send a message to
 * the agent" surface — no third-party service involved.
 */
export type WebhookChannel = ChannelAdapter & {
  /** Called by the gateway's HTTP layer when a message arrives. */
  deliver(message: Omit<InboundMessage, "messageId" | "receivedAt">): InboundMessage;
};

export function createWebhookChannel(opts: { id?: string; name?: string; onMessage: (m: InboundMessage) => void }): WebhookChannel {
  const id = opts.id ?? "webhook";
  let handler: ((m: InboundMessage) => void) | null = null;
  return {
    id,
    name: opts.name ?? "Local webhook",
    requiresAuth: false,
    supportsInbound: true,
    onMessage(h) {
      handler = h;
    },
    /** Called by the gateway's HTTP layer when a message arrives. */
    deliver(message: Omit<InboundMessage, "messageId" | "receivedAt">) {
      const full: InboundMessage = {
        ...message,
        messageId: `msg_${Date.now().toString(36)}`,
        receivedAt: Date.now(),
      };
      handler?.(full);
      return full;
    },
    async send(_message: OutboundMessage) {
      // The webhook channel is inbound-only.
    },
    async status(): Promise<ChannelStatus> {
      return { id, name: opts.name ?? "Local webhook", connected: true, linkState: "linked", accounts: [] };
    },
  } satisfies WebhookChannel;
}

/**
 * A channel that writes to the log — used for the desktop's own surface, and
 * to make the gateway testable without any external service.
 */
export function createConsoleChannel(id = "console", name = "Console"): ChannelAdapter {
  const sent: OutboundMessage[] = [];
  return {
    id,
    name,
    requiresAuth: false,
    supportsInbound: true,
    onMessage() {},
    async send(message) {
      sent.push(message);
      // eslint-disable-next-line no-console
      console.log(`[${id}] → ${message.text}`);
    },
    async status(): Promise<ChannelStatus> {
      return { id, name, connected: true, linkState: "linked", accounts: [] };
    },
  };
}
