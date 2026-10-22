/**
 * M3 — SelfImpulse's MCP capability router (16.2.0; 16.5.0: dual-era).
 *
 * SelfImpulse speaks MCP (Model Context Protocol, JSON-RPC 2.0 over stdio)
 * as a SERVER: an MCP client (Claude Desktop, an agent harness, your own
 * tooling) can list and call the product's capabilities.
 *
 * THE ROUTING RULE (the whole point of M3):
 *   `tools/call` never executes anything itself. Every call is routed into
 *   `runSelfImpulseToolCall` — the SAME governed path the chat face uses:
 *   authorize → SIMULATE (risky) → HUMAN GATE (risky) → call → SELFIMPULSE
 *   (receipt). The MCP face has no other route to the tools, so it cannot
 *   bypass the pipeline. Refusals, denials and errors mint receipts too —
 *   the audit trail is never optional.
 *
 * DUAL-ERA PROTOCOL (16.5.0 — spec 2026-07-28 + legacy 2025-x):
 *   The 2026-07-28 spec retired the `initialize`/`initialized` handshake and
 *   `Mcp-Session-Id`: every request is self-describing, carrying its
 *   protocol version and capabilities in `_meta` (`_meta` keys
 *   `io.modelcontextprotocol/protocolVersion` and
 *   `io.modelcontextprotocol/clientCapabilities`). This server is DUAL-ERA:
 *     - a request with a modern `_meta` is processed statelessly
 *       (no handshake required; `server/discover` is available; results
 *       carry `resultType` + `ttlMs`/`cacheScope` where the spec requires;
 *       gated calls return the spec's MRTR `input_required` result or —
 *       for clients that declare the `io.modelcontextprotocol/tasks`
 *       extension — a durable task handle polled via `tasks/get` and
 *       answered via `tasks/update`);
 *     - a request without modern `_meta` is treated as LEGACY (2025-11-25 /
 *       2025-06-18 / 2025-03-26) and gets exactly the 16.2-16.4 behavior:
 *       initialize handshake, `approve_action`/`deny_action` + `call_status`.
 *   Both eras hit the SAME governed executor. Version mismatches answer
 *   `-32022` (UnsupportedProtocolVersion) with the supported list; a task
 *   RPC from a client that did not declare the extension answers `-32021`.
 *
 * Gate semantics: a risky call returns immediately (a tool call must not
 * block for a human) with the approval handle. Modern clients thread the
 * decision back via MRTR (`inputResponses` + `requestState`) or `tasks/update`;
 * legacy clients use `approve_action` / `deny_action` + `call_status`.
 * `call_status` reports gated → running → done. Every COMPLETED call
 * carries a receipt id.
 *
 * State: this face holds its session in the server process (the engine's
 * node-safe store). The native app's session is separate; a given process
 * is one face. Task records live in the same process as the call tracks
 * they describe — a restart loses both, and that is labeled plainly.
 */
import {
  SELFIMPULSE_TOOLS,
  RISKY_TOOLS,
  runSelfImpulseToolCall,
  resolveSelfImpulseApproval,
  requestSelfImpulseApproval,
  selfimpulseToolCallStatus,
  selfimpulseMissions,
  verifySelfImpulseReceipt,
} from "./selfimpulse";
import { redeemCapability, verifyCapability } from "../../security/capability";
/* Headless boot: the operator who launched this engine vouches through the
   environment (SI_OWNER_SECRET). Without it the engine stays the labelled
   bootstrap — reads answer, but the gate refuses every effectful approval. */
import { bindOwnerRootFromEnv } from "../../security/ownerRoot";
bindOwnerRootFromEnv();
/* Trusted startup ends here: the read-only registry seals, so code loaded
   later — a worker, a plugin, an integration — can never redefine what
   "read-only" means. */
import { sealReadOnlyRegistry } from "../../security/capability";
sealReadOnlyRegistry();
import { sealPolicyRegistry } from "./policyGateway";
sealPolicyRegistry();
import {
  proposeMetaChange,
  revertMetaChange,
  metaChanges,
  metaChange,
  currentGatedTools,
} from "./meta";
/* side-effect import: registers run_drill as a governed tool (risky) */
import "./drill";
import { ENGINE_VERSION } from "../../version";

/* ── protocol versions: modern (stateless, per-request _meta) + legacy ── */
const MODERN_VERSIONS = ["2026-07-28"];
const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const SUPPORTED_VERSIONS = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];
const PROTOCOL_VERSIONS = LEGACY_VERSIONS; // legacy `initialize` negotiation

const TASKS_EXT = "io.modelcontextprotocol/tasks";
const META_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_CLIENT_CAPS = "io.modelcontextprotocol/clientCapabilities";
const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";
const LIST_TTL_MS = 3_600_000; // the tool set is static within a release
const TASK_POLL_MS = 2_000;

