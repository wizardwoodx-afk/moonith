/**
 * Moon Gateway — the native desktop gateway.
 *
 * This is this app's own implementation of the external-agent gateway concept: a
 * local service that receives messages from channels, routes each one to an
 * agent, runs the turn through ImpulseCore, and sends the reply back out. It
 * runs inside this app's main process — no CLI, no external service.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createChannelRegistry, createConsoleChannel, createWebhookChannel } from "./channels";
import { resolveAgentRoute } from "./routing";
import { buildAgentMainSessionKey, sanitizeAgentId } from "./sessionKey";
import { GatewayStore } from "./store";
import { nextRunAt } from "./automations";
import type {
  AgentConfig,
  ChannelAdapter,
  ChannelStatus,
  CronJob,
  InboundMessage,
  OutboundMessage,
  ResolvedAgentRoute,
  RouteBinding,
  SessionRecord,
  SessionTurn,
} from "./types";

export type TurnRunner = (input: {
  agentId: string;
  sessionKey: string;
  text: string;
  history: SessionTurn[];
}) => Promise<string>;

export type GatewayOptions = {
  storeFile: string;
  /** Runs one agent turn. */
  runTurn?: TurnRunner;
  /** The port the local HTTP surface listens on. 0 picks a free port. */
  port?: number;
  host?: string;
  /** Bearer token every request must carry. */
  token?: string;
  /** Called when a request is refused, for logging. */
  onDenied?: (reason: string) => void;
};

export class MoonGateway {
  readonly store: GatewayStore;
  readonly channels = createChannelRegistry();
  private runner: TurnRunner;
  private server: { close(cb?: () => void): void } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private host: string;
  private requestedPort: number;
  private token: string;
  private onDenied: ((reason: string) => void) | undefined;
  readonly webhook: ChannelAdapter;

