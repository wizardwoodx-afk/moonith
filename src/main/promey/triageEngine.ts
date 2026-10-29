/**
 * PROPRIETARY - SelfImpulse Promey Duet Engine
 * Smart Stream & Inbox Triage Engine
 */

import crypto from 'node:crypto';
import type { PromeyTriageItem } from './types';

export class PromeyTriageEngine {
  private items: Map<string, PromeyTriageItem> = new Map();

  constructor() {
    this.seedBaselineItems();
  }

  private seedBaselineItems(): void {
    this.ingestItem({
      source: 'workspace',
      title: 'Repository Build Verification',
      content: 'Local workspace clean and ready for proactive task scheduling.',
      urgency: 'low',
      category: 'informational',
      suggestedAction: 'No action required.'
    });
  }

  public ingestItem(
    item: Omit<PromeyTriageItem, 'id' | 'receivedAt' | 'status' | 'urgency' | 'category'> & {
      status?: PromeyTriageItem['status']
      urgency?: PromeyTriageItem['urgency']
      category?: PromeyTriageItem['category']
      suggestedAction?: string
    }
  ): PromeyTriageItem {
    const id = `triage-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const fullItem: PromeyTriageItem = {
      id,
      receivedAt: new Date().toISOString(),
      status: item.status || 'action_required',
      urgency: item.urgency || 'normal',
      category: item.category || 'informational',
      ...item
    };

    // Auto-calculate urgency heuristics if not explicitly set
    const text = `${item.title} ${item.content}`.toLowerCase();
    if (text.includes('security') || text.includes('vulnerability') || text.includes('breach') || text.includes('fatal')) {
      fullItem.urgency = 'critical';
      fullItem.category = 'action_required';
    } else if (text.includes('fail') || text.includes('error') || text.includes('urgent') || text.includes('deadline')) {
      fullItem.urgency = fullItem.urgency === 'critical' ? 'critical' : 'high';
      fullItem.category = 'action_required';
    }

    this.items.set(id, fullItem);
    return fullItem;
  }

  public resolveItem(id: string, note?: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    item.status = 'resolved';
    if (note) item.content += ` [Resolved: ${note}]`;
    return true;
  }

  public dismissItem(id: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    item.status = 'dismissed';
    return true;
  }

  public listItems(filter?: { urgency?: PromeyTriageItem['urgency']; status?: PromeyTriageItem['status'] }): PromeyTriageItem[] {
    return Array.from(this.items.values()).filter((item) => {
      if (filter?.urgency && item.urgency !== filter.urgency) return false;
      if (filter?.status && item.status !== filter.status) return false;
      return true;
    });
  }

  public getPendingActionItems(): PromeyTriageItem[] {
    return this.listItems({ status: 'action_required' });
  }

  public getTelemetry(): {
    totalItemsCount: number;
    pendingActionCount: number;
    criticalCount: number;
    resolvedCount: number;
  } {
    const all = Array.from(this.items.values());
    return {
      totalItemsCount: all.length,
      pendingActionCount: all.filter((i) => i.status === 'action_required').length,
      criticalCount: all.filter((i) => i.urgency === 'critical' && i.status !== 'resolved').length,
      resolvedCount: all.filter((i) => i.status === 'resolved').length
    };
  }
}
