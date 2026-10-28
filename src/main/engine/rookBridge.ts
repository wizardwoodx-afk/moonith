import { RookKernel } from '../rook/rookKernel'
import type { GuiActionRequest, RookExecutionTurn, RookPermissionMode } from '../rook/types'

/**
 * RookEngineBridge
 * Seamlessly interfaces the ROOK dual-engine (Visual GUI Perception + Software Engineering)
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

  public getStatus(): {
    ready: boolean;
    permissionMode: RookPermissionMode;
    executionTurns: number;
  } {
    return {
      ready: true,
      permissionMode: this.kernel.getPermissionMode(),
      executionTurns: this.kernel.getLedger().length
    };
  }
}

export const rookEngineBridge = RookEngineBridge.getInstance();
