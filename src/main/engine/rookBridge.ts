import { RookKernel } from '../rook/rookKernel'
import type { 
  GuiActionRequest, 
  RookExecutionTurn, 
  RookPermissionMode,
  ChangeRequest,
  ResearchReport,
  ResearchSource,
  InteractiveClarification,
  DeliverablePackage
} from '../rook/types'

/**
 * RookEngineBridge
 * Seamlessly interfaces the ROOK dual-engine (Visual GUI Perception + Software Engineering + Digital Worker)
 * into SelfImpulse's main execution engine without perturbing the primary state graph.
 */
export class RookEngineBridge {
  private static instance: RookEngineBridge;
  private kernel: RookKernel;

  private constructor() {
    this.kernel = new RookKernel();
  }

  public static getInstance(): RookEngineBridge {
    if (!RookEngineBridge.instance) {
      RookEngineBridge.instance = new RookEngineBridge();
    }
    return RookEngineBridge.instance;
  }

  public getKernel(): RookKernel {
    return this.kernel;
  }

  public setWorkspace(workspaceRoot: string): void {
    this.kernel.setWorkspace(workspaceRoot);
  }

  public setPermissionMode(mode: RookPermissionMode): void {
    this.kernel.setPermissionMode(mode);
  }

  public getPermissionMode(): RookPermissionMode {
    return this.kernel.getPermissionMode();
  }

  public async executeVisualAction(action: GuiActionRequest): Promise<RookExecutionTurn> {
    return this.kernel.executeVisualAction(action);
  }

  public async executeCodeEdit(
    filePath: string,
    targetSubstring: string,
    replacement: string
  ): Promise<RookExecutionTurn> {
    return this.kernel.executeCodeEdit(filePath, targetSubstring, replacement);
  }

  public async executeShellCommand(command: string): Promise<RookExecutionTurn> {
    return this.kernel.executeShell(command);
  }

  public createChangeRequest(params: {
    title: string;
    description: string;
    changedFiles: string[];
    diffSummary: string;
    targetBranch?: string;
  }): ChangeRequest {
    return this.kernel.worker.changeRequests.createChangeRequest(params);
  }

  public synthesizeResearch(topic: string, sources: ResearchSource[]): ResearchReport {
    return this.kernel.worker.research.synthesizeReport({ topic, sources });
  }

  public askClarification(question: string, context: string, options?: string[]): InteractiveClarification {
    return this.kernel.worker.gate.createQuestionGate({ question, context, options });
  }

  public registerDeliverable(pkg: Omit<DeliverablePackage, 'id' | 'timestamp'>): DeliverablePackage {
    return this.kernel.worker.registerDeliverable(pkg);
  }

  public getStatus(): {
    ready: boolean;
    permissionMode: RookPermissionMode;
    executionTurns: number;
    deliverablesCount: number;
    changeRequestsCount: number;
    pendingGatesCount: number;
  } {
    return {
      ready: true,
      permissionMode: this.kernel.getPermissionMode(),
      executionTurns: this.kernel.getLedger().length,
      deliverablesCount: this.kernel.worker.getDeliverables().length,
      changeRequestsCount: this.kernel.worker.changeRequests.listChangeRequests().length,
      pendingGatesCount: this.kernel.worker.gate.getPendingGates().length
    };
  }
}

export const rookEngineBridge = RookEngineBridge.getInstance();