const SERVER_INFO = { name: "selfimpulse", version: ENGINE_VERSION };

/* 19.5.1 — Agent Reach MCP: the portable authority plane is served on the
   stdio surface too (safe tier; pc.* ride the governed SelfImpulse pipeline in-app). */
import { reachMcpCall, reachMcpServerInfo } from "../../engine/reachMcp";

const INSTRUCTIONS =
  "SelfImpulse's governed capabilities. Every action tool call is routed through the product's pipeline (risk classification, human gate on risky calls, signed receipt per completed call). " +
  "Modern clients (protocol 2026-07-28): gated calls return resultType 'input_required' (answer with inputResponses + requestState) or, when you declare the io.modelcontextprotocol/tasks extension, a durable task handle (poll tasks/get, answer tasks/update). " +
  "Legacy clients: risky calls return pending with an approval id — use approve_action / deny_action, then poll call_status. Audit reads: mission_status, verify_receipt.";

type Json = Record<string, unknown>;

/* ── the tool manifest (schemas are the contract; descriptions are honest) ── */
export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Json;
}

const toolDef = (name: string, description: string, props: Record<string, Json>, required: string[] = []): McpToolDef => ({
  name,
  description,
  inputSchema: { type: "object", properties: props, required },
});

const str = { type: "string" };

export const MCP_TOOLS: McpToolDef[] = [
  toolDef("reach_info", "Agent Reach MCP — primary default server info: version, tools, governance model.", {}),
  toolDef("authority.issue", "Issue an ECDSA P-256 mission mandate (portable authority plane).", { missionId: str }),
  toolDef("authority.verify", "Verify a mandate with the public key alone.", { mandate: { type: "object" }, publicKeyPem: str }, ["mandate", "publicKeyPem"]),
  toolDef("authority.lookup", "Look up + verify the authority record bound to a mission provenance digest.", { responseDigest: str }, ["responseDigest"]),

  toolDef("calculator", "Evaluate a math expression with the product's real parser (no eval). Safe; mints a receipt.", { expression: str }, ["expression"]),
  toolDef("clock", "Current date/time — this machine's own timezone, and UTC. Safe; mints a receipt.", {}),
  toolDef("search", "Search the local offline knowledge base. Safe; mints a receipt.", { query: str }, ["query"]),
  toolDef("web_search", "Live web evidence — keyless providers (Wikipedia, HN, GitHub); failures reported, never hidden. Safe; mints a receipt.", { query: str }, ["query"]),
  toolDef("memory_save", "Store a durable fact about the user (visible + deletable in the product). Safe; mints a receipt.", { fact: str }, ["fact"]),
  toolDef("memory_recall", "List everything remembered about the user — facts and preferences. Safe; mints a receipt.", {}),
  toolDef("preference_save", "Learn a standing preference from the user. Safe; mints a receipt.", { text: str }, ["text"]),
  toolDef("workspace_list", "List files in the local workspace. Safe; mints a receipt.", {}),
  toolDef(
    "workspace_write",
    "Write a file to the local workspace. RISKY — pauses at the HUMAN GATE: the response is pending with an approval id; approve it (approve_action) or deny it (deny_action), then poll call_status.",
    { name: str, content: str },
    ["name", "content"],
  ),
  toolDef(
    "dispatch_mission",
    "Dispatch a mission to the host crew (your saved crew, or the prebuilt crew) via the real Mission Loop. RISKY — human-gated; on approval the mission runs in the background and the result arrives via call_status / mission_status. A missing crew is an honest refusal, never a fake.",
    { objective: str },
    ["objective"],
  ),
  toolDef("approve_action", "Resolve a pending human-gate approval (the MCP face of the gate). Control surface — no receipt.", { approvalId: str, approve: { type: "boolean", description: "true = approve, false = deny" } }, ["approvalId"]),
  toolDef("deny_action", "Deny a pending human-gate approval. Control surface — no receipt.", { approvalId: str }, ["approvalId"]),
  toolDef("call_status", "Poll a tool call started through this face: gated → running → done, with the final result (incl. receipt id). Control surface — no receipt.", { callId: str }, ["callId"]),
  toolDef("mission_status", "Look up a mission in the unified mission ledger (omit missionId for the most recent). Control surface — no receipt.", { missionId: str }),
  toolDef("verify_receipt", "Re-verify a receipt from this face's ledger (chain + seal + issuer). Control surface — no receipt.", { receiptId: str }, ["receiptId"]),
  toolDef("system_info", "This machine: runtime, OS/arch, product version, brain. Safe; mints a receipt.", {}),
  toolDef(
    "meta_propose",
    "M6 meta-loop: propose a change to the product's OWN control plane — kind 'risk.tier' (tighten a tool's gate: safe -> risky; the meta-loop may never loosen) or 'preference.set' (add a standing preference). This is the most sensitive class of change: SIMULATE + human gate + attested receipt. Returns pending with the change id; poll meta_status.",
    { kind: str, target: str, reason: str },
    ["kind", "target", "reason"],
  ),
  toolDef("meta_status", "M6 meta-loop: list the product's self-change ledger, or one change by id (status: refused / denied / proposed / applied / reverted, with receipts). Control surface — no receipt.", { changeId: str }),
  toolDef(
    "meta_revert",
    "M6 meta-loop: revert an APPLIED meta change. The revert is itself human-gated and mints its own receipt; the original change is marked reverted. Reverts are terminal — a revert cannot be reverted (propose a new change instead).",
    { changeId: str },
    ["changeId"],
  ),
  toolDef(
    "run_drill",
    "16.4 drill: dispatch a standard REAL mission — a fresh real git repo, the repo's OWN test command, the real mission loop with the real governance arena. Scenarios: guard (fix the disabled-admin bug), maths (implement clamp so the failing test passes), impossible (honest-failure scenario — must report FAILED, never a fake pass). Optional harness (16.7): run the seats on a REAL model — the named harness's CLI must be on PATH, otherwise the drill refuses in words (it never fakes a real-model run); without it, the labeled deterministic seat runs. RISKY — it is a mission; it pauses at the human gate, then runs in the background (poll call_status). The result is a attested drill report + attestation digest.",
    { scenario: str, harness: { type: "string", description: "optional — run the seats on this harness's real CLI (external-model validation); refused honestly when the CLI is not on PATH" } },
    ["scenario"],
  ),
];

