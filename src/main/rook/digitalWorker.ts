import type { DeliverablePackage, ChangeRequest } from './types'
import { ChangeRequestManager } from './changeRequest'
import { ResearchSynthesizer } from './researchEngine'
import { InteractiveGate } from './interactiveGate'
import { ResourceSandboxGuard } from './sandboxGuard'

export class DigitalWorkerRuntime {
  public readonly changeRequests: ChangeRequestManager;
  public readonly research: ResearchSynthesizer;
  public readonly gate: InteractiveGate;
  public readonly sandbox: ResourceSandboxGuard;
  private deliverables: DeliverablePackage[] = [];

  constructor(workspacePath: string = process.cwd()) {
    this.changeRequests = new ChangeRequestManager();
    this.research = new ResearchSynthesizer();
    this.gate = new InteractiveGate();
    this.sandbox = new ResourceSandboxGuard(workspacePath);
  }

  public registerDeliverable(deliverable: Omit<DeliverablePackage, 'id' | 'timestamp'>): DeliverablePackage {
    const pkg: DeliverablePackage = {
      ...deliverable,
      id: `deliv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      content: this.sandbox.redactSecrets(deliverable.content),
      timestamp: Date.now()
    };
    this.deliverables.push(pkg);
    return pkg;
  }

  public getDeliverables(): readonly DeliverablePackage[] {
    return this.deliverables;
  }

  public packageTaskCompletion(params: {
    title: string;
    summary: string;
    artifacts: Array<{ title: string; content: string; type?: DeliverablePackage['type'] }>;
    createdChangeRequest?: ChangeRequest;
  }): { deliverables: DeliverablePackage[]; changeRequest?: ChangeRequest } {
    const registered: DeliverablePackage[] = [];

    for (const art of params.artifacts) {
      const deliv = this.registerDeliverable({
        title: art.title,
        type: art.type || 'document',
        content: art.content,
        changeRequestId: params.createdChangeRequest?.id
      });
      registered.push(deliv);
    }

    return {
      deliverables: registered,
      changeRequest: params.createdChangeRequest
    };
  }
}
