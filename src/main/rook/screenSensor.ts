import type { GuiVisualElement } from './types'
import { VisualGroundingEngine } from './visualGrounding'

export interface ScreenObservation {
  timestamp: number;
  width: number;
  height: number;
  activeWindow?: string;
  detectedElements: GuiVisualElement[];
}

export class ScreenSensor {
  private grounding: VisualGroundingEngine;

  constructor(grounding?: VisualGroundingEngine) {
    this.grounding = grounding || new VisualGroundingEngine();
  }

  public captureScreen(mockElements?: GuiVisualElement[]): ScreenObservation {
    const res = this.grounding.getResolution();

    const elements: GuiVisualElement[] = mockElements || [
      {
        id: 'btn_terminal',
        label: 'New Terminal',
        role: 'button',
        box: { ymin: 40, xmin: 150, ymax: 70, xmax: 270 },
        confidence: 0.98,
        isInteractive: true
      },
      {
        id: 'editor_input',
        label: 'Code Editor Surface',
        role: 'textbox',
        box: { ymin: 100, xmin: 200, ymax: 800, xmax: 950 },
        confidence: 0.96,
        isInteractive: true
      },
      {
        id: 'btn_run',
        label: 'Run Test Suite',
        role: 'button',
        box: { ymin: 40, xmin: 300, ymax: 70, xmax: 420 },
        confidence: 0.99,
        isInteractive: true
      }
    ];

    return {
      timestamp: Date.now(),
      width: res.width,
      height: res.height,
      activeWindow: 'Active Workspace Surface',
      detectedElements: elements
    };
  }

  public getGrounding(): VisualGroundingEngine {
    return this.grounding;
  }
}