const TOOL_NAMES = new Set(MCP_TOOLS.map((t) => t.name));
const ACTION_TOOLS = new Set(["calculator", "clock", "search", "web_search", "memory_save", "memory_recall", "preference_save", "workspace_list", "workspace_write", "dispatch_mission", "system_info", "run_drill"]);

/* ── JSON-RPC plumbing ── */
interface RpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Json;
}

function result(id: number | string | null, result: Json): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}
function rpcError(id: number | string | null, code: number, message: string, data?: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } });
}
function textResult(id: number | string | null, text: string, isError = false): string {
  return result(id, { content: [{ type: "text", text }], isError });
}

/* ── dual-era plumbing (2026-07-28: stateless, self-describing requests) ── */
interface ModernMeta {
  version: string;
  caps: Json | null;
}
function modernMeta(params: Json): ModernMeta | null {
  const meta = params._meta;
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Json;
  if (typeof m[META_VERSION] !== "string") return null;
  const caps = m[META_CLIENT_CAPS];
  return {
    version: m[META_VERSION] as string,
    caps: caps && typeof caps === "object" ? (caps as Json) : null,
  };
}
function clientDeclaredTasks(caps: Json | null): boolean {
  const ext = caps?.extensions;
  return !!ext && typeof ext === "object" && TASKS_EXT in (ext as Json);
}
/**
 * Modern results MUST carry `resultType` (absent ⇒ "complete" for legacy
 * clients) and SHOULD carry the server's identity so any request can land on
 * any instance (stateless core).
 */
function modernResult(id: number | string | null, r: Json): string {
  const out: Json = { ...r, resultType: (r.resultType as string) ?? "complete", _meta: { [META_SERVER_INFO]: SERVER_INFO, ...((r._meta as Json) ?? {}) } };
  return JSON.stringify({ jsonrpc: "2.0", id, result: out });
}
function modernText(id: number | string | null, text: string, isError = false): string {
  return modernResult(id, { content: [{ type: "text", text }], isError });
}
function missingTasksCapability(id: number | string | null): string {
  /* 16.6.0 conformance fix: the 2026-07-28 schema defines
   * `data.requiredCapabilities` as a ClientCapabilities OBJECT (not an
   * array) — the conformance suite (probe #89) caught the drift. */
  return rpcError(id, -32021, "MissingRequiredClientCapability — the client did not declare the tasks extension in its per-request capabilities.", {
    requiredCapabilities: { extensions: { [TASKS_EXT]: {} } },
  });
}

/* The spec's InputRequests map for the human gate (elicitation/create). */
function approvalInputRequest(r: { approvalId: string | null; callId: string }, name: string): Json {
  return {
    human_approval: {
      method: "elicitation/create",
      params: {
        mode: "form",
        message: `SelfImpulse human gate: tool "${name}" is RISKY — approve to execute (the run is attested with a signed receipt) or decline. Approval id ${r.approvalId}; call id ${r.callId} (poll it with the call_status tool).`,
        requestedSchema: {
          type: "object",
          properties: { decision: { type: "string", enum: ["accept", "decline"] } },
          required: ["decision"],
        },
      },
    },
  };
}
/** Read a human decision out of an InputResponses map (accept/decline). */
function decisionFromInputResponses(inputResponses: unknown): boolean | null {
  if (!inputResponses || typeof inputResponses !== "object") return null;
  for (const v of Object.values(inputResponses as Json)) {
    if (!v || typeof v !== "object") continue;
    const o = v as Json;
    if (o.action === "accept") return true;
    if (o.action === "decline" || o.action === "cancel") return false;
    const content = o.content;
    if (content && typeof content === "object" && (content as Json).decision === "accept") return true;
    if (content && typeof content === "object" && (content as Json).decision === "decline") return false;
  }
  return null;
}

