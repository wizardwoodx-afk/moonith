import type { ChangeRequest } from './types'

export class ChangeRequestManager {
  private requests: Map<string, ChangeRequest> = new Map();

  public createChangeRequest(params: {
    title: string;
    description: string;
    targetBranch?: string;
    changedFiles: string[];
    diffSummary: string;
    riskAssessment?: 'low' | 'medium' | 'high';
  }): ChangeRequest {
    const id = `cr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const cr: ChangeRequest = {
      id,
      title: params.title,
      description: params.description,
      targetBranch: params.targetBranch || 'main',
      changedFiles: params.changedFiles,
      diffSummary: params.diffSummary,
      riskAssessment: params.riskAssessment || (params.changedFiles.length > 5 ? 'high' : 'low'),
      status: 'pending_review',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.requests.set(id, cr);
    return cr;
  }

  public getChangeRequest(id: string): ChangeRequest | undefined {
    return this.requests.get(id);
  }

  public listChangeRequests(statusFilter?: ChangeRequest['status']): ChangeRequest[] {
    const all = Array.from(this.requests.values());
    if (statusFilter) {
      return all.filter(cr => cr.status === statusFilter);
    }
    return all;
  }

  public reviewChangeRequest(id: string, decision: 'approved' | 'rejected'): ChangeRequest {
    const cr = this.requests.get(id);
    if (!cr) {
      throw new Error(`Change Request not found: ${id}`);
    }
    cr.status = decision;
    cr.updatedAt = Date.now();
    return cr;
  }

  public applyChangeRequest(id: string): ChangeRequest {
    const cr = this.requests.get(id);
    if (!cr) {
      throw new Error(`Change Request not found: ${id}`);
    }
    if (cr.status !== 'approved') {
      throw new Error(`Cannot apply Change Request in '${cr.status}' state. Must be 'approved'.`);
    }
    cr.status = 'applied';
    cr.updatedAt = Date.now();
    return cr;
  }
}
