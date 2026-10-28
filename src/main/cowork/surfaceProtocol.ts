import type { SurfaceComponentSchema } from './types'

export type SurfaceFrameType =
  | 'thought_delta'
  | 'component_mount'
  | 'component_update'
  | 'component_unmount'
  | 'execution_status';

export interface SurfaceFrame {
  id: string;
  sessionId: string;
  timestamp: number;
  frameType: SurfaceFrameType;
  component?: SurfaceComponentSchema;
  deltaText?: string;
  statusPayload?: {
    phase: string;
    progressPercentage: number;
    message: string;
  };
}

export type SurfaceFrameListener = (frame: SurfaceFrame) => void;

export class SurfaceStreamer {
  private listeners: Set<SurfaceFrameListener> = new Set();
  private mountedComponents: Map<string, SurfaceComponentSchema> = new Map();

  public subscribe(listener: SurfaceFrameListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public streamThought(sessionId: string, delta: string): void {
    this.emit({
      id: `frame_${Date.now()}_thought`,
      sessionId,
      timestamp: Date.now(),
      frameType: 'thought_delta',
      deltaText: delta
    });
  }

  public mountWidget(sessionId: string, schema: SurfaceComponentSchema): void {
    this.mountedComponents.set(schema.id, schema);
    this.emit({
      id: `frame_${Date.now()}_mount`,
      sessionId,
      timestamp: Date.now(),
      frameType: 'component_mount',
      component: schema
    });
  }

  public emitStatus(sessionId: string, phase: string, progress: number, message: string): void {
    this.emit({
      id: `frame_${Date.now()}_status`,
      sessionId,
      timestamp: Date.now(),
      frameType: 'execution_status',
      statusPayload: {
        phase,
        progressPercentage: Math.min(100, Math.max(0, progress)),
        message
      }
    });
  }

  public getMountedWidgets(): readonly SurfaceComponentSchema[] {
    return Array.from(this.mountedComponents.values());
  }

  private emit(frame: SurfaceFrame): void {
    for (const listener of this.listeners) {
      try {
        listener(frame);
      } catch (err) {
        console.error('Surface frame listener error:', err);
      }
    }
  }
}