/* Tasks (io.modelcontextprotocol/tasks): durable handles over the same
 * per-process call tracks the legacy face polls. A task is created BEFORE
 * the response is sent and reflects the live track state on every read. */
interface TaskRecord {
  taskId: string;
  callId: string;
  approvalId: string;
  tool: string;
  createdAt: string;
  lastUpdatedAt: string;
  inputRequests: Json;
  cancelled?: string; // statusMessage when cancelled at the gate
}
const tasks = new Map<string, TaskRecord>();
const approvalToCall = new Map<string, { callId: string; tool: string }>();

function openTask(r: { approvalId: string | null; callId: string }, name: string, inputRequests: Json): TaskRecord {
  const now = new Date().toISOString();
  const t: TaskRecord = { taskId: `t_${r.callId}`, callId: r.callId, approvalId: r.approvalId ?? "", tool: name, createdAt: now, lastUpdatedAt: now, inputRequests };
  tasks.set(t.taskId, t);
  return t;
}
function taskView(t: TaskRecord): Json {
  const base = { taskId: t.taskId, createdAt: t.createdAt, lastUpdatedAt: new Date().toISOString(), ttlMs: null, pollIntervalMs: TASK_POLL_MS };
  if (t.cancelled) return { ...base, status: "cancelled", statusMessage: t.cancelled };
  const track = selfimpulseToolCallStatus(t.callId);
  if (!track) return { ...base, status: "failed", error: { code: -32603, message: "the call's track is gone (this server process restarted); nothing further can be reported" } };
  if (track.state === "gated") return { ...base, status: "input_required", statusMessage: "waiting at the human gate", inputRequests: t.inputRequests };
  if (track.state === "running") return { ...base, status: "working", statusMessage: `running in the background${track.missionId ? ` (mission ${track.missionId})` : ""}` };
  const r = track.result;
  const receipt = r?.receiptId ? `\nreceipt: ${r.receiptId}` : "";
  return {
    ...base,
    status: "completed",
    result: { content: [{ type: "text", text: `call ${t.callId} [${t.tool}] done — ok=${r?.ok ?? false}, approved=${r?.approved ?? false}${receipt}\n${r?.output ?? ""}` }], isError: r ? !r.ok : true },
  };
}

/* ── the governed tool body (shared by BOTH eras — one throat) ── */
interface GovernedOutcome {
  text: string;
  isError: boolean;
  pending: { approvalId: string; callId: string } | null;
}
/**
 * The governed tool pipeline.
 *
 * `era` says which PROTOCOL era the caller speaks, and it decides one
 * thing only: whether `approve_action` may settle a gate. The modern era
 * has a real human channel (the server's own `elicitation/create`), so the
 * tool is refused there — using it instead is the agent bypassing the
 * human. The legacy era has no other way to settle a gate, so the call is
 * allowed and recorded as a CLIENT approval, which the receipt says plainly.
 */
/**
 * Settle a pending approval from the wire.
 *
 * AN AGENT CANNOT APPROVE ITS OWN REQUEST — WHERE THE PROTOCOL GIVES A REAL
 * HUMAN CHANNEL.
 *
 * The MODERN era (2026-07-28) raises `elicitation/create` and the client
 * shows the person a prompt; the answer comes back as `inputResponses`. A
 * modern client that calls this TOOL instead is the agent bypassing the
 * human, so the tool is refused and the client is told where the human is.
 *
 * The LEGACY era has no such channel: `approve_action` is the only way a
 * client can settle a gate. Refusing it there would leave every legacy
 * client unable to approve anything — a functional break in exchange for no
 * extra guarantee, because the era cannot prove a person was involved either
 * way. So the decision is allowed and RECORDED as "client": the approval, the
 * durable checkpoint and the receipt all say that no person was proven to be
 * in the loop.
 */
