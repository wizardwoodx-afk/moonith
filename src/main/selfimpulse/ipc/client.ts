import type {
  Connection,
  DataType,
  ExecutionEventRecord,
  ExecutionRecord,
  ExecutionStats,
  McpServerEntry,
  MemoryRecord,
  RolePrompt,
  SkillRecord,
  WorkflowGraph,
  WorkflowRecord,
} from "../domain/types";
import { detectHost, electronInfo, electronSecretBridge, electronSurface } from "../app/desktop";
import { can, describeHost, refusal } from "./hostCapabilities";
import { checkEgressUrl } from "../security/guardrail";
import { validateWorkflow } from "../graph/validation";
import { safeEgressFetch } from "../security/egressNet";
import { ENGINE_VERSION } from "../version";
import { localDb } from "./localDb";

/**
 * The command contract this client speaks, in ONE table.
 *
 * It is a contract with NO TRANSPORT. These were the Tauri/Rust command names; that shell is gone
 * from the frontend, no generic `invoke` is left to call, and the live native path is the Electron
 * bridge's list of NAMED preload methods. What the table still earns its keep on: the shapes the
 * seams that DO exist return (the Electron bridge and localDb), and the shape each verb refused by
 * `noChannel` would have produced — so a refusal names a real payload rather than a vague "unavailable".
 *
 * Why a table at all. Before this existed, `tauriInvoke` was generic over a type nobody supplied:
 * 72 of 82 call sites inferred `T = unknown`, so a mistyped command name, a renamed Rust command,
 * or a changed return shape all compiled clean and failed at runtime — in the one environment (the
 * desktop build) the probe suites never touched, because they ran with `useTauri() === false`. Both
 * of those functions have since been deleted; the shapes outlived them.
 *
 * What changed with them: a wrong command NAME is no longer a compile error, because there is no
 * call site left to type a name into — `noChannel` takes a plain string and only quotes it. What
 * still binds is the indexed lookups (`NativeCommands["exec_grant_request"]`, …): reading a field
 * this table has not modelled remains a compile error.
 *
 * Honesty about precision: the entries typed `Json` were `serde_json::Value` on the Rust side.
 * Nothing has modelled their shape and this table does not pretend otherwise — they are typed as
 * "some JSON", not as a specific record wearing a type it has not earned. The precise entries are
 * the ones the frontend already declares AND both live paths (the Electron bridge and localDb)
 * agree on.
 */
type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

/** Result of one CLI probe: what the app resolved for each bin in this shell's PATH. */
export interface CliEnvReport {
  path: string;
  searched: string[];
  bins: Array<{ id: string; bin: string; executable: string | null; installed: boolean; version: string | null }>;
}

/**
 * The shape `mcp_server_save` accepts.
 *
 * This is deliberately NOT `McpServerEntry`. `McpServerEntry` is the post-save READ shape, where
 * the command lives at `config.command`. The Rust save command also accepted the flat WRITE shape —
 * `command`, `args`, `enabled`, `pinned` at the top level — because `db::mcp_save` lifted them into
 * `config` itself when no `config` key was present (src-tauri/src/db.rs:444 — the command this shape
 * was written against; no client verb reaches it now, `ipc.mcpServerSave` goes to localDb).
 * `McpPage` still sends the flat form, and `mcp_connect_test` read it back at `/config/command`.
 *
 * Typing this as `McpServerEntry` would have been a lie that only survived because the parameter
 * used to be `Record<string, unknown>`.
 */
export type McpServerSaveInput = Partial<McpServerEntry> & {
  name: string;
  command?: string | null;
  args?: string[] | null;
  enabled?: boolean;
  pinned?: boolean;
  /** May the sandboxed server reach the network? Default true (MCP servers are network clients); false = none at all. Part of what a human approves. */
  network?: boolean;
};

interface NativeCommands {
  /** Federation lifecycle — supervised children, not timed-out commands. */
  a2a_host_start: Record<string, unknown>;
  a2a_host_status: Record<string, unknown>;
  a2a_host_stop: Record<string, unknown>;
  app_info: Record<string, unknown>;
  approval_authorize: Json;
  approval_decide: null;
  approval_get: Json;
  approval_list: Json;
  approval_request: Json;
  browser_act: Json;
  browser_console: Json;
  browser_navigate: Json;
  browser_screenshot: Json;
  browser_session_close: Json;
  browser_session_create: Json;
  browser_sessions: Json;
  // Retained under its historical name: it now reports the DEV-TOOL allowlist
  // (node/npm/cargo/git/…), not agent CLIs. Renaming it is a wire change to
  // every caller and buys clarity we can get from the comment instead.
  cli_env: CliEnvReport;
  control_connect_ports: Connection;
  control_disconnect_ports: Json;
  control_list_nodes: Json;
  control_run_workflow: Json;
  control_validate_graph: Json;
  custom_harness_delete: Json;
  custom_harness_save: Json;
  db_maintenance: Json;
  dlq_add: Json;
  dlq_list: Json;
  dlq_resolve: null;
  evaluation_history: Json;
  evaluation_save: Json;
  event_emit: ExecutionEventRecord;
  evolution_decide: Json;
  evolution_list: Json;
  evolution_propose_save: Json;
  evolution_rollback: Json;
  evolution_service_health: Json;
  evolution_service_propose: Json;
  execution_create: { id: string };
  execution_events: ExecutionEventRecord[];
  execution_finish: null;
  execution_list: ExecutionRecord[];
  execution_trace: Json;
  feedback_add: Json;
  feedback_list: Json;
  fs_list: { ok: boolean; path?: string; entries: Array<{ name: string; path: string; dir: boolean }>; reason?: string };
  fs_mkdir: { ok: boolean; path?: string; reason?: string };
  fs_read: { ok: boolean; path?: string; content: string; bytesRead: number; reason?: string };
  fs_remove: { ok: boolean; path?: string; reason?: string };
  fs_write: { ok: boolean; path?: string; bytesWritten: number; reason?: string };
  git_branch: GitBranchResult;
  git_diff: GitDiffResult;
  git_head: GitHeadResult;
  git_is_repo: GitRepoResult;
  git_read_only_check: GitReadOnlyResult;
  git_status: GitStatusResult;
  hermes_bridge: Json;
  llm_chat: { content: string; model: string; usage: { input_tokens: number; output_tokens: number }; duration_ms: number };
  mcp_call: Json;
  mcp_connect_test: Json;
  mcp_server_list: McpServerEntry[];
  mcp_server_remove: null;
  mcp_server_save: { id: string; approved: boolean };
  memory_add: Json;
  memory_delete: null;
  memory_search: MemoryRecord[];
  node_state_load: Json;
  node_state_save: null;
  package_export: Json;
  package_import: Json;
  run_request_take: string[];
  secret_delete: null;
  secret_exists: Record<string, SecretStatus>;
  /**
   * Provider keys are NEVER returned (`value` is null, `redacted` true, `hint` is the last four
   * characters of a long key). Only signing keys (owner / issuer) come back as a value — a stated
   * residual until signing moves native. Any other reference is refused.
   *
   * `warning` is optional and additive: the Electron seam and the browser fallback use it to state
   * where the answer came from, which is the part a caller has to be able to repeat honestly.
   */
  secret_get: { ref: string; present: boolean; value: string | null; redacted?: boolean; hint?: string | null; warning?: string };
  exec_grant_request: { grant: string; workspace: string; network: boolean; programs: string[]; expiresAt: number };
  exec_grants_status: Array<{ workspace: string; network: boolean; programs: string[]; expiresAt: number; secondsLeft: number }>;
  exec_grants_revoke: { revoked: number };
  provider_bind_endpoint: { bound: boolean; origin: string; secretRef: string; alreadyBound?: boolean; reason?: string };
  provider_endpoints_list: Array<{ secretRef: string; origin: string; boundBy: string; boundAt: string }>;
  provider_unbind_endpoint: { unbound: boolean; secretRef: string; reason?: string };
  secret_set: { stored: boolean; location: "keychain" | "memory-only" | "browser-localStorage" | "absent"; survivesRestart: boolean; warning?: string };
  shell_exec: Json;
  skill_deactivate: null;
  skill_touch: Json;
  skill_upsert: Json;
  skills_list: { skills: SkillRecord[]; all: SkillRecord[] };
  suite_list: Json;
  suite_save: Json;
  workflow_create: { id: string };
  workflow_delete: null;
  workspace_root_add: { ok: boolean; path: string };
  workspace_root_list: { path: string; addedAt: string }[];
  workspace_root_remove: { ok: boolean; path: string };
  workflow_get: WorkflowRecord;
  workflow_list: WorkflowRecord[];
  workflow_save: null;
  workflow_version_create: Json;
  workflow_version_restore: Json;
  workflow_versions: Json;
}

