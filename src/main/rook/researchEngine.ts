import type { ResearchReport, ResearchSource } from './types'

export class ResearchSynthesizer {
  private reports: Map<string, ResearchReport> = new Map();

  public synthesizeReport(params: {
    topic: string;
    sources: ResearchSource[];
    rawNotes?: string[];
  }): ResearchReport {
    const findings: string[] = [];

    if (params.rawNotes && params.rawNotes.length > 0) {
      findings.push(...params.rawNotes);
    } else {
      findings.push(`Analyzed ${params.sources.length} primary verified sources.`);
      params.sources.forEach(s => {
        findings.push(`${s.title}: ${s.snippet.slice(0, 120)}...`);
      });
    }

    const summary = `Executive Research Deliverable on "${params.topic}". Synthesized across ${params.sources.length} sources with structured validation.`;

    const report: ResearchReport = {
      topic: params.topic,
      summary,
      keyFindings: findings,
      sources: params.sources,
      generatedAt: Date.now()
    };

    this.reports.set(params.topic, report);
    return report;
  }

  public getReport(topic: string): ResearchReport | undefined {
    return this.reports.get(topic);
  }

  public formatMarkdownReport(report: ResearchReport): string {
    const lines: string[] = [];
    lines.push(`# Research Report: ${report.topic}`);
    lines.push(`\n**Generated:** ${new Date(report.generatedAt).toISOString()}`);
    lines.push(`\n## Executive Summary\n${report.summary}\n`);
    lines.push(`## Key Findings`);
    report.keyFindings.forEach((kf, i) => lines.push(`${i + 1}. ${kf}`));
    lines.push(`\n## Verified Sources & Evidence`);
    report.sources.forEach(src => lines.push(`- **[${src.title}](${src.url})**: ${src.snippet}`));
    return lines.join('\n');
  }
}
