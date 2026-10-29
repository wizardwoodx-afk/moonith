/**
 * PROPRIETARY - SelfImpulse Promey Duet Engine
 * Master Promey Kernel: Proactive Autonomous Assistant Substrate
 */

import { PromeyMorningBriefEngine } from './morningBrief';
import { PromeyTriageEngine } from './triageEngine';
import { PromeyApprovalGate } from './approvalGate';
import { PromeyPrivacyGuard } from './privacyGuard';
import { PromeyRoutineWorker } from './routineWorker';
import { PromeyDuetProtocol } from './duetProtocol';
import type { 
  PromeyMorningBrief, 
  PromeyTriageItem, 
  PromeyApprovalItem, 
  ApprovalDecision, 
  ConsequenceLevel,
  PromeyPrivacySanitizeResult,
  PromeyDuetStateDelta,
  PromeyGenerativeUiWidget
} from './types';

export class PromeyKernel {
  public readonly briefs: PromeyMorningBriefEngine;
  public readonly triage: PromeyTriageEngine;
  public readonly approvals: PromeyApprovalGate;
  public readonly privacy: PromeyPrivacyGuard;
  public readonly routines: PromeyRoutineWorker;
  public readonly protocol: PromeyDuetProtocol;

  constructor() {
    this.briefs = new PromeyMorningBriefEngine();
    this.triage = new PromeyTriageEngine();
    this.approvals = new PromeyApprovalGate();
    this.privacy = new PromeyPrivacyGuard();
    this.routines = new PromeyRoutineWorker();
    this.protocol = new PromeyDuetProtocol();
  }

  /**
   * Synthesize proactive morning brief using live triage and pending approvals
   */
  public generateMorningBrief(userName?: string, workspaceName?: string): PromeyMorningBrief {
    const brief = this.briefs.generateBrief({
      userName,
      workspaceName,
      triageItems: this.triage.listItems(),
      pendingApprovals: this.approvals.listPending(),
      routines: this.routines.listRoutines(),
      recentAccomplishments: ['RSIRALS 8-module substrate promoted and verified', 'Rook perception engine ready']
    });

    // Also emit generative UI widget for the brief
    this.protocol.emitGenerativeUi({
      type: 'brief_summary',
      title: brief.headline,
      data: {
        briefId: brief.briefId,
        date: brief.date,
        highPriorityCount: brief.highPriorityItems.length,
        pendingApprovalsCount: brief.pendingApprovals.length
      }
    });

    return brief;
  }

  /**
   * Ingest and prioritize incoming stream or notification
   */
  public triageStream(item: {
    source: PromeyTriageItem['source'];
    title: string;
    content: string;
    urgency?: PromeyTriageItem['urgency'];
    category?: PromeyTriageItem['category'];
  }): PromeyTriageItem {
    const ingested = this.triage.ingestItem({
      source: item.source,
      title: item.title,
      content: item.content,
      urgency: item.urgency || 'normal',
      category: item.category || 'action_required'
    });

    // If critical, immediately emit a generative UI notification widget
    if (ingested.urgency === 'critical' || ingested.urgency === 'high') {
      this.protocol.emitGenerativeUi({
        type: 'triage_list',
        title: `Priority Alert: ${ingested.title}`,
        data: { itemId: ingested.id, content: ingested.content, source: ingested.source },
        actionOptions: [
          { label: 'Resolve', actionId: `resolve:${ingested.id}`, style: 'primary' },
          { label: 'Dismiss', actionId: `dismiss:${ingested.id}`, style: 'ghost' }
        ]
      });
    }

    return ingested;
  }

  /**
   * Request human approval for a high-consequence action
   */
  public requestConsequentialApproval(params: {
    actionType: string;
    title: string;
    description: string;
    targetResource: string;
    parameters?: Record<string, unknown>;
    consequenceLevel?: ConsequenceLevel;
  }): { item: PromeyApprovalItem; autoApproved: boolean; autoRefused: boolean } {
    const req = this.approvals.requestApproval(params);

    if (!req.autoApproved && !req.autoRefused) {
      // Emit interactive Generative UI Approval Card
      this.protocol.emitGenerativeUi({
        type: 'approval_card',
        title: `Approval Required: ${req.item.title}`,
        data: {
          approvalId: req.item.id,
          actionType: req.item.actionType,
          description: req.item.description,
          targetResource: req.item.targetResource,
          consequenceLevel: req.item.consequenceLevel
        },
        actionOptions: [
          { label: 'Allow Once', actionId: `allow_once:${req.item.id}`, style: 'primary' },
          { label: 'Always Allow', actionId: `always_allowed:${req.item.id}`, style: 'primary' },
          { label: 'Refuse', actionId: `refuse:${req.item.id}`, style: 'danger' }
        ]
      });
    }

    return req;
  }

  /**
   * Decide on a pending approval
   */
  public submitApprovalDecision(
    approvalId: string, 
    decision: ApprovalDecision, 
    note?: string
  ): { success: boolean; item?: PromeyApprovalItem; error?: string } {
    return this.approvals.submitDecision(approvalId, decision, note);
  }

  /**
   * Privacy boundary sanitization (credential masking + DLP scan)
   */
  public sanitizeOutbound(text: string): PromeyPrivacySanitizeResult {
    return this.privacy.sanitizeOutbound(text);
  }

  public maskSecret(secretValue: string, label?: string): string {
    return this.privacy.maskCredential(secretValue, label);
  }

  /**
   * Master status telemetry
   */
  public getStatus() {
    return {
      ready: true,
      triage: this.triage.getTelemetry(),
      approvals: this.approvals.getTelemetry(),
      privacy: this.privacy.getTelemetry(),
      routines: this.routines.getTelemetry(),
      protocol: this.protocol.getTelemetry(),
      latestBrief: this.briefs.getLatestBrief() || null
    };
  }
}