/**
 * The refusal every verb that has no implementation on this host answers
 * with.
 *
 * It is still the honest answer for a host that genuinely cannot do the
 * thing — the browser edition has no filesystem, no subprocess and no
 * keychain. But it is NOT the answer for the desktop edition any more.
 *
 * WHAT CHANGED
 *
 * The Electron shell publishes NAMED preload methods for all of this work
 * (`fsRead`, `fsWrite`, `fsList`, `fsMkdir`, `fsRemove`, `gitStatus`,
 * `gitDiff`, `gitHead`, `gitBranch`, `gitIsRepo`, `gitReadOnlyCheck`,
 * `shellExec`, `execGrantRequest`, `execGrantsStatus`, `execGrantsRevoke`,
 * `providerBindEndpoint`, `providerEndpointsList`, `providerUnbindEndpoint`,
 * the ten `browser*` verbs and the nine `controlMcp*` verbs), and the main
 * process registers a matching `ipcMain.handle` for each one
 * (`electron/native/*.cjs`). The preload's own comment said the wiring was
 * "its own stated piece of work", and it was never done — so on the
 * packaged desktop build the Permissions pane's "allow network for 30
 * minutes" button always failed, the provider endpoint could never be
 * bound, and the whole git panel refused.
 *
 * Each verb below now REACHES the bridge when the host publishes it, and
 * keeps this refusal for the host that does not. The capability gate stays
 * in front of every one: `can("fs")` is resolved from the shape of the
 * surface, so a page that merely defines a look-alike object earns
 * nothing.
 */
function noChannel(cmd: string, args?: unknown): never {
  void args;
  throw new Error(`${cmd}: this build exposes no native command channel for it — nothing was done, and no result here stands in for one.`);
}

/**
 * ONE named method from the Electron bridge, or null.
 *
 * The bridge is resolved from the SURFACE, never from a host name, and the
 * method is looked up by the exact name the capability table declares. A
 * half-built bridge earns nothing: if the method is not a function, this
 * returns null and the caller keeps its honest refusal.
 */
function bridgeMethod(name: string): ((...args: unknown[]) => Promise<unknown>) | null {
  const bag = electronSurface();
  if (!bag) return null;
  const fn = bag[name];
  if (typeof fn !== "function") return null;
  return (fn as (...args: unknown[]) => Promise<unknown>).bind(bag);
}

/**
 * Which secret seam this host actually has, decided from the capability matrix
 * rather than from a host name, and re-derived on every call because a preload
 * can appear or disappear across a hot reload.
 *
 * `"none"` is not "a browser": it means *this* host has no OS credential store,
 * and the three callers below say which of the two situations they are in.
 */
type SecretSeam = "electron-bridge" | "none";
function secretSeam(): SecretSeam {
  const host = detectHost();
  if (host === "electron" && can("secrets")) return "electron-bridge";
  return "none";
}

/**
 * The federation seam, resolved the same way — by what the host EXPOSES.
 *
 * The Electron build carries its supervised A2A host in the main process
 * (`electron/native/federation.cjs`) and reaches it through named preload
 * methods. The Tauri `app_info` bundle path went with that shell, which is why
 * the bridge branch below reports `bundled: true, hostPath: "in-process"` —
 * there is no on-disk host this client can name any more. All three verbs must
 * be present or the bridge is not claimed — a half-built preload earns nothing.
 */
function federationBridge(): {
  status: () => Promise<unknown>;
  mount: (opts: Record<string, unknown>) => Promise<unknown>;
  stop: () => Promise<unknown>;
} | null {
  const bag = electronSurface();
  if (!bag) return null;
  const isFn = (v: unknown): boolean => typeof v === "function";
  if (!isFn(bag.federationStatus) || !isFn(bag.federationMount) || !isFn(bag.federationStop)) return null;
  return {
    status: bag.federationStatus as () => Promise<unknown>,
    mount: bag.federationMount as (opts: Record<string, unknown>) => Promise<unknown>,
    stop: bag.federationStop as () => Promise<unknown>,
  };
}

/**
 * Where a secret really lives. V7 fix (bug W): "exists" used to be a bare boolean, which could not
 * distinguish a key safely in the OS keychain from one sitting in RAM that vanishes on exit.
 */
export interface SecretStatus {
  exists: boolean;
  location: "keychain" | "memory-only" | "browser-localStorage" | "absent";
  survivesRestart: boolean;
  warning?: string;
}

/**
 * V7 fix (bug V): the single honest explanation for the browser family, shared by the browser
 * fallbacks here. It mirrored `browser_reason()` in the Rust `commands.rs`, a command channel this
 * client no longer has. No Chromium is bundled.
 */
const browserReason =
  "No browser is attached in this build: the app does not bundle or launch Chromium, so there is no session, no page and no DOM. Nothing was fetched.";

/* ------------------------------------------------------------------ git result shapes
 * Written against what `src-tauri/src/git.rs` returned; that command channel is gone, and the
 * verbs below refuse at `noChannel` until the Electron `git*` preload methods are wired up here.
 * The shapes stay because they are what the git panel renders and what the seam must answer with.
 * `ok: false` is a *result*, not a thrown error: a
 * repository that is not a git repository, or a diff that timed out, is something the UI has to be able
 * to display. `reason` always explains it.
 */
export interface GitRepoResult {
  ok: boolean;
  isRepo: boolean;
  toplevel?: string;
  reason?: string | null;
  timedOut?: boolean;
}
export interface GitStatusEntry {
  xy: string;
  path: string;
  from: string | null;
  untracked: boolean;
  staged: boolean;
  worktree: boolean;
}
export interface GitStatusResult {
  ok: boolean;
  entries: GitStatusEntry[];
  count: number;
  clean: boolean;
  untracked: number;
  summary?: string;
  reason?: string | null;
  timedOut?: boolean;
}
export interface GitDiffFile {
  path: string;
  added: number;
  removed: number;
  isNew: boolean;
  isDeleted: boolean;
  isBinary: boolean;
  renamedFrom: string | null;
}
export interface GitDiffResult {
  ok: boolean;
  files: GitDiffFile[];
  summary?: string;
  totals?: { files: number; added: number; removed: number; newFiles: number; deletedFiles: number; renames: number; binaryFiles: number };
  raw?: string;
  rawBytes?: number;
  truncated?: boolean;
  reason?: string | null;
  timedOut?: boolean;
}
export interface GitHeadResult {
  ok: boolean;
  sha: string | null;
  shortSha?: string;
  subject?: string;
  author?: string;
  committedAt?: string;
  hasCommits: boolean;
  reason?: string | null;
}
export interface GitBranchResult {
  ok: boolean;
  branch: string | null;
  detached: boolean;
  reason?: string | null;
}
export interface GitReadOnlyResult {
  ok: boolean;
  /** "clean" | "violated" | "unknown". Unknown is never reported as clean. */
  verdict: "clean" | "violated" | "unknown";
  paths: string[];
  reason: string;
}

/** The A2A host's real lifecycle, as reported by the backend supervisor.
 *  `running` is never assumed: it is true only when the OS says the child is
 *  alive AND the supervisor says it reached `running`. */
export type FederationState = "stopped" | "starting" | "running" | "failed" | "unavailable";

export interface FederationStatus {
  state: FederationState;
  bundled: boolean;
  hostPath: string | null;
  running: boolean;
  pid: number | null;
  port: number | null;
  cardUrl: string | null;
  interfaceUrl: string | null;
  selfimpulse: string | null;
  identityFp: string | null;
  cardSigned: boolean;
  tokenMinted: boolean;
  /** "local" = 127.0.0.1 only. "lan" = this machine and the network it is on. */
  bindScope: "local" | "lan" | null;
  bindAddress: string | null;
  /** The ONE-TIME pairing code. Never the host's own token. */
  pairingCode: string | null;
  pairingExpires: string | null;
  /** Whether AlterSend is actually mounted on the running host. */
  files: boolean;
  detail: string;
}

