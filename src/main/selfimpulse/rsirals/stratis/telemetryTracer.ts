import crypto from 'node:crypto'
import type { StratisSpan } from './types'

export class StratisTelemetryTracer {
  private spans: Map<string, StratisSpan> = new Map();

  public startSpan(
    name: string,
    spanType: StratisSpan['spanType'],
    metadata: Record<string, unknown> = {},
    parentSpanId?: string
  ): StratisSpan {
    const spanId = `span_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const span: StratisSpan = {
      spanId,
      parentSpanId,
      name,
      spanType,
      startTime: Date.now(),
      status: 'ok',
      metadata
    };

    this.spans.set(spanId, span);
    return span;
  }

  public endSpan(spanId: string, status: 'ok' | 'error' = 'ok', error?: string): StratisSpan | undefined {
    const span = this.spans.get(spanId);
    if (!span) return undefined;

    span.endTime = Date.now();
    span.status = status;
    if (error) {
      span.errorMessage = error;
    }

    return span;
  }

  public getTrace(spanId: string): StratisSpan | undefined {
    return this.spans.get(spanId);
  }

  public listSpans(): StratisSpan[] {
    return Array.from(this.spans.values()).sort((a, b) => b.startTime - a.startTime);
  }

  public getSpanTree(rootSpanId: string): StratisSpan[] {
    const results: StratisSpan[] = [];
    const collectChildren = (parentId: string) => {
      for (const span of this.spans.values()) {
        if (span.parentSpanId === parentId) {
          results.push(span);
          collectChildren(span.spanId);
        }
      }
    };

    const root = this.spans.get(rootSpanId);
    if (root) {
      results.push(root);
      collectChildren(rootSpanId);
    }

    return results;
  }
}
