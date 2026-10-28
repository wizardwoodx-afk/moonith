/**
 * ROOK Engine Domain Contracts for SelfImpulse
 * Synthesizes Vision-Language GUI Grounding with Agentic Code Execution
 */

export type RookPermissionMode = 'plan' | 'build' | 'yolo';

export type RookActionModality = 'gui_vision' | 'code_terminal' | 'reasoning';

export interface BoundingBox2D {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export interface ScreenCoordinate {
  x: number;
  y: number;
  displayIndex?: number;
}

export interface GuiActionRequest {
  action: 'click' | 'double_click' | 'right_click' | 'drag' | 'type_text' | 'hotkey' | 'scroll';
  coordinates?: ScreenCoordinate;
  dragTarget?: ScreenCoordinate;
  text?: string;
  keys?: string[];
  scrollDelta?: { dx: number; dy: number };
}

export interface GuiVisualElement {
  id: string;
  label: string;
  role: string;
  box: BoundingBox2D;
  confidence: number;
  isInteractive: boolean;
}

export interface CodeFileOperation {
  action: 'read' | 'write' | 'patch' | 'search';
  path: string;
  content?: string;
  targetSubstring?: string;
  replacement?: string;
  patchDiff?: string;
  startLine?: number;
  endLine?: number;
}

export interface ShellExecutionRequest {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface ShellExecutionResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface RookExecutionTurn {
  turnIndex: number;
  modality: RookActionModality;
  thought: string;
  guiAction?: GuiActionRequest;
  codeAction?: CodeFileOperation;
  shellAction?: ShellExecutionRequest;
  output?: Record<string, unknown>;
  durationMs: number;
}

export interface RookTaskResult {
  taskId: string;
  status: 'completed' | 'awaiting_approval' | 'failed';
  permissionMode: RookPermissionMode;
  turns: RookExecutionTurn[];
  filesModified: string[];
  guiActionsExecuted: number;
  summary: string;
}