/* ── execution grants (module memory only) ─────────────────────────────────
 * A cache of grants the native side minted. That side was the Rust command
 * channel; with it gone there is nothing to mint one, so `requestExecGrant`
 * refuses and this list stays empty rather than holding a grant nobody issued. */
interface ExecGrantToken { token: string; workspace: string; network: boolean; programs: string[]; expiresAt: number }
let execGrants: ExecGrantToken[] = [];

const bareProgram = (p: string): string => (p.split(/[\\/]/).pop() ?? p).replace(/\.exe$/i, "");
const norm = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const within = (child: string, root: string): boolean => norm(child) === norm(root) || norm(child).startsWith(norm(root) + "/");

function pickExecGrant(program: string, cwd: string | undefined, needNetwork: boolean): ExecGrantToken | undefined {
  const now = Date.now() / 1000;
  execGrants = execGrants.filter((g) => g.expiresAt > now + 5);
  const bare = bareProgram(program);
  return execGrants.find((g) => (g.network || !needNetwork) && g.programs.includes(bare) && (cwd === undefined || within(cwd, g.workspace)));
}
function dropExecGrant(token: string): void {
  execGrants = execGrants.filter((g) => g.token !== token);
}
async function requestExecGrant(workspace: string | undefined, network: boolean, programs: string[] = [], minutes?: number): Promise<ExecGrantToken> {
  const ws = workspace ?? String(((await ipc.appInfo()) as { workspaceRoot?: unknown }).workspaceRoot ?? "");
  /* The native side mints the grant at a native dialog the page cannot
     auto-dismiss (`electron/native/exec.cjs` -> `exec:grant-request`), and
     the preload publishes it as `execGrantRequest`. It was never called from
     here, so the Permissions pane's "allow network for 30 minutes" button
     could not work on the desktop build that ships the button. */
  const fn = bridgeMethod("execGrantRequest");
  if (!fn) {
    return noChannel("exec_grant_request", { programs, workspace: ws, network, minutes });
  }
  const r = (await fn(programs, ws, network, minutes)) as {
    grant: string | null;
    workspace: string;
    network: boolean;
    programs: string[];
    expiresAt: number;
    reason?: string;
  };
  if (!r || !r.grant) {
    throw new Error(`exec_grant_request: ${r?.reason ?? "the native side did not mint an execution grant"} — nothing was run.`);
  }
  const g: ExecGrantToken = { token: r.grant, workspace: r.workspace, network: r.network, programs: r.programs, expiresAt: r.expiresAt };
  execGrants.push(g);
  return g;
}

