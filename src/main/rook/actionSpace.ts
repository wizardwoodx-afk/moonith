import type { GuiActionRequest, ScreenCoordinate } from './types'

export interface TrajectoryPoint {
  x: number;
  y: number;
  t: number;
}

export class GuiActionSpace {
  private currentCursor: ScreenCoordinate = { x: 0, y: 0 };
  private executedActions: GuiActionRequest[] = [];

  public getCursorPosition(): ScreenCoordinate {
    return { ...this.currentCursor };
  }

  public planTrajectory(start: ScreenCoordinate, target: ScreenCoordinate, steps: number = 20): TrajectoryPoint[] {
    const points: TrajectoryPoint[] = [];
    const dx = target.x - start.x;
    const dy = target.y - start.y;
    const dist = Math.hypot(dx, dy);

    const curvature = 0.12;
    const normalX = -dy / (dist || 1);
    const normalY = dx / (dist || 1);
    const deflection = dist * curvature;

    const p0 = { x: start.x, y: start.y };
    const p1 = { x: start.x + dx * 0.3 + normalX * deflection, y: start.y + dy * 0.3 + normalY * deflection };
    const p2 = { x: start.x + dx * 0.7 - normalX * deflection * 0.5, y: start.y + dy * 0.7 - normalY * deflection * 0.5 };
    const p3 = { x: target.x, y: target.y };

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const ease = 1 - Math.pow(1 - t, 3);
      const inv = 1 - ease;

      const x = Math.pow(inv, 3) * p0.x + 3 * Math.pow(inv, 2) * ease * p1.x + 3 * inv * Math.pow(ease, 2) * p2.x + Math.pow(ease, 3) * p3.x;
      const y = Math.pow(inv, 3) * p0.y + 3 * Math.pow(inv, 2) * ease * p1.y + 3 * inv * Math.pow(ease, 2) * p2.y + Math.pow(ease, 3) * p3.y;

      points.push({ x: Math.round(x), y: Math.round(y), t });
    }

    return points;
  }

  public async executeGuiAction(req: GuiActionRequest): Promise<{ success: boolean; pathPoints?: number; details?: string }> {
    this.executedActions.push(req);

    if (req.coordinates) {
      const trajectory = this.planTrajectory(this.currentCursor, req.coordinates);
      this.currentCursor = { ...req.coordinates };

      return {
        success: true,
        pathPoints: trajectory.length,
        details: `Dispatched ${req.action} to (${req.coordinates.x}, ${req.coordinates.y})`
      };
    }

    if (req.action === 'drag' && req.dragTarget) {
      this.currentCursor = { ...req.dragTarget };
      return {
        success: true,
        details: `Dragged element to (${req.dragTarget.x}, ${req.dragTarget.y})`
      };
    }

    return {
      success: true,
      details: `Executed ${req.action}${req.text ? ` text: "${req.text}"` : ''}${req.keys ? ` keys: [${req.keys.join('+')}]` : ''}`
    };
  }

  public getHistory(): readonly GuiActionRequest[] {
    return this.executedActions;
  }
}
