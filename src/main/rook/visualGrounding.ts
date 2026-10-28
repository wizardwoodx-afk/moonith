import type { BoundingBox2D, GuiVisualElement, ScreenCoordinate } from './types'

export interface DisplayResolution {
  width: number;
  height: number;
  scaleFactor: number;
}

export class VisualGroundingEngine {
  private display: DisplayResolution;

  constructor(display: Partial<DisplayResolution> = {}) {
    this.display = {
      width: display.width ?? 1920,
      height: display.height ?? 1080,
      scaleFactor: display.scaleFactor ?? 1.0
    };
  }

  public setResolution(width: number, height: number, scaleFactor: number = 1.0): void {
    this.display = { width, height, scaleFactor };
  }

  public getResolution(): DisplayResolution {
    return { ...this.display };
  }

  public denormalizeBox(box: BoundingBox2D): { top: number; left: number; width: number; height: number } {
    const left = Math.round((box.xmin / 1000) * this.display.width);
    const top = Math.round((box.ymin / 1000) * this.display.height);
    const right = Math.round((box.xmax / 1000) * this.display.width);
    const bottom = Math.round((box.ymax / 1000) * this.display.height);

    return {
      top,
      left,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top)
    };
  }

  public getCenterPoint(box: BoundingBox2D): ScreenCoordinate {
    const physical = this.denormalizeBox(box);
    return {
      x: Math.round(physical.left + physical.width / 2),
      y: Math.round(physical.top + physical.height / 2)
    };
  }

  public locateElement(elements: GuiVisualElement[], query: string): GuiVisualElement | null {
    const q = query.toLowerCase().trim();

    for (const el of elements) {
      if (el.label.toLowerCase() === q) return el;
    }

    for (const el of elements) {
      if (el.label.toLowerCase().includes(q)) return el;
    }

    for (const el of elements) {
      if (`${el.role} ${el.label}`.toLowerCase().includes(q)) return el;
    }

    return null;
  }
}
