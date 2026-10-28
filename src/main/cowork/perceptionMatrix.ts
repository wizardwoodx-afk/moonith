import type { BoundingBox, PerceptionNode, PerceptionSnapshot } from './types'

export interface RawElementRepresentation {
  tag: string;
  id?: string;
  className?: string;
  role?: string;
  accessibleName?: string;
  rect: { x: number; y: number; width: number; height: number };
  value?: string;
  interactive: boolean;
}

export class DomMatrix {
  public parseDomHierarchy(elements: RawElementRepresentation[]): PerceptionSnapshot {
    const nodes: PerceptionNode[] = [];

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const bounds: BoundingBox = {
        top: el.rect.y,
        left: el.rect.x,
        width: el.rect.width,
        height: el.rect.height
      };

      const isText = el.tag.toLowerCase() === 'input' || el.tag.toLowerCase() === 'textarea' || el.role === 'textbox';

      nodes.push({
        nodeId: `node_${i}_${el.tag}`,
        tag: el.tag,
        role: el.role,
        accessibleName: el.accessibleName,
        bounds,
        isClickable: el.interactive || el.tag === 'button' || el.tag === 'a',
        isTextInput: isText,
        value: el.value
      });
    }

    return {
      timestamp: Date.now(),
      viewportWidth: 1920,
      viewportHeight: 1080,
      domTree: nodes
    };
  }

  public locateElementByIntent(snapshot: PerceptionSnapshot, query: string): PerceptionNode | null {
    const normalizedQuery = query.toLowerCase().trim();

    for (const node of snapshot.domTree) {
      if (node.accessibleName && node.accessibleName.toLowerCase() === normalizedQuery) {
        return node;
      }
    }

    for (const node of snapshot.domTree) {
      if (node.accessibleName && node.accessibleName.toLowerCase().includes(normalizedQuery)) {
        return node;
      }
    }

    for (const node of snapshot.domTree) {
      if (node.role && node.role.toLowerCase() === normalizedQuery) {
        return node;
      }
    }

    return null;
  }
}

export class BrowserLens {
  private domMatrix: DomMatrix;
  private currentUrl?: string;
  private pageTitle?: string;

  constructor() {
    this.domMatrix = new DomMatrix();
  }

  public async navigateTo(url: string): Promise<{ success: boolean; url: string; status: number }> {
    this.currentUrl = url;
    try {
      this.pageTitle = `Perception Session - ${new URL(url).hostname}`;
    } catch {
      this.pageTitle = 'Perception Session';
    }
    return {
      success: true,
      url: this.currentUrl,
      status: 200
    };
  }

  public captureSnapshot(mockElements?: RawElementRepresentation[]): PerceptionSnapshot {
    const elements = mockElements || [
      {
        tag: 'header',
        rect: { x: 0, y: 0, width: 1920, height: 60 },
        interactive: false
      },
      {
        tag: 'button',
        accessibleName: 'Execute Task',
        role: 'button',
        rect: { x: 700, y: 350, width: 140, height: 44 },
        interactive: true
      },
      {
        tag: 'input',
        accessibleName: 'Target Query',
        role: 'textbox',
        rect: { x: 300, y: 350, width: 380, height: 44 },
        interactive: true,
        value: ''
      }
    ];

    const snapshot = this.domMatrix.parseDomHierarchy(elements);
    snapshot.activeUrl = this.currentUrl;
    snapshot.pageTitle = this.pageTitle;
    return snapshot;
  }

  public getDomMatrix(): DomMatrix {
    return this.domMatrix;
  }
}
