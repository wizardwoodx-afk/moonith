/**
 * PROPRIETARY - SelfImpulse Promey Engine Bridge
 * Interfaces the Promey Proactive Duet Engine into SelfImpulse's core execution loop.
 */

import { PromeyKernel } from '../promey/promeyKernel';
import type { 
  PromeyMorningBrief, 
  PromeyTriageItem, 
  PromeyApprovalItem, 
  ApprovalDecision, 
  ConsequenceLevel,
  PromeyPrivacySanitizeResult
} from '../promey/types';

export class PromeyEngineBridge {
  private static instance: PromeyEngineBridge;
  private kernel: PromeyKernel;

  private constructor() {
    this.kernel = new PromeyKernel();
  }

  public static getInstance(): PromeyEngineBridge {
    if (!PromeyEngineBridge.instance) {
      PromeyEngineBridge.instance = new PromeyEngineBridge();
    }
    return PromeyEngineBridge.instance;
  }

  public getKernel(): PromeyKernel {
    return this.kernel;
  }

  public generateMorningBrief(userName?: string, workspaceName?: string): PromeyMorningBrief {
    return this.kernel.generateMorningBrief(userName, workspaceName);
  }

  public triageStream(item: {
    source: PromeyTriageItem['source'];
    title: string;
    content: string;
    urgency?: PromeyTriageItem['urgency'];
    category?: PromeyTriageItem['category'];
  }): PromeyTriageItem {
    return this.kernel.triageStream(item);
  }

  public requestApproval(params: {
    actionType: string;
    title: string;
    description: string;
    targetResource: string;
    parameters?: Record<string, unknown>;
    consequenceLevel?: ConsequenceLevel;
  }): { item: PromeyApprovalItem; autoApproved: boolean; autoRefused: boolean } {
    return this.kernel.requestConsequentialApproval(params);
  }

  public submitApprovalDecision(
    approvalId: string, 
    decision: ApprovalDecision, 
    note?: string
  ): { success: boolean; item?: PromeyApprovalItem; error?: string } {
    return this.kernel.submitApprovalDecision(approvalId, decision, note);
  }

  public sanitizeOutbound(text: string): PromeyPrivacySanitizeResult {
    return this.kernel.sanitizeOutbound(text);
  }

  public maskSecret(secretValue: string, label?: string): string {
    return this.kernel.maskSecret(secretValue, label);
  }

  public getStatus() {
    return this.kernel.getStatus();
  }
}

export const promeyEngineBridge = PromeyEngineBridge.getInstance();
