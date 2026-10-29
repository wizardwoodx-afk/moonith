/**
 * PROPRIETARY - SelfImpulse Promey Duet Engine
 * Human-in-the-Loop Tri-Choice Approval Gate
 */

import crypto from 'node:crypto';
import type { PromeyApprovalItem, ApprovalDecision, ConsequenceLevel } from './types';

export class PromeyApprovalGate {
  private approvals: Map<string, PromeyApprovalItem> = new Map();
  private alwaysAllowedPatterns: Set<string> = new Set();
  private refusedPatterns: Set<string> = new Set();

  /**
   * Request human approval for a consequential action
   */
  public requestApproval(params: {
    actionType: string;
    title: string;
    description: string;
    targetResource: string;
    parameters?: Record<string, unknown>;
    consequenceLevel?: ConsequenceLevel;
  }): { item: PromeyApprovalItem; autoApproved: boolean; autoRefused: boolean } {
    const patternKey = `${params.actionType}:${params.targetResource}`;

    // Check always-allowed whitelist
    if (this.alwaysAllowedPatterns.has(patternKey) || this.alwaysAllowedPatterns.has(params.actionType)) {
      const autoItem: PromeyApprovalItem = {
        id: `appr-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        actionType: params.actionType,
        title: params.title,
        description: params.description,
        targetResource: params.targetResource,
        parameters: params.parameters || {},
        consequenceLevel: params.consequenceLevel || 'medium',
        status: 'always_allowed',
        requestedAt: new Date().toISOString(),
        decidedAt: new Date().toISOString(),
        decisionNote: 'Auto-approved via persistent Promey always-allowed rule.'
      };
      this.approvals.set(autoItem.id, autoItem);
      return { item: autoItem, autoApproved: true, autoRefused: false };
    }

    // Check permanently refused blocklist
    if (this.refusedPatterns.has(patternKey)) {
      const refusedItem: PromeyApprovalItem = {
        id: `appr-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        actionType: params.actionType,
        title: params.title,
        description: params.description,
        targetResource: params.targetResource,
        parameters: params.parameters || {},
        consequenceLevel: params.consequenceLevel || 'high',
        status: 'refused',
        requestedAt: new Date().toISOString(),
        decidedAt: new Date().toISOString(),
        decisionNote: 'Auto-refused via persistent blocklist rule.'
      };
      this.approvals.set(refusedItem.id, refusedItem);
      return { item: refusedItem, autoApproved: false, autoRefused: true };
    }

    const item: PromeyApprovalItem = {
      id: `appr-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      actionType: params.actionType,
      title: params.title,
      description: params.description,
      targetResource: params.targetResource,
      parameters: params.parameters || {},
      consequenceLevel: params.consequenceLevel || 'medium',
      status: 'pending',
      requestedAt: new Date().toISOString()
    };

    this.approvals.set(item.id, item);
    return { item, autoApproved: false, autoRefused: false };
  }

  /**
   * Submit human decision: 'allow_once' | 'always_allowed' | 'refused'
   */
  public submitDecision(
    approvalId: string, 
    decision: ApprovalDecision, 
    note?: string
  ): { success: boolean; item?: PromeyApprovalItem; error?: string } {
    const item = this.approvals.get(approvalId);
    if (!item) {
      return { success: false, error: `Approval item ${approvalId} not found.` };
    }

    item.status = decision;
    item.decidedAt = new Date().toISOString();
    item.decisionNote = note;

    const patternKey = `${item.actionType}:${item.targetResource}`;
    if (decision === 'always_allowed') {
      this.alwaysAllowedPatterns.add(patternKey);
    } else if (decision === 'refused' && note?.includes('never')) {
      this.refusedPatterns.add(patternKey);
    }

    return { success: true, item };
  }

  public listPending(): PromeyApprovalItem[] {
    return Array.from(this.approvals.values()).filter((a) => a.status === 'pending');
  }

  public listAll(): PromeyApprovalItem[] {
    return Array.from(this.approvals.values());
  }

  public getTelemetry(): {
    totalRequestsCount: number;
    pendingCount: number;
    allowedOnceCount: number;
    alwaysAllowedCount: number;
    refusedCount: number;
  } {
    const all = Array.from(this.approvals.values());
    return {
      totalRequestsCount: all.length,
      pendingCount: all.filter((a) => a.status === 'pending').length,
      allowedOnceCount: all.filter((a) => a.status === 'allow_once').length,
      alwaysAllowedCount: all.filter((a) => a.status === 'always_allowed').length,
      refusedCount: all.filter((a) => a.status === 'refused').length
    };
  }
}
