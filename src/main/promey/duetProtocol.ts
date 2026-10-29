/**
 * PROPRIETARY - SelfImpulse Promey Duet Engine
 * Event-Driven Duet Protocol: State Delta Streaming & Generative UI
 */

import crypto from 'node:crypto';
import type { 
  PromeyDuetStateDelta, 
  PromeyGenerativeUiWidget 
} from './types';

export class PromeyDuetProtocol {
  private activeSessions: Map<string, { currentSequence: number; lastActivity: string }> = new Map();
  private eventHistory: PromeyDuetStateDelta[] = [];
  private activeWidgets: Map<string, PromeyGenerativeUiWidget> = new Map();

  /**
   * Emit an event-driven state delta to the frontend
   */
  public emitDelta(
    sessionId: string,
    eventType: PromeyDuetStateDelta['eventType'],
    payload: Record<string, unknown>
  ): PromeyDuetStateDelta {
    let session = this.activeSessions.get(sessionId);
    if (!session) {
      session = { currentSequence: 0, lastActivity: new Date().toISOString() };
      this.activeSessions.set(sessionId, session);
    }

    session.currentSequence++;
    session.lastActivity = new Date().toISOString();

    const delta: PromeyDuetStateDelta = {
      sessionId,
      sequenceNumber: session.currentSequence,
      eventType,
      payload,
      timestamp: new Date().toISOString()
    };

    this.eventHistory.push(delta);
    if (this.eventHistory.length > 500) {
      this.eventHistory.shift();
    }

    return delta;
  }

  /**
   * Propose a Generative UI widget (e.g. approval card, triage stream, live diff)
   */
  public emitGenerativeUi(widget: Omit<PromeyGenerativeUiWidget, 'widgetId'>): PromeyGenerativeUiWidget {
    const widgetId = `genui-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const fullWidget: PromeyGenerativeUiWidget = {
      widgetId,
      ...widget
    };

    this.activeWidgets.set(widgetId, fullWidget);
    this.emitDelta('default-duet-session', 'generative_ui', { widget: fullWidget });
    return fullWidget;
  }

  /**
   * Handle mid-stream human interruption and takeover
   */
  public handleHumanInterrupt(sessionId: string, humanInstructions: string): PromeyDuetStateDelta {
    return this.emitDelta(sessionId, 'human_interrupt', {
      pausedAt: new Date().toISOString(),
      instructions: humanInstructions,
      state: 'awaiting_human_steer'
    });
  }

  /**
   * Hand back control to the autonomous agent loop after human steering
   */
  public handbackToAgent(sessionId: string, contextPatch?: Record<string, unknown>): PromeyDuetStateDelta {
    return this.emitDelta(sessionId, 'handback', {
      resumedAt: new Date().toISOString(),
      contextPatch: contextPatch || {},
      state: 'autonomous_executing'
    });
  }

  public getSessionDeltas(sessionId: string): PromeyDuetStateDelta[] {
    return this.eventHistory.filter((e) => e.sessionId === sessionId);
  }

  public listActiveWidgets(): PromeyGenerativeUiWidget[] {
    return Array.from(this.activeWidgets.values());
  }

  public getTelemetry(): {
    activeSessionsCount: number;
    totalDeltasEmitted: number;
    activeWidgetsCount: number;
  } {
    return {
      activeSessionsCount: this.activeSessions.size,
      totalDeltasEmitted: this.eventHistory.length,
      activeWidgetsCount: this.activeWidgets.size
    };
  }
}
