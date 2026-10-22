/**
 * AGENT REACH MCP — 19.7.2.2 "Federation"
 *
 * The primary, default MCP server of SelfImpulse, wired into the app itself.
 * It exposes the computer-use plane and the portable authority plane over an
 * MCP-shaped surface (initialize / tools/list / tools/call), and every call
 * goes through the same governed executor as the rest of the product:
 * risk tier → human gate → receipt. This module is the in-app server core;
 * tools/mcp.mjs serves the same surface over stdio for external clients.
 *
 * Tools exposed:
 *   pc.exec            — allowlisted, bounded, injection-scanned process execution
 *   pc.browser.open    — HTTPS-only page load under the mission profile
 *   pc.browser.screenshot — real-binary screenshot, honest refusal otherwise
 *   authority.issue    — issue an ECDSA mission mandate (portable authority)
 *   authority.verify   — verify a mandate with the public key alone
 *   authority.lookup   — look up and verify the authority record bound to a provenance digest
 */
import { pcExec, missionBrowser, detectBrowserBinary } from "./computerUse";
import type { ExecPolicy, BrowserTransport } from "./computerUse";
import {
  issueMissionMandate, verifyMissionAuthorityRecord, missionAuthorityFor,
  ISSUABLE_SCOPE, MAX_BUDGET, MAX_DEPTH,
} from "./missionAuthority";
import { verifyMandateWeb } from "./authorityWeb";
import type { Mandate } from "./authorityCore";

export const REACH_MCP_NAME = "Agent Reach MCP";
export const REACH_MCP_VERSION = "19.7.16";

export const REACH_MCP_DEFAULT_POLICY: ExecPolicy = {
  allowlist: ["ls", "cat", "echo", "grep"],
  maxRuntimeMs: 5000,
  maxOutputBytes: 64 * 1024,
};

export interface ReachMcpTool {
  name: string;
  description: string;
  riskTier: "safe" | "risky";
  inputSchema: Record<string, unknown>;
}

export const reachMcpTools: ReachMcpTool[] = [
  { name: "pc.exec", riskTier: "risky", description: "Run an allowlisted binary under the mission policy — bounded, injection-scanned, receipted.", inputSchema: { type: "object", properties: { binary: { type: "string" }, args: { type: "array", items: { type: "string" } } }, required: ["binary"] } },
  { name: "pc.browser.open", riskTier: "risky", description: "Open an HTTPS page in the built-in headless browser under the isolated mission profile.", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "pc.browser.screenshot", riskTier: "risky", description: "Screenshot the loaded page via the real browser binary; refuses honestly when none exists.", inputSchema: { type: "object", properties: { url: { type: "string" }, outPath: { type: "string" } }, required: ["outPath"] } },
  { name: "authority.issue", riskTier: "risky", description: "OWNER-GRANTED authority: issues an ECDSA P-256 mandate ONLY after the human gate approves, ONLY for an explicit non-empty scope the owner names (subset of the issuable set), with clamped budget/depth. No gate, no issue.", inputSchema: { type: "object", properties: { missionId: { type: "string" }, scope: { type: "array", items: { type: "string" } }, budgetCap: { type: "number" }, maxDepth: { type: "number" } }, required: ["missionId", "scope"] } },
  { name: "authority.verify", riskTier: "safe", description: "Verify a mandate with the public key alone.", inputSchema: { type: "object", properties: { mandate: { type: "object" }, publicKeyPem: { type: "string" } }, required: ["mandate", "publicKeyPem"] } },
  { name: "authority.lookup", riskTier: "safe", description: "Look up and verify the authority record bound to a mission's provenance digest.", inputSchema: { type: "object", properties: { responseDigest: { type: "string" } }, required: ["responseDigest"] } },
];

export interface ReachMcpContext {
  missionId: string;
  /** The VH identity handle grants authority; falls back to the local label. */
  owner?: string;
  policy?: ExecPolicy;
  transport?: BrowserTransport;
  gate?: (ask: { action: string; riskTier: string }) => Promise<{ approved: boolean; reason: string }>;
  run?: (bin: string, args: string[], timeoutMs: number) => { status: number | null; timedOut: boolean; stdout: string; stderr: string };
  exists?: (p: string) => boolean;
  spawn?: (bin: string, args: string[]) => { status: number | null; stderr: string };
}

export interface ReachMcpResult {
  ok: boolean;
  decision: "executed" | "refused" | "gated-out" | "handover";
  output: string;
  receipt?: unknown;
}

export function reachMcpServerInfo() {
  return {
    name: REACH_MCP_NAME,
    version: REACH_MCP_VERSION,
    primary: true,
    default: true,
    transport: ["in-app", "stdio"],
    tools: reachMcpTools.map((t) => ({ name: t.name, description: t.description, riskTier: t.riskTier })),
  };
}