function settleApprovalOverTheWire(
  tool: "approve_action" | "deny_action",
  args: Json,
  era: "legacy" | "modern",
): GovernedOutcome {
  const approvalId = String(args.approvalId ?? "");
  if (!approvalId) {
    return { text: `${tool} needs the approvalId from the pending response.`, isError: true, pending: null };
  }
  const approve = tool === "approve_action" && args.approve !== false;
  if (approve && era === "modern") {
    return {
      text: `Approval ${approvalId} was NOT granted: a requester cannot approve itself. The server has raised an elicitation — the person has to answer that prompt (or approve in the desktop app's gate card). Nothing was executed.`,
      isError: false,
      pending: null,
    };
  }
  /* A REFUSAL is always allowed — refusing an action is safe, because it
     stops the thing from happening. The decision is recorded as a CLIENT
     decision in both eras: a denial settles nothing, but it still belongs
     to whoever asked for it, and "human" would be a claim the server
     cannot make on a client's behalf. */
  resolveSelfImpulseApproval(approvalId, approve, { by: "client" });
  if (!approve) {
    return { text: `Denied ${approvalId} — nothing was executed; the denial is recorded in the session.`, isError: false, pending: null };
  }
  const provenance = era === "legacy" ? " (Recorded as a CLIENT approval: this protocol era cannot prove a person answered.)" : "";
  return { text: `Approved ${approvalId} — the call continues in the background; poll call_status for the receipt.${provenance}`, isError: false, pending: null };
}

/** The authority plane over the wire.
 *
 * `authority.issue` is OWNER-GRANTED: it pauses at the same human gate as
 * every risky action, then issues only for the explicit scope the owner
 * named. The gate it uses redeems the capability for THIS call — one
 * approval, one issue. */
async function runAuthorityTool(name: string, args: Json): Promise<GovernedOutcome> {
  const gate = async (ask: { action: string; riskTier: string }) => {
    const detail = `${ask.action} — ${ask.riskTier} authority-plane call; approve only if you are the owner granting this scope`;
    const approval = await requestSelfImpulseApproval(ask.action, detail);
    if (!approval.ok) {
      const why =
        approval.reason === "expired"
          ? "the approval expired"
          : approval.reason === "capability-unavailable"
            ? "the gate could not back the approval with a signed capability"
            : "owner declined at the gate";
      return { approved: false, reason: why };
    }
    /* The intent is stated: the capability must have been signed for THIS
       action and THIS resource. */
    const intent = { action: ask.action, resource: detail.slice(0, 200) };
    const verified = verifyCapability(approval.capability!, "si.runtime", { intent });
    const redeemed = verified.ok ? redeemCapability(approval.capability!, "si.runtime", intent) : verified;
    return {
      approved: redeemed.ok,
      reason: redeemed.ok
        ? "owner approved at the gate; the capability was redeemed for this call"
        : `the approval's capability did not redeem (${redeemed.reason})`,
    };
  };
  /* Every stdio Reach call rides a UNIQUE mission id, so concurrent external
     operations never share a browser session. */
  const stdioMission = `mcp-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
  const outcome = await reachMcpCall(name, (args ?? {}) as Record<string, unknown>, { missionId: stdioMission, gate });
  if (!outcome.ok && outcome.decision === "gated-out") {
    return { text: `${outcome.output} — authority is owner-granted: approve_action to continue, or nothing is issued.`, isError: false, pending: null };
  }
  return { text: outcome.output + (outcome.receipt ? `\n${JSON.stringify(outcome.receipt).slice(0, 900)}` : ""), isError: !outcome.ok, pending: null };
}

/* ── the control surface: the gate's own tools and the audit reads ───────── */

/** Where a gated call stands right now — running, parked at the gate, or done. */
function callStatusOverTheWire(args: Json): GovernedOutcome {
  const track = selfimpulseToolCallStatus(String(args.callId ?? ""));
  if (!track) return { text: `no such call "${String(args.callId ?? "")}" on this server (calls are per-process).`, isError: true, pending: null };
  if (track.state !== "done" || !track.result) {
    const mission = track.missionId ? ` (mission ${track.missionId})` : "";
    /* A gate that appeared WHILE this call was running. It is named here
       because a client polling a call that will never finish needs the
       approval id that would unstick it, and that id cannot be guessed. */
    const mid = track.pendingApproval
      ? ` It is now waiting at ANOTHER human gate - approval ${track.pendingApproval.id} (${track.pendingApproval.action}) - approve_action / deny_action.`
      : "";
    return { text: `call ${args.callId} [${track.tool}] is ${track.state === "gated" ? "waiting at the human gate - approve_action / deny_action" : "running"}${mission}.${mid}`, isError: false, pending: null };
  }
  const r = track.result;
  const receipt = r.receiptId ? `\nreceipt: ${r.receiptId}` : "";
  return { text: `call ${args.callId} [${track.tool}] done — ok=${r.ok}, approved=${r.approved}${receipt}\n${r.output}`, isError: !r.ok, pending: null };
}

/** The unified mission ledger — one state, one mission ID. */
function missionStatusOverTheWire(args: Json): GovernedOutcome {
  const missions = selfimpulseMissions();
  if (missions.length === 0) return { text: "no missions in this face's unified ledger yet.", isError: false, pending: null };
  const want = String(args.missionId ?? "").trim();
  const m = want ? missions.find((x) => x.missionId === want) ?? null : missions[missions.length - 1];
  if (!m) return { text: `no mission "${want}" in this face's ledger.`, isError: true, pending: null };
  return {
    text: `${m.missionId} — "${m.objective}"\nstatus: ${m.status} · cycle ${m.cycleNo} · verified ${m.verifiedSeats}/${m.seatCount} · gate ${m.gateStatus ?? "n/a"} · receipt ${m.receiptOk ? "signed" : "missing"}\ncrew: ${m.teamName} · ${m.runMs}ms · engine: ${m.engine}`,
    isError: false,
    pending: null,
  };
}

