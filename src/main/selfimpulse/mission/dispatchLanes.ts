/**
 * §DISPATCH LANES — a bounded ceiling on concurrent seats. SelfImpulse's lift
 * from the `claw-enterprise` controller's credential queue
 * (`apps/controller/src/drivers/repo/credentials/provider-queue.ts`, MIT —
 * Copyright (c) 2026 OpenAI; licence text at `LICENSES/claw-enterprise-MIT.txt`).
 *
 * WHY WE NEEDED IT
 * `executeTeam` drains a wave with `Promise.all`: every seat in the wave starts
 * at the same instant. That was defensible while a seat was an external CLI
 * process the operator sized by hand. Since 19.7.15 a seat runs an in-process
 * agent loop against the owner's provider key, and nothing in this repository
 * ceilings `team.seats` — `validateTeam` in `src/mission/agentTeam.ts` checks
 * role shape, never count, and `composeAssignments` in `missionLoop.ts` emits
 * one seat per roster entry. A 60-seat desk is therefore 60 simultaneous
 * provider streams opened in the same tick: a spend incident, a rate-limit
 * incident (`engine/generalist.ts` names a 25-stream fan-out as "a 429 waiting
 * to" happen), and — the safety half — 60 live write-capable loops over 60
 * worktrees with only the per-wave budget reservation between them and the cap.
 * The crew layer already bounds itself (`CREW_CONCURRENCY` in
 * `src/engine/crew.ts`); the executor layer was the one that did not.
 *
 * WHAT WAS ADOPTED
 * The queue's three real properties, not its names:
 *   1. BOUNDED — at most `concurrency` tasks run at once; the rest wait.
 *   2. TWO LANES, NOT ONE QUEUE — admitted work and housekeeping drain ahead of
 *      teardown-shaped work, but housekeeping gets a streak cap so a continuous
 *      stream of it can never starve an admitted request (upstream allows an
 *      admitted request through after two cleanup actions; the same number is
 *      kept here because it is the smallest one that still makes fairness
 *      observable).
 *   3. A FULL LANE REFUSES IN WORDS — it does not grow, and it does not drop
 *      the work silently.
 *
 * WHAT WAS NOT, AND WHY
 *   - Upstream's `waitWithin` deadline helper is NOT re-implemented. This
 *     repository already owns that seam: `withDeadline` in `src/mission/caps.ts`
 *     races work against a wall clock and is what seats use today. A second
 *     deadline helper beside it would be a second answer to one question.
 *   - The `AbortSignal` arm is replaced by a `stopReason` predicate consulted
 *     immediately before a queued task is started, not by a signal object. The
 *     reason is this codebase's own: the thing that stops a run is a measured
 *     refusal (`req.ledger.admissionError()` — cost, turns, invocations, wall
 *     clock), not an external caller holding a handle. A predicate that returns
 *     the sentence keeps the refusal in the run's voice and needs no
 *     controller, no listener and no timer.
 *   - Upstream's `Clock` seam is dropped for the same reason: nothing here reads
 *     a monotonic clock, and the two counters this queue exposes are derived from
 *     the queue's own state rather than measured from time.
 */

/** Which lane a queued unit of work belongs to. */
export type DispatchLane = "foreground" | "housekeeping";

/** How many housekeeping entries may run before an admitted foreground entry is
 *  forced through, even when housekeeping keeps arriving. Two is upstream's
 *  number and it is kept: one would make fairness a formality, three starts to
 *  look like a tuning knob nobody measured. */
export const HOUSEKEEPING_STREAK_CAP = 2;

/** The ceiling this product ships with.
 *
 * 8, because it is the number the surrounding facts support rather than a
 * round one: `DEFAULT_CAPS` in `src/mission/caps.ts` gives a seat a 10-minute
 * window and 40 turns, `INBOUND_DELEGATION_CAPS` declares exactly two seats and
 * `maxInvocations: 4` for a remote caller, and `seat.timeoutSecs` defaults to
 * 600. Eight concurrent in-process loops is the point where a full desk of
 * writers still drains in a small number of passes while staying well under the
 * fan-out `generalist.ts` flags as a rate-limit incident. It is a ceiling, not a
 * target: a 3-seat team is unaffected. */
export const SEAT_LANE_CONCURRENCY = 8;