  constructor(options: GatewayOptions) {
    this.store = new GatewayStore(options.storeFile);
    this.runner = options.runTurn ?? noopTurnRunner;
    this.host = options.host ?? "127.0.0.1";
    this.requestedPort = options.port ?? 0;
    this.token = options.token ?? "";
    this.onDenied = options.onDenied;

    this.webhook = createWebhookChannel({
      onMessage: (message) => {
        void this.handleInbound(message);
      },
    });
    this.channels.register(this.webhook);
    this.channels.register(createConsoleChannel());

    // A gateway with no agents still needs one to route to.
    if (!this.store.get().agents.length) {
      this.store.upsertAgent({
        id: "main",
        name: "SelfImpulse",
        enabled: true,
        createdAt: Date.now(),
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Agents, bindings                                                   */
  /* ---------------------------------------------------------------- */

  agents(): AgentConfig[] {
    return this.store.get().agents;
  }

  upsertAgent(agent: Partial<AgentConfig> & { name: string }): AgentConfig {
    const id = sanitizeAgentId(agent.id);
    const existing = this.store.get().agents.find((a) => a.id === id);
    const next: AgentConfig = {
      id,
      name: agent.name,
      workspace: agent.workspace ?? existing?.workspace,
      model: agent.model ?? existing?.model,
      enabled: agent.enabled ?? existing?.enabled ?? true,
      createdAt: existing?.createdAt ?? Date.now(),
    };
    this.store.upsertAgent(next);
    return next;
  }

  removeAgent(id: string) {
    this.store.removeAgent(sanitizeAgentId(id));
  }

  bindings(): RouteBinding[] {
    return this.store.get().bindings;
  }

  upsertBinding(binding: Partial<RouteBinding> & { agentId: string }): RouteBinding {
    const next: RouteBinding = {
      id: binding.id ?? `bind_${Date.now().toString(36)}`,
      agentId: sanitizeAgentId(binding.agentId),
      channel: binding.channel ?? "webhook",
      accountId: binding.accountId,
      peerKind: binding.peerKind,
      peerId: binding.peerId,
      priority: binding.priority ?? 0,
    };
    this.store.upsertBinding(next);
    return next;
  }

  removeBinding(id: string) {
    this.store.removeBinding(id);
  }

  /* ---------------------------------------------------------------- */
  /* Routing and turns                                                 */
  /* ---------------------------------------------------------------- */

  route(message: InboundMessage): ResolvedAgentRoute {
    const state = this.store.get();
    return resolveAgentRoute({
      channel: message.channel,
      accountId: message.accountId,
      peer: message.peer,
      agents: state.agents,
      bindings: state.bindings,
      identityLinks: (state.channelConfig.identityLinks as Record<string, string[]>) || undefined,
    });
  }

  /** Receive a message, run the turn, deliver the reply. */
  async handleInbound(message: InboundMessage): Promise<{ route: ResolvedAgentRoute; reply: string } | null> {
    const route = this.route(message);
    const session = this.ensureSession(route, message);
    const reply = await this.runner({
      agentId: route.agentId,
      sessionKey: route.sessionKey,
      text: message.text,
      history: session.turns,
    });
    this.appendTurn(session, { role: "user", text: message.text });
    this.appendTurn(session, { role: "assistant", text: reply });

    const outbound: OutboundMessage = {
      channel: route.channel,
      accountId: route.accountId,
      peer: message.peer,
      text: reply,
    };
    const adapter = this.channels.get(route.channel);
    if (adapter) await adapter.send(outbound);
    return { route, reply };
  }

  private ensureSession(route: ResolvedAgentRoute, message: InboundMessage): SessionRecord {
    const existing = this.store.session(route.sessionKey);
    if (existing) return existing;
    const session: SessionRecord = {
      key: route.sessionKey,
      agentId: route.agentId,
      channel: route.channel,
      accountId: route.accountId,
      peer: message.peer,
      title: message.text.slice(0, 60),
      turns: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.store.putSession(session);
    return session;
  }

  private appendTurn(session: SessionRecord, turn: { role: "user" | "assistant"; text: string }) {
    const full: SessionTurn = {
      id: `turn_${Date.now().toString(36)}`,
      kind: "visible",
      phase: "completed",
      role: turn.role,
      text: turn.text,
      at: Date.now(),
    };
    this.store.putSession({ ...session, turns: [...session.turns, full], updatedAt: Date.now() });
  }

  sessions(): SessionRecord[] {
    return [...this.store.get().sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /* ---------------------------------------------------------------- */
  /* Automations                                                       */
  /* ---------------------------------------------------------------- */

  automations(): CronJob[] {
    return this.store.get().automations;
  }

  upsertAutomation(job: Partial<CronJob> & { prompt: string }): CronJob {
    const id = job.id ?? `job_${Date.now().toString(36)}`;
    const existing = this.store.get().automations.find((j) => j.id === id);
    const next: CronJob = {
      id,
      agentId: sanitizeAgentId(job.agentId ?? existing?.agentId ?? "main"),
      sessionKey: job.sessionKey ?? existing?.sessionKey ?? buildAgentMainSessionKey({ agentId: job.agentId ?? "main" }),
      prompt: job.prompt,
      schedule: job.schedule ?? existing?.schedule ?? "0 9 * * *",
      enabled: job.enabled ?? existing?.enabled ?? true,
      family: job.family ?? existing?.family,
      lastRunAt: existing?.lastRunAt,
      nextRunAt: existing?.nextRunAt,
      lastStatus: existing?.lastStatus,
      createdAt: existing?.createdAt ?? Date.now(),
    };
    const jobs = [...this.store.get().automations];
    const i = jobs.findIndex((j) => j.id === id);
    if (i === -1) jobs.push(next);
    else jobs[i] = next;
    this.store.setAutomations(jobs);
    this.reschedule();
    return next;
  }

  removeAutomation(id: string) {
    this.store.setAutomations(this.store.get().automations.filter((j) => j.id !== id));
    this.reschedule();
  }

  /** Recompute the next-run time for every job. */
  reschedule() {
    const now = new Date();
    const jobs = this.store.get().automations.map((j) => ({ ...j, nextRunAt: nextRunAt(j, now) }));
    this.store.setAutomations(jobs);
  }

  /** The scheduler tick — runs every job that is due. */
  async tick(): Promise<CronJob[]> {
    const now = Date.now();
    const due = this.store.get().automations.filter((j) => j.enabled && j.nextRunAt && j.nextRunAt <= now);
    for (const job of due) {
      try {
        const reply = await this.runner({
          agentId: job.agentId,
          sessionKey: job.sessionKey,
          text: job.prompt,
          history: [],
        });
        this.store.setAutomations(
          this.store.get().automations.map((j) =>
            j.id === job.id
              ? { ...j, lastRunAt: now, lastStatus: "ok", nextRunAt: nextRunAt(j, new Date(now + 1000)) }
              : j,
          ),
        );
        this.emit("gateway:automation", { job: job.id, ok: true, reply: reply.slice(0, 200) });
      } catch (err) {
        this.store.setAutomations(
          this.store.get().automations.map((j) =>
            j.id === job.id
              ? { ...j, lastRunAt: now, lastStatus: "failed", nextRunAt: nextRunAt(j, new Date(now + 1000)) }
              : j,
          ),
        );
        this.emit("gateway:automation", { job: job.id, ok: false, error: String(err) });
      }
    }
    return due;
  }

  /* ---------------------------------------------------------------- */
  /* Channels                                                          */
  /* ---------------------------------------------------------------- */

  registerChannel(adapter: ChannelAdapter) {
    this.channels.register(adapter);
    adapter.onMessage?.((message) => {
      void this.handleInbound(message);
    });
  }

  async channelStatus(): Promise<ChannelStatus[]> {
    return this.channels.status();
  }

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                         */
  /* ---------------------------------------------------------------- */

  private emit(event: string, payload: unknown) {
    this.emitter?.(event, payload);
  }

  emitter: ((event: string, payload: unknown) => void) | null = null;

  start(): Promise<{ port: number; url: string }> {
    if (this.server) return Promise.resolve(this.address());
    return new Promise((resolve, reject) => {
      const server = createServer((req: IncomingMessage, res: ServerResponse) =>
        this.handleHttp(req as unknown as HttpRequest, res as unknown as HttpResponse),
      );
      server.on("error", reject);
      server.listen(this.requestedPort, this.host, () => {
        this.server = server;
        this.reschedule();
        this.timer = setInterval(() => void this.tick(), 30_000);
        if (typeof this.timer.unref === "function") this.timer.unref();
        resolve(this.address());
      });
    });
  }

  address() {
    const addr = this.server && (this.server as unknown as { address(): { port: number } }).address();
    const port = typeof addr === "object" && addr ? addr.port : this.requestedPort;
    return { port, url: `http://${this.host}:${port}` };
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }
  }

  /* ---------------------------------------------------------------- */
  /* The local HTTP surface                                             */
  /* ---------------------------------------------------------------- */

  private async handleHttp(req: HttpRequest, res: HttpResponse) {
    const url = new URL(req.url || "/", `http://${this.host}`);
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    try {
      // 1. the Host header must be loopback — this blocks DNS rebinding, where a
      //    remote page resolves its own name to 127.0.0.1 and talks to us.
      const host = String(req.headers?.host || "").split(":")[0].toLowerCase();
      if (host && !["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
        this.onDenied?.(`bad host: ${host}`);
        return json(403, { error: "forbidden" });
      }

      // 2. every request carries the per-install bearer token
      const auth = String(req.headers?.authorization || "");
      if (this.token) {
        const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
        const expected = this.token;
        const ok =
          presented.length === expected.length &&
          presented.length > 0 &&
          timingSafeEqual(presented, expected);
        if (!ok) {
          this.onDenied?.("bad token");
          return json(401, { error: "unauthorized" });
        }
      }

      if (url.pathname === "/health") return json(200, { ok: true, ...this.address() });

      if (url.pathname === "/agents" && req.method === "GET") {
        return json(200, { agents: this.agents() });
      }
      if (url.pathname === "/agents" && req.method === "POST") {
        const body = await readBody(req);
        return json(200, { agent: this.upsertAgent(body) });
      }

      if (url.pathname === "/bindings" && req.method === "GET") {
        return json(200, { bindings: this.bindings() });
      }
      if (url.pathname === "/bindings" && req.method === "POST") {
        const body = await readBody(req);
        return json(200, { binding: this.upsertBinding(body) });
      }

      if (url.pathname === "/channels" && req.method === "GET") {
        return json(200, { channels: await this.channelStatus() });
      }

      if (url.pathname === "/sessions" && req.method === "GET") {
        return json(200, { sessions: this.sessions() });
      }

      if (url.pathname === "/automations" && req.method === "GET") {
        return json(200, { automations: this.automations() });
      }
      if (url.pathname === "/automations" && req.method === "POST") {
        const body = await readBody(req);
        return json(200, { automation: this.upsertAutomation(body) });
      }

      if (url.pathname === "/messages" && req.method === "POST") {
        const body = await readBody(req);
        const message: InboundMessage = {
          messageId: `msg_${Date.now().toString(36)}`,
          channel: body.channel || "webhook",
          accountId: body.accountId || "default",
          peer: { kind: body.peerKind || "direct", id: String(body.peerId || "local") },
          text: String(body.text || ""),
          receivedAt: Date.now(),
        };
        const result = await this.handleInbound(message);
        return json(200, { ok: true, route: result?.route, reply: result?.reply });
      }

      return json(404, { error: "not found" });
    } catch (err) {
      return json(500, { error: String(err) });
    }
  }
}

type HttpRequest = {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  [Symbol.asyncIterator](): AsyncIterator<Buffer>;
  [key: string]: unknown;
};
type HttpResponse = { writeHead(code: number, headers: Record<string, string>): void; end(body?: string): void };

/** Constant-time comparison, so a token cannot be guessed by timing. */
function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readBody(req: HttpRequest): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** The fallback turn runner, used when the gateway is built without one. */
const noopTurnRunner: TurnRunner = async () => "";

export { createChannelRegistry, createWebhookChannel, createConsoleChannel } from "./channels";
export { resolveAgentRoute, pickFirstExistingAgentId } from "./routing";
export { buildAgentSessionKey, buildAgentPeerSessionKey, sanitizeAgentId } from "./sessionKey";
export { GatewayStore, emptyState } from "./store";
export { matchesCron, nextRunAt, fingerprintCronJobRows } from "./automations";
export * from "./types";
