import type { BoundingBox, KineticInputEvent, KineticVector, SpatialCoordinates } from './types'

export interface DisplayGeometry {
  id: string;
  width: number;
  height: number;
  scaleFactor: number;
  isPrimary: boolean;
}

export class DisplayMatrix {
  private displays: DisplayGeometry[] = [];

  constructor(defaultDisplays?: DisplayGeometry[]) {
    if (defaultDisplays && defaultDisplays.length > 0) {
      this.displays = defaultDisplays;
    } else {
      this.displays = [
        {
          id: 'display_primary',
          width: 1920,
          height: 1080,
          scaleFactor: 1.0,
          isPrimary: true
        }
      ];
    }
  }

  public registerDisplay(geometry: DisplayGeometry): void {
    this.displays = this.displays.filter(d => d.id !== geometry.id);
    this.displays.push(geometry);
  }

  public denormalize(coords: SpatialCoordinates): { x: number; y: number } {
    const targetDisplay = coords.displayId
      ? this.displays.find(d => d.id === coords.displayId) || this.getPrimary()
      : this.getPrimary();

    if (!coords.normalized) {
      return { x: Math.round(coords.x), y: Math.round(coords.y) };
    }

    const realX = Math.round(coords.x * targetDisplay.width);
    const realY = Math.round(coords.y * targetDisplay.height);
    return { x: realX, y: realY };
  }

  public getCenterOfBounds(bounds: BoundingBox): SpatialCoordinates {
    return {
      x: Math.round(bounds.left + bounds.width / 2),
      y: Math.round(bounds.top + bounds.height / 2),
      normalized: false
    };
  }

  public getPrimary(): DisplayGeometry {
    return this.displays.find(d => d.isPrimary) || this.displays[0];
  }
}

export interface TrajectoryPoint {
  x: number;
  y: number;
  timeOffsetMs: number;
}

export class KineticActuator {
  private displayMatrix: DisplayMatrix;
  private currentPosition: { x: number; y: number } = { x: 0, y: 0 };
  private actionLog: KineticInputEvent[] = [];

  constructor(displayMatrix?: DisplayMatrix) {
    this.displayMatrix = displayMatrix || new DisplayMatrix();
  }

  public generateTrajectory(vector: KineticVector, steps: number = 24): TrajectoryPoint[] {
    const points: TrajectoryPoint[] = [];
    const p0 = { x: vector.startX, y: vector.startY };
    const p3 = { x: vector.targetX, y: vector.targetY };

    const dx = p3.x - p0.x;
    const dy = p3.y - p0.y;
    const distance = Math.hypot(dx, dy);

    const normalX = -dy / (distance || 1);
    const normalY = dx / (distance || 1);
    const deflection = distance * vector.curvature;

    const p1 = {
      x: p0.x + dx * 0.25 + normalX * deflection * 0.8,
      y: p0.y + dy * 0.25 + normalY * deflection * 0.8
    };

    const p2 = {
      x: p0.x + dx * 0.75 + normalX * deflection * 0.4,
      y: p0.y + dy * 0.75 + normalY * deflection * 0.4
    };

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const easeT = 1 - Math.pow(1 - t, 3);
      const oneMinusT = 1 - easeT;

      const x =
        Math.pow(oneMinusT, 3) * p0.x +
        3 * Math.pow(oneMinusT, 2) * easeT * p1.x +
        3 * oneMinusT * Math.pow(easeT, 2) * p2.x +
        Math.pow(easeT, 3) * p3.x;

      const y =
        Math.pow(oneMinusT, 3) * p0.y +
        3 * Math.pow(oneMinusT, 2) * easeT * p1.y +
        3 * oneMinusT * Math.pow(easeT, 2) * p2.y +
        Math.pow(easeT, 3) * p3.y;

      points.push({
        x: Math.round(x),
        y: Math.round(y),
        timeOffsetMs: Math.round(t * vector.durationMs)
      });
    }

    return points;
  }

  public async dispatchKineticEvent(event: KineticInputEvent): Promise<{ success: boolean; executedPathPoints?: number }> {
    this.actionLog.push(event);

    if (event.coordinates) {
      const target = this.displayMatrix.denormalize(event.coordinates);
      const vector: KineticVector = {
        startX: this.currentPosition.x,
        startY: this.currentPosition.y,
        targetX: target.x,
        targetY: target.y,
        curvature: 0.15,
        durationMs: 180,
        easingCurve: 'natural_bezier'
      };

      const path = this.generateTrajectory(vector);
      this.currentPosition = target;

      return {
        success: true,
        executedPathPoints: path.length
      };
    }

    return { success: true };
  }

  public getCurrentCoordinates(): SpatialCoordinates {
    return {
      x: this.currentPosition.x,
      y: this.currentPosition.y,
      normalized: false
    };
  }

  public getDisplayMatrix(): DisplayMatrix {
    return this.displayMatrix;
  }
}