/** One seat's refusal when the lane cannot take it.
 *
 * An error CLASS rather than a string, so a caller can tell "the lane refused
 * to start this" from "this started and threw" without matching on prose — the
 * distinction decides whether the run records an unrun seat or fails. */
export class LaneRefusalError extends Error {
  readonly laneRefused = true;
  constructor(message: string) {
    super(message);
    this.name = "LaneRefusalError";
  }
}

/** True when the thrown value is a lane refusal and not a task failure. */
export function isLaneRefusal(e: unknown): e is LaneRefusalError {
  return e instanceof LaneRefusalError;
}

export interface LaneRunOptions {
  /** `foreground` is work the run was asked to do; `housekeeping` is the work
   *  that must still happen when nothing else does. Default `foreground`. */
  priority?: DispatchLane;
  /** Consulted IMMEDIATELY before a queued entry is started, and again at
   *  enqueue. A non-null return means the run has been stopped since this entry
   *  was queued, and the entry is refused with that sentence instead of
   *  starting — the property a bounded queue newly needs, because an entry that
   *  waits can be overtaken by a stop. */
  stopReason?: () => string | null;
}

export interface DispatchLanes {
  /** Run one unit of work under the ceiling. Rejects with a sentence when the
   *  lane is full at enqueue, or when a stop arrived while it was waiting. */
  run<T>(task: () => Promise<T>, opts?: LaneRunOptions): Promise<T>;
  /** Register a readiness notification: called the moment the queue has room.
   *  Fires immediately when there already is room. */
  whenAvailable(notify: () => void): void;
  /** Entries waiting or running. */
  readonly pending: number;
  readonly waiting: number;
  readonly running: number;
  /** Everything a report needs to say what the lane did, in this queue's own
   *  vocabulary and nothing else's. */
  snapshot(): {
    concurrency: number;
    maximumQueued: number;
    running: number;
    waiting: number;
    startedByLane: Record<DispatchLane, number>;
    refused: string[];
    longestHousekeepingStreak: number;
  };
}

/**
 * Create a bounded, two-lane dispatch queue.
 *
 * `maximumQueued` caps the entries WAITING for a lane — it does not count the
 * `concurrency` entries already running, so the largest number of entries the
 * queue can hold at once is `concurrency + maximumQueued`. That is deliberate
 * rather than an off-by-one: "how many may be waiting" is the property a caller
 * can reason about, whereas a single combined figure would move depending on how
 * many lanes happened to be busy at the instant of the check.
 *
 * The ceiling is deliberately caller-supplied rather than `Infinity`: a queue
 * with no ceiling is the thing this module exists to replace, and a caller that
 * says "however many" has not decided anything. Passing a value smaller than the
 * number of entries the caller may enqueue is a bug the refusal will surface
 * loudly, which is the point.
 */
