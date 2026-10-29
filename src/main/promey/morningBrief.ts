/**
 * PROPRIETARY - SelfImpulse Promey Duet Engine
 * Morning Brief & Daily Prioritization Engine
 */

import crypto from 'node:crypto';
import type { 
  PromeyMorningBrief, 
  PromeyTriageItem, 
  PromeyApprovalItem, 
  PromeyStandingRoutine 
} from './types';

export class PromeyMorningBriefEngine {
  private briefsHistory: Map<string, PromeyMorningBrief> = new Map();

  /**
   * Synthesize a structured morning brief
   */
  public generateBrief(params: {
    userName?: string;
    workspaceName?: string;
    triageItems: PromeyTriageItem[];
    pendingApprovals: PromeyApprovalItem[];
    routines: PromeyStandingRoutine[];
    recentAccomplishments?: string[];
  }): PromeyMorningBrief {
    const briefId = `brief-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const today = new Date().toISOString().split('T')[0];
    const user = params.userName || 'Operator';
    const workspace = params.workspaceName || 'Current Workspace';

    const highPriority = params.triageItems.filter(
      (item) => (item.urgency === 'critical' || item.urgency === 'high') && item.status !== 'resolved'
    );

    const activeRoutines = params.routines.filter((r) => r.active);

    const headline = highPriority.length > 0
      ? `Good morning, ${user}. ${highPriority.length} item(s) require your attention in ${workspace}.`
      : `Good morning, ${user}. All background routines are active and clean.`;

    let summaryMarkdown = `## Daily Executive Briefing · ${today}\n\n`;
    summaryMarkdown += `**${headline}**\n\n`;

    if (params.pendingApprovals.length > 0) {
      summaryMarkdown += `### ⚠️ Pending Approvals (${params.pendingApprovals.length})\n`;
      for (const app of params.pendingApprovals.slice(0, 5)) {
        summaryMarkdown += `* **[${app.consequenceLevel.toUpperCase()}]** ${app.title} — *${app.description}*\n`;
      }
      summaryMarkdown += `\n`;
    }

    if (highPriority.length > 0) {
      summaryMarkdown += `### 📌 Critical & High Priority Stream (${highPriority.length})\n`;
      for (const item of highPriority.slice(0, 5)) {
        summaryMarkdown += `* **[${item.source}]** ${item.title} — *${item.content}*\n`;
      }
      summaryMarkdown += `\n`;
    }

    if (activeRoutines.length > 0) {
      summaryMarkdown += `### 🔄 Active Standing Routines (${activeRoutines.length})\n`;
      for (const r of activeRoutines) {
        summaryMarkdown += `* \`${r.name}\` (${r.cadence}) — Last run: ${r.lastRunAt ? new Date(r.lastRunAt).toLocaleTimeString() : 'Pending'}\n`;
      }
      summaryMarkdown += `\n`;
    }

    if (params.recentAccomplishments && params.recentAccomplishments.length > 0) {
      summaryMarkdown += `### ✅ Background Progress & Accomplishments\n`;
      for (const acc of params.recentAccomplishments) {
        summaryMarkdown += `* ${acc}\n`;
      }
    }

    const brief: PromeyMorningBrief = {
      briefId,
      date: today,
      headline,
      summaryMarkdown,
      highPriorityItems: highPriority,
      pendingApprovals: params.pendingApprovals,
      activeRoutinesCount: activeRoutines.length,
      generatedAt: new Date().toISOString()
    };

    this.briefsHistory.set(briefId, brief);
    return brief;
  }

  public getLatestBrief(): PromeyMorningBrief | undefined {
    const list = Array.from(this.briefsHistory.values());
    return list[list.length - 1];
  }

  public listBriefs(): PromeyMorningBrief[] {
    return Array.from(this.briefsHistory.values());
  }
}
