/**
 * §AGUI — Agent-User Interaction event emitter (17.1.3).
 *
 * SelfImpulse emits the standard AG-UI subset of events alongside its
 * signed receipt chain so that external observers (browser extensions,
 * third-party UIs, the Tauri native bridge, MCP introspection tools) can
 * follow a voyage in real time without parsing receipt JSONL or poking at
 * internal state.
 *
 * Reference: https://docs.ag-ui.com/concepts/events — lifecycle, text, tool,
 * state, interrupt, and custom event families. We emit the subset that
 * maps cleanly onto SelfImpulse's existing run model:
 *
 *   RUN_STARTED / RUN_FINISHED / RUN_ERROR       — a Helm submission
 *   TEXT_MESSAGE_START / _CONTENT / _END         — streamed reply text
 *   TOOL_CALL_START / _ARGS / _END / _RESULT     — governed tool execution
 *   STATE_SNAPSHOT / STATE_DELTA                 — session/receipt state
 *   INTERRUPT                                    — human gate pause
 *   CUSTOM                                       — vendor-specific payloads
 *
 * Crucially, AG-UI is an EMIT-ONLY side-channel: receipts remain the
 * source of truth. An AG-UI subscriber can observe a run but cannot alter
 * it through this module (approvals still go through resolveSelfImpulseApproval,
 * tools are still invoked by the mission loop). That keeps the governance
 * story intact.
 *
 * Consumers subscribe via `agui.addEventListener(type, cb)` and receive
 * events of the form `{ type, runId, threadId, ...payload }`. We extend
 * EventTarget so the browser/Tauri can treat this like any other event
 * emitter.
 */

import { scrubAuditValue } from "../../security/auditScrub";

export type AguiEventType =
  | "RUN_STARTED"
  | "RUN_FINISHED"
  | "RUN_ERROR"
  | "TEXT_MESSAGE_START"
  | "TEXT_MESSAGE_CONTENT"
  | "TEXT_MESSAGE_END"
  | "TOOL_CALL_START"
  | "TOOL_CALL_ARGS"
  | "TOOL_CALL_END"
  | "TOOL_CALL_RESULT"
  | "STATE_SNAPSHOT"
  | "STATE_DELTA"
  | "INTERRUPT"
  | "CUSTOM";

export interface AguiEvent {
  type: AguiEventType;
  /** Run id (per Helm submission). */
  runId: string;
  /** Thread id the run belongs to. */
  threadId: string;
  /** ISO timestamp the event was emitted at. */
  ts: string;
  [k: string]: unknown;
}

class AguiBus extends EventTarget {
  emit(ev: AguiEvent): void {
    this.dispatchEvent(new CustomEvent(ev.type, { detail: ev }));
  }
  on(type: AguiEventType, cb: (ev: AguiEvent) => void): () => void {
    const handler = (e: Event) => cb((e as CustomEvent<AguiEvent>).detail);
    this.addEventListener(type, handler);
    return () => this.removeEventListener(type, handler);
  }
}

export const agui = new AguiBus();

/* ── typed emit helpers — callers use these instead of hand-building events ── */

let runCounter = 0;
export function nextRunId(): string {
  runCounter += 1;
  return `run_${Date.now().toString(36)}_${runCounter.toString(36)}`;
}

export function emitRunStarted(runId: string, threadId: string): void {
  agui.emit({ type: "RUN_STARTED", runId, threadId, ts: new Date().toISOString() });
}
export function emitRunFinished(runId: string, threadId: string, outcome: "approved" | "denied" | "completed" | "error"): void {
  agui.emit({ type: "RUN_FINISHED", runId, threadId, ts: new Date().toISOString(), outcome });
}
export function emitRunError(runId: string, threadId: string, error: string): void {
  agui.emit({ type: "RUN_ERROR", runId, threadId, ts: new Date().toISOString(), error });
}
export function emitTextStart(runId: string, threadId: string, messageId: string): void {
  agui.emit({ type: "TEXT_MESSAGE_START", runId, threadId, ts: new Date().toISOString(), messageId, role: "assistant" });
}
export function emitTextChunk(runId: string, threadId: string, messageId: string, delta: string): void {
  agui.emit({ type: "TEXT_MESSAGE_CONTENT", runId, threadId, ts: new Date().toISOString(), messageId, delta });
}
export function emitTextEnd(runId: string, threadId: string, messageId: string): void {
  agui.emit({ type: "TEXT_MESSAGE_END", runId, threadId, ts: new Date().toISOString(), messageId });
}
export function emitToolStart(runId: string, threadId: string, toolCallId: string, tool: string): void {
  agui.emit({ type: "TOOL_CALL_START", runId, threadId, ts: new Date().toISOString(), toolCallId, tool });
}
export function emitToolArgs(runId: string, threadId: string, toolCallId: string, args: Record<string, unknown>): void {
  /* Tool arguments reach every AG-UI subscriber, and the event ring is a
     transport, not a vault: a `workspace_write` body or a provider key echoed
     back by a model would ride out to every listener in plain text. The same
     scrub the receipts use, applied at the emit seam, so no subscriber ever
     sees a secret this product has already decided is a secret. */
  agui.emit({ type: "TOOL_CALL_ARGS", runId, threadId, ts: new Date().toISOString(), toolCallId, args: scrubAuditValue(args) as Record<string, unknown> });
}
export function emitToolEnd(runId: string, threadId: string, toolCallId: string): void {
  agui.emit({ type: "TOOL_CALL_END", runId, threadId, ts: new Date().toISOString(), toolCallId });
}
export function emitToolResult(runId: string, threadId: string, toolCallId: string, result: string, ok: boolean): void {
  agui.emit({ type: "TOOL_CALL_RESULT", runId, threadId, ts: new Date().toISOString(), toolCallId, result, ok });
}
export function emitInterrupt(runId: string, threadId: string, approvalId: string, tool: string, reason: string): void {
  agui.emit({ type: "INTERRUPT", runId, threadId, ts: new Date().toISOString(), approvalId, tool, reason });
}
export function emitStateSnapshot(runId: string, threadId: string, snapshot: Record<string, unknown>): void {
  agui.emit({ type: "STATE_SNAPSHOT", runId, threadId, ts: new Date().toISOString(), snapshot });
}
export function emitStateDelta(runId: string, threadId: string, delta: Record<string, unknown>): void {
  agui.emit({ type: "STATE_DELTA", runId, threadId, ts: new Date().toISOString(), delta });
}