/** Re-verify a receipt offline, from the chain and the seal. */
async function verifyReceiptOverTheWire(args: Json): Promise<GovernedOutcome> {
  const v = await verifySelfImpulseReceipt(String(args.receiptId ?? ""));
  return v.ok
    ? { text: `VALID — receipt ${args.receiptId} verifies (chain + seal${v.events ? ` + ${v.events} events` : ""}).`, isError: false, pending: null }
    : { text: `INVALID — receipt "${String(args.receiptId ?? "")}": ${v.reason ?? "unknown"}.`, isError: true, pending: null };
}

/**
 * The meta plane: propose, status, revert.
 *
 * Meta changes have their own ledger and their own poll surface (meta_status)
 * — they are not tool-call tracks, so they never become tasks.
 */
async function metaPlaneTool(name: string, args: Json): Promise<GovernedOutcome> {
  if (name === "meta_propose") {
    const r = await proposeMetaChange(String(args.kind ?? ""), String(args.target ?? ""), String(args.reason ?? ""));
    const extra = r.receiptId ? `\nreceipt: ${r.receiptId}` : "";
    return { text: r.output + extra, isError: !r.ok && !r.pending, pending: null };
  }
  if (name === "meta_revert") {
    const r = await revertMetaChange(String(args.changeId ?? ""));
    const extra = r.receiptId ? `\nreceipt: ${r.receiptId}` : "";
    return { text: r.output + extra, isError: !r.ok && !r.pending, pending: null };
  }
  /* meta_status */
  const want = String(args.changeId ?? "").trim();
  if (want) {
    const c = metaChange(want);
    if (!c) return { text: `no meta change "${want}" in this face's ledger.`, isError: true, pending: null };
    const rec = c.receiptId ? ` · decision receipt ${c.receiptId}` : "";
    const rv = c.revertedAt ? ` · REVERTED at ${c.revertedAt}${c.revertReceiptId ? ` (receipt ${c.revertReceiptId})` : ""}` : "";
    const ro = c.revertOf ? ` · revert of ${c.revertOf}` : "";
    return { text: `${c.id} — ${c.kind} on "${c.target}" — status: ${c.status}${ro}${rv}${rec}\nBEFORE: ${c.from}\nAFTER: ${c.to}\nREASON: ${c.reason}${c.decidedAt ? `\nDECIDED: ${c.decision} at ${c.decidedAt}` : "\nDECIDED: pending at the human gate"}`, isError: false, pending: null };
  }
  const all = metaChanges();
  if (all.length === 0) return { text: "no meta changes in this face's ledger yet. Currently gated: " + currentGatedTools().join(", ") + ".", isError: false, pending: null };
  return {
    text:
      `Currently gated: ${currentGatedTools().join(", ")}.` +
      "\n" +
      all
        .slice(-10)
        .map((c) => `${c.id} — ${c.kind} on "${c.target}" — ${c.status}${c.revertOf ? ` (revert of ${c.revertOf})` : ""}${c.receiptId ? ` [receipt ${c.receiptId}]` : ""}`)
        .join("\n"),
    isError: false,
    pending: null,
  };
}

async function governedTool(name: string, args: Json, era: "legacy" | "modern" = "legacy"): Promise<GovernedOutcome> {
  if (name === "reach_info") {
    const server = reachMcpServerInfo();
    return { text: `${server.name} v${server.version} — PRIMARY default MCP of SelfImpulse. Tools: ${server.tools.map((t) => `${t.name} (${t.riskTier})`).join(", ")}. The pc.* tools execute inside the governed SelfImpulse pipeline (gate + receipts); the authority plane is served here.`, isError: false, pending: null };
  }
  if (name.startsWith("authority.")) {
    return runAuthorityTool(name, args);
  }

  /* control surface — the gate's own tools and the audit reads */
  if (name === "approve_action" || name === "deny_action") {
    return settleApprovalOverTheWire(name, args, era);
  }
  if (name === "call_status") return callStatusOverTheWire(args);
  if (name === "mission_status") return missionStatusOverTheWire(args);
  if (name === "verify_receipt") return verifyReceiptOverTheWire(args);
  if (name === "meta_propose" || name === "meta_status" || name === "meta_revert") {
    return metaPlaneTool(name, args);
  }

  /* unknown tool — honest refusal (never a silent no-op) */
  if (!TOOL_NAMES.has(name)) {
    return { text: `unknown MCP tool "${name}" — refused. Available: ${[...TOOL_NAMES].join(", ")}.`, isError: true, pending: null };
  }

  /* action surface — the ROUTE: every capability call goes through
   * runSelfImpulseToolCall (authorize → simulate → gate → call → selfimpulse). */
  if (!ACTION_TOOLS.has(name)) return { text: `tool "${name}" is not routable.`, isError: true, pending: null };
  const r = await runSelfImpulseToolCall(name, args, { origin: "mcp" });
  const extra = r.receiptId ? `\nreceipt: ${r.receiptId}` : "";
  return {
    text: r.output + extra,
    isError: !r.ok && !r.pending,
    pending: r.pending && r.approvalId ? { approvalId: r.approvalId, callId: r.callId } : null,
  };
}

