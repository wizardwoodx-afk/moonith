/**
 * PROPRIETARY - SelfImpulse Promey Duet Engine
 * Background Routine Scheduler & Standing Instructions Worker
 */

import crypto from 'node:crypto';
import type { PromeyStandingRoutine } from './types';

export class PromeyRoutineWorker {
  private routines: Map<string, PromeyStandingRoutine> = new Map();
  private executionCount = 0;

  constructor() {
    this.seedDefaultRoutines();
  }

  private seedDefaultRoutines(): void {
    this.registerRoutine({
      name: 'Daily Morning Brief',
      cadence: 'daily_morning',
      standingPrompt: 'Synthesize critical inbox triage, pending approvals, and workspace roadmap items into an actionable morning brief.'
    });

    this.registerRoutine({
      name: 'Continuous Triage Sentinel',
      cadence: 'hourly',
      standingPrompt: 'Scan git status, active file locks, and CI signals for high-urgency interruptions.'
    });
  }

  public registerRoutine(params: {
    name: string;
    cadence: string;
    standingPrompt: string;
  }): PromeyStandingRoutine {
    const id = `routine-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const routine: PromeyStandingRoutine = {
      id,
      name: params.name,
      cadence: params.cadence,
      standingPrompt: params.standingPrompt,
      active: true
    };
    this.routines.set(id, routine);
    return routine;
  }

  public toggleRoutine(id: string, active: boolean): boolean {
    const r = this.routines.get(id);
    if (!r) return false;
    r.active = active;
    return true;
  }

  public recordRun(id: string, outcomeDigest: string): boolean {
    const r = this.routines.get(id);
    if (!r) return false;
    r.lastRunAt = new Date().toISOString();
    r.lastOutcomeDigest = outcomeDigest;
    this.executionCount++;
    return true;
  }

  public listRoutines(): PromeyStandingRoutine[] {
    return Array.from(this.routines.values());
  }

  public getTelemetry(): {
    totalRoutines: number;
    activeRoutines: number;
    totalExecutions: number;
  } {
    const list = Array.from(this.routines.values());
    return {
      totalRoutines: list.length,
      activeRoutines: list.filter((r) => r.active).length,
      totalExecutions: this.executionCount
    };
  }
}
