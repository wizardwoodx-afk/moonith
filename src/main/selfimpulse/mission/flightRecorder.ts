/**
 * §32 Governance + §14 Flight Recorder.
 *
 * Every autonomous action in VH 6.0 is recorded here with actor, authority, policy, reason
 * and evidence. There is no code path in the mission runtime that mutates state without
 * going through `record`.
 *
 * The recorder is append-only and replayable: `replay` folds events from the beginning to
 * any sequence number, which is what powers time-travel inspection in the UI.
 */

import { uid } from "../app/id";
import { scrubAuditLines, scrubAuditText, scrubAuditValue } from "../security/auditScrub";
import type { FlightEvent, FlightEventKind } from "./types";

export interface RecordInput {
  missionId: string;
  kind: FlightEventKind;
  actor: string;
  /** Who authorised this: "policy:<name>", "human:<name>", "supervisor", "runtime". */
  authority: string;
  /** The policy rule that permitted it, or "none-required". */
  policy: string;
  reason: string;
  evidence?: string[];
  subjectId?: string | null;
  data?: Record<string, unknown>;
}

export interface RecorderSnapshot {
  events: FlightEvent[];
  nextSeq: number;
}

type Listener = (e: FlightEvent) => void;

const listeners = new Set<Listener>();

export function onFlightEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Append-only flight recorder, per mission.
 *
 * Persisted through the IPC layer when running natively; held in memory in the browser
 * preview. Either way it is the single authoritative trace of a mission.
 */
export class FlightRecorder {
  private events: FlightEvent[] = [];
  private nextSeq = 1;
  private readonly missionId: string;

  constructor(missionId: string, seed: FlightEvent[] = []) {
    this.missionId = missionId;
    this.events = [...seed];
    this.nextSeq = seed.length ? Math.max(...seed.map((e) => e.seq)) + 1 : 1;
  }

  /**
   * §25 Merge persisted history back in on resume. Existing sequence numbers are kept so a
   * restored mission's trace stays contiguous, and events already present are not duplicated.
   */
  seedHistory(events: FlightEvent[]): number {
    if (!events.length) return 0;
    const seen = new Set(this.events.map((e) => e.seq));
    let added = 0;
    for (const e of events) {
      if (seen.has(e.seq)) continue;
      this.events.push(e);
      seen.add(e.seq);
      added += 1;
    }
    this.events.sort((a, b) => a.seq - b.seq);
    this.nextSeq = this.events.length ? this.events[this.events.length - 1].seq + 1 : 1;
    return added;
  }

  record(input: Omit<RecordInput, "missionId"> & { missionId?: string }): FlightEvent {
    if (!input.actor) throw new Error("governance: every event needs an actor");
    if (!input.authority) throw new Error("governance: every event needs an authority");
    if (!input.reason) throw new Error("governance: every event needs a reason");
    /* §AUDIT SCRUB (claw-enterprise, MIT) — this is the ONE append path every
     * governed mutation goes through, so it is where the trail is scrubbed: a
     * human's denial reason quoting the token it was shown, a router rationale
     * carrying the endpoint it was refused, a tool's stderr tail with the git
     * remote in it. Scrubbed HERE rather than by caller discipline, because a
     * caller that forgets once leaves a secret in a document that is replayed,
     * exported and read by people other than the one who wrote it. Ordinary
     * prose is untouched — see src/security/auditScrub.ts.
     *
     * `seq`, `actor`, `authority`, `policy`, `subjectId` are this runtime's own
     * identifiers, never user text, so they pass through unscrubbed rather than
     * being treated as suspect. `reason` is validated ABOVE, on the caller's
     * string: the scrub must not be able to turn a real reason into an empty
     * one and then trip the "every event needs a reason" rule with a message
     * that blames the caller. */
    const event: FlightEvent = {
      seq: this.nextSeq++,
      missionId: input.missionId ?? this.missionId,
      ts: new Date().toISOString(),
      kind: input.kind,
      actor: input.actor,
      authority: input.authority,
      policy: input.policy || "none-required",
      reason: scrubAuditText(input.reason),
      evidence: scrubAuditLines(input.evidence),
      subjectId: input.subjectId ?? null,
      data: scrubAuditValue(input.data ?? {}) as Record<string, unknown>,
    };
    this.events.push(event);
    for (const fn of listeners) {
      try {
        fn(event);
      } catch {
        /* a broken listener must not break the mission */
      }
    }
    return event;
  }

  all(): FlightEvent[] {
    return [...this.events];
  }

  ofKind(...kinds: FlightEventKind[]): FlightEvent[] {
    const set = new Set(kinds);
    return this.events.filter((e) => set.has(e.kind));
  }

  forSubject(subjectId: string): FlightEvent[] {
    return this.events.filter((e) => e.subjectId === subjectId);
  }

  last(kind: FlightEventKind): FlightEvent | null {
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].kind === kind) return this.events[i];
    }
    return null;
  }

  count(kind: FlightEventKind): number {
    return this.events.filter((e) => e.kind === kind).length;
  }

  /**
   * §14 Replay. Returns the recorder state as it was after `uptoSeq` events.
   * Used by the flight-recorder UI to scrub the mission timeline.
   */
  replay(uptoSeq: number): FlightEvent[] {
    return this.events.filter((e) => e.seq <= uptoSeq);
  }

  /** Distinct sequence numbers, for the scrubber. */
  seqRange(): { min: number; max: number } {
    if (!this.events.length) return { min: 0, max: 0 };
    return { min: this.events[0].seq, max: this.events[this.events.length - 1].seq };
  }

  snapshot(): RecorderSnapshot {
    return { events: this.all(), nextSeq: this.nextSeq };
  }

  /**
   * Truncate everything after `uptoSeq` — used when rolling a mission back to a checkpoint
   * so the trace does not claim things that are no longer true. The truncation is itself
   * recorded first, so the rollback is visible.
   */
  truncateAfter(uptoSeq: number, reason: string): number {
    const removed = this.events.filter((e) => e.seq > uptoSeq).length;
    this.events = this.events.filter((e) => e.seq <= uptoSeq);
    this.nextSeq = uptoSeq + 1;
    if (removed > 0) {
      this.record({
        kind: "MISSION_ROLLED_BACK",
        actor: "flight-recorder",
        authority: "runtime",
        policy: "checkpoint.rollback",
        reason,
        data: { removedEvents: removed, uptoSeq },
      });
    }
    return removed;
  }

  get length(): number {
    return this.events.length;
  }
}

/** Process-wide registry so pages can find the recorder for an open mission. */
const recorders = new Map<string, FlightRecorder>();

export function recorderFor(missionId: string, seed?: FlightEvent[]): FlightRecorder {
  let r = recorders.get(missionId);
  if (!r) {
    r = new FlightRecorder(missionId, seed);
    recorders.set(missionId, r);
  }
  return r;
}

export function dropRecorder(missionId: string): void {
  recorders.delete(missionId);
}

export function allRecorders(): FlightRecorder[] {
  return [...recorders.values()];
}

/**
 * Governance assertion. Throws when an action lacks the authority to happen, so a
 * mis-wired caller fails loudly instead of mutating silently.
 */
export function assertAuthority(action: string, authority: string, allowed: string[]): void {
  if (!allowed.includes(authority)) {
    throw new Error(
      `governance: ${action} requires authority in [${allowed.join(", ")}] but was attempted with "${authority}"`,
    );
  }
}

export function newGovernanceId(prefix: string): string {
  return uid(prefix);
}
