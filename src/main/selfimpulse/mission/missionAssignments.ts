/**
 * §THE ASSIGNMENTS — who runs, in which wave, and where the dispatch notice
 * goes.
 *
 * These two functions used to live inside `missionLoop.ts`. They moved here
 * when the mission cycle became a GRAPH (`runGraph.ts`): the graph's compose
 * and dispatch steps need them, and a graph that had to reach back into the
 * orchestrator that drives it would be a cycle in the module graph.
 *
 * Nothing about them changed. The recipe is the same, the channels are the
 * same, and `missionLoop.ts` re-exports both, so every existing import path
 * — the Loop page, the probes — keeps working unchanged.
 */
import type { CliAgentTeam, TeamSeat } from "./agentTeam";
import type { SeatAssignment } from "./teamExecutor";

/**
 * The TeamsPage assignment recipe, owned by the loop: one assignment per
 * seat, waves by role, read-only for non-writers, prompt = instructions +
 * objective.
 */
export function composeAssignments(team: CliAgentTeam, objective: string): SeatAssignment[] {
  return team.seats.map((s, idx) => ({
    seat: s,
    prompt: `${s.instructions ? `${s.instructions}\n\n` : ""}Objective: ${objective}\nScope: Touch only authorized files.`,
    wave: s.role === "planner" || s.role === "architect" ? 1 : s.mayWrite ? 2 : 3,
    readOnly: !s.mayWrite,
    turnNumber: idx + 1,
  }));
}

/** The inter-agent channel a seat's dispatch notice belongs on. */
export function dispatchChannel(role: string): string {
  if (role === "planner" || role === "architect") return "#architecture";
  if (role === "coder" || role === "debugger") return "#implementation-sync";
  if (role === "tester" || role === "security" || role === "reviewer") return "#qa-review";
  return "#general";
}

/** The seat a dispatch notice names. */
export type DispatchSeat = TeamSeat;
