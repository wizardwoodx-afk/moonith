import { VisualGroundingEngine } from './visualGrounding'
import { GuiActionSpace } from './actionSpace'
import { ScreenSensor } from './screenSensor'
import { CodeFileEngine } from './fileEngine'
import { ShellExecutor } from './shellExecutor'
import { PermissionRegimeManager } from './permissionRegime'
import { ContextCompactor } from './contextCompactor'
import { DigitalWorkerRuntime } from './digitalWorker'
import type {
  GuiActionRequest,
  CodeFileOperation,
  RookPermissionMode,
  RookTaskResult,
  RookExecutionTurn,
  ShellExecutionRequest
} from './types'

export interface RookKernelOptions {
  workspacePath: string;
  permissionMode: RookPermissionMode;
  displayWidth?: number;
  displayHeight?: number;
}

export class RookKernel {
  public readonly grounding: VisualGroundingEngine;
  public readonly actionSpace: GuiActionSpace;
  public readonly sensor: ScreenSensor;
  public readonly fileEngine: CodeFileEngine;
  public readonly shell: ShellExecutor;
  public readonly permissions: PermissionRegimeManager;
  public readonly compactor: ContextCompactor;
  public readonly worker: DigitalWorkerRuntime;
  private turns: RookExecutionTurn[] = [];

  constructor(options: Partial<RookKernelOptions> = {}) {
    const ws = options.workspacePath || process.cwd();
    this.grounding = new VisualGroundingEngine({
      width: options.displayWidth ?? 1920,
      height: options.displayHeight ?? 1080
    });
    this.actionSpace = new GuiActionSpace();
    this.sensor = new ScreenSensor(this.grounding);
    this.fileEngine = new CodeFileEngine(ws);
    this.shell = new ShellExecutor(ws);
    this.permissions = new PermissionRegimeManager(options.permissionMode || 'build');
    this.compactor = new ContextCompactor();
    this.worker = new DigitalWorkerRuntime(ws);
  }

  public setPermissionMode(mode: RookPermissionMode): void {
    this.permissions.setMode(mode);
  }

  public getPermissionMode(): RookPermissionMode {
    return this.permissions.getMode();
  }

  public async executeVisualAction(action: GuiActionRequest, thought: string = 'Execute visual action'): Promise<RookExecutionTurn> {
    const startTime = Date.now();
    const perm = this.permissions.evaluateAction('gui_vision', action.action, action as unknown as Record<string, unknown>);

    if (!perm.allowed) {
      throw new Error(`GUI Action Blocked: ${perm.reason}`);
    }

    const res = await this.actionSpace.executeGuiAction(action);
    const turn: RookExecutionTurn = {
      turnIndex: this.turns.length + 1,
      modality: 'gui_vision',
      thought,
      guiAction: action,
      output: { ...res },
      durationMs: Date.now() - startTime
    };

    this.turns.push(turn);
    return turn;
  }

  public async executeCodeAction(op: CodeFileOperation, thought: string = 'Perform file operation'): Promise<RookExecutionTurn> {
    const startTime = Date.now();
    const perm = this.permissions.evaluateAction('code_terminal', op.action, op as unknown as Record<string, unknown>);

    if (!perm.allowed) {
      throw new Error(`Code Operation Blocked: ${perm.reason}`);
    }

    const res = await this.fileEngine.executeOperation(op);
    const turn: RookExecutionTurn = {
      turnIndex: this.turns.length + 1,
      modality: 'code_terminal',
      thought,
      codeAction: op,
      output: { ...res },
      durationMs: Date.now() - startTime
    };

    this.turns.push(turn);
    return turn;
  }

  public async executeTerminalCommand(cmd: ShellExecutionRequest, thought: string = 'Run terminal command'): Promise<RookExecutionTurn> {
    const startTime = Date.now();
    const perm = this.permissions.evaluateAction('code_terminal', 'shell', cmd as unknown as Record<string, unknown>);

    if (!perm.allowed) {
      throw new Error(`Terminal Execution Blocked: ${perm.reason}`);
    }

    const res = await this.shell.executeCommand(cmd);
    const turn: RookExecutionTurn = {
      turnIndex: this.turns.length + 1,
      modality: 'code_terminal',
      thought,
      shellAction: cmd,
      output: { ...res },
      durationMs: Date.now() - startTime
    };

    this.turns.push(turn);
    return turn;
  }

  public setWorkspace(workspaceRoot: string): void {
    this.fileEngine.setWorkspaceRoot(workspaceRoot);
    this.shell.setWorkspaceRoot(workspaceRoot);
    this.worker.sandbox.setWorkspaceRoot(workspaceRoot);
  }

  public async executeCodeEdit(filePath: string, targetSubstring: string, replacement: string, thought = 'Patch source file'): Promise<RookExecutionTurn> {
    return this.executeCodeAction({
      action: 'patch',
      path: filePath,
      targetSubstring,
      replacement
    }, thought);
  }

  public async executeShell(command: string, thought = 'Run shell command'): Promise<RookExecutionTurn> {
    return this.executeTerminalCommand({
      command
    }, thought);
  }

  public getTurns(): readonly RookExecutionTurn[] {
    return this.turns;
  }

  public getLedger(): readonly RookExecutionTurn[] {
    return this.turns;
  }
}