/* Legacy era encoding (16.2-16.4 wire shape, byte-stable for old probes). */
async function callTool(name: string, args: Json, id: number | string | null): Promise<string> {
  try {
    const o = await governedTool(name, args, "legacy");
    return textResult(id, o.text, o.isError);
  } catch (e) {
    return textResult(id, `tool "${name}" failed in the governed pipeline: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

/* Modern era encoding (2026-07-28: resultType, MRTR, Tasks, cache hints). */
async function modernCallTool(name: string, args: Json, params: Json, id: number | string | null, caps: Json | null): Promise<string> {
  try {
    /* MRTR retry: the client re-sends the original call with the answers
     * attached — inputResponses + the opaque requestState (= the approval id)
     * ride at the TOP LEVEL of params, beside name/arguments (spec 2026-07-28). */
    if (params.inputResponses && typeof params.inputResponses === "object" && typeof params.requestState === "string") {
      const approvalId = String(params.requestState);
      const decision = decisionFromInputResponses(params.inputResponses);
      if (decision === null) return modernText(id, "inputResponses did not answer the outstanding approval (expected action accept or decline).", true);
      resolveSelfImpulseApproval(approvalId, decision, { by: "client" });
      const ref = approvalToCall.get(approvalId);
      const callRef = ref ? `call_status "${ref.callId}"` : "the call";
      /* The provenance is stated, not implied: the client answered the
       * server's elicitation, and the server cannot verify that a person was
       * shown anything — so the decision is recorded as the CLIENT's. */
      return modernText(
        id,
        decision
          ? `Approved ${approvalId} — the call continues in the background; poll ${callRef} for the receipt. (Recorded as a CLIENT approval: the server cannot prove a person was shown the prompt.)`
          : `Denied ${approvalId} — nothing was executed; the denial is recorded in the session.`,
        !decision,
      );
    }
    const o = await governedTool(name, args, "modern");
    if (o.pending) {
      /* remember the approval → call binding so BOTH the MRTR retry and the
       * tasks path can name the call the decision belongs to. */
      approvalToCall.set(o.pending.approvalId, { callId: o.pending.callId, tool: name });
      const inputRequests = approvalInputRequest(o.pending, name);
      if (clientDeclaredTasks(caps)) {
        const t = openTask(o.pending, name, inputRequests);
        return modernResult(id, {
          resultType: "task",
          taskId: t.taskId,
          status: "input_required",
          statusMessage: "waiting at the human gate",
          inputRequests: t.inputRequests,
          createdAt: t.createdAt,
          lastUpdatedAt: t.lastUpdatedAt,
          ttlMs: null,
          pollIntervalMs: TASK_POLL_MS,
        });
      }
      return modernResult(id, { resultType: "input_required", inputRequests, requestState: o.pending.approvalId });
    }
    return modernText(id, o.text, o.isError);
  } catch (e) {
    return modernText(id, `tool "${name}" failed in the governed pipeline: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

function modernTasksGet(params: Json, id: number | string | null, caps: Json | null): string {
  if (!clientDeclaredTasks(caps)) return missingTasksCapability(id);
  const t = tasks.get(String(params.taskId ?? ""));
  if (!t) return rpcError(id, -32602, `no such task "${String(params.taskId ?? "")}" on this server (tasks are per-process).`);
  return modernResult(id, taskView(t));
}
function modernTasksUpdate(params: Json, id: number | string | null, caps: Json | null): string {
  if (!clientDeclaredTasks(caps)) return missingTasksCapability(id);
  const t = tasks.get(String(params.taskId ?? ""));
  if (!t) return rpcError(id, -32602, `no such task "${String(params.taskId ?? "")}" on this server (tasks are per-process).`);
  const decision = decisionFromInputResponses(params.inputResponses);
  if (decision === null) return rpcError(id, -32602, "inputResponses must answer the outstanding approval (action accept or decline).");
  resolveSelfImpulseApproval(t.approvalId, decision, { by: "client" });
  t.lastUpdatedAt = new Date().toISOString();
  return modernResult(id, {});
}
function modernTasksCancel(params: Json, id: number | string | null, caps: Json | null): string {
  if (!clientDeclaredTasks(caps)) return missingTasksCapability(id);
  const t = tasks.get(String(params.taskId ?? ""));
  if (!t) return rpcError(id, -32602, `no such task "${String(params.taskId ?? "")}" on this server (tasks are per-process).`);
  const track = selfimpulseToolCallStatus(t.callId);
  if (track?.state === "gated") {
    resolveSelfImpulseApproval(t.approvalId, false, { by: "client" });
    t.cancelled = "cancelled at the human gate — nothing was executed; the denial is recorded in the session";
  } else if (track?.state === "running") {
    /* cooperative: acknowledge, but work already in flight completes —
     * a mission cannot be un-executed, and we say so instead of pretending. */
    t.cancelled = "cancellation acknowledged (cooperative) — the work already in flight completes; the final state is reported via tasks/get";
  }
  t.lastUpdatedAt = new Date().toISOString();
  return modernResult(id, {});
}

const SERVER_DISCOVER_RESULT = (): Json => ({
  supportedVersions: SUPPORTED_VERSIONS,
  capabilities: { tools: { listChanged: false }, extensions: { [TASKS_EXT]: {} } },
  instructions: INSTRUCTIONS,
  ttlMs: LIST_TTL_MS,
  cacheScope: "public",
});

/* ── the message dispatcher (one line in, one line out) ── */
export async function handleMcpMessage(line: string): Promise<string | null> {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let msg: RpcRequest;
  try {
    msg = JSON.parse(trimmed) as RpcRequest;
  } catch {
    return rpcError(null, -32700, "Parse error — the line is not valid JSON.");
  }
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return rpcError(msg.id ?? null, -32600, "Invalid Request — expected JSON-RPC 2.0 with a method.");
  }
  const id = msg.id ?? null;
  const params = (msg.params ?? {}) as Json;

  /* ── DUAL-ERA DISPATCH: modern requests self-describe in _meta ── */
  const meta = modernMeta(params);
  if (meta) {
    if (!MODERN_VERSIONS.includes(meta.version)) {
      return rpcError(id, -32022, "Unsupported protocol version", { supported: SUPPORTED_VERSIONS, requested: meta.version });
    }
    if (meta.caps === null) {
      return rpcError(id, -32602, `Invalid params — a modern request must carry ${META_CLIENT_CAPS} in _meta (an object, possibly empty).`);
    }
    switch (msg.method) {
      case "server/discover":
        return modernResult(id, SERVER_DISCOVER_RESULT());
      case "initialize":
        /* a modern client probing via the legacy method still gets a full,
         * current answer: modern fields + the legacy shape as a superset. */
        return modernResult(id, {
          protocolVersion: "2026-07-28",
          ...SERVER_DISCOVER_RESULT(),
          serverInfo: SERVER_INFO,
        });
      case "notifications/initialized":
      case "initialized":
        return null; // notification — no response
      case "ping":
        return modernResult(id, {});
      case "tools/list": {
        const sorted = [...MCP_TOOLS].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        return modernResult(id, { tools: sorted, ttlMs: LIST_TTL_MS, cacheScope: "public" });
      }
      case "tools/call": {
        const name = String(params.name ?? "");
        const args = (params.arguments ?? {}) as Json;
        return modernCallTool(name, args, params, id, meta.caps);
      }
      case "tasks/get":
        return modernTasksGet(params, id, meta.caps);
      case "tasks/update":
        return modernTasksUpdate(params, id, meta.caps);
      case "tasks/cancel":
        return modernTasksCancel(params, id, meta.caps);
      default:
        return rpcError(id, -32601, `Method not found: ${msg.method}`);
    }
  }

  /* ── LEGACY ERA (2025-x clients: initialize handshake, no _meta) ── */
  switch (msg.method) {
    case "initialize": {
      const requested = String(params.protocolVersion ?? "");
      const protocolVersion = PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
      return result(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "notifications/initialized":
    case "initialized":
      return null; // notification — no response
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, { tools: MCP_TOOLS });
    case "tools/call": {
      const name = String(params.name ?? "");
      const args = (params.arguments ?? {}) as Json;
      return callTool(name, args, id);
    }
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

/* ── stdio transport (used by tools/mcp.mjs and by the probe) ── */
export async function serveMcpStdio(readLine: () => Promise<string | null>): Promise<void> {
  for (;;) {
    const line = await readLine();
    if (line === null) return;
    const out = await handleMcpMessage(line);
    if (out !== null) process.stdout.write(out + "\n");
  }
}

export { RISKY_TOOLS, SELFIMPULSE_TOOLS };
