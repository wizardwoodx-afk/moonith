/**
 * Cowork Engine Domain Contracts for SelfImpulse
 * Unified Autonomous Coworker Subsystem
 */

export type CoworkSessionStatus =
  | 'idle'
  | 'planning'
  | 'executing'
  | 'awaiting_human'
  | 'quarantined'
  | 'completed'
  | 'faulted';

export type ActionModality =
  | 'cognitive'
  | 'kinetic'
  | 'perception'
  | 'surface'
  | 'tool';

export interface SpatialCoordinates {
  x: number;
  y: number;
  displayId?: string;
  normalized?: boolean;
}

export interface BoundingBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface KineticVector {
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  curvature: number;
  durationMs: number;
  easingCurve: 'natural_bezier' | 'linear' | 'ballistic';
}

export interface KineticInputEvent {
  kind: 'click' | 'double_click' | 'right_click' | 'hover' | 'drag' | 'type_text' | 'key_combination' | 'scroll';
  coordinates?: SpatialCoordinates;
  vector?: KineticVector;
  textPayload?: string;
  keys?: string[];
  scrollDelta?: { deltaX: number; deltaY: number };
}

export interface PerceptionNode {
  nodeId: string;
  tag: string;
  role?: string;
  accessibleName?: string;
  bounds: BoundingBox;
  isClickable: boolean;
  isTextInput: boolean;
  value?: string;
  children?: PerceptionNode[];
}

export interface PerceptionSnapshot {
  timestamp: number;
  viewportWidth: number;
  viewportHeight: number;
  activeUrl?: string;
  pageTitle?: string;
  domTree: PerceptionNode[];
  rawScreenshotBase64?: string;
}

export interface SurfaceComponentSchema {
  id: string;
  componentType: 'approval_dialog' | 'data_table' | 'metric_card' | 'progress_tracker' | 'terminal_feed' | 'thought_stream';
  title: string;
  description?: string;
  props: Record<string, unknown>;
  requiresUserAction?: boolean;
  actionOptions?: Array<{
    id: string;
    label: string;
    intent: 'confirm' | 'reject' | 'modify';
  }>;
}

export interface SecurityPolicyRule {
  ruleId: string;
  description: string;
  modality: ActionModality;
  targetPattern: string;
  effect: 'allow' | 'deny' | 'require_approval';
  riskScore: number;
}

export interface HumanInterventionRequest {
  requestId: string;
  sessionId: string;
  timestamp: number;
  reason: string;
  component: SurfaceComponentSchema;
  resolved: boolean;
  resolutionDecision?: 'approved' | 'rejected' | 'modified';
  userInput?: Record<string, unknown>;
}

export interface CoworkStepResult {
  stepIndex: number;
  modality: ActionModality;
  actionName: string;
  inputPayload: Record<string, unknown>;
  outputPayload?: Record<string, unknown>;
  error?: string;
  elapsedMs: number;
  divergenceScore: number;
}