/** The single governed executor for Agent Reach MCP calls. */
export async function reachMcpCall(name: string, args: Record<string, unknown>, ctx: ReachMcpContext): Promise<ReachMcpResult> {
  const def = reachMcpTools.find((t) => t.name === name);
  if (!def) return { ok: false, decision: "refused", output: `unknown tool "${name}" — Agent Reach MCP exposes: ${reachMcpTools.map((t) => t.name).join(", ")}` };

  if (def.riskTier === "risky") {
    if (!ctx.gate) return { ok: false, decision: "gated-out", output: `${name} is ${def.riskTier} and no human gate is wired — nothing executed` };
    const decision = await ctx.gate({ action: `${REACH_MCP_NAME} · ${name}`, riskTier: def.riskTier });
    if (!decision.approved) return { ok: false, decision: "gated-out", output: `declined at the gate: ${decision.reason}` };
  }

  const policy = ctx.policy ?? REACH_MCP_DEFAULT_POLICY;

  switch (name) {
    case "pc.exec": {
      const r = pcExec(String(args.binary ?? ""), Array.isArray(args.args) ? (args.args as unknown[]).map(String) : [], policy, "risky", ctx.run ? { run: ctx.run } : {});
      return { ok: r.decision === "executed", decision: r.decision, output: r.decision === "executed" ? `exit ${r.exitCode} — ${r.stdoutPreview || "(no output)"}` : r.reason, receipt: r };
    }
    case "pc.browser.open":
    case "pc.browser.navigate": {
      const browser = missionBrowser(ctx.missionId, ctx.transport ?? undefined, ctx.exists ? detectBrowserBinary(undefined, ctx.exists) : null, ctx.spawn);
      const r = await browser.open(String(args.url ?? ""));
      return { ok: r.decision === "executed", decision: r.decision, output: r.decision === "executed" && r.result ? `loaded ${r.result.url} (${r.result.status}) — ${r.result.title || "(no title)"}` : r.reason, receipt: r };
    }
    case "pc.browser.screenshot": {
      const browser = missionBrowser(ctx.missionId, ctx.transport ?? undefined, ctx.exists ? detectBrowserBinary(undefined, ctx.exists) : null, ctx.spawn);
      if (typeof args.url === "string" && args.url) await browser.open(args.url);
      const r = browser.screenshot(String(args.outPath ?? ""));
      return { ok: r.decision === "executed", decision: r.decision, output: r.reason, receipt: r };
    }
    case "authority.issue": {
      /* P0 review fix — the OWNER grants authority: this call is risky-tier
         (the gate ran above), the scope must be explicit and is capped to
         the issuable set, budget/depth clamp. Empty or unknown scope refuses. */
      const requestedMission = typeof args.missionId === "string" && args.missionId ? args.missionId : ctx.missionId;
      if (requestedMission !== ctx.missionId) {
        return { ok: false, decision: "refused", output: `authority.issue refused: args.missionId "${requestedMission}" does not match this call's mission "${ctx.missionId}" — a gate on one call never issues for another mission` };
      }
      const scope = Array.isArray(args.scope) ? (args.scope as unknown[]).map(String) : [];
      const granted = [...new Set(scope)].filter((s) => (ISSUABLE_SCOPE as readonly string[]).includes(s));
      if (granted.length === 0) {
        return { ok: false, decision: "refused", output: `authority.issue needs an explicit non-empty scope from the issuable set (${ISSUABLE_SCOPE.join(", ")}) — owner authority is granted, never self-issued broad` };
      }
      if (granted.length !== new Set(scope).size) {
        return { ok: false, decision: "refused", output: `scope outside the issuable set was dropped (${[...new Set(scope)].filter((s) => !(ISSUABLE_SCOPE as readonly string[]).includes(s)).join(", ")}) — refusing rather than silently narrowing a mandate` };
      }
      const mandate = await issueMissionMandate({
        missionId: requestedMission,
        scope: granted,
        budgetCap: typeof args.budgetCap === "number" ? Math.min(args.budgetCap, MAX_BUDGET) : undefined,
        maxDepth: typeof args.maxDepth === "number" ? Math.min(args.maxDepth, MAX_DEPTH) : undefined,
      }, { identity: ctx.owner });
      return { ok: true, decision: "executed", output: `mandate issued — owner ${mandate.owner}, scope ${mandate.scope.join(", ")} (owner-granted, gate-approved), ECDSA P-256`, receipt: mandate };
    }
    case "authority.verify": {
      const r = await verifyMandateWeb(args.mandate as Mandate, String(args.publicKeyPem ?? ""));
      return { ok: r.ok, decision: r.ok ? "executed" : "refused", output: r.ok ? "mandate verifies with the public key" : r.detail };
    }
    case "authority.lookup": {
      const rec = missionAuthorityFor(String(args.responseDigest ?? ""));
      if (!rec) return { ok: false, decision: "refused", output: "no authority record bound to that digest" };
      const ok = await verifyMissionAuthorityRecord(rec);
      return { ok, decision: ok ? "executed" : "refused", output: ok ? `authority verified — scheme ${rec.scheme}, owner ${rec.mandate.owner}` : "record failed verification", receipt: rec };
    }
    default:
      return { ok: false, decision: "refused", output: `unhandled tool "${name}"` };
  }
}