export const ipc = {
  /**
   * Is the managed engine tier actually up?
   *
   * The status pills on the Captain used to be three hardcoded strings, so
   * they said READY regardless. This asks the shell, which asks the engine
   * host, and answers in words. A host with no engine tier says so.
   */
  engineStatus: async (): Promise<{ enabled: boolean; ready: boolean; operational?: boolean; reason?: string }> => {
    const w = (globalThis as { selfImpulseDesktop?: { engineStatus?: () => Promise<unknown> } }).selfImpulseDesktop;
    if (!w || typeof w.engineStatus !== "function") {
      return { enabled: false, ready: false, reason: "this build has no managed engine tier" };
    }
    try {
      const st = (await w.engineStatus()) as Record<string, unknown>;
      return {
        enabled: st.enabled === true,
        ready: st.ready === true,
        operational: st.operational === true,
        ...(typeof st.reason === "string" ? { reason: st.reason } : {}),
      };
    } catch (e) {
      /* The shell could not be asked. The answer is "not ready, and here is
       * why" — never a silent success, because the pill that reads this
       * reports the engine's state to the user. */
      return { enabled: false, ready: false, reason: e instanceof Error ? e.message : String(e) };
    }
  },
  /**
   * Is the channels gateway actually accepting?
   *
   * Same rule as the engine: the pill reports, it does not assert.
   */
  channelsStatus: async (): Promise<{ gatewayReady: boolean; reason?: string }> => {
    try {
      const st = (await ipc.appInfo()) as Record<string, unknown>;
      const running = st.channelsReady === true;
      return { gatewayReady: running, ...(typeof st.channelsReason === "string" ? { reason: st.channelsReason } : {}) };
    } catch (e) {
      /* The app could not be asked — so the gateway is not known to be
       * ready, and the reason says why. */
      return { gatewayReady: false, reason: e instanceof Error ? e.message : String(e) };
    }
  },
  /**
   * What host am I running in, as the host itself says.
   *
   * The old shape answered `host: "webview-host"` for the packaged Electron app
   * too, which is how a screen that only asked "tauri or not" ended up
   * describing a desktop install as a browser preview. The Electron branch now
   * asks the shell; the fallback states which storage the build really uses
   * instead of calling everything a browser workspace.
   */
  appInfo: async () => {
    const host = detectHost();
    if (host === "electron") {
      const info = await electronInfo();
      return {
        ...(info ?? {}),
        version: ENGINE_VERSION,
        platform: info?.platform ?? navigator.platform,
        workspaceRoot: "(electron build: this app's own storage, no native workspace root)",
        artifactsDir: "(electron build: this app's own storage)",
        dbHealthy: true,
        controlMcpPort: 0,
        controlMcpTransport: "none",
        controlMcpRunning: false,
        startupMs: 0,
        host: "electron",
        vendors: ["mcp-servers-reference", "mcp-github"],
      };
    }
    return {
      version: ENGINE_VERSION,
      platform: navigator.platform,
      workspaceRoot: "(browser workspace)",
      artifactsDir: "(memory)",
      dbHealthy: true,
      /* The web host runs NO control MCP. It used to report
       * `controlMcpRunning: true` with `transport: "stdio"`, which is a
       * claim about a server that is not there — and the Control MCP panel
       * reads this field to decide whether it can connect anything. A
       * browser edition has no Control MCP process, so it says so. */
      controlMcpPort: 0,
      controlMcpTransport: "none",
      controlMcpRunning: false,
      startupMs: 0,
      host: "webview-host",
      vendors: ["mcp-servers-reference", "mcp-github"],
    };
  },
  /* ---------------------------------------------------------------- federation
   *
   * The desktop app bundles an A2A host and, until now, did nothing with it:
   * `app_info` reported `a2aHostPath`, and no TypeScript ever read the field.
   * The architecture was therefore a fact a user had to discover, which is not
   * the same thing as a product concept.
   *
   * It is one now, and the decision is EXPLICIT rather than automatic. A host
   * binds a TCP port and signs an agent card, so silently starting one on launch
   * would be the app opening a listener nobody asked for. Instead the user
   * mounts it deliberately, and the UI says plainly what mounting means before
   * the button does anything.
   */
  /* ── FEDERATION ────────────────────────────────────────────────────────
   * Three commands, one lifecycle. This used to be a single `shellExec` call
   * with a 20-second timeout, which cannot work: `run_timeout()` kills the
   * child on the deadline, so a long-lived A2A host came up, announced READY,
   * and was terminated while the UI still called it mounted. The backend now
   * supervises the child itself (`a2a_host_start` / `_status` / `_stop`), and
   * `running` is a question the OS answers rather than a constant. */
  federationStatus: async (): Promise<FederationStatus> => {
    /* The gate is a capability, not a host name. This used to be `!useTauri()`,
     * which told a user of the packaged Electron app that "Federation is a
     * desktop capability" while they were sitting in a desktop app — a sentence
     * that is false in the mouth of the thing that said it. A host that cannot
     * mount a listener now refuses in words AND names itself, so the reader can
     * tell "you are in a browser" from "you are in the Electron build, which
     * ships no supervised host". */
    if (!can("federation")) {
      return {
        state: "unavailable", bundled: false, hostPath: null, running: false,
        pid: null, port: null, cardUrl: null, interfaceUrl: null, selfimpulse: null,
        identityFp: null, cardSigned: false, tokenMinted: false,
        bindScope: null, bindAddress: null, pairingCode: null, pairingExpires: null, files: false,
        detail: refusal("federation"),
      };
    }
    const bridge = federationBridge();
    if (bridge) {
      try {
        const st = (await bridge.status()) as Record<string, unknown>;
        const state = (typeof st.state === "string" ? st.state : "stopped") as FederationState;
        return {
          state, bundled: true, hostPath: "in-process",
          running: st.running === true && state === "running",
          files: st.files === true,
          pid: typeof st.pid === "number" ? st.pid : null,
          port: typeof st.port === "number" ? st.port : null,
          cardUrl: typeof st.cardUrl === "string" ? st.cardUrl : null,
          interfaceUrl: typeof st.interfaceUrl === "string" ? st.interfaceUrl : null,
          selfimpulse: typeof st.selfimpulse === "string" ? st.selfimpulse : null,
          identityFp: typeof st.identityFp === "string" ? st.identityFp : null,
          cardSigned: st.cardSigned === true,
          tokenMinted: st.tokenMinted === true,
          bindScope: st.bindScope === "lan" ? "lan" : st.bindScope === "local" ? "local" : null,
          bindAddress: typeof st.bindAddress === "string" ? st.bindAddress : null,
          pairingCode: typeof st.pairingCode === "string" ? st.pairingCode : null,
          pairingExpires: typeof st.pairingExpires === "string" ? st.pairingExpires : null,
          detail: String(st.detail ?? ""),
        };
      } catch (err) {
        return {
          state: "unavailable", bundled: true, hostPath: "in-process", running: false, files: false,
          pid: null, port: null, cardUrl: null, interfaceUrl: null, selfimpulse: null,
          identityFp: null, cardSigned: false, tokenMinted: false, bindScope: null,
          bindAddress: null, pairingCode: null, pairingExpires: null,
          detail: `Could not read the A2A host state: ${String(err)}`,
        };
      }
    }
    /* No bridge means no supervised host this build can reach: the named
     * `federationStatus`/`Mount`/`Stop` methods on the Electron preload are the
     * only carrier of the A2A host left here, and `can("federation")` above
     * already refused anything that does not publish all three. */
    return {
      state: "unavailable", bundled: false, hostPath: null, running: false, files: false,
      pid: null, port: null, cardUrl: null, interfaceUrl: null, selfimpulse: null,
      identityFp: null, cardSigned: false, tokenMinted: false,
      bindScope: null, bindAddress: null, pairingCode: null, pairingExpires: null,
      detail: refusal("federation"),
    };
  },

  federationMount: async (opts: {
    selfimpulse: string;
    port?: number;
    /** Explicit, and defaulted to the narrowest choice. */
    bind?: "local" | "lan";
    /** Mint a one-time pairing code for a peer machine. */
    pair?: boolean;
    /** Mount AlterSend so paired peers can offer files. Off unless asked for. */
    files?: boolean;
  }): Promise<{ ok: boolean; detail: string }> => {
    if (!can("federation")) return { ok: false, detail: refusal("federation") };
    const mountBridge = federationBridge();
    if (mountBridge) {
      try {
        const r = (await mountBridge.mount({
          selfimpulse: opts.selfimpulse || "SelfImpulse",
          port: opts.port ?? 0,
          bind: opts.bind ?? "local",
          pair: opts.pair === true,
          files: opts.files === true,
        })) as Record<string, unknown>;
        return { ok: r.ok === true, detail: String(r.detail ?? (r.ok === true ? "The host is mounted." : "The host did not report ready.")) };
      } catch (err) {
        return { ok: false, detail: `Mount failed in words rather than pretending: ${String(err)}` };
      }
    }
    /* No bridge: the supervised host is the preload's, and a build that does not
     * publish it starts nothing. `federationStatus` says the same in words. */
    return { ok: false, detail: refusal("federation") };
  },

  federationStop: async (): Promise<{ ok: boolean; detail: string }> => {
    if (!can("federation")) return { ok: false, detail: refusal("federation") };
    const stopBridge = federationBridge();
    if (stopBridge) {
      try {
        const r = (await stopBridge.stop()) as Record<string, unknown>;
        return { ok: r.ok !== false, detail: String(r.detail ?? "The A2A host was stopped.") };
      } catch (err) {
        return { ok: false, detail: `Stop failed in words rather than pretending: ${String(err)}` };
      }
    }
    return { ok: false, detail: refusal("federation") };
  },

  dbMaintenance: async (vacuum: boolean) => {
    /* The native side owns a real database and can really vacuum it
       (`electron/native/db.cjs` -> `db:maintenance`). When it is there, it is
       used. When it is not, the fallback measures the local store - and it
       says which of the two happened, because "vacuumed: true" over a
       blob that was never compacted is a claim about work that did not
       happen. */
    const fn = bridgeMethod("dbMaintenance");
    if (fn) {
      const r = (await fn(vacuum)) as { ok?: boolean; vacuumed?: boolean; sizeBytes?: number; reason?: string };
      if (r?.ok === false) {
        return { vacuumed: false, sizeBytes: r.sizeBytes ?? 0, reason: r.reason ?? "the native database refused the maintenance request" };
      }
      return { vacuumed: r?.vacuumed === true, sizeBytes: r?.sizeBytes ?? 0 };
    }
    if (vacuum) {
      /* no-op compact */
    }
    const raw = localStorage.getItem("selfimpulse.v3.db") ?? "";
    return { vacuumed: false, sizeBytes: raw.length, reason: "this host has no native database — the local store was measured but not compacted" };
  },

  workflowList: async (): Promise<WorkflowRecord[]> => {
    return localDb.workflowList();
  },
  workflowGet: async (workflowId: string) => {
    return localDb.workflowGet(workflowId);
  },
  workflowCreate: async (name: string, description: string) => {
    return localDb.workflowCreate(name, description);
  },
  workflowDelete: async (workflowId: string) => {
    localDb.workflowDelete(workflowId);
  },
  workflowSave: async (workflowId: string, name: string, description: string, graph: WorkflowGraph) => {
    localDb.workflowSave(workflowId, name, description, graph);
  },
  // V7 fix (bug T): the browser fallbacks for versioning fabricated an id and a constant
  // `version: 1`, so the version history UI showed a plausible list of versions that were never
  // stored and could not be restored. These now fail loudly. The loudness is not a browser-only
  // caveat: versions were stored by the Rust commands, and this build reaches no native command
  // channel at all, so nothing here can store or restore one. The Electron bridge is the live
  // path and it publishes no version verbs — see `electron/preload.cjs`.
  versionCreate: async (workflowId: string, label: string) =>
    noChannel("workflow_version_create", { workflowId, label }),
  versionList: async (_workflowId: string) => {
    throw new Error("Workflow versions are only stored by the native build; this browser session has no version history to show.");
  },
  versionRestore: async (versionRecordId: string) =>
    noChannel("workflow_version_restore", { versionRecordId }),

  nodeStateLoad: async (_nodeKey: string) => {
    return {};
  },
  nodeStateSave: async (_nodeKey: string, _rolePrompt?: RolePrompt) => {
  },

  memoryAdd: async (nodeKey: string, kind: string, content: string, tags: string[], importance: number, _executionId?: string) => {
    return localDb.memoryAdd(nodeKey, kind, content, tags, importance);
  },
  memorySearch: async (nodeKey: string, query: string, limit = 12): Promise<MemoryRecord[]> => {
    return localDb.memorySearch(nodeKey, query, limit);
  },
  memoryDelete: async (memoryId: string) => {
    localDb.memoryDelete(memoryId);
  },
  skillsList: async (nodeKey: string): Promise<{ skills: SkillRecord[]; all: SkillRecord[] }> => {
    return localDb.skillsList(nodeKey);
  },
  skillTouch: async (skillIds: string[]) => {
    // Honest browser-host limitation (V11): usage counts live in the native SQLite store.
    return noChannel("skill_touch", { skillIds });
  },
  skillDeactivate: async (_skillId: string) => {
  },
  skillUpsert: async (args: {
    nodeKey: string;
    skillId?: string | null;
    name: string;
    description: string;
    procedure: string;
    origin: string;
    score?: number | null;
  }) => {
    return localDb.skillUpsert(args);
  },
  feedbackAdd: async (executionId: string, nodeKey: string, rating: number, comment: string) => {
    return localDb.feedbackAdd(executionId, nodeKey, rating, comment);
  },
  feedbackList: async () => {
    return localDb.feedbackList();
  },

  // V7 fix (bug T): these returned fabricated ids and empty lists. A fabricated evaluation id
  // implies a stored result that does not exist, and an empty list is indistinguishable from
  // "no evaluations have ever run" — both read as success while nothing happened.
  evaluationSave: async (nodeKey: string, executionId: string | null, suite: unknown, score: number, details: Record<string, unknown>) =>
    noChannel("evaluation_save", { nodeKey, executionId, suite, score, details }),
  evaluationHistory: async (nodeKey: string) =>
    noChannel("evaluation_history", { nodeKey }),
  suiteList: async () => {
    throw new Error("Test suites live in the native build's SQLite database; the browser preview has no database to read.");
  },
  suiteSave: async (args: { suiteId?: string | null; name: string; cases: unknown[] }) =>
    noChannel("suite_save", args),
  evolutionProposeSave: async (cand: Record<string, unknown>) => {
    return localDb.evolutionPropose(cand);
  },
  evolutionList: async (_nodeKey?: string) => {
    return localDb.evolutionList();
  },
  evolutionDecide: async (candidateId: string, decision: "ACCEPTED" | "REJECTED") => {
    return localDb.evolutionDecide(candidateId, decision);
  },
  evolutionRollback: async (_candidateId: string, _restoreRolePrompt?: RolePrompt | null) => {
  },

  approvalRequest: async (executionId: string, nodeKey: string, summary: string, payload: Record<string, unknown>, requestedBy?: string) => {
    return localDb.approvalRequest(executionId, nodeKey, summary, payload, requestedBy);
  },
  approvalGet: async (executionId: string, nodeKey: string) => {
    return localDb.approvalGet(executionId, nodeKey);
  },
  approvalList: async () => {
    return localDb.approvalList();
  },
  /** C-2 (archive 4): mint the decision capability — native OS dialog in the
   *  desktop app, an interactive confirm in the web mirror. The token it
   *  returns is the ONLY thing approvalDecide will accept. */
  approvalAuthorize: async (approvalId: string, decision: "APPROVED" | "REJECTED") => {
    return localDb.approvalAuthorize(approvalId, decision);
  },
  approvalDecide: async (approvalId: string, decision: "APPROVED" | "REJECTED", capability: string) => {
    localDb.approvalDecide(approvalId, decision, capability);
  },

  executionCreate: async (workflowId: string, workflowVersion: number) => {
    return localDb.executionCreate(workflowId, workflowVersion);
  },
  executionFinish: async (executionId: string, status: string, error: string | null, stats: Record<string, unknown>) => {
    localDb.executionFinish(executionId, status, error, stats as unknown as ExecutionStats);
  },
  eventEmit: async (executionId: string, kind: string, level: string, nodeId: string | null, data: Record<string, unknown>) => {
    return localDb.eventEmit(executionId, kind, level, nodeId, data);
  },
  executionEvents: async (executionId: string): Promise<ExecutionEventRecord[]> => {
    return localDb.executionEvents(executionId);
  },
  executionTrace: async (executionId: string) => {
    return { events: localDb.executionEvents(executionId), status: "COMPLETED" };
  },
  executionList: async (): Promise<ExecutionRecord[]> => {
    return localDb.executionList();
  },
  dlqAdd: async (executionId: string, nodeKey: string, error: string, payload: Record<string, unknown>, suggestedCause: string, candidateFix: string) => {
    return localDb.dlqAdd(executionId, nodeKey, error, payload, suggestedCause, candidateFix);
  },
  dlqList: async () => {
    return localDb.dlqList();
  },
  dlqResolve: async (dlqId: string) => {
    localDb.dlqResolve(dlqId);
  },
  runRequestTake: async (): Promise<string[]> => {
    return localDb.runTake();
  },

  evolutionServiceHealth: async () => {
    // V6 fix: this used to claim available:true from the browser. It is not available there —
    // the service is a stdio child process owned by the native host.
    return {
      available: false,
      transport: "stdio",
      reason: "The evolution service is a stdio child process of the native host. Build the desktop app (npm run tauri:build).",
      engine: "mj_evolution.stdio_server",
      hooks: ["on_session_start", "pre_llm_call", "post_llm_call", "on_session_end"],
    };
  },
  hermesBridge: async (msg: Record<string, unknown>) => {
    return { ok: true, transport: "in-process", echo: msg };
  },
  evolutionServicePropose: async (_args: { task: string; expected: string; output: string; skill: string }) => {
    // V6 fix: the Rust command took one parameter named `args`; this used to send the payload
    // flat, so Tauri rejected the invoke for a missing key. There is no invoke left to satisfy,
    // so the verb returns null — no proposal is recorded, and nothing here claims one was.
    return null;
  },

  /* ── SECRETS ─────────────────────────────────────────────────────────────
   * The seams, and one rule that does not bend: NO credential is ever written as
   * plaintext, and no native build ever downgrades to browser storage.
   *
   * The bug this closes. `ipc.secretSet` used to be `if (useTauri()) … else
   * localDb.secretSet(…)`, and `localDb.secretSet` puts the key in the
   * `selfimpulse.v3.db` localStorage blob as readable text. That was reachable
   * from the packaged Electron app — `detectHost()` answered `"electron"`,
   * `useTauri()` answered `false`, and the "browser" branch ran inside a desktop
   * install — while the receipt it returned said `location:
   * "browser-localStorage"`, which is a description of a web page, not of the
   * app the user launched. The OS keychain path and the destination-binding
   * check in `src-tauri/src/grants.rs` were skipped entirely.
   *
   * What each host may now claim:
   *   · electron → the named `secretSet`/`secretGet`/`secretHas`/`secretRemove`
   *                methods over the contextBridge, backed by the OS credential
   *                store in the main process (`electron/nativeSecrets.cjs`).
   *                This is the ONLY native seam left: the Rust `secret_*`
   *                commands went with the shell, so a desktop host that does not
   *                publish all four verbs is refused exactly like a page is —
   *                `useTauri()` and the `tauri` host it named no longer exist to
   *                claim anything.
   *   · neither → a refusal in words. `stored: false`, `location: "absent"`.
   *                There is no fourth branch that writes plaintext, in the
   *                browser or anywhere else.
   */
  secretGet: async (
    secretRef: string,
  ): Promise<{ ref: string; present: boolean; value: string | null; redacted?: boolean; hint?: string | null; warning?: string }> => {
    const seam = secretSeam();
    if (seam === "electron-bridge") {
      const bridge = electronSecretBridge();
      // `secretSeam()` already proved all four verbs; a bridge that vanished
      // between the two reads is a torn hot-reload, and it is reported, not
      // routed to a browser fallback.
      if (!bridge) return { ref: secretRef, present: false, value: null, warning: refusal("secrets", "Reading a credential") };
      return bridge.secretGet(secretRef);
    }
    if (detectHost() !== "web") {
      return { ref: secretRef, present: false, value: null, warning: refusal("secrets", "Reading a credential") };
    }
    // The browser reads only what this app's own browser key path put there
    // (local / Ollama keys). It is plaintext in this origin's storage, and the
    // answer says so rather than borrowing the desktop vocabulary.
    const value = localDb.secretGet(secretRef) as string | null | undefined;
    return {
      ref: secretRef,
      present: value != null && value !== "",
      value: value ?? null,
      warning: "The browser build holds no OS credential store: whatever is here sits in this origin's own storage and anything running here can read it.",
    };
  },
  secretSet: async (secretRef: string, value: string): Promise<{ stored: boolean; location: SecretStatus["location"]; survivesRestart: boolean; warning?: string }> => {
    const seam = secretSeam();
    if (seam === "electron-bridge") {
      const bridge = electronSecretBridge();
      if (bridge) return bridge.secretSet(secretRef, value);
      return { stored: false, location: "absent", survivesRestart: false, warning: refusal("secrets", "Storing the key") };
    }
    /* A native shell with no credential seam refuses. A browser refuses too —
     * and neither one writes plaintext to make the interaction feel like it
     * worked. `stored: false` reaches the Settings receipt, so the owner reads
     * the refusal instead of a success that never happened. */
    return { stored: false, location: "absent", survivesRestart: false, warning: refusal("secrets", "Storing the key") };
  },
  secretDelete: async (secretRef: string): Promise<{ removed: boolean; warning?: string }> => {
    const seam = secretSeam();
    if (seam === "electron-bridge") {
      const bridge = electronSecretBridge();
      if (bridge) {
        const r = await bridge.secretRemove(secretRef);
        return { removed: r.removed === true, warning: r.warning };
      }
      return { removed: false, warning: refusal("secrets", "Removing a credential") };
    }
    // Removing is always allowed wherever it lives: forgetting a key cannot be
    // a capability a host lacks. A browser record is this app's own to delete.
    localDb.secretDelete(secretRef);
    return { removed: true };
  },
  secretExists: async (refs: string[]): Promise<Record<string, SecretStatus>> => {
    const seam = secretSeam();
    if (seam === "electron-bridge") {
      const bridge = electronSecretBridge();
      if (bridge) return (await bridge.secretHas(refs)) as Record<string, SecretStatus>;
      return Object.fromEntries(refs.map((r) => [r, { exists: false, location: "absent" as const, survivesRestart: false, warning: refusal("secrets", "Looking up a credential") }]));
    }
    if (detectHost() !== "web") {
      return Object.fromEntries(refs.map((r) => [r, { exists: false, location: "absent" as const, survivesRestart: false, warning: refusal("secrets", "Looking up a credential") }]));
    }
    return localDb.secretExists(refs);
  },
  llmChat: async (req: {
    provider: string;
    base_url?: string;
    model: string;
    messages: Array<{ role: string; content: string }>;
    system?: string;
    max_tokens?: number;
    temperature?: number;
    secret_ref: string;
  }): Promise<{ content: string; model: string; usage: { input_tokens: number; output_tokens: number }; duration_ms: number }> => {
    // Egress guard at the IPC boundary. Every provider call in the engine passes
    // through here, so the policy is applied once, at the choke point, rather than
    // per call site. Before this, only engine/providers.ts complete() checked
    // checkEgressUrl — the Hermes autonomous loop (engine/hermesRuntime.ts) called
    // llmChat directly with a caller-supplied base_url, so an SSRF to link-local /
    // RFC1918 / a cloud metadata endpoint, and an exfiltration of the provider key
    // to an attacker-chosen host, both rode an unguarded path. The web host and the Rust handler
    // used to enforce this policy on opposite sides of the same invoke; with the invoke gone, the
    // check below is the single decision point, and it is one function (`src/security/guardrail.ts`)
    // for every host — so nothing can drift between them.
    const target = req.base_url && req.base_url.trim() ? req.base_url.trim() : undefined;

    /* A LOCAL MODEL IS A DIFFERENT SHAPE, AND IT IS NOT THE NATIVE PATH'S
     * BUSINESS.
     *
     * The native path exists so the key stays in the OS credential store:
     * the main process reads it and attaches it to an approved
     * destination. A local Ollama is the opposite case — it needs NO key
     * at all, and it lives on loopback.
     *
     * So the native path must not intercept it. The native handler
     * REQUIRES a stored provider key (it refuses a request with no
     * `secret_ref`, and refuses one whose ref is not a provider key), so
     * routing a keyless local request into it turns a working call into a
     * refusal. */
    const isLocalModel = req.provider === "ollama" || !!target?.includes("11434");

    /* THE DESKTOP CALL.
     *
     * The renderer never holds a provider key's plaintext on the desktop:
     * the key lives in the OS credential store and the renderer holds only a
     * reference. So the call has to be made by the main process, which can
     * read the key and attach it to an approved destination without the key
     * ever crossing the bridge.
     *
     * This verb is the only thing that can do that, and the bridge publishes
     * exactly one method for it (`llmChat` -> `llm:chat`). It was missing,
     * and the consequence was that the packaged desktop build could not call
     * a provider at all - `engine/providers.ts` refused every call that
     * carried a `secretRef`, with a sentence about the browser.
     *
     * The egress guard runs here FIRST, in the renderer, so a request for a
     * forbidden destination never reaches the main process. The native side
     * re-checks it - two hosts, two checks, one policy - and additionally
     * requires a human binding for any origin that is not a canonical
     * vendor endpoint. */
    if (can("providerCall") && !isLocalModel) {
      const native = bridgeMethod("llmChat");
      if (native) {
        if (target) {
          const egress = checkEgressUrl(target);
          if (!egress.ok) {
            throw new Error(
              `base URL refused by the egress guard: ${egress.reason} - nothing was sent and no key left this machine.`,
            );
          }
        }
        const r = (await native(req)) as {
          content?: string;
          model?: string;
          usage?: { input_tokens?: number; output_tokens?: number };
          duration_ms?: number;
          error?: string;
        };
        if (r?.error) {
          throw new Error(r.error);
        }
        return {
          content: r?.content ?? "",
          model: r?.model ?? req.model,
          usage: { input_tokens: r?.usage?.input_tokens ?? 0, output_tokens: r?.usage?.output_tokens ?? 0 },
          duration_ms: r?.duration_ms ?? 0,
        };
      }
    }
    if (target) {
      const egress = checkEgressUrl(target);
      if (!egress.ok) {
        throw new Error(
          `base URL refused by the egress guard: ${egress.reason} — nothing was sent and no key left this machine.`,
        );
      }
    }

    // The WEB host has no native egress_guard, so the DNS/IP-aware check happens
    // here instead: resolve once, classify every answer, pin the address, and
    // re-vet each redirect hop (safeEgressFetch, below). On desktop this is the
    // native handler's job — doing it twice would add a second DNS lookup to
    // every call and would break an offline self-hosted gateway whose name does
    // not resolve, so the string gate above is all the WebView does there.
    const key = localDb.secretGet(req.secret_ref);
    if (isLocalModel) {
      try {
        // The web host has no native egress_guard, so the DNS/IP-aware check
        // runs here instead: resolve once, classify every answer, pin the
        // address, and re-vet each redirect hop. Loopback is allowed because a
        // local Ollama is documented product surface; a name that resolves to a
        // private address is not, and is refused before a key or a prompt moves.
        const r = await safeEgressFetch(`${target || "http://127.0.0.1:11434"}/api/chat`, {
          method: "POST",
          allowLoopback: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: req.model,
            stream: false,
            messages: [
              ...(req.system ? [{ role: "system", content: req.system }] : []),
              ...req.messages,
            ],
          }),
        });
        const j = await r.json();
        return {
          content: j.message?.content ?? "",
          model: req.model,
          usage: { input_tokens: 0, output_tokens: 0 },
          duration_ms: 0,
        };
      } catch (e) {
        throw new Error(`ollama unreachable: ${e}`);
      }
    }
    if (!key) throw new Error(`secret not found: ${req.secret_ref}`);
    throw new Error(
      `A cloud provider call needs a host that sends it: this is ${describeHost()}, and it has no native sender and no OS-held key to attach. ` +
        `Use Local LLM / Ollama, or the desktop build that runs the provider natively. Nothing was sent.`,
    );
  },

  /* ── FILESYSTEM / EXEC / GIT / PROVIDER BINDING ──────────────────────────
   * Every refusal below used to read "…is available in the native desktop
   * build", gated on `useTauri()`. In a packaged Electron window that sentence
   * told the user their own build was not a native desktop build. The gate is
   * now the capability, and the refusal names the host that lacks it — which is
   * the difference between a limitation and a lie.
   */
  fsRead: async (path: string): Promise<NativeCommands["fs_read"]> => {
    if (!can("fs")) throw new Error(refusal("fs", "Reading a file"));
    const fn = bridgeMethod("fsRead");
    if (!fn) return noChannel("fs_read", { path });
    return (await fn(path)) as NativeCommands["fs_read"];
  },
  fsWrite: async (path: string, content: string): Promise<NativeCommands["fs_write"]> => {
    if (!can("fs")) throw new Error(refusal("fs", "Writing a file"));
    const fn = bridgeMethod("fsWrite");
    if (!fn) return noChannel("fs_write", { path, content });
    return (await fn(path, content)) as NativeCommands["fs_write"];
  },
  fsList: async (path: string): Promise<NativeCommands["fs_list"]> => {
    if (!can("fs")) {
      // `[]` here would read as "the folder is empty". There is no folder this
      // host can see, and the caller has to be able to tell the two apart, so
      // the refusal throws like its siblings do.
      throw new Error(refusal("fs", "Listing a directory"));
    }
    const fn = bridgeMethod("fsList");
    if (!fn) return noChannel("fs_list", { path });
    return (await fn(path)) as NativeCommands["fs_list"];
  },
  fsMkdir: async (path: string): Promise<NativeCommands["fs_mkdir"]> => {
    if (!can("fs")) throw new Error(refusal("fs", "Creating a directory"));
    const fn = bridgeMethod("fsMkdir");
    if (!fn) return noChannel("fs_mkdir", { path });
    return (await fn(path)) as NativeCommands["fs_mkdir"];
  },
  fsRemove: async (path: string, recursive: boolean): Promise<NativeCommands["fs_remove"]> => {
    if (!can("fs")) throw new Error(refusal("fs", "Removing a path"));
    const fn = bridgeMethod("fsRemove");
    if (!fn) return noChannel("fs_remove", { path, recursive });
    return (await fn(path, recursive)) as NativeCommands["fs_remove"];
  },
  /**
   * Run a dev tool inside the sandbox. The native side runs NOTHING without an execution grant a
   * human minted at a native dialog (which tools, which workspace, network or not, for how long).
   * The grant is requested on first need and kept in this module's memory — never persisted — and
   * renewed transparently when it expires or is revoked. Network is OFF unless `opts.network` asks
   * for it, in which case the dialog says so in capitals.
   */
  shellExec: async (program: string, args: string[], cwd?: string, timeoutSecs?: number, opts?: { network?: boolean }) => {
    if (!can("exec")) throw new Error(refusal("exec", `Running \`${program}\``));
    const needNetwork = opts?.network === true;
    let g = pickExecGrant(program, cwd, needNetwork);
    if (!g) g = await requestExecGrant(cwd, needNetwork);
    const shell = bridgeMethod("shellExec");
    if (!shell) return noChannel("shell_exec", { program, args, cwd, timeoutSecs, grant: g.token });
    try {
      return await shell(program, args, cwd, timeoutSecs, g.token);
    } catch (e) {
      if (!/unknown or was revoked|has expired/i.test(String(e))) throw e;
      dropExecGrant(g.token);
      const fresh = await requestExecGrant(cwd, needNetwork);
      return await shell(program, args, cwd, timeoutSecs, fresh.token);
    }
  },
  /** Ask (natively) for an execution grant. Resolves with its public shape — the token stays inside this module. */
  execGrantRequest: async (o: { workspace?: string; programs?: string[]; network?: boolean; minutes?: number } = {}) => {
    if (!can("exec")) throw new Error(refusal("exec", "An execution grant"));
    const g = await requestExecGrant(o.workspace, o.network === true, o.programs, o.minutes);
    return { workspace: g.workspace, network: g.network, programs: g.programs, expiresAt: g.expiresAt };
  },
  execGrantsStatus: async () => {
    if (!can("exec")) return [] as NativeCommands["exec_grants_status"];
    const fn = bridgeMethod("execGrantsStatus");
    if (!fn) return noChannel("exec_grants_status");
    const r = (await fn()) as { grants?: unknown[]; reason?: string };
    return (r?.grants ?? []) as NativeCommands["exec_grants_status"];
  },
  execGrantsRevoke: async () => {
    if (!can("exec")) return { revoked: 0 };
    const fn = bridgeMethod("execGrantsRevoke");
    /* The local cache goes first either way: this module must not keep
       presenting a grant the native side has already revoked. */
    execGrants = [];
    if (!fn) return noChannel("exec_grants_revoke");
    return fn();
  },

  /**
   * Bind a provider key to ONE non-canonical https origin. The vendor's own host needs no binding;
   * anything else (a self-hosted or BYOK gateway) needs a human at a native dialog, because the
   * page cannot be trusted to say where a key may go.
   *
   * The capability, not the host name, is what makes this safe to say: a desktop build that holds
   * keys in its OS credential store but has NO human binding dialog must refuse the binding, and
   * must not be treated as a browser — its key is real, and an unbound endpoint must not receive it.
   */
  providerBindEndpoint: async (secretRef: string, baseUrl: string): Promise<NativeCommands["provider_bind_endpoint"]> => {
    if (!can("providerBinding")) throw new Error(refusal("providerBinding", "Binding an endpoint to a stored key"));
    const fn = bridgeMethod("providerBindEndpoint");
    if (!fn) return noChannel("provider_bind_endpoint", { secretRef, baseUrl });
    return (await fn(secretRef, baseUrl)) as NativeCommands["provider_bind_endpoint"];
  },
  providerEndpointsList: async (): Promise<NativeCommands["provider_endpoints_list"]> => {
    if (!can("providerBinding")) return [] as NativeCommands["provider_endpoints_list"];
    const fn = bridgeMethod("providerEndpointsList");
    if (!fn) return noChannel("provider_endpoints_list");
    /* The native side answers with a REPORT (`{bindings, count}`); the
     * contract this verb has always had is the LIST, and the Settings panel
     * reads it as one. So the report is unwrapped here, at the seam. */
    const r = (await fn()) as { bindings?: NativeCommands["provider_endpoints_list"]; reason?: string };
    return r?.bindings ?? [];
  },
  providerUnbindEndpoint: async (secretRef: string): Promise<NativeCommands["provider_unbind_endpoint"]> => {
    if (!can("providerBinding")) return { unbound: false, secretRef };
    const fn = bridgeMethod("providerUnbindEndpoint");
    if (!fn) return noChannel("provider_unbind_endpoint", { secretRef });
    return (await fn(secretRef)) as NativeCommands["provider_unbind_endpoint"];
  },

  // QA fix (audit C2): the native filesystem is sandboxed to the app data dir plus these
  // user-registered workspace roots. Teams registers the runner repo when a run starts.
  workspaceRootAdd: async (root: string) => {
    if (!can("fs")) return { ok: false as boolean, path: root };
    return noChannel("workspace_root_add", { root });
  },
  workspaceRootRemove: async (root: string) => {
    if (!can("fs")) return { ok: false as boolean, path: root };
    return noChannel("workspace_root_remove", { root });
  },
  workspaceRootList: async (): Promise<{ path: string; addedAt: string }[]> => {
    if (!can("fs")) return [];
    return noChannel("workspace_root_list");
  },

  mcpServerList: async (): Promise<McpServerEntry[]> => {
    return localDb.mcpList();
  },
  mcpServerSave: async (cfg: McpServerSaveInput) => {
    return localDb.mcpSave(cfg);
  },
  mcpServerRemove: async (serverId: string) => {
    localDb.mcpRemove(serverId);
  },
  mcpConnectTest: async (serverId: string) => {
    const s = localDb.mcpList().find((m) => m.id === serverId);
    return {
      serverId,
      connected: false,
      /* The old line read "Connect from the native desktop build", which is a
       * sentence a packaged Electron window should never have said about itself.
       * It names the host it resolved instead, so the reader can tell "this
       * build runs no stdio server" from "the server you have failed". */
      lastError: `No MCP server was contacted: this build (${describeHost()}) runs no stdio server process.`,
      toolCount: 0,
      name: s?.name,
    };
  },
  mcpCall: async (_serverId: string, tool: string, _args: unknown) => {
    throw new Error(refusal("exec", `Calling the MCP tool \`${tool}\``));
  },

  /* The BROWSER.
   *
   * V7 fix (bug V) once made these fallbacks invent a session id, a page title
   * and an engine name — an agent reading one would conclude a real
   * navigation had happened. The invented shapes are gone; what remains is a
   * host that genuinely has no browser, and it says so in the same words in
   * EVERY host.
   *
   * WHAT CHANGED: the Electron shell registers a real browser service
   * (`electron/native/browser.cjs` + `electron/browser-service/server.mjs`)
   * and publishes ten named methods for it. They were never called from
   * here, so a packaged desktop build reported "no browser is attached" for
   * a browser that was attached. Each verb below now REACHES the bridge
   * when the host publishes it, and keeps the honest notAttached shape for
   * the host that does not — which is the browser edition, where there is
   * genuinely no Chromium.
   */
  /**
   * `key` is what makes browser use autonomous: pass a stable key (a node key, a workflow id) and
   * the same session comes back, so a loop that navigates repeatedly drives one tab with its
   * history and cookies intact instead of leaking a fresh browser context on every call.
   */
  browserSessionCreate: async (key?: string) => {
    if (!can("browser")) return { ok: false, notAttached: true, engine: null, sessionId: null, reason: browserReason };
    const fn = bridgeMethod("browserSessionCreate");
    if (!fn) return { ok: false, notAttached: true, engine: null, sessionId: null, reason: browserReason };
    return fn(key);
  },
  browserSessionClose: async (sessionId: string) => {
    if (!can("browser")) return;
    const fn = bridgeMethod("browserSessionClose");
    if (!fn) return;
    return fn(sessionId);
  },
  browserSessions: async () => {
    if (!can("browser")) return [];
    const fn = bridgeMethod("browserSessions");
    if (!fn) return [];
    return fn();
  },
  browserNavigate: async (sessionId: string, url: string, timeoutMs = 30000) => {
    if (!can("browser")) return { ok: false, notAttached: true, url, title: null, engine: null, reason: browserReason };
    const fn = bridgeMethod("browserNavigate");
    if (!fn) return { ok: false, notAttached: true, url, title: null, engine: null, reason: browserReason };
    return fn({ sessionId, url, timeoutMs });
  },
  browserAct: async (args: Record<string, unknown>) => {
    if (!can("browser")) return { ok: false, notAttached: true, reason: browserReason };
    const fn = bridgeMethod("browserAct");
    if (!fn) return { ok: false, notAttached: true, reason: browserReason };
    return fn(args);
  },
  browserScreenshot: async (sessionId: string, fullPage = false) => {
    if (!can("browser")) return { ok: false, notAttached: true, path: null, reason: browserReason };
    const fn = bridgeMethod("browserScreenshot");
    if (!fn) return { ok: false, notAttached: true, path: null, reason: browserReason };
    return fn({ sessionId, fullPage });
  },
  browserConsole: async (sessionId: string) => {
    if (!can("browser")) return { ok: false, notAttached: true, console: [], networkFailures: [], reason: browserReason };
    const fn = bridgeMethod("browserConsole");
    if (!fn) return { ok: false, notAttached: true, console: [], networkFailures: [], reason: browserReason };
    return fn({ sessionId });
  },
  browserStatus: async () => {
    if (!can("browser")) return { ok: false, running: false, state: "stopped", reason: browserReason };
    const fn = bridgeMethod("browserStatus");
    if (!fn) return { ok: false, running: false, state: "stopped", reason: browserReason };
    return fn();
  },
  browserStart: async () => {
    if (!can("browser")) return { ok: false, started: false, reason: browserReason };
    const fn = bridgeMethod("browserStart");
    if (!fn) return { ok: false, started: false, reason: browserReason };
    return fn();
  },
  browserStop: async () => {
    if (!can("browser")) return { ok: false, stopped: false, reason: browserReason };
    const fn = bridgeMethod("browserStop");
    if (!fn) return { ok: false, stopped: false, reason: browserReason };
    return fn();
  },

  /* There is no external execution bridge.
   *
   * Every agent runs in-process on the owner's own provider key. Nothing in this
   * bridge can spawn a third-party process, and the methods that once did are
   * gone rather than stubbed — there is no native command left to call.
   * probe/noExternalCli.test.ts pins the absence.
   */

  /* -------------------------------------------------------------- git
   * Every one of these throws in a host with no git seam rather than returning an
   * empty result. A git panel that renders "no changes" when it never spoke to git is
   * the exact false-success pattern the product forbids: the user cannot tell "clean
   * tree" from "never checked". The thrown message is the label, and it names the host
   * that could not check — which now has to distinguish "this Electron build publishes
   * no git seam" from "this page has no native shell at all", because the Rust command
   * channel that used to answer every desktop is gone.
   */
  gitIsRepo: async (cwd: string) => {
    if (!can("git")) throw new Error(refusal("git", "Checking whether a folder is a repository"));
    const fn = bridgeMethod("gitIsRepo");
    if (!fn) return noChannel("git_is_repo", { cwd });
    return fn(cwd);
  },
  gitStatus: async (cwd: string) => {
    if (!can("git")) throw new Error(refusal("git", "Reading the working tree"));
    const fn = bridgeMethod("gitStatus");
    if (!fn) return noChannel("git_status", { cwd });
    return fn(cwd);
  },
  gitDiff: async (cwd: string, staged = false, budget?: number) => {
    if (!can("git")) throw new Error(refusal("git", "Diffing the working tree"));
    const fn = bridgeMethod("gitDiff");
    if (!fn) return noChannel("git_diff", { cwd, staged, budget: budget ?? null });
    return fn(cwd, staged, budget ?? null);
  },
  gitHead: async (cwd: string) => {
    if (!can("git")) throw new Error(refusal("git", "Reading HEAD"));
    const fn = bridgeMethod("gitHead");
    if (!fn) return noChannel("git_head", { cwd });
    return fn(cwd);
  },
  gitBranch: async (cwd: string) => {
    if (!can("git")) throw new Error(refusal("git", "Reading the current branch"));
    const fn = bridgeMethod("gitBranch");
    if (!fn) return noChannel("git_branch", { cwd });
    return fn(cwd);
  },
  /**
   * Did a seat that was told to be read-only actually refrain from writing?
   * A harness flag is a promise; this is the check. Three-way on purpose, as the Rust `git.rs`
   * this was written against made it: `unknown` is never allowed to read as `clean`.
   */
  gitReadOnlyCheck: async (cwd: string) => {
    if (!can("git")) throw new Error(refusal("git", "Proving a read-only seat wrote nothing"));
    const fn = bridgeMethod("gitReadOnlyCheck");
    if (!fn) return noChannel("git_read_only_check", { cwd });
    return fn(cwd);
  },

  packageExport: async (workflowId: string, _includeHistory: boolean) => {
    const wf = localDb.workflowGet(workflowId);
    return {
      packageFormat: 1,
      exportedAt: new Date().toISOString(),
      application: "SelfImpulse",
      version: ENGINE_VERSION,
      workflow: { name: wf.name, description: wf.description, graph: wf.graph },
      history: [],
      secretsIncluded: false,
    };
  },
  packageImport: async (pkg: unknown) => {
    const p = pkg as { application?: string; workflow?: { name: string; description?: string; graph: WorkflowGraph } };
    // The export names SelfImpulse; packages written before the rename say "VH" and still import.
    if ((p.application !== "SelfImpulse" && p.application !== "VH") || !p.workflow) throw new Error("package rejected");
    const created = localDb.workflowCreate(`${p.workflow.name} (imported)`, p.workflow.description ?? "");
    localDb.workflowSave(created.id, `${p.workflow.name} (imported)`, p.workflow.description ?? "", p.workflow.graph);
    return { id: created.id, validated: validateWorkflow(p.workflow.graph).length === 0 };
  },

  controlValidate: async (workflowId: string): Promise<{ valid: boolean; errors: unknown[] }> => {
    /* Validation is real and local. `src/graph/validation.ts` is the same checker the
     * canvas runs, so a stored graph actually gets inspected. This used to answer
     * `{ valid: true, errors: [] }` for ANY id at all — asserting a fact about a graph
     * it never looked at, which is the one thing a governance product must not do. */
    const wf = localDb.workflowGet(workflowId);
    if (!wf) {
      return { valid: false, errors: [{ message: `no workflow with id "${workflowId}" — nothing was validated.` }] };
    }
    const errors = validateWorkflow(wf.graph);
    return { valid: errors.length === 0, errors };
  },
  controlConnectPorts: async (args: { workflowId: string; sourceNodeId: string; sourcePortId: string; targetNodeId: string; targetPortId: string }): Promise<Connection> => {
    if (!can("controlMcp")) {
      throw new Error(refusal("controlMcp", "Connecting two ports of a workflow"));
    }
    const fn = bridgeMethod("controlMcpConnectPorts");
    if (!fn) return noChannel("control_connect_ports", args);
    const r = (await fn(args)) as {
      ok?: boolean;
      error?: string;
      id?: string;
      sourceNodeId?: string;
      sourcePortId?: string;
      targetNodeId?: string;
      targetPortId?: string;
      dataType?: DataType;
      status?: Connection["status"];
    };
    /* The native receipt is a CONTROL-MCP receipt, not a `Connection` row, so
       it is adapted rather than cast. A refusal from the native side is
       re-thrown with its own words; a success that does not carry the
       connection fields is refused too, because a fabricated `Connection`
       would render as a wired graph that was never wired. */
    if (r?.ok === false) {
      throw new Error(`control_connect_ports: ${r.error ?? "the control server refused the connection"} — nothing was connected.`);
    }
    if (!r || typeof r.id !== "string" || !r.id) {
      throw new Error("control_connect_ports: the control server returned a receipt with no connection in it — nothing was connected.");
    }
    return {
      id: r.id,
      sourceNodeId: r.sourceNodeId ?? args.sourceNodeId,
      sourcePortId: r.sourcePortId ?? args.sourcePortId,
      targetNodeId: r.targetNodeId ?? args.targetNodeId,
      targetPortId: r.targetPortId ?? args.targetPortId,
      dataType: r.dataType ?? ("any" as DataType),
      status: r.status ?? "active",
    };
  },
};

export function nodeKeyOf(workflowId: string, nodeId: string): string {
  return `${workflowId}:${nodeId}`;
}
