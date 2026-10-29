import { describe, it, expect } from 'vitest';
import {
  promeyGenerateBriefTool,
  promeyTriageStreamTool,
  promeyRequestApprovalTool,
  promeyMaskCredentialTool,
  promeyScanDlpTool,
  promeyScheduleRoutineTool,
  promeyStreamGenerativeUiTool,
  promeyTools
} from './promeyTools';
import type { ToolContext } from './types';

const dummyCtx = {} as ToolContext;

describe('Promey Native Agent Tools', () => {
  it('exposes all 7 core native tools', () => {
    expect(promeyTools.length).toBe(7);
  });

  it('generates executive morning brief', async () => {
    const res = (await promeyGenerateBriefTool.execute(
      { userName: 'Lead Engineer', workspaceName: 'SelfImpulse' },
      dummyCtx
    )) as any;
    expect(res.status).toBe('generated');
    expect(res.content).toBeDefined();
    expect(res.headline).toBeDefined();
    expect(res.summaryMarkdown).toBeDefined();
  });

  it('triages an incoming stream event', async () => {
    const res = (await promeyTriageStreamTool.execute(
      {
        source: 'git',
        title: 'Pull Request #42 merged',
        content: 'Feature branch merged into main',
        urgency: 'normal',
        category: 'informational'
      },
      dummyCtx
    )) as any;
    expect(res.status).toBe('triaged');
    expect(res.content).toBeDefined();
    expect(res.itemId).toBeDefined();
  });

  it('requests consequential approval', async () => {
    const res = (await promeyRequestApprovalTool.execute(
      {
        actionType: 's3_upload',
        title: 'Upload build artifact',
        description: 'Upload release 0.3.0 to CDN bucket',
        targetResource: 's3://release-cdn',
        consequenceLevel: 'medium'
      },
      dummyCtx
    )) as any;
    expect(res.status).toBeDefined();
    expect(res.content).toBeDefined();
    expect(res.approvalId).toBeDefined();
  });

  it('masks secret credentials for transcript protection', async () => {
    const res = (await promeyMaskCredentialTool.execute(
      {
        secretValue: 'sk_live_very_secret_token_123',
        label: 'stripe'
      },
      dummyCtx
    )) as any;
    expect(res.status).toBe('masked');
    expect(res.content).toBeDefined();
    expect(res.maskedToken).toContain('__PROMEY_MASKED_STRIPE_');
    expect(res.safeForTranscript).toBe(true);
  });

  it('scans text with outbound DLP guard', async () => {
    const res = (await promeyScanDlpTool.execute(
      {
        text: 'My token is ghp_123456789012345678901234567890123456'
      },
      dummyCtx
    )) as any;
    expect(res.status).toBe('scanned');
    expect(res.content).toBeDefined();
    expect(res.sanitizedText).toContain('[REDACTED_GITHUB_PERSONAL_TOKEN]');
    expect(res.redactedDlpCount).toBeGreaterThanOrEqual(1);
  });

  it('schedules an autonomous standing routine', async () => {
    const res = (await promeyScheduleRoutineTool.execute(
      {
        name: 'Nightly Vulnerability Scan',
        cadence: 'daily_evening',
        standingPrompt: 'Audit all npm package hashes against CVE database.'
      },
      dummyCtx
    )) as any;
    expect(res.status).toBe('scheduled');
    expect(res.content).toBeDefined();
    expect(res.routineId).toBeDefined();
  });

  it('streams generative UI widget', async () => {
    const res = (await promeyStreamGenerativeUiTool.execute(
      {
        type: 'status_pill',
        title: 'Duet Mode Active',
        data: { connected: true, latencyMs: 12 }
      },
      dummyCtx
    )) as any;
    expect(res.status).toBe('emitted');
    expect(res.content).toBeDefined();
    expect(res.widgetId).toBeDefined();
  });
});
