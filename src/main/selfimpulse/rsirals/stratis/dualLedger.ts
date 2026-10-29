/**
 * PROPRIETARY - SelfImpulse RSIRALS Stratis
 * Dual-Ledger Orchestrator Subsystem
 * Inspired by Microsoft AGT / Magentic-One without external vendor dependencies.
 */

import crypto from 'node:crypto'

export type SpecialistRole = 'orchestrator' | 'researcher' | 'coder' | 'terminal' | 'auditor';

export interface MilestoneItem {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  completedAt?: number;
  evidenceRef?: string;
}

export interface GroundedFact {
  key: string;
  fact: string;
  source: string;
  verified: boolean;
  timestamp: number;
}

export interface TaskLedger {
  globalObjective: string;
  milestones: MilestoneItem[];
  knownFacts: GroundedFact[];
  hypotheses: string[];
  createdAt: number;
  lastUpdatedAt: number;
}

export interface ProgressStepRecord {
  stepId: string;
  subtask: string;
  assignedRole: SpecialistRole;
  actionTaken: string;
  outcomeStatus: 'ok' | 'failed' | 'retrying';
  toolOutputExcerpt?: string;
  timestamp: number;
}

export interface ProgressLedger {
  activeSubtask: string;
  currentRole: SpecialistRole;
  currentStepNumber: number;
  stallCount: number; // Detects repetitive non-progress loops
  recentSteps: ProgressStepRecord[];
  lastResult?: unknown;
}

export class DualLedgerOrchestrator {
  private taskLedger: TaskLedger;
  private progressLedger: ProgressLedger;

  constructor(globalObjective: string = 'General Task Execution') {
    this.taskLedger = {
      globalObjective,
      milestones: [],
      knownFacts: [],
      hypotheses: [],
      createdAt: Date.now(),
      lastUpdatedAt: Date.now()
    };

    this.progressLedger = {
      activeSubtask: 'Initialization',
      currentRole: 'orchestrator',
      currentStepNumber: 0,
      stallCount: 0,
      recentSteps: []
    };
  }

  /* -----------------------------------------------------------------------
   * 1. TASK LEDGER (OUTER LOOP) MANAGEMENT
   * ----------------------------------------------------------------------- */
  public setGlobalObjective(objective: string): void {
    this.taskLedger.globalObjective = objective;
    this.taskLedger.lastUpdatedAt = Date.now();
  }

  public addMilestone(title: string): string {
    const id = `ms_${this.taskLedger.milestones.length + 1}`;
    this.taskLedger.milestones.push({
      id,
      title,
      status: 'pending'
    });
    this.taskLedger.lastUpdatedAt = Date.now();
    return id;
  }

  public updateMilestoneStatus(
    milestoneId: string,
    status: MilestoneItem['status'],
    evidenceRef?: string
  ): boolean {
    const ms = this.taskLedger.milestones.find((m) => m.id === milestoneId);
    if (!ms) return false;

    ms.status = status;
    if (status === 'completed') {
      ms.completedAt = Date.now();
      ms.evidenceRef = evidenceRef;
    }
    this.taskLedger.lastUpdatedAt = Date.now();
    return true;
  }

  public recordFact(key: string, fact: string, source: string = 'execution_result'): void {
    const existing = this.taskLedger.knownFacts.find((f) => f.key === key);
    if (existing) {
      existing.fact = fact;
      existing.source = source;
      existing.timestamp = Date.now();
    } else {
      this.taskLedger.knownFacts.push({
        key,
        fact,
        source,
        verified: true,
        timestamp: Date.now()
      });
    }
    this.taskLedger.lastUpdatedAt = Date.now();
  }

  public addHypothesis(hypothesis: string): void {
    if (!this.taskLedger.hypotheses.includes(hypothesis)) {
      this.taskLedger.hypotheses.push(hypothesis);
      this.taskLedger.lastUpdatedAt = Date.now();
    }
  }

  /* -----------------------------------------------------------------------
   * 2. PROGRESS LEDGER (INNER LOOP) MANAGEMENT
   * ----------------------------------------------------------------------- */
  public beginSubtask(subtask: string, role: SpecialistRole = 'coder'): void {
    this.progressLedger.activeSubtask = subtask;
    this.progressLedger.currentRole = role;
    this.progressLedger.currentStepNumber++;
  }

  public recordStepResult(
    actionTaken: string,
    outcomeStatus: ProgressStepRecord['outcomeStatus'],
    toolOutputExcerpt?: string
  ): void {
    const stepId = `step_${this.progressLedger.currentStepNumber}_${Date.now()}`;
    const record: ProgressStepRecord = {
      stepId,
      subtask: this.progressLedger.activeSubtask,
      assignedRole: this.progressLedger.currentRole,
      actionTaken,
      outcomeStatus,
      toolOutputExcerpt: toolOutputExcerpt?.slice(0, 300),
      timestamp: Date.now()
    };

    this.progressLedger.recentSteps.push(record);
    if (this.progressLedger.recentSteps.length > 20) {
      this.progressLedger.recentSteps.shift();
    }

    if (outcomeStatus === 'failed') {
      this.progressLedger.stallCount++;
    } else {
      this.progressLedger.stallCount = 0;
    }
  }

  public isStalled(threshold: number = 3): boolean {
    return this.progressLedger.stallCount >= threshold;
  }

  /* -----------------------------------------------------------------------
   * 3. COMPREHENSIVE DUAL-LEDGER SNAPSHOT
   * ----------------------------------------------------------------------- */
  public getSnapshot(): {
    taskLedger: TaskLedger;
    progressLedger: ProgressLedger;
    progressPercentage: number;
    isStalled: boolean;
  } {
    const totalMilestones = this.taskLedger.milestones.length;
    const completedMilestones = this.taskLedger.milestones.filter((m) => m.status === 'completed').length;
    const progressPercentage = totalMilestones > 0 
      ? Math.round((completedMilestones / totalMilestones) * 100) 
      : 0;

    return {
      taskLedger: JSON.parse(JSON.stringify(this.taskLedger)),
      progressLedger: JSON.parse(JSON.stringify(this.progressLedger)),
      progressPercentage,
      isStalled: this.isStalled()
    };
  }
}
