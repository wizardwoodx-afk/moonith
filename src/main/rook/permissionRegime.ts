import type { RookActionModality, RookPermissionMode } from './types'

export interface PermissionCheckResult {
  allowed: boolean;
  requiresUserConfirmation: boolean;
  reason: string;
}

export class PermissionRegimeManager {
  private currentMode: RookPermissionMode;

  constructor(initialMode: RookPermissionMode = 'build') {
    this.currentMode = initialMode;
  }

  public setMode(mode: RookPermissionMode): void {
    this.currentMode = mode;
  }

  public getMode(): RookPermissionMode {
    return this.currentMode;
  }

  public evaluateAction(modality: RookActionModality, actionName: string, payload: Record<string, unknown>): PermissionCheckResult {
    if (this.currentMode === 'yolo') {
      return { allowed: true, requiresUserConfirmation: false, reason: 'Autonomous execution authorized under YOLO regime.' };
    }

    if (this.currentMode === 'plan') {
      if (actionName === 'read' || actionName === 'search' || actionName === 'inspect' || modality === 'reasoning') {
        return { allowed: true, requiresUserConfirmation: false, reason: 'Read-only action allowed in Plan regime.' };
      }
      return {
        allowed: false,
        requiresUserConfirmation: false,
        reason: `Action '${actionName}' forbidden in Plan regime. Switch to Build or YOLO to modify files/execute.`
      };
    }

    const payloadStr = JSON.stringify(payload).toLowerCase();
    const isDangerous = /rm\s+-rf|drop\s+table|format\s+drive|curl.*\|\s*sh|wipe/i.test(payloadStr);

    if (isDangerous) {
      return {
        allowed: false,
        requiresUserConfirmation: true,
        reason: `Hazardous pattern detected in action '${actionName}'. User confirmation required.`
      };
    }

    return {
      allowed: true,
      requiresUserConfirmation: false,
      reason: 'Standard engineering operation authorized in Build regime.'
    };
  }
}