export function createDispatchLanes(args: {
  concurrency?: number;
  maximumQueued?: number;
  housekeepingStreakCap?: number;
}): DispatchLanes {
  const concurrency = Math.max(1, Math.floor(args.concurrency ?? SEAT_LANE_CONCURRENCY));
  const maximumQueued = Math.max(1, Math.floor(args.maximumQueued ?? concurrency));
  const streakCap = Math.max(1, Math.floor(args.housekeepingStreakCap ?? HOUSEKEEPING_STREAK_CAP));

  type Entry = {
    priority: DispatchLane;
    run: () => Promise<void>;
    refuse: (reason: string) => void;
    stopReason?: () => string | null;
  };

  const waiting: Entry[] = [];
  const readiness = new Set<() => void>();
  const refusals: string[] = [];
  const started = { foreground: 0, housekeeping: 0 };
  let running = 0;
  let housekeepingStreak = 0;
  let longestHousekeepingStreak = 0;

  /** Notify waiters only once there is genuinely room, so a subscriber cannot be
   *  told "ready" and then be refused by the same count that triggered it. */
  function notifyRoom(): void {
    if (waiting.length >= maximumQueued) return;
    const ready = [...readiness];
    readiness.clear();
    for (const notify of ready) notify();
  }

  /** Pick the next entry. Foreground wins; housekeeping wins only while its
   *  streak is under the cap or there is no foreground entry to displace. */
  function pickIndex(): number {
    const foreground = waiting.findIndex((e) => e.priority === "foreground");
    const housekeeping = waiting.findIndex((e) => e.priority === "housekeeping");
    if (housekeeping < 0) return foreground >= 0 ? foreground : waiting.length ? 0 : -1;
    if (foreground < 0) return housekeeping;
    return housekeepingStreak < streakCap ? housekeeping : foreground;
  }

  function advance(): void {
    if (running >= concurrency) return;
    const index = pickIndex();
    if (index < 0) {
      if (waiting.length === 0) notifyRoom();
      return;
    }
    const next = waiting.splice(index, 1)[0];

    /* THE STOP CHECK. An entry that waited behind the ceiling may be starting
     * after the run was stopped; it must refuse rather than begin. This is also
     * the check that makes `stopReason` honest: it is read at the moment the
     * effect would happen, not when the caller asked. */
    const stop = next.stopReason ? next.stopReason() : null;
    if (stop) {
      refusals.push(stop);
      next.refuse(stop);
      advance();
      return;
    }

    housekeepingStreak = next.priority === "housekeeping" ? housekeepingStreak + 1 : 0;
    longestHousekeepingStreak = Math.max(longestHousekeepingStreak, housekeepingStreak);
    started[next.priority] += 1;
    running += 1;
    void next.run().finally(() => {
      running -= 1;
      advance();
      notifyRoom();
    });
    if (running < concurrency) advance();
  }

  return Object.freeze({
    run<T>(task: () => Promise<T>, opts: LaneRunOptions = {}): Promise<T> {
      const priority: DispatchLane = opts.priority === "housekeeping" ? "housekeeping" : "foreground";
      const stopReason = opts.stopReason;

      /* Refuse at the door too. An entry that is already past the ceiling is not
       * queued to be refused later — the caller hears immediately, in a
       * sentence, and can record the seat as unrun. */
      const alreadyStopped = stopReason ? stopReason() : null;
      if (alreadyStopped) {
        refusals.push(alreadyStopped);
        return Promise.reject(new LaneRefusalError(alreadyStopped));
      }
      if (waiting.length >= maximumQueued) {
        const reason =
          `the dispatch lane is full — ${waiting.length} of ${maximumQueued} queued entries are already waiting ` +
          `under a ceiling of ${concurrency} concurrent ${concurrency === 1 ? "seat" : "seats"}. ` +
          `Refused rather than growing the queue, because an unbounded lane is the thing this guard replaces.`;
        refusals.push(reason);
        return Promise.reject(new LaneRefusalError(reason));
      }

      return new Promise<T>((resolve, reject) => {
        const entry: Entry = {
          priority,
          stopReason,
          refuse: (reason) => reject(new LaneRefusalError(reason)),
          run: async () => {
            try {
              resolve(await task());
            } catch (e) {
              // The task's own failure is the caller's to classify; the lane does
              // not convert an exception into a refusal, it only passes it on.
              reject(e instanceof Error ? e : new Error(String(e)));
            }
          },
        };
        waiting.push(entry);
        advance();
      });
    },
    whenAvailable(notify: () => void) {
      if (waiting.length < maximumQueued) notify();
      else readiness.add(notify);
    },
    get pending() {
      return waiting.length + running;
    },
    get waiting() {
      return waiting.length;
    },
    get running() {
      return running;
    },
    snapshot() {
      return {
        concurrency,
        maximumQueued,
        running,
        waiting: waiting.length,
        startedByLane: { ...started },
        refused: [...refusals],
        longestHousekeepingStreak,
      };
    },
  });
}

/**
 * Which lane a seat belongs to.
 *
 * A seat that may write is the work the run was asked for — it produces the
 * bytes, and the reviewers are useless until it exists. A read-only seat is
 * housekeeping in this queue's precise sense: it must still run, and the gate
 * verdict depends on it, but it consumes a lane behind an unstarted writer
 * without delaying anything the writers depend on.
 *
 * This is not a ranking of importance. It is an ordering of *dependency*: the
 * reviewer reviews the writer's output, so starting the reviewer first can only
 * waste a lane.
 */
export function laneForSeat(mayWrite: boolean): DispatchLane {
  return mayWrite ? "foreground" : "housekeeping";
}
